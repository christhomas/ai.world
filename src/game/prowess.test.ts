import { describe, expect, it } from 'vitest';
import { PROWESS, costOf, learnedFrom, levelFor, saidOf, towardsNext } from './prowess';
import { KINDS } from '../entities/animals';
import { HEALTH } from '../world/health';
import { GameState } from './state';

/**
 * Kit improved and the hero never did, so a fight in the second week was the first week's fight
 * with a better sword in it. These pin the shape of the answer: practice is earned by doing the
 * dangerous thing, it is worth little against a weapon, and it runs out.
 */
describe('getting better at fighting', () => {
  it('starts nobody as anything', () => {
    expect(levelFor(0)).toBe(0);
    expect(saidOf(0)).toBe('');
  });

  it('pays more for hitting something that could kill you', () => {
    expect(learnedFrom(4, false)).toBeGreaterThan(learnedFrom(0, false));
  });

  it('pays most for finishing it, so hitting a chicken all day is not the way', () => {
    expect(learnedFrom(0, true)).toBeGreaterThan(learnedFrom(3, false));
  });

  it('costs more for every level than the one before', () => {
    for (let n = 1; n < PROWESS.MOST; n++) {
      expect(costOf(n + 1) - costOf(n), `level ${n + 1}`).toBeGreaterThan(costOf(n) - costOf(n - 1));
    }
  });

  it('takes a real run of fights to gain the first one', () => {
    // a dozen easy kills should not do it; this is not a bar that fills while you look at it
    expect(levelFor(learnedFrom(0, true) * 6)).toBe(0);
  });

  it('runs out rather than growing for ever', () => {
    expect(levelFor(costOf(PROWESS.MOST) * 100)).toBe(PROWESS.MOST);
    expect(towardsNext(costOf(PROWESS.MOST) * 100)).toBe(1);
  });

  it('reports progress through a level between nought and one', () => {
    for (const p of [0, 50, 200, 1000, 9000]) {
      expect(towardsNext(p)).toBeGreaterThanOrEqual(0);
      expect(towardsNext(p)).toBeLessThanOrEqual(1);
    }
  });

  it('has something to say at every level it can reach', () => {
    for (let n = 1; n <= PROWESS.MOST; n++) expect(saidOf(n).length).toBeGreaterThan(0);
  });
});

/**
 * Power scaling: what practice does to how much of you there is.
 *
 * Asked for in so many words — "I don't think an experienced hero should be killed by a wolf in
 * five or six bites. That would be ridiculous." It was four. The health scale was widened to make
 * room for the answer, and this is the answer: a level of practice is forty more of you.
 *
 * The bestiary does not move. A wolf hits for what a wolf has always hit for; the hero grows past
 * it. That is the difference between power scaling and inflation, and it is why a bear is still a
 * bear to a beginner after this.
 */
describe('how much of a hero there is', () => {
  const heroAt = (level: number): GameState => {
    const s = GameState.fresh();
    // enough practice to have earned that level, however the table is priced. Through `practised`
    // rather than by setting the number, because arriving at a level is what heals you into it
    while (levelFor(s.practice) < level) s.practised(100, true);
    return s;
  };

  it('starts at a hundred, which is what a fit grown adult has', () => {
    expect(heroAt(0).maxHpTotal).toBe(HEALTH.FULL);
  });

  it('grows with practice, and the growth is not written down anywhere', () => {
    // derived rather than saved: a hero who has levelled is not a hero whose starting health
    // changed, and a second copy of `practice` would be free to disagree with the first
    const green = heroAt(0);
    const salted = heroAt(PROWESS.MOST);
    expect(salted.maxHpTotal).toBe(green.maxHpTotal + PROWESS.MOST * PROWESS.TOUGHER);
    // and the health came with the capacity: a level that only widened an empty bar would be a
    // reward that makes you look worse the moment you earn it
    expect(salted.hp).toBe(salted.maxHpTotal);
    expect(salted.toJSON().maxHp, 'levelling wrote itself into the save').toBe(green.toJSON().maxHp);
  });

  it('turns a wolf from a real fight into an inconvenience, without the wolf changing', () => {
    const bite = KINDS.wolf.damage ?? 0;
    const bitesToFell = (s: GameState): number => {
      let n = 0;
      while (s.hp > 0 && n < 500) { s.damage(bite); n++; }
      return n;
    };
    const green = bitesToFell(heroAt(0));
    const salted = bitesToFell(heroAt(PROWESS.MOST));
    // the complaint that started this: four bites, on the old scale, for anybody at all
    expect(green, 'a beginner is finished too quickly for a wolf to be a fight').toBeGreaterThan(5);
    expect(salted, 'an experienced hero is still felled by a wolf pack in a few bites')
      .toBeGreaterThan(20);
  });

  it('leaves a bear a bad idea for a beginner, which is the other half of it', () => {
    // power scaling must not quietly make the early game safe: the hero moves, the bestiary does not
    const bear = KINDS.bear.damage ?? 0;
    const green = heroAt(0);
    let blows = 0;
    while (green.hp > 0 && blows < 100) { green.damage(bear); blows++; }
    expect(blows, 'a bear no longer finishes a beginner in a handful of blows').toBeLessThan(8);
  });
});
