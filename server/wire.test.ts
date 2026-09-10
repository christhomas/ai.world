import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every message the two halves can send each other, and whether anybody is listening.
 *
 * The faults this was written for all had the same shape, and none of them was findable by reading
 * the code that was wrong: something happened on one side and the other side was never told, so
 * both halves went on being right about different worlds. A hero carried home after a knock on the
 * head was hauled back to the wolf that felled him. A hero taken in by the law was hauled back out
 * of the cell. A hero on an island in the sky was walked about a field. Each was reported as
 * something impossible — "it puts me back where I died" — and each was a message that was never
 * sent, or one that was sent and dropped.
 *
 * A message nobody handles is invisible: it type-checks, it goes up the wire, and nothing happens.
 * So the wire is read out of the protocol itself and every kind of message is accounted for — one
 * side sending it, the other side doing something about it — with the ones that are deliberately
 * ignored named here rather than left to be guessed at.
 *
 * It reads the source rather than the types because that is where the answer is: the union says
 * what may be said, and the switches say what is heard. Neither can drift from this without the
 * other noticing.
 */

const source = (path: string): string => readFileSync(path, 'utf8');

/** Where the run leaves its account of itself. Printed by `chore wire`. */
const REPORT = 'wire-report.txt';

/** One line of that account: a verdict, a count, and what it was about. */
const covered: string[] = [];

/** The names in one of the protocol's two unions. */
function kinds(union: 'ClientMessage' | 'ServerMessage'): string[] {
  const text = source('server/protocol.ts');
  const from = text.indexOf(`export type ${union}`);
  expect(from, `${union} is not declared where this expects`).toBeGreaterThan(-1);
  // to the end of the union, which is the next top-level declaration
  const rest = text.slice(from + 1);
  const to = rest.indexOf('\nexport ');
  const body = to === -1 ? rest : rest.slice(0, to);
  return [...new Set([...body.matchAll(/type: '([a-z-]+)'/g)].map(([, name]) => name))];
}

/** Everything the given files do something about, whether by a switch or by an if. */
function heard(paths: string[]): Set<string> {
  const listening = new Set<string>();
  for (const path of paths) {
    const text = source(path);
    for (const [, name] of text.matchAll(/case '([a-z-]+)'/g)) listening.add(name);
    for (const [, name] of text.matchAll(/message\.type === '([a-z-]+)'/g)) listening.add(name);
    for (const [, name] of text.matchAll(/\.type === '([a-z-]+)'/g)) listening.add(name);
  }
  return listening;
}

describe('the wire', () => {
  it('has a listener for everything a client can say', () => {
    const listening = heard(['server/messages.ts', 'server/sim.ts', 'server/rooms.ts']);
    const said = kinds('ClientMessage');
    const unheard = said.filter((kind) => !listening.has(kind));
    covered.push(`${unheard.length === 0 ? 'PASS' : 'FAIL'}  ${String(said.length).padStart(4)}  kinds a client can say, all of them heard by the world`);
    expect(unheard, 'a client can say this and the world does nothing about it').toEqual([]);
  });

  it('has a listener for everything the world can say', () => {
    // `heard.ts` and not `online.ts`: the switch over every kind of message came out of the class
    // that carries them, for the same reason `server/messages.ts` is not `server/rooms.ts`. Both
    // are named because the vocabulary is declared in one and a couple of things are still done
    // about it in the other.
    const listening = heard(['src/game/heard.ts', 'src/game/online.ts']);
    /*
     * The three the client is allowed to ignore, and why.
     *
     * `pinged` is the answer to a ping and is measured by the round trip rather than read; `error`
     * and `left` are handled where the socket is, not where the messages are. Anything else in this
     * list is a message the world sends into silence.
     */
    const ignored = new Set(['pinged', 'error', 'left']);
    const fromTheWorld = kinds('ServerMessage');
    const unheard = fromTheWorld.filter((kind) => !listening.has(kind) && !ignored.has(kind));
    covered.push(`${unheard.length === 0 ? 'PASS' : 'FAIL'}  ${String(fromTheWorld.length).padStart(4)}  kinds the world can say, all heard by the game but ${[...ignored].join(', ')}`);
    expect(unheard, 'the world says this and the game does nothing about it').toEqual([]);
  });

  it('names every way a hero can be put somewhere, and the world checks each of them', () => {
    /*
     * The `stood` message is the one that carries every jump: a door, a staircase, a gangplank, a
     * saddle, a knock on the head. It is also where every fault of this kind has been, because a
     * jump the world is not told about is a hero the world drags back.
     *
     * Each reason is a promise about what happened, and the world checks the ones it can: a ride
     * has to end beside the boat or at a pier, and being carried has to end in a village square of
     * the world's own making. A reason that is merely believed is written here as such.
     */
    const reasons = [...new Set(
      [...source('server/protocol.ts').matchAll(/why: '([a-z]+)'(?: \| '([a-z]+)')*/g)]
        .flatMap((m) => m[0].match(/'([a-z]+)'/g) ?? [])
        .map((quoted) => quoted.replace(/'/g, '')),
    )];
    expect(reasons.length, 'the ways of being put somewhere have moved').toBeGreaterThan(3);

    const handling = source('server/messages.ts');
    const unnamed = reasons.filter((reason) => !handling.includes(`'${reason}'`));
    covered.push(`${unnamed.length === 0 ? 'PASS' : 'FAIL'}  ${String(reasons.length).padStart(4)}  ways of being put somewhere — ${reasons.join(', ')} — each named by the world`);
    for (const reason of reasons) {
      expect(handling.includes(`'${reason}'`), `the world does nothing with a stood of "${reason}"`).toBe(true);
    }
  });
});

/**
 * What the wire looks like today, written down.
 *
 * The same reason the collision bench writes one: a green run that has quietly stopped checking
 * half the messages reads exactly like a green run. This says how many of each there are and which
 * are deliberately unheard, so the shape of the wire is visible without reading the protocol.
 */
describe('what this bench covered', () => {
  it('writes down the state of the wire', () => {
    const said = kinds('ClientMessage'), heardBack = kinds('ServerMessage');
    const lines = [
      `WIRE BENCH — ${covered.every((l) => l.startsWith('PASS')) ? 'PASS' : 'FAIL'} — ${new Date().toISOString()}`,
      '',
      `  ${said.length} kinds of message a client can send, ${heardBack.length} the world can send back.`,
      '  Every one of them has to be heard by somebody, or it is a thing that happens on one side',
      '  and never on the other — which is what "it puts me back where I died" was.',
      '',
      ...covered.map((line) => `  ${line}`),
      '',
      `  Written by server/wire.test.ts to ${REPORT}. Run it again with: chore wire`,
      '',
    ];
    writeFileSync(REPORT, lines.join('\n'));
    expect(covered.length, 'the bench stopped reporting what it did').toBeGreaterThanOrEqual(3);
  });
});
