import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { BEHAVIOUR, Entity, Herd, updateEntity, type TileWorld } from './entity';
import { treeFor } from './behaviours';

/** All water, everywhere: the open sea a shark would be in. */
const sea: TileWorld = {
  heightAt: () => null,
  waterAt: () => 0.28,
  blocked: () => false,
  isRoad: () => false,
};

const shark = (x: number, z: number) => {
  const herd = new Herd(KINDS.shark, x, z, x, z, 20);
  const e = new Entity(KINDS.shark, x, z, herd, 'sea', mulberry32(7));
  herd.members.push(e);
  return e;
};

/** Run the creature for a while and report what it did. */
function swimFor(e: Entity, seconds: number, ctx: { playerX: number; playerZ: number; afloat: boolean }) {
  const bites: number[] = [];
  const ranges: number[] = [];
  let charged = false;
  const step = 1 / 30;
  for (let t = 0; t < seconds; t += step) {
    updateEntity(e, step, {
      world: sea, rng: mulberry32(Math.floor(t * 1000) + 1),
      playerX: ctx.playerX, playerZ: ctx.playerZ,
      playerArmed: false, playerAfloat: ctx.afloat, treeFor,
      onAttack: (_e, damage) => bites.push(damage),
    });
    ranges.push(Math.hypot(e.x - ctx.playerX, e.z - ctx.playerZ));
    if (e.charging > 0) charged = true;
  }
  return { bites, ranges, charged, closest: Math.min(...ranges), furthest: Math.max(...ranges) };
}

describe('sharks and orcas', () => {
  it('pay no attention to somebody standing on dry land', () => {
    const e = shark(8, 0);
    const run = swimFor(e, 20, { playerX: 0, playerZ: 0, afloat: false });
    expect(run.charged).toBe(false);
    expect(run.bites).toEqual([]);
    expect(e.charging).toBe(0);
  });

  it('keep station on a boat, then break off and come straight in', () => {
    const e = shark(9, 0);
    const run = swimFor(e, 30, { playerX: 0, playerZ: 0, afloat: true });

    expect(run.charged).toBe(true);                              // one of them works itself up to it
    expect(run.closest).toBeLessThan(BEHAVIOUR.CIRCLE_RADIUS);   // and closes the distance when it does
    // while it is only circling it keeps its distance rather than sitting on top of you
    expect(run.furthest).toBeGreaterThan(2);
    expect(run.bites.length).toBeGreaterThan(0);                 // a charge that arrives, bites
    for (const damage of run.bites) expect(damage).toBe(KINDS.shark.dangerous);
  });

  it('gives up a charge that goes nowhere rather than chasing forever', () => {
    const e = shark(9, 0);
    e.charging = BEHAVIOUR.CHARGE_TIME;
    // the boat is far away: the charge should run out of patience on its own
    swimFor(e, BEHAVIOUR.CHARGE_TIME + 1, { playerX: 400, playerZ: 0, afloat: true });
    expect(e.charging).toBeLessThanOrEqual(0);
  });

  it('is a real creature: it can be fought back', () => {
    expect(KINDS.shark.hp).toBeGreaterThan(0);
    expect(KINDS.orca.hp).toBeGreaterThan(KINDS.shark.hp!);
    expect(KINDS.orca.dangerous).toBeGreaterThan(KINDS.shark.dangerous!);
    expect(KINDS.shark.behaviour).toBe('circle');
    expect(KINDS.orca.behaviour).toBe('circle');
  });
});
