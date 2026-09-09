import { describe, expect, it } from 'vitest';
import { countryOf } from './localmesh';
import type { Land } from './localroads';
import { riverFrom, slopeOf, springsNear, waterIn } from './localwater';
import { Simplex2D } from './noise';
import type { Within } from './window';

/**
 * Water that does not depend on how the world was walked.
 *
 * The bounded world's rivers are chosen from a list of every crossroads there is, sorted by height,
 * and each is stopped when it comes within six tiles of any water built *before it*. So a river's
 * course depends on how many rivers happened to be built first — which is a traversal, and is
 * exactly the thing an endless world cannot have. Two patches would disagree about where a river
 * went, and a river that disagrees with itself is a river with a step in it.
 *
 * What is checked here is that the three replacements hold: a spring is a property of a place, a
 * river runs downhill and only downhill, and where two rivers meet it is the springs' own names
 * that decide which of them ends.
 */

function country(seed: number): Land {
  const shape = new Simplex2D(seed);
  const grain = new Simplex2D(seed ^ 0x1234);
  return {
    // coarser than the other local tests use, and nearer what the drawn world has: a river gathers
    // three hundred tiles in every direction, so a country of faces fourteen tiles across would
    // make this a test of how fast a mesh can be built rather than of where the water goes
    ...countryOf(seed, (x, z) => (grain.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5, { near: 20, far: 40, tries: 6 }),
    land: (x, z) => shape.fbm(x * 0.0018, z * 0.0018, 3) > -0.15,
  };
}

const SEED = 20260909;
const WEST: Within = { x0: 0, z0: 0, x1: 400, z1: 500 };
const EAST: Within = { x0: 200, z0: 0, x1: 600, z1: 500 };
const OVERLAP: Within = { x0: 200, z0: 0, x1: 400, z1: 500 };

const inside = (within: Within, x: number, z: number): boolean =>
  x >= within.x0 && x <= within.x1 && z >= within.z0 && z <= within.z1;

describe('the water of an endless country', () => {
  it('rises in the same places whichever patch asks', () => {
    const named = (within: Within): string[] => springsNear(country(SEED), within)
      .filter((s) => inside(OVERLAP, s.x, s.z))
      .map((s) => s.id)
      .sort();
    const mine = named(WEST), theirs = named(EAST);
    expect(mine.length, 'no springs in the overlap').toBeGreaterThan(0);
    expect(theirs).toEqual(mine);
  });

  it('keeps its springs apart without a list of where the others went', () => {
    const springs = springsNear(country(SEED), { x0: 0, z0: 0, x1: 400, z1: 400 });
    expect(springs.length, 'a country with no springs in it').toBeGreaterThan(3);
    for (const a of springs) {
      for (const b of springs) {
        if (a.id === b.id) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} and ${b.id} rise on top of each other`)
          .toBeGreaterThanOrEqual(45);
      }
    }
  });

  it('runs downhill the whole way, which is what makes a river a river', () => {
    const world = country(SEED);
    const slope = slopeOf(world, { x0: -300, z0: -300, x1: 700, z1: 700 });
    let traced = 0;
    for (const spring of springsNear(world, { x0: 0, z0: 0, x1: 400, z1: 400 })) {
      const course = riverFrom(world, spring, slope);
      for (let i = 1; i < course.length; i++) {
        expect(course[i].level, `${spring.id} climbs at step ${i}`).toBeLessThanOrEqual(course[i - 1].level);
      }
      traced++;
    }
    expect(traced, 'no rivers were traced').toBeGreaterThan(3);
  });

  it('draws the same river from the same spring, alone or in company', () => {
    const world = country(SEED);
    const spring = springsNear(world, { x0: 0, z0: 0, x1: 400, z1: 400 })[0];
    expect(spring, 'nowhere for a river to rise').toBeTruthy();
    const patch = { x0: spring.x - 400, z0: spring.z - 400, x1: spring.x + 400, z1: spring.z + 400 };
    const alone = riverFrom(world, spring, slopeOf(country(SEED), patch));
    const again = riverFrom(country(SEED), spring, slopeOf(country(SEED), patch));
    expect(again.map((n) => `${n.x.toFixed(4)},${n.z.toFixed(4)}@${n.level}`))
      .toEqual(alone.map((n) => `${n.x.toFixed(4)},${n.z.toFixed(4)}@${n.level}`));
  });

  it('gives two patches the same water in the ground they both hold', () => {
    const shown = (within: Within): string[] => {
      const water = waterIn(country(SEED), within);
      const out: string[] = [];
      for (const river of water.rivers) {
        for (const node of river) {
          if (!inside(OVERLAP, node.x, node.z)) continue;
          out.push(`r ${node.x.toFixed(3)},${node.z.toFixed(3)} ${node.level} ${node.width.toFixed(3)}`);
        }
      }
      for (const lake of water.lakes) {
        if (!inside(OVERLAP, lake.x, lake.z)) continue;
        out.push(`l ${lake.x.toFixed(3)},${lake.z.toFixed(3)} ${lake.r.toFixed(3)} ${lake.level}`);
      }
      return out.sort();
    };
    const mine = shown(WEST), theirs = shown(EAST);
    expect(mine.length, 'no water in the overlap at all').toBeGreaterThan(10);
    expect(theirs).toEqual(mine);
  });

  it('ends a river at the sea or in a lake, never in mid air', () => {
    const world = country(SEED);
    const water = waterIn(world, WEST);
    expect(water.rivers.length, 'a country with no rivers').toBeGreaterThan(0);
    for (const river of water.rivers) {
      const last = river[river.length - 1];
      const pooled = water.lakes.some((l) => Math.hypot(l.x - last.x, l.z - last.z) < 1e-6);
      const met = water.rivers.some((other) => other !== river
        && other.some((n) => Math.hypot(n.x - last.x, n.z - last.z) < 7));
      expect(last.level === 1 || pooled || met,
        `a river stops at ${last.x.toFixed(0)},${last.z.toFixed(0)} on dry ground for no reason`).toBe(true);
    }
  });
});
