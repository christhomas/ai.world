import { describe, expect, it } from 'vitest';
import { countryOf } from './localmesh';
import { graphIn, levelAt } from './localgraph';
import type { Land } from './localroads';
import { Simplex2D } from './noise';
import type { Within } from './window';

/**
 * The roads of a patch are the roads of the country, whichever patch you ask for.
 *
 * `roadweb.ts` can answer this for nothing, because it builds every road in the world at once and
 * there is only ever one answer. A patch has to earn it: two patches that overlap are built from
 * different faces, in a different order, and number their crossroads differently, and they must
 * still put the same road in the same place with the same bend in it and the same terrace at either
 * end — or a player walking from one patch into the next walks off a road onto nothing.
 *
 * The terraces are the other half. The bounded world could take them off a rough field and smooth
 * them along a spanning tree afterwards; there is no tree here, so the field itself has to be gentle
 * enough that no road climbs more than one terrace between one crossroads and the next. That is a
 * claim about a number, and the last test is what holds the number to it.
 */

function country(seed: number): Land {
  const shape = new Simplex2D(seed);
  const grain = new Simplex2D(seed ^ 0x1234);
  return {
    ...countryOf(seed, (x, z) => (grain.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5, { near: 6, far: 14, tries: 6 }),
    land: (x, z) => shape.fbm(x * 0.0018, z * 0.0018, 3) > -0.15,
  };
}

const SEED = 20260909;

/** Two patches sharing a good deal of ground, neither a corner of the other. */
const WEST: Within = { x0: 100, z0: 100, x1: 400, z1: 400 };
const EAST: Within = { x0: 250, z0: 100, x1: 550, z1: 400 };
const OVERLAP: Within = { x0: 250, z0: 100, x1: 400, z1: 400 };

/** Every road of a patch, named by where it runs rather than by what it is numbered. */
function roadsOf(graph: ReturnType<typeof graphIn>, inside: Within): Map<string, string> {
  const out = new Map<string, string>();
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a], b = graph.nodes[edge.b];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (mid.x < inside.x0 || mid.x > inside.x1 || mid.z < inside.z0 || mid.z > inside.z1) continue;
    const ends = [`${a.x.toFixed(4)},${a.z.toFixed(4)}@${a.level}`, `${b.x.toFixed(4)},${b.z.toFixed(4)}@${b.level}`].sort();
    out.set(ends.join(' '), `${edge.roadWidth}`);
  }
  return out;
}

describe('the roads of one patch of an endless country', () => {
  const world = country(SEED);
  const west = graphIn(world, WEST);
  const east = graphIn(world, EAST);

  it('are the same roads in the ground both patches hold', () => {
    const mine = roadsOf(west, OVERLAP), theirs = roadsOf(east, OVERLAP);
    expect(mine.size, 'no roads in the overlap at all').toBeGreaterThan(20);
    expect([...theirs.keys()].sort()).toEqual([...mine.keys()].sort());
  });

  it('bend the same way whichever patch drew them', () => {
    // the bends are nodes of their own, so this is already covered above — but only if a bent road
    // is what is being compared, so say out loud that the roads are bent
    const straight = west.edges.filter((e) => {
      const a = west.nodes[e.a], b = west.nodes[e.b];
      return a.x === b.x || a.z === b.z;
    });
    expect(straight.length, 'every road is a straight line, so the comparison proves nothing')
      .toBeLessThan(west.edges.length / 2);
  });

  it('agree about the towns standing in the ground both hold', () => {
    const townsIn = (graph: typeof west, inside: Within): string[] => graph.towns
      .map((i) => graph.nodes[i])
      .filter((n) => n.x >= inside.x0 && n.x <= inside.x1 && n.z >= inside.z0 && n.z <= inside.z1)
      .map((n) => `${n.x.toFixed(4)},${n.z.toFixed(4)}`)
      .sort();
    const mine = townsIn(west, OVERLAP), theirs = townsIn(east, OVERLAP);
    expect(mine.length, 'no towns in the overlap').toBeGreaterThan(0);
    expect(theirs).toEqual(mine);
  });

  it('are the same asked for cold as asked for as a corner of something bigger', () => {
    const small: Within = { x0: 300, z0: 300, x1: 380, z1: 380 };
    const alone = graphIn(country(SEED), small);
    const wide = graphIn(country(SEED), { x0: 0, z0: 0, x1: 800, z1: 800 });
    expect([...roadsOf(wide, small).keys()].sort()).toEqual([...roadsOf(alone, small).keys()].sort());
  });

  it('never climb more than a terrace between one crossroads and the next', () => {
    let steepest = 0, roads = 0;
    for (const edge of west.edges) {
      const climb = Math.abs(west.nodes[edge.a].level - west.nodes[edge.b].level);
      if (climb > steepest) steepest = climb;
      roads++;
    }
    expect(roads, 'no roads to measure').toBeGreaterThan(50);
    expect(steepest, 'a road climbs more than one terrace, so the terrace field is too rough').toBeLessThanOrEqual(1);
  });

  it('puts a crossroads at the same height wherever it is asked from, and another world elsewhere', () => {
    let differed = 0;
    for (let z = 0; z < 2000; z += 137) {
      for (let x = 0; x < 2000; x += 137) {
        expect(levelAt(SEED, x + 0.5, z + 0.25)).toBe(levelAt(SEED, x + 0.5, z + 0.25));
        if (levelAt(SEED, x + 0.5, z + 0.25) !== levelAt(SEED + 1, x + 0.5, z + 0.25)) differed++;
      }
    }
    // four terraces, so any one place may agree between two worlds by chance; the country cannot
    expect(differed, 'two worlds have the same ground everywhere').toBeGreaterThan(20);
  });
});
