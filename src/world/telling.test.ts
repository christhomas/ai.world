import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { isTold, replayTold, type Told } from './telling';
import type { WorldDelta } from '../../server/protocol';

const TRADES = ['farmer', 'hunter', 'seller'];
/**
 * A hamlet of one roof, and more trades than it has people to hold them.
 *
 * A village of twenty-four fills every trade on its list, and an oath to a trade the place already
 * has lapses by design — see `vacancies.ts`. So the oath below needs somewhere with a real gap in
 * it, and one house against eight trades is that: with this seed nobody there is a doctor.
 */
const HAMLET = ['farmer', 'hunter', 'seller', 'smith', 'baker', 'miller', 'fisher', 'doctor'];

/** A register meeting a world's log for the first time, which is what `sim.ts` does on every room. */
function caughtUp(log: readonly Told[], settle: (register: Register) => void, day: number): Register {
  const register = new Register(11);
  settle(register);
  register.advance(day);
  replayTold(log, (change) => register.apply(change));
  return register;
}

describe('replaying what a world was told', () => {
  it('puts a killing back, so the dead stay dead', () => {
    const origin = new Register(11);
    origin.settle('Ashford', 6, TRADES);
    origin.advance(40);
    const doomed = origin.living('Ashford')[0];
    origin.bury(doomed.id, 40);
    expect(origin.living('Ashford').some((p) => p.id === doomed.id)).toBe(false);

    const log: Told[] = [{ kind: 'died', who: doomed.id, village: 'Ashford', day: 40 }];
    const back = caughtUp(log, (r) => r.settle('Ashford', 6, TRADES), 40);
    expect(back.living('Ashford').some((p) => p.id === doomed.id)).toBe(false);
  });

  it('puts an oath back, so the trade a traveller took is still theirs', () => {
    const log: Told[] = [{ kind: 'sworn', village: 'Ashford', trade: 'doctor', who: 'Wanderer', day: 40 }];
    const back = caughtUp(log, (r) => r.settle('Ashford', 1, HAMLET), 40);

    expect(back.directoryOf('Ashford').sworn.map((one) => one.who)).toContain('Wanderer');
  });

  it('puts a declaration back, so a town does not come up a village', () => {
    // grown rather than given a treasury: a village that saved for its own hall is the one whose
    // re-lived self can still afford it, which is the whole of what replaying one means
    const TOWNSFOLK = ['farmer', 'seller', 'hunter', 'soldier'];
    const origin = new Register(17, 30);
    origin.settle('Testing', 9, TOWNSFOLK);
    origin.advance(900);
    const vote = origin.vote('Testing', 900);
    if (!vote) throw new Error('the grown village never saved enough to call its vote');
    expect(origin.rankOf('Testing')).toBe('town');

    const back = new Register(17, 30);
    back.settle('Testing', 9, TOWNSFOLK);
    back.advance(900);
    expect(back.rankOf('Testing')).toBe('village');      // nine roofs, and nobody has voted
    replayTold([{ kind: 'voted', village: 'Testing', rank: 'town', day: 900 }], (c) => back.apply(c));
    expect(back.rankOf('Testing')).toBe('town');
  });

  it('applies the same fact twice without applying it twice', () => {
    const log: Told[] = [{ kind: 'sworn', village: 'Ashford', trade: 'doctor', who: 'Wanderer', day: 40 }];
    const back = caughtUp([...log, ...log], (r) => r.settle('Ashford', 1, HAMLET), 40);

    expect(back.directoryOf('Ashford').sworn.filter((one) => one.who === 'Wanderer')).toHaveLength(1);
  });

  it('picks the told facts out of a log and leaves the rest of it alone', () => {
    const log: WorldDelta[] = [
      { kind: 'chest', id: 'a' },
      { kind: 'died', who: 'somebody', village: 'Ashford', day: 3 },
      { kind: 'sow', tile: '1,1', crop: 'wheat', day: 2 },
      { kind: 'voted', village: 'Ashford', rank: 'town', day: 4 },
      { kind: 'sworn', village: 'Ashford', trade: 'doctor', who: 'Wanderer', day: 5 },
    ];

    expect(log.filter(isTold).map((one) => one.kind)).toEqual(['died', 'voted', 'sworn']);
  });
});
