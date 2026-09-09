import { describe, expect, it } from 'vitest';
import { Simplex2D } from './noise';
import { sitesIn, type CellDials } from './scattercells';

/**
 * The one question an endless world turns on: does a patch of country depend on how you got there?
 *
 * Everything else in an infinite world — towns seeding towns, roads meeting at borders, ferries to
 * islands that grow their own islands — is downstream of this. If the ground a mile east is the same
 * ground whether you walked there, sailed there, or asked for it cold, the rest is arithmetic. If it
 * is not, no amount of care further up will save it: two players stand in the same field and see
 * different countries, and the game is over.
 *
 * So this asks for the same patch in every way there is to ask, and demands the same answer. It is
 * the generation half of what `twohalves.test.ts` does for the client and the server, and it exists
 * before any of the infinite world does, because it is the thing that decides whether that world is
 * possible at all.
 */

const DIALS: CellDials = { near: 6, far: 14, tries: 6 };

/** Country that is fine-grained in some places and open in others, as the real one is. */
function grain(seed: number): (x: number, z: number) => number {
  const noise = new Simplex2D(seed);
  return (x, z) => (noise.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5;
}

/** The points of a window, in an order two runs can be compared in. */
const inOrder = (sites: Array<{ x: number; z: number; claim: number }>): string[] =>
  sites.map((s) => `${s.x.toFixed(6)},${s.z.toFixed(6)},${s.claim.toFixed(6)}`).sort();

describe('country that does not care how you reached it', () => {
  const seed = 20260909;
  const spacing = grain(seed);
  const patch = { x0: 400, z0: -250, x1: 520, z1: -130 };

  it('is the same asked for cold as asked for from a mile away', () => {
    const alone = inOrder(sitesIn(seed, spacing, DIALS, patch));
    // the same ground, asked for as a corner of something much bigger
    const wide = sitesIn(seed, spacing, DIALS, { x0: 0, z0: -700, x1: 900, z1: 300 });
    const within = inOrder(wide.filter((s) => s.x >= patch.x0 && s.x <= patch.x1 && s.z >= patch.z0 && s.z <= patch.z1));
    expect(alone.length, 'the patch came back empty, which proves nothing').toBeGreaterThan(10);
    expect(alone).toEqual(within);
  });

  it('is the same asked for in pieces as asked for whole', () => {
    const whole = inOrder(sitesIn(seed, spacing, DIALS, patch));
    // four quarters, asked for in the wrong order, as somebody wandering would
    const midX = (patch.x0 + patch.x1) / 2, midZ = (patch.z0 + patch.z1) / 2;
    const quarters = [
      { x0: midX, z0: midZ, x1: patch.x1, z1: patch.z1 },
      { x0: patch.x0, z0: midZ, x1: midX, z1: patch.z1 },
      { x0: midX, z0: patch.z0, x1: patch.x1, z1: midZ },
      { x0: patch.x0, z0: patch.z0, x1: midX, z1: midZ },
    ].flatMap((corner) => sitesIn(seed, spacing, DIALS, corner));
    // the halves of a boundary are asked for twice, so the same point can come back twice
    expect([...new Set(inOrder(quarters))]).toEqual([...new Set(whole)]);
  });

  it('is not moved by country somewhere else entirely', () => {
    const here = inOrder(sitesIn(seed, spacing, DIALS, patch));
    // a world in which somebody has been ten thousand tiles away first
    sitesIn(seed, spacing, DIALS, { x0: 10_000, z0: 10_000, x1: 10_400, z1: 10_400 });
    expect(inOrder(sitesIn(seed, spacing, DIALS, patch))).toEqual(here);
  });

  it('is a different country under a different seed', () => {
    const mine = inOrder(sitesIn(seed, spacing, DIALS, patch));
    const theirs = inOrder(sitesIn(seed + 1, grain(seed + 1), DIALS, patch));
    expect(theirs).not.toEqual(mine);
  });
});

describe('and is country worth walking about in', () => {
  const seed = 7;
  const spacing = grain(seed);
  const patch = { x0: -300, z0: -300, x1: 300, z1: 300 };

  it('never puts two points closer than the closest they may be', () => {
    const sites = sitesIn(seed, spacing, DIALS, patch);
    let closest = Infinity;
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const dx = sites[i].x - sites[j].x, dz = sites[i].z - sites[j].z;
        closest = Math.min(closest, Math.hypot(dx, dz));
      }
    }
    expect(sites.length, 'nothing to measure').toBeGreaterThan(200);
    // the rule is the larger of the two claims, so the tightest pair possible is two points that
    // both want the least room there is
    expect(closest).toBeGreaterThanOrEqual(DIALS.near * 0.999);
  });

  it('fills the ground rather than leaving holes in it', () => {
    const sites = sitesIn(seed, spacing, DIALS, patch);
    // the furthest any spot in the middle of the patch is from a point. Country with a hole in it
    // would mesh into one enormous face, which is what "no seams" must not mean
    let worst = 0;
    for (let x = -200; x <= 200; x += 25) {
      for (let z = -200; z <= 200; z += 25) {
        let nearest = Infinity;
        for (const s of sites) nearest = Math.min(nearest, Math.hypot(s.x - x, s.z - z));
        worst = Math.max(worst, nearest);
      }
    }
    expect(worst, 'a hole in the country wider than the widest face it should make').toBeLessThan(DIALS.far * 1.6);
  });

  it('is finer where the ground says fine and opener where it says open', () => {
    const sites = sitesIn(seed, spacing, DIALS, patch);
    // the claim each point made against what the field says there: they should agree, because the
    // claim is read off the field. What this really catches is the field being read somewhere else
    // than where the point stands, which is a whole world out of step by half a cell.
    for (const s of sites.slice(0, 50)) {
      const want = DIALS.near + (DIALS.far - DIALS.near) * Math.min(1, Math.max(0, spacing(s.x, s.z)));
      expect(Math.abs(s.claim - want)).toBeLessThan(1e-9);
    }
  });

  it('costs little enough to do while somebody is walking', () => {
    // one screen's worth of country, which is what arriving somewhere new asks for
    const began = performance.now();
    let made = 0;
    for (let n = 0; n < 20; n++) {
      made += sitesIn(seed, spacing, DIALS, { x0: n * 500, z0: 0, x1: n * 500 + 160, z1: 160 }).length;
    }
    const each = (performance.now() - began) / 20;
    expect(made, 'no country was made').toBeGreaterThan(20);
    // generous, because this is a prototype and a slow machine, but it catches an order of
    // magnitude — which is what would make an endless world unplayable rather than merely slower
    expect(each, `${each.toFixed(2)}ms for a screen of country`).toBeLessThan(30);
  });
});
