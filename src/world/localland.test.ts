import { describe, expect, it } from 'vitest';
import { FaceKind } from './mesh';
import { countryOf, facesIn, type Country } from './localmesh';
import { highlandNear, kindOf, landOf } from './localland';
import { Simplex2D } from './noise';
import type { Within } from './window';

/**
 * What the ground is made of, asked one face at a time.
 *
 * The bounded world settles this in a single pass over every face there is, and can therefore do
 * things a patch cannot: drown the rim, lift islands by how far out they lie, keep the middle dry,
 * and grow lakes by walking a list where each face changes what the next one sees. The local rules
 * that replace them have to give the same answer wherever they are asked from — a face that is a
 * lake seen from the west and open ground seen from the east is a hole in the world.
 *
 * The high country is the one worth reading twice. A face's height depends on how deep into a range
 * it is, which sounds like a question about the whole range; it is not, because the ground stops
 * rising after three faces. Counting three steps out gives the number the whole-world flood gives,
 * exactly rather than nearly.
 */

function country(seed: number): Country {
  const grain = new Simplex2D(seed ^ 0x1234);
  return countryOf(seed, (x, z) => (grain.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5, { near: 6, far: 14, tries: 6 });
}

const SEED = 20260909;
const WEST: Within = { x0: 0, z0: 0, x1: 400, z1: 400 };
const EAST: Within = { x0: 200, z0: 0, x1: 600, z1: 400 };
const OVERLAP: Within = { x0: 200, z0: 0, x1: 400, z1: 400 };

const inside = (within: Within, x: number, z: number): boolean =>
  x >= within.x0 && x <= within.x1 && z >= within.z0 && z <= within.z1;

describe('the ground of an endless country', () => {
  const world = country(SEED);

  it('is made of the same stuff whichever patch asks', () => {
    const west = country(SEED), east = country(SEED);
    const kinds = (from: Country, within: Within): string[] => facesIn(from, within)
      .filter((f) => inside(OVERLAP, f.x, f.z))
      .map((f) => `${f.id} ${kindOf(from, f)}`)
      .sort();
    const mine = kinds(west, WEST), theirs = kinds(east, EAST);
    expect(mine.length, 'no faces in the overlap').toBeGreaterThan(50);
    expect(theirs).toEqual(mine);
  });

  it('is neither all sea nor all land', () => {
    const seen = new Map<FaceKind, number>();
    for (const face of facesIn(world, WEST)) {
      const kind = kindOf(world, face);
      seen.set(kind, (seen.get(kind) ?? 0) + 1);
    }
    const total = [...seen.values()].reduce((a, b) => a + b, 0);
    for (const [name, kind] of [['sea', FaceKind.Sea], ['land', FaceKind.Land], ['mountains', FaceKind.Mountain]] as const) {
      expect(seen.get(kind) ?? 0, `a country with no ${name} in it`).toBeGreaterThan(0);
    }
    expect((seen.get(FaceKind.Sea) ?? 0) / total, 'the country is nearly all sea').toBeLessThan(0.9);
  });

  it('puts its lakes inland, never on a coast', () => {
    let lakes = 0;
    for (const face of facesIn(world, WEST)) {
      if (kindOf(world, face) !== FaceKind.Lake) continue;
      lakes++;
      // a lake is only ever offered ground that had dry land all round it
      for (const id of face.neighbours) {
        const near = facesIn(world, {
          x0: face.x - 60, z0: face.z - 60, x1: face.x + 60, z1: face.z + 60,
        }).find((f) => f.id === id);
        if (!near) continue;
        expect(kindOf(world, near), `a lake at ${face.x.toFixed(0)},${face.z.toFixed(0)} touches the sea`)
          .not.toBe(FaceKind.Sea);
      }
    }
    expect(lakes, 'a country with no lakes in it').toBeGreaterThan(0);
  });

  it('stands its high country at the same height whichever patch asks', () => {
    const lift = (within: Within): string[] => highlandNear(country(SEED), within)
      .filter((hill) => inside(OVERLAP, hill.x, hill.z))
      .map((hill) => `${hill.x.toFixed(3)},${hill.z.toFixed(3)} ${hill.lift} ${hill.reach.toFixed(3)}`)
      .sort();
    const mine = lift(WEST), theirs = lift(EAST);
    expect(mine.length, 'no mountains in the overlap').toBeGreaterThan(0);
    expect(theirs).toEqual(mine);
  });

  it('has ground that gets higher the further into a range you go', () => {
    const hills = highlandNear(world, WEST);
    const lifts = new Set(hills.map((h) => h.lift));
    expect(hills.length, 'no high country at all').toBeGreaterThan(10);
    expect(lifts.size, 'every mountain face is the same height, so nothing counted its depth')
      .toBeGreaterThan(1);
  });

  it('answers where you can stand, and says the same thing every time', () => {
    const land = landOf(world);
    let dry = 0, wet = 0;
    for (let z = 0; z < 400; z += 13) {
      for (let x = 0; x < 400; x += 13) {
        const first = land(x + 0.5, z + 0.5);
        expect(land(x + 0.5, z + 0.5)).toBe(first);
        if (first) dry++; else wet++;
      }
    }
    expect(dry, 'nowhere to stand in the whole patch').toBeGreaterThan(100);
    expect(wet, 'no water anywhere in the patch').toBeGreaterThan(10);
  });
});
