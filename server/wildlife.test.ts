import { describe, expect, it } from 'vitest';
import { generateWebGraph } from '../src/world/roadweb';
import { GroundWorld } from '../src/world/groundworld';
import { TerrainSampler } from '../src/world/terrain';
import { Wildlife } from './wildlife';

/**
 * The creatures the server owns, and the two things it does with them that a player feels: a blow
 * thrown at them, and one thrown back.
 *
 * Both used to be the client's. The second stopped happening at all when the creatures moved
 * across — the client no longer steps a creature the world owns, so nothing was left to decide that
 * a wolf had bitten anybody, and the wild animals of the world were decorative for a while. That is
 * the kind of thing that is invisible until somebody stands still in front of a wolf, so it is
 * pinned here.
 */

/** A world with ground under it, grown around one spot. */
function worldAt(seed: number, x: number, z: number): { alive: Wildlife; ground: GroundWorld } {
  const ground = new GroundWorld(new TerrainSampler(generateWebGraph(seed)));
  ground.reach(x, z, 2);
  return { alive: new Wildlife(seed, ground, ground), ground };
}

/**
 * Noon, and not for atmosphere.
 *
 * A chunk's population is spawned by the chunk, and the manager throws the lot away and spawns it
 * again the moment the day flips to night — so a creature put down by hand survives only as long as
 * the light does not change under it. These tests want the wolf they placed, so the sun stays up.
 */
const DAY = 0.5;

/** Somebody standing still, with whatever they are wearing. */
const standing = (x: number, z: number, gear: string[] = []) => ({ x, z, gear });

describe('a creature the world owns', () => {
  it('bites somebody standing in front of it, and says who and how hard', () => {
    const { alive } = worldAt(3, 0, 0);
    const wolf = alive.put('wolf', 1.2, 0, 99);
    expect(wolf, 'there is a wolf').not.toBeNull();

    const who = standing(0, 0);
    let bitten = 0;
    let hardest = 0;
    // ten seconds of standing still next to a wolf, which is nine seconds more than anybody would
    for (let step = 0; step < 200; step++) {
      for (const bite of alive.step(0.05, [who], DAY)) {
        bitten++;
        hardest = Math.max(hardest, bite.damage);
        expect(bite.who, 'and it says which of them it bit').toBe(who);
        expect(bite.id, 'by the number the creature travels under').toBeGreaterThan(0);
      }
    }
    expect(bitten, 'a wolf does what a wolf does').toBeGreaterThan(0);
    expect(hardest).toBeGreaterThan(0);
  });

  it('keeps its distance from somebody with a sword on their hip', () => {
    const { alive } = worldAt(3, 0, 0);
    alive.put('wolf', 1.2, 0, 99);
    // the same ten seconds, and the only difference is what the world can see they are wearing
    const armed = standing(0, 0, ['sword']);
    let bitten = 0;
    for (let step = 0; step < 200; step++) bitten += alive.step(0.05, [armed], DAY).length;
    expect(bitten, 'a predator that will bite an empty hand thinks again about an armed one').toBe(0);
  });

  it('takes a blow in the arc in front of somebody, and nothing outside it', () => {
    const { alive } = worldAt(3, 0, 0);
    // a herd is put down as a herd, scattered round the spot rather than standing on it, so what
    // is east and what is west is read back rather than assumed
    alive.put('deer', 4, 0, 7);
    alive.put('deer', -4, 0, 8);
    const before = new Map(alive.listNear(0, 0, 20).map((e) => [e.id, e]));
    expect(before.size, 'deer on both sides of him').toBeGreaterThan(2);

    // facing east, and swinging until whatever is over there has fallen
    const killed = new Set<number>();
    for (let blow = 0; blow < 60; blow++) {
      for (const id of alive.swung({ x: 0, z: 0, y: 0, yaw: 0, reach: 6, arc: 1.1, damage: 30, one: false })) {
        killed.add(id);
      }
    }
    expect(killed.size, 'the ones it was facing').toBeGreaterThan(0);
    for (const id of killed) expect(before.get(id)!.x, 'and every one of them in front of him').toBeGreaterThan(0);
  });

  it('will not reach further than a bow does, or hit harder than a blow may be worth', () => {
    const { alive } = worldAt(3, 0, 0);
    alive.put('deer', 40, 0, 7);
    const far = alive.listNear(40, 0, 8).map((e) => e.id);
    expect(far.length, 'there is a herd out there').toBeGreaterThan(0);
    // a client asking for a reach across the county gets a bowshot, and no further
    const killed = alive.swung({ x: 0, z: 0, y: 0, yaw: 0, reach: 1e6, arc: Math.PI, damage: 1e9, one: false });
    for (const id of far) expect(killed).not.toContain(id);
  });

  it('takes one creature with a shot, not everything in the line', () => {
    const { alive } = worldAt(3, 0, 0);
    alive.put('deer', 5, 0, 7);
    const before = alive.listNear(0, 0, 20);
    expect(before.length, 'more than one thing to hit').toBeGreaterThan(1);
    // one arrow, one creature, however many are standing in the line of it
    const hit = alive.swung({ x: 0, z: 0, y: 0, yaw: 0, reach: 12, arc: 1.0, damage: 400, one: true });
    expect(hit).toHaveLength(1);
  });
});
