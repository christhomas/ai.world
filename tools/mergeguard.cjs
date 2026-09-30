/*
 * Check the code GitHub would merge, against the first parent of its synthetic PR merge commit —
 * or, on a push or dispatch run, the branch merged into origin/main, against origin/main (#534).
 * This catches the #221 failure: a stale branch restored the reachability bench's inline excuse
 * list after main had moved that list to tools/excused.ts. Both versions passed their own tests.
 */
const { execFileSync, spawnSync } = require('node:child_process');
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

function usesExpectedBase(baseSha, mergeParentSha, mergeParentParents) {
  return mergeParentSha === baseSha
    || (mergeParentParents.length === 3 && mergeParentParents.slice(1).includes(baseSha));
}

const GUARDED = 'src/world/reachable.test.ts';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

// A pull request: GitHub's synthetic merge commit is checked out, and must sit on the request's base.
function pullRequestResult(event) {
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ');
  if (parents.length !== 3) throw new Error('checkout is not GitHub’s synthetic two-parent PR merge commit');
  const baseSha = event.pull_request.base.sha;
  const mergeParentParents = git(['rev-list', '--parents', '-n', '1', parents[1]]).trim().split(' ');
  if (!usesExpectedBase(baseSha, parents[1], mergeParentParents)) {
    throw new Error(`merge result uses base ${parents[1]}, expected ${baseSha} directly or as a parent of its synthetic base; rerun on current base`);
  }
  return {
    what: 'PR merge result',
    base: git(['show', `${baseSha}:${GUARDED}`]),
    merged: readFileSync(GUARDED, 'utf8'),
    pulls: () => [event.pull_request],
  };
}

// A push or dispatch has no request to name a base, yet its tree can still land: a stacked head is
// tested by its push run and lands whole when the top of the stack merges (#534). So merge the head
// into origin/main's tip here, as the squash onto main would, and guard that result against the tip.
// Not the head's own file against the tip, which blames a branch merely behind a tightened ratchet;
// not against the merge base, which forgets whatever main has done since the branch left it.
function mainResult() {
  const head = git(['rev-parse', 'HEAD']).trim();
  let main;
  try { main = git(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']).trim(); } catch {
    throw new Error('origin/main is not in this checkout; fetch it (fetch-depth: 0) so the guard can merge with it');
  }
  if (spawnSync('git', ['merge-base', '--is-ancestor', head, main]).status === 0) {
    console.log(`${head} is already on origin/main ${main}; nothing would land, so nothing to guard.`);
    return null;
  }
  console.log(`Guarding ${head} merged into origin/main ${main}.`);
  const merge = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', main, head], { encoding: 'utf8' });
  if (merge.status !== 0 && merge.status !== 1) throw new Error(`git merge-tree failed:\n${merge.stderr}`);
  const [tree, ...conflicted] = merge.stdout.split('\n\n')[0].trim().split('\n');
  if (conflicted.includes(GUARDED)) {
    throw new Error(`${GUARDED} conflicts with origin/main ${main}; merge main into the branch first`);
  }
  return {
    what: `This branch merged into origin/main`,
    base: git(['show', `${main}:${GUARDED}`]),
    merged: git(['show', `${tree}:${GUARDED}`]),
    pulls: () => openPullsAt(head),
  };
}

// The requests whose head this commit is, so a stacked head can carry the same exception a request
// to main would. Asked only when something regressed; a failed lookup grants nothing.
function openPullsAt(sha) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) return [];
  try {
    const pulls = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/commits/${sha}/pulls`], { encoding: 'utf8' }));
    return pulls.filter((pull) => pull.state === 'open' && pull.head?.sha === sha);
  } catch { return []; }
}

function exception(pulls) {
  for (const pull of pulls) {
    const labels = pull.labels ?? [];
    const explanation = /^Merge guard exception:\s*(.{30,})$/m.exec(pull.body ?? '');
    if (labels.some((label) => label.name === 'merge-guard-exception') && explanation) return explanation[1];
  }
  return null;
}

function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const result = event.pull_request ? pullRequestResult(event) : mainResult();
  if (!result) return;
  const faults = regressions(result.base, result.merged);
  if (!faults.length) { console.log('Merge result keeps the reachability guards and their ratchets.'); return; }
  const explanation = exception(result.pulls());
  if (explanation) {
    console.log(`Maintainer exception: ${explanation}`);
    console.log(faults.join('\n'));
    return;
  }
  throw new Error(`${result.what} restores or weakens a guard:\n${faults.map((fault) => `- ${fault}`).join('\n')}\nAn intentional change needs the maintainer's merge-guard-exception label and a PR-body line 'Merge guard exception: <reason, at least 30 characters>'.`);
}

if (require.main === module) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { allowances, exception, regressions, usesExpectedBase };
