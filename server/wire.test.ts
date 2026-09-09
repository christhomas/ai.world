import { readFileSync } from 'node:fs';
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
    const unheard = kinds('ClientMessage').filter((kind) => !listening.has(kind));
    expect(unheard, 'a client can say this and the world does nothing about it').toEqual([]);
  });

  it('has a listener for everything the world can say', () => {
    const listening = heard(['src/game/online.ts']);
    /*
     * The three the client is allowed to ignore, and why.
     *
     * `pinged` is the answer to a ping and is measured by the round trip rather than read; `error`
     * and `left` are handled where the socket is, not where the messages are. Anything else in this
     * list is a message the world sends into silence.
     */
    const ignored = new Set(['pinged', 'error', 'left']);
    const unheard = kinds('ServerMessage').filter((kind) => !listening.has(kind) && !ignored.has(kind));
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
    for (const reason of reasons) {
      expect(handling.includes(`'${reason}'`), `the world does nothing with a stood of "${reason}"`).toBe(true);
    }
  });
});
