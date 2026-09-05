import { describe, expect, it } from 'vitest';
import { BREATH, Breath, guardCovers } from './breath';
import { COMBAT } from './combat';

/**
 * The complaint these answer: you jam one button until something falls over. So every claim here
 * is about there being a wrong way to press it.
 */

/** Hold a guard for this long, then take a blow. */
const held = (seconds: number) => {
  const b = new Breath();
  b.raise();
  for (let t = 0; t < seconds; t += 1 / 60) b.age(1 / 60);
  return b;
};

describe('breath', () => {
  it('runs out if you only ever swing, so a flurry has an end', () => {
    const b = new Breath();
    let full = 0;
    for (let n = 0; n < 4; n++) if (b.swing() === 1) full++;
    expect(full).toBeLessThanOrEqual(4);
    expect(b.winded).toBe(true);
  });

  it('makes a swing thrown with nothing left feeble rather than impossible', () => {
    const b = new Breath();
    for (let n = 0; n < 6; n++) b.swing();
    // it still happens: refusing it outright reads as the controls being broken
    expect(b.swing()).toBe(BREATH.TIRED);
    expect(BREATH.TIRED).toBeGreaterThan(0);
  });

  it('comes back when you stop, but not the instant you stop', () => {
    const b = new Breath();
    b.swing();
    const spent = b.share;
    b.age(BREATH.CATCH / 2);
    expect(b.share, 'breath came back before the pause was up').toBeCloseTo(spent, 5);
    b.age(BREATH.CATCH);
    expect(b.share).toBeGreaterThan(spent);
  });

  it('so backing off for a second is a move, not a waste of one', () => {
    const b = new Breath();
    for (let n = 0; n < 4; n++) b.swing();
    expect(b.winded).toBe(true);
    for (let t = 0; t < 2; t += 1 / 60) b.age(1 / 60);
    expect(b.winded).toBe(false);
  });
});

describe('the guard', () => {
  it('parries a blow answered the moment it goes up', () => {
    const b = new Breath();
    b.raise();
    expect(b.answer()).toBe('parried');
  });

  it('only blocks when it has been held since before the blow was thrown', () => {
    // the whole skill: you cannot get the good outcome by keeping the key pressed
    expect(held(BREATH.PARRY_WINDOW + 0.2).answer()).toBe('blocked');
  });

  it('is worth having anyway, because a block is most of a blow taken off', () => {
    expect(Breath.after('blocked', 4)).toBeLessThan(4);
    expect(Breath.after('parried', 4)).toBe(0);
    expect(Breath.after('open', 4)).toBe(4);
  });

  it('never blocks a blow down to nothing, or a held guard would be invulnerability', () => {
    expect(Breath.after('blocked', 1)).toBeGreaterThan(0);
    expect(Breath.after('blocked', 12)).toBeGreaterThan(0);
  });

  it('costs breath to hold, so it cannot simply be left up', () => {
    const b = held(1);
    expect(b.share).toBeLessThan(1);
    const longer = held(BREATH.MOST / BREATH.GUARD + 0.5);
    expect(longer.guarding, 'a guard held past the last of the breath stayed up').toBe(false);
  });

  it('hands some back on a parry, so reading the fight pays for itself', () => {
    const b = new Breath();
    b.swing();
    const after = b.share;
    b.raise();
    b.answer();
    expect(b.share).toBeGreaterThan(after);
    // and not so much that parrying is a way of getting breath rather than of not being hit
    expect(BREATH.MOST * BREATH.PARRY_REFUND).toBeLessThan(BREATH.SWING);
  });

  it('is spent by the parry, so a flurry has to be answered blow by blow', () => {
    const b = new Breath();
    b.raise();
    expect(b.answer()).toBe('parried');
    expect(b.answer(), 'one raised guard parried two blows').toBe('open');
  });

  it('comes down when you swing, so you cannot attack from behind it', () => {
    const b = new Breath();
    b.raise();
    b.swing();
    expect(b.guarding).toBe(false);
  });

  it('is filled back up by waking from a knockout', () => {
    const b = new Breath();
    for (let n = 0; n < 5; n++) b.swing();
    b.refill();
    expect(b.share).toBe(1);
    expect(b.guarding).toBe(false);
  });

  it('slows you down while it is up, so it is not a free thing to walk around behind', () => {
    expect(BREATH.GUARDED_PACE).toBeLessThan(1);
    expect(BREATH.GUARDED_PACE).toBeGreaterThan(0);
  });
});

describe('a guard against another player', () => {
  it('blocks, because holding your arm up is a decision you can actually make', () => {
    const b = new Breath();
    b.raise();
    expect(b.answer(false)).toBe('blocked');
  });

  it('never parries, because the tell arrives over a wire and timing it would be luck', () => {
    const b = new Breath();
    b.raise();
    // the same guard that would parry a wolf only blocks a person
    expect(b.answer(false)).not.toBe('parried');
  });
});

/**
 * A guard that answered a blow arriving at the back of your head would make holding the key
 * strictly better than facing anything, and the arc is the only reason facing matters.
 */
describe('where a guard reaches', () => {
  // the hero faces +x at yaw 0: forward is (cos yaw, -sin yaw)
  const facingEast = 0;

  it('covers what is in front of you', () => {
    expect(guardCovers(facingEast, 1, 0)).toBe(true);
  });

  it('does not cover what is directly behind you', () => {
    expect(guardCovers(facingEast, -1, 0)).toBe(false);
  });

  it('covers wider than you can swing, because taking a blow asks less than landing one', () => {
    expect(BREATH.GUARD_ARC).toBeGreaterThan(COMBAT.ARC);
    // and still nothing like the whole circle
    expect(BREATH.GUARD_ARC).toBeLessThan(Math.PI);
  });

  it('counts something standing inside you as covered, or a swarm would be unanswerable', () => {
    expect(guardCovers(facingEast, 0, 0)).toBe(true);
  });

  it('leaves you open to a blow from outside the arc without spending the guard', () => {
    const b = new Breath();
    b.raise();
    expect(b.answer(true, false)).toBe('open');
    // the arm never came down: it simply was not there, so it still answers the next one
    expect(b.guarding).toBe(true);
    expect(b.answer(true, true)).toBe('parried');
  });

  it('so a blow from behind lands in full however long the guard has been up', () => {
    const b = new Breath();
    b.raise();
    const behind = guardCovers(facingEast, -1, 0);
    expect(Breath.after(b.answer(true, behind), 4)).toBe(4);
  });
});
