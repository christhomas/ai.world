import { describe, expect, it } from 'vitest';
import { KINDS } from '../entities/animals';
import { HEALTH, bodyOf, heroOf, share, spent } from './health';

/**
 * Being alive, on one scale for everything that is.
 *
 * The game ran on hearts: the hero had ten and a wolf's bite took three. Ten steps cannot say
 * anything — a blow worth a twentieth of a man was not representable, so every blow had to be worth
 * a tenth or more, which is exactly why a wolf could finish the hero in four bites. A hundred is a
 * fit adult now, and what is *drawn* is a share of your own maximum, which is uniform across
 * everything alive however tough it is.
 */

describe('the scale', () => {
  it('is one scale, and everything alive is quoted on it', () => {
    expect(KINDS.villager.hp).toBe(60);
    expect(KINDS.wolf.hp).toBe(30);
    expect(KINDS.bear.hp).toBe(200);
    expect(KINDS.troll.hp).toBe(280);
    // and a hundred is the anchor: what a fit grown adult has, which is what the hero starts with
    expect(HEALTH.FULL).toBe(100);
  });

  it('leaves room under a single blow, which hearts never did', () => {
    /*
     * The whole reason for the rescale. A wolf's bite is a tenth of a fit man, and on the old scale
     * a tenth of the hero *was* the smallest thing expressible — so nothing could hit for less, and
     * nothing could be tougher than ten bites without being tougher than everything.
     */
    expect(KINDS.wolf.damage).toBe(HEALTH.A_SCRATCH);
    expect(HEALTH.FULL / (KINDS.wolf.damage ?? 1)).toBe(10);
    // and an ogre's smash is four times a wolf's bite, which a ten-step scale could barely hold
    expect(KINDS.ogre.damage).toBe(40);
  });
});

describe('a creature as something alive', () => {
  const wolf = () => ({ hp: 30, kind: { hp: 30 } });

  it('reads what is left against what its kind is born with', () => {
    const body = bodyOf(wolf());
    expect(body.hp).toBe(30);
    expect(body.most).toBe(30);
    expect(share(body)).toBe(1);
  });

  it('says how much a blow actually took, never more than was there', () => {
    const e = wolf();
    expect(bodyOf(e).hurt(500)).toBe(30);
    expect(e.hp).toBe(0);
    expect(spent(bodyOf(e))).toBe(true);
  });

  it('mends no further than full, however generous the physic', () => {
    const e = { hp: 5, kind: { hp: 30 } };
    expect(bodyOf(e).mend(1000)).toBe(25);
    expect(e.hp).toBe(30);
  });

  /*
   * There is no longer such a thing as a kind with no health of its own, and the test that used to
   * say so is this one.
   *
   * It asserted that an absent `kind.hp` came out as `HEALTH.FULL`, which was true and was an
   * accident: the hero's entry had no hit points in it and the fallback was quietly supplying the
   * player's own. That made a nought mean two incompatible things — "a blade does not answer this"
   * to `canBeCut`, and "this is the hero" here — and item 94 could not settle the field until they
   * were separated. So the hero says a hundred in its own entry, which is where a fact about the
   * player belongs, and a nought now means the one thing it always should have.
   */
  it('takes what its kind says it can take, the hero included', () => {
    expect(bodyOf({ hp: 50, kind: { hp: 30 } }).most).toBe(30);
    expect(bodyOf({ hp: 50, kind: KINDS.hero }).most).toBe(HEALTH.FULL);
    // and a kind that says nought is a kind a blade does not answer, rather than a full-health one
    expect(bodyOf({ hp: 5, kind: { hp: 0 } }).most).toBe(0);
  });
});

describe('the hero as something alive', () => {
  it('has a maximum that moves with what he is wearing', () => {
    /*
     * The one thing in this world whose full is not a constant, which is why `most` is a getter: a
     * helm taken off between one blow and the next changes what full means, and a copy of the
     * number taken when the view was built would be the old full for as long as anybody held it.
     */
    const state = { hp: 100, maxHpTotal: 100 };
    const hero = heroOf(state);
    expect(share(hero)).toBe(1);
    state.maxHpTotal = 200;
    expect(share(hero)).toBe(0.5);
  });

  it('is hurt and mended by the same words a wolf is', () => {
    const state = { hp: 100, maxHpTotal: 160 };
    const hero = heroOf(state);
    expect(hero.hurt(40)).toBe(40);
    expect(hero.mend(1000)).toBe(100);
    expect(state.hp).toBe(160);
  });
});

describe('what gets drawn', () => {
  it('is a share, so one bar serves a rabbit and Old Nettle alike', () => {
    const rabbit = bodyOf({ hp: 5, kind: { hp: 10 } });
    const nettle = bodyOf({ hp: 240, kind: { hp: 480 } });
    expect(share(rabbit)).toBe(share(nettle));
  });

  it('never goes outside nought and one, whatever the arithmetic did', () => {
    expect(share(bodyOf({ hp: -50, kind: { hp: 10 } }))).toBe(0);
    expect(share(bodyOf({ hp: 99, kind: { hp: 10 } }))).toBe(1);
    expect(share(bodyOf({ hp: 5, kind: { hp: 0 } }))).toBe(0);
  });
});
