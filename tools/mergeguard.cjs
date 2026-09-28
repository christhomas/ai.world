/*
 * Check the code GitHub would merge, against the first parent of its synthetic PR merge commit.
 * This catches the #221 failure: a stale branch restored the reachability bench's inline excuse
 * list after main had moved that list to tools/excused.ts. Both versions passed their own tests.
 */
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { parse } = require('@babel/parser');

const RATCHETS = ['ALREADY_LIKE_THIS', 'ALREADY_UNEXPLAINED', 'NAMED_NOWHERE_ALREADY'];
const COUNTS = new Map([
  ['ALREADY_LIKE_THIS', 'orphans'],
  ['ALREADY_UNEXPLAINED', 'unexplained'],
  ['NAMED_NOWHERE_ALREADY', 'never'],
]);

function parsed(source) {
  return parse(source, { sourceType: 'module', plugins: ['typescript'] }).program;
}

function allowances(source) {
  const file = parsed(source);
  const values = new Map(RATCHETS.map((name) => [name, null]));
  const seen = new Set();
  for (const statement of file.body) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue;
    for (const declaration of statement.declarations) {
      if (declaration.id.type !== 'Identifier' || !RATCHETS.includes(declaration.id.name)) continue;
      const value = declaration.init?.type === 'NumericLiteral' ? declaration.init.value : null;
      const name = declaration.id.name;
      values.set(name, seen.has(name) ? null : value);
      seen.add(name);
    }
  }
  return values;
}

function walk(node, visit) {
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return; }
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (!['loc', 'start', 'end', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) {
      walk(value, visit);
    }
  }
}

function identifier(node, name) {
  return node?.type === 'Identifier' && node.name === name;
}

function property(node, name) {
  return node?.type === 'MemberExpression' && !node.computed && identifier(node.property, name);
}

function called(node, name) {
  return node?.type === 'CallExpression' && identifier(node.callee, name);
}

function hasRatchetAssertion(file, name) {
  const target = COUNTS.get(name);
  let found = false;
  walk(file, (node) => {
    if (node.type === 'CallExpression' && property(node.callee, 'toBeLessThanOrEqual')
      && node.arguments.length === 1 && identifier(node.arguments[0], name)) {
      const actual = node.callee.object;
      const measured = called(actual, 'expect') && actual.arguments[0];
      if (property(measured, 'length') && identifier(measured.object, target)) found = true;
    }
  });
  return found;
}

function hasExcuseReasonAssertion(file) {
  let found = false;
  walk(file, (node) => {
    if (node.type === 'CallExpression' && property(node.callee, 'toEqual') && node.arguments.length === 1
      && node.arguments[0].type === 'ArrayExpression' && node.arguments[0].elements.length === 0) {
      const actual = node.callee.object;
      if (called(actual, 'expect')) {
        let checksExcusedReasons = false;
        walk(actual.arguments[0], (part) => {
          if (part.type !== 'CallExpression' || !property(part.callee, 'filter')) return;
          const collection = part.callee.object;
          if (collection?.type !== 'ArrayExpression') return;
          let checksSharedList = false, checksReason = false;
          walk(collection, (entry) => { if (identifier(entry, 'EXCUSED')) checksSharedList = true; });
          walk(part.arguments[0], (predicate) => { if (called(predicate, 'isCheckable')) checksReason = true; });
          checksExcusedReasons ||= checksSharedList && checksReason;
        });
        if (checksExcusedReasons) found = true;
      }
    }
  });
  return found;
}

function regressions(base, merged) {
  const found = [];
  const file = parsed(merged);
  const before = allowances(base), after = allowances(merged);
  for (const name of RATCHETS) {
    const old = before.get(name), now = after.get(name);
    if (old === null || now === null) found.push(`${name} allowance disappeared`);
    else if (now > old) found.push(`${name} rose from ${old} to ${now}`);
    if (!hasRatchetAssertion(file, name)) {
      found.push(`${name} is no longer asserted`);
    }
  }
  const importsExcuses = file.body.some((statement) => statement.type === 'ImportDeclaration'
    && statement.source.value === '../../tools/excused'
    && ['EXCUSED', 'isCheckable'].every((name) => statement.specifiers
      .some((specifier) => specifier.type === 'ImportSpecifier' && (specifier.imported.name ?? specifier.imported.value) === name)));
  if (!importsExcuses || !hasExcuseReasonAssertion(file)) {
    found.push('reachability bench no longer imports the shared excuse list and its reason guard');
  }
  let hasInlineExplained = false;
  walk(file, (node) => {
    if (node.type === 'VariableDeclarator' && identifier(node.id, 'EXPLAINED')) hasInlineExplained = true;
  });
  if (hasInlineExplained) {
    found.push('inline EXPLAINED excuse list returned');
  }
  return found;
}

function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!event.pull_request) throw new Error('merge guard only runs for pull requests');
  const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { encoding: 'utf8' }).trim().split(' ');
  if (parents.length !== 3) throw new Error('checkout is not GitHub’s synthetic two-parent PR merge commit');
  const baseSha = event.pull_request.base.sha;
  if (parents[1] !== baseSha) throw new Error(`merge result uses base ${parents[1]}, expected ${baseSha}; rerun on current main`);
  const path = 'src/world/reachable.test.ts';
  const base = execFileSync('git', ['show', `${parents[1]}:${path}`], { encoding: 'utf8' });
  const merged = readFileSync(path, 'utf8');
  const faults = regressions(base, merged);
  if (!faults.length) { console.log('Merge result keeps the reachability guards and their ratchets.'); return; }
  const labels = event.pull_request.labels ?? [];
  const explanation = /^Merge guard exception:\s*(.{30,})$/m.exec(event.pull_request.body ?? '');
  if (labels.some((label) => label.name === 'merge-guard-exception') && explanation) {
    console.log(`Maintainer exception: ${explanation[1]}`);
    console.log(faults.join('\n'));
    return;
  }
  throw new Error(`PR merge result restores or weakens a guard:\n${faults.map((fault) => `- ${fault}`).join('\n')}\nAn intentional change needs the maintainer's merge-guard-exception label and a PR-body line 'Merge guard exception: <reason, at least 30 characters>'.`);
}

if (require.main === module) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { allowances, regressions };
