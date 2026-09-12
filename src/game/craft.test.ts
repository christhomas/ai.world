import { describe, expect, it } from 'vitest';
import { CRAFT, Craft } from './craft';
import type { AirBelow } from './gliding';
import type { Entity } from '../entities/entity';

/**
 * Flying the thing in the crater.
 *
 * A wing spends height it already had; this has thrust and hovers, which makes it a different verb
 * rather than a better wing. What is held here is the half of it that makes it *Zarch* rather than
 * a cursor: thrust moves the craft and not the pilot, so speed has to be got rid of as deliberately
 * as it was built up, and arriving anywhere on purpose is the skill.
 */

const flat = (height = 0): AirBelow => ({
  heightAt: () => height,
  waterAt: () => null,
  blocked: () => false,
});

const hero = (): Entity => ({ x: 0, z: 0, y: 0, yaw: 0 } as Entity);

/** Fly for a while with the keys held one way. */
function fly(craft: Craft, e: Entity, world: AirBelow, seconds: number, steer = { dx: 0, dz: 0 }) {
  const dt = 1 / 30;
  let last: string = 'flying';
  // stopped at the moment it stops flying: anything after that is a craft sitting on the ground
  // being asked to fly, and the answer to that is 'ground' however it got there
  for (let t = 0; t < seconds && last === 'flying'; t += dt) last = craft.update(dt, steer, e, world);
  return last;
}

describe('the craft', () => {
  it('lifts off to its hover height and stays there over level ground', () => {
    const e = hero(), craft = new Craft();
    expect(craft.lift(e, 0)).toBe(true);
    expect(craft.flying).toBe(true);
    fly(craft, e, flat(), 2);
    expect(e.y).toBeCloseTo(CRAFT.HOVER, 1);
  });

  it('keeps going after the keys are released, which is the whole of how it flies', () => {
    /*
     * The one rule that makes it Zarch rather than a mouse pointer. Thrust moves the craft, drag
     * takes it back slowly, and a pilot who lets go at speed is still travelling — which is why
     * stopping somewhere on purpose is a thing you have to plan two seconds ahead of.
     */
    const e = hero(), craft = new Craft();
    craft.lift(e, 0);
    fly(craft, e, flat(), 2, { dx: 1, dz: 0 });
    const runUp = craft.speed;
    expect(runUp, 'the engine does nothing').toBeGreaterThan(5);
    fly(craft, e, flat(), 2);
    expect(craft.speed, 'it stops dead when you let go').toBeGreaterThan(runUp * 0.2);
    expect(craft.speed, 'and never slows down at all').toBeLessThan(runUp);
  });

  it('will not go faster than it can be flown', () => {
    const e = hero(), craft = new Craft();
    craft.lift(e, 0);
    fly(craft, e, flat(), 20, { dx: 1, dz: 0 });
    expect(craft.speed).toBeLessThanOrEqual(CRAFT.TOP + 0.001);
  });

  it('rides the country: up over a ridge and down into a valley', () => {
    const e = hero(), craft = new Craft();
    craft.lift(e, 0);
    const ridge: AirBelow = { ...flat(), heightAt: (x: number) => (x > 5 ? 6 : 0) };
    fly(craft, e, ridge, 3, { dx: 1, dz: 0 });
    expect(e.x, 'it never got to the ridge').toBeGreaterThan(5);
    expect(e.y, 'it flew into the hill rather than over it').toBeGreaterThan(6);
  });

  it('is put in the ground by a wall met at speed, and merely stopped by one met slowly', () => {
    const wall: AirBelow = { ...flat(), blocked: (x: number) => x > 4 };
    const fast = hero(), quick = new Craft();
    quick.lift(fast, 0);
    expect(fly(quick, fast, wall, 4, { dx: 1, dz: 0 }), 'a wall at twenty a second was survivable').toBe('hit');
    expect(quick.flying).toBe(false);

    // and a nudge is a nudge: the craft stops, the pilot walks away, because being knocked out for
    // brushing a roof is a punishment for using the thing at all
    const slow = hero(), crawl = new Craft();
    crawl.lift(slow, 0);
    crawl.update(0.05, { dx: 1, dz: 0 }, slow, wall);
    slow.x = 3.9;
    expect(crawl.update(0.05, { dx: 1, dz: 0 }, slow, wall)).toBe('flying');
    expect(crawl.flying).toBe(true);
  });

  it('is taken by the sea like everything else', () => {
    const e = hero(), craft = new Craft();
    craft.lift(e, 0);
    const coast: AirBelow = {
      heightAt: (x: number) => (x > 4 ? null : 0),
      waterAt: (x: number) => (x > 4 ? 0.28 : null),
      blocked: () => false,
    };
    expect(fly(craft, e, coast, 4, { dx: 1, dz: 0 })).toBe('water');
    expect(craft.flying).toBe(false);
  });

  it('points where it is going rather than where it was asked to go', () => {
    // a craft that faces its keys while sliding sideways reads as a model on rails; this is what
    // makes a drift look like a drift
    const e = hero(), craft = new Craft();
    craft.lift(e, 0);
    fly(craft, e, flat(), 1.5, { dx: 1, dz: 0 });
    const east = e.yaw;
    fly(craft, e, flat(), 0.3, { dx: -1, dz: 0 });
    expect(e.yaw, 'it turned round before it had stopped going forwards').toBeCloseTo(east, 2);
  });
});
