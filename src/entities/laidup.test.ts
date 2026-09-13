import { describe, expect, it } from 'vitest';
import { CREATURE_VERBS } from './verbs';

/**
 * A villager laid up on the register knows to go to the doctor.
 *
 * The rest of item 36 (issue #6), and it is the recurring fault of this codebase in its smallest
 * form: two representations of one thing, disagreeing.
 *
 * `wounds.ts` puts the wound on the **person** — deliberately, and the issue says why: *"the wound
 * is on the person rather than on the body in the street, the same shape as being hungry, because
 * it has to survive being walked away from."* It is what stops him working, what the doctor halves,
 * and what costs him a day's keep on the morning the bone is set.
 *
 * `behaviours/villagers.json` has the branch that sends him to the surgery, and it asks `wounded`,
 * which reads `self.hp` — the body standing in the street, which is destroyed the moment a player
 * walks away. So the man who is laid up for six days never goes, and the man who goes is the one
 * with a scratch that will be gone by morning anyway.
 *
 * The body question stays, because a creature bleeding in front of you is a real question with a
 * real answer. What changes is that being laid up counts too.
 */
describe('who counts as wounded', () => {
  const tick = (hp: number, full: number, laidUp: number) => ({
    world: {
      self: { hp, kind: { hp: full }, person: 'Ashford-1-0' },
      laidUpFor: () => laidUp,
    },
  });

  it('is anybody hurt badly enough in the body, as it always was', () => {
    expect(CREATURE_VERBS.questions.wounded({})(tick(2, 100, 0) as never)).toBe(true);
    expect(CREATURE_VERBS.questions.wounded({})(tick(90, 100, 0) as never)).toBe(false);
  });

  /*
   * The one this exists for. He is on his feet and unmarked — the body took its damage days ago and
   * has mended — and he is still laid up for four more days, not working, waiting on a doctor.
   */
  it('and anybody the register has laid up, however whole the body looks', () => {
    expect(CREATURE_VERBS.questions.wounded({})(tick(100, 100, 4) as never), 'laid up is wounded').toBe(true);
  });

  it('but not somebody the register has nothing against', () => {
    expect(CREATURE_VERBS.questions.wounded({})(tick(100, 100, 0) as never)).toBe(false);
  });

  it('and answers for a creature with no register behind it at all', () => {
    const wild = { world: { self: { hp: 100, kind: { hp: 100 }, person: '' } } };
    expect(CREATURE_VERBS.questions.wounded({})(wild as never)).toBe(false);
  });
});
