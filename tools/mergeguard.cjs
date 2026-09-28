/*
 * Check the code GitHub would merge, against the first parent of its synthetic PR merge commit.
 * This catches the #221 failure: a stale branch restored the reachability bench's inline excuse
 * list after main had moved that list to tools/excused.ts. Both versions passed their own tests.
 */
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const RATCHETS = ['ALREADY_LIKE_THIS', 'ALREADY_UNEXPLAINED', 'NAMED_NOWHERE_ALREADY'];

function allowances(source) {
  return new Map(RATCHETS.map((name) => {
    const found = new RegExp(`\\bconst\\s+${name}\\s*=\\s*(\\d+)\\s*;`).exec(source);
    return [name, found ? Number(found[1]) : null];
  }));
}

function regressions(base, merged) {
  const found = [];
  const before = allowances(base), after = allowances(merged);
  for (const name of RATCHETS) {
    const old = before.get(name), now = after.get(name);
    if (old === null || now === null) found.push(`${name} allowance disappeared`);
    else if (now > old) found.push(`${name} rose from ${old} to ${now}`);
    if (!new RegExp(`\\.toBeLessThanOrEqual\\(\\s*${name}\\s*\\)`).test(merged)) {
      found.push(`${name} is no longer asserted`);
    }
  }
  if (!/import\s*\{[^}]*\bEXCUSED\b[^}]*\bisCheckable\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/tools\/excused['"]/.test(merged)) {
    found.push('reachability bench no longer imports the shared excuse list and its reason guard');
  }
  if (/\b(?:const|let|var)\s+EXPLAINED\s*=/.test(merged)) {
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
