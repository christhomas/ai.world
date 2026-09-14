import { execFileSync } from 'node:child_process';
import { EXCUSED, issueIn } from './excused';

/**
 * An excuse expires with the issue it names.
 *
 * `reachable.test.ts` lets an unreached export stay when somebody writes down why, and the obvious
 * way that goes wrong is that an excuse is cheaper to write than a fix. The half of the answer the
 * suite can check is the *shape* of an excuse — it must name a test or an issue, which
 * `isCheckable` decides and the bench enforces. This is the other half: an excuse saying a caller
 * is *"pending in issue #49"* is a promise, and the day #49 closes with the name still unreached,
 * the promise was not kept and nobody is told.
 *
 * It was not hypothetical when this was written. Four excuses named issues that had already closed
 * — #26, #33 and #49 twice — and all four exports were still unreached. Two were deleted, one was
 * wired into the caller its comment had claimed all along, and one had its assertion rewritten
 * against the thing it was actually about.
 *
 * ## Why a tool and not a test
 *
 * It asks GitHub, and the suite must not: a test that needs the network is a test that fails on a
 * train. So the decision is pure and tested — `whichHaveExpired` takes the issue states as an
 * argument — and only the asking lives out here, where CI already has a token.
 */

/** What GitHub said about one issue: open, closed, or never heard of. */
export type IssueState = 'OPEN' | 'CLOSED' | 'UNKNOWN';

/** One excuse that has outlived the issue it defers to. */
export interface Expired {
  name: string;
  reason: string;
  issue: number;
}

/**
 * Which of the excuses named an issue that is no longer open.
 *
 * An issue nobody can find counts as expired too, and deliberately: an excuse pointing at an issue
 * number that does not exist is worth exactly as much as one pointing at a closed one, and both are
 * things somebody has to go and look at.
 */
export function whichHaveExpired(
  excused: ReadonlyMap<string, string>, states: ReadonlyMap<number, IssueState>,
): Expired[] {
  const out: Expired[] = [];
  for (const [name, reason] of excused) {
    const issue = issueIn(reason);
    if (issue === null) continue;
    if (states.get(issue) === 'OPEN') continue;
    out.push({ name, reason, issue });
  }
  return out;
}

/** Every issue the excuses defer to, each asked about once however many names cite it. */
export function issuesNamed(excused: ReadonlyMap<string, string>): number[] {
  const seen = new Set<number>();
  for (const reason of excused.values()) {
    const issue = issueIn(reason);
    if (issue !== null) seen.add(issue);
  }
  return [...seen].sort((one, two) => one - two);
}

function stateOf(issue: number): IssueState {
  try {
    const said: unknown = JSON.parse(
      execFileSync('gh', ['issue', 'view', String(issue), '--json', 'state'], { encoding: 'utf8' }),
    );
    if (said && typeof said === 'object' && 'state' in said && said.state === 'OPEN') return 'OPEN';
    return 'CLOSED';
  } catch {
    return 'UNKNOWN';
  }
}

function main(): void {
  const states = new Map<number, IssueState>(
    issuesNamed(EXCUSED).map((issue) => [issue, stateOf(issue)]),
  );
  const expired = whichHaveExpired(EXCUSED, states);
  if (expired.length === 0) {
    console.log(`every excuse names an open issue (${states.size} asked about, ${EXCUSED.size} excuses)`);
    return;
  }
  console.error('excuses that have outlived the issue they name:');
  for (const one of expired) {
    console.error(`  ${one.name}\n    ${one.reason} — #${one.issue} is ${states.get(one.issue)}`);
  }
  console.error('\nWire the export, delete it, or write down the issue that actually blocks it.');
  process.exit(1);
}

if (process.argv[1]?.endsWith('staleexcuses.ts')) main();
