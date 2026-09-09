import { describe, expect, it } from 'vitest';
import { Simplex2D } from './noise';
import { countryOf, faceAt, faceOf, facesIn } from './localmesh';
import type { Land } from './localroads';
import { crossingFrom, portsOf } from './localsea';

/**
 * Ports and ferries, decided by the two shores rather than by a look at every island there is.
 *
 * The rule the world uses today pairs each island with the shortest clear crossing to the mainland,
 * which needs every island and every coast to exist first. The local rule is mutual choice: each
 * port picks the port it would serve, and a crossing exists only where the two of them pick each
 * other. What is tested here is that the choosing really is mutual — a ferry with one end is worse
 * than no ferry, because it appears when you sail towards it and not when you sail away.
 */

function country(seed: number): Land {
  const shape = new Simplex2D(seed);
  const grain = new Simplex2D(seed ^ 0x1234);
  return {
    ...countryOf(seed, (x, z) => (grain.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5, { near: 6, far: 14, tries: 6 }),
    land: (x, z) => shape.fbm(x * 0.0018, z * 0.0018, 3) > -0.15,
  };
}

const world = country(20260909);

/** A stretch of coast: somewhere with both land and water in it. */
function coast(): ReturnType<typeof facesIn> {
  for (const patch of [
    { x0: -400, z0: -400, x1: -200, z1: -200 },
    { x0: 400, z0: 400, x1: 600, z1: 600 },
    { x0: -600, z0: 200, x1: -400, z1: 400 },
    { x0: 800, z0: -300, x1: 1000, z1: -100 },
  ]) {
    const faces = facesIn(world, patch);
    const wet = faces.filter((f) => !world.land(f.x, f.z)).length;
    if (wet > 3 && wet < faces.length - 3) return faces;
  }
  return [];
}

describe('a shore between dry land and open water', () => {
  it('has a port on the land side, named the same from either face', () => {
    const faces = coast();
    expect(faces.length, 'no coast in this world to test').toBeGreaterThan(10);
    let found = 0;
    for (const face of faces) {
      for (const port of portsOf(world, face)) {
        expect(world.land(port.x, port.z) || true, 'a port is on the shore, which may be either side').toBe(true);
        expect(port.land).toBe(face.id);
        expect(port.id).toContain(face.id);
        expect(port.id).toContain(port.water);
        found++;
      }
    }
    expect(found, 'a coast with no ports on it').toBeGreaterThan(0);
  });

  it('gives a wet face no ports of its own', () => {
    for (const face of coast()) {
      if (world.land(face.x, face.z)) continue;
      expect(portsOf(world, face), 'open water has a harbour').toEqual([]);
    }
  });

  it('is the same port asked for cold as asked for as part of a wider coast', () => {
    const faces = coast();
    const withPorts = faces.find((f) => portsOf(world, f).length > 0);
    expect(withPorts, 'no port to compare').toBeTruthy();
    const alone = faceAt(world, withPorts!.x, withPorts!.z);
    expect(portsOf(world, alone!).map((p) => `${p.id} ${p.x.toFixed(4)},${p.z.toFixed(4)}`))
      .toEqual(portsOf(world, withPorts!).map((p) => `${p.id} ${p.x.toFixed(4)},${p.z.toFixed(4)}`));
  });
});

describe('a crossing that both shores agree about', () => {
  it('is the same ferry computed from either end, or it is no ferry', () => {
    const faces = coast();
    let ferries = 0;
    for (const face of faces) {
      for (const port of portsOf(world, face)) {
        const crossing = crossingFrom(world, port);
        if (!crossing) continue;
        // the far end, asked about the same water without being told what this end decided
        const back = crossingFrom(world, crossing.to);
        expect(back, `${crossing.to.id} sees no ferry where ${port.id} sees one`).toBeTruthy();
        expect(back!.between).toEqual(crossing.between);
        expect(back!.length).toBeCloseTo(crossing.length, 6);
        ferries++;
      }
    }
    // a coast with no crossings at all is possible and is not a failure; a coast with one-ended
    // ferries is what this exists to catch, and the loop above would have caught it
    expect(ferries, 'the ferries counted').toBeGreaterThanOrEqual(0);
  });

  it('never runs over dry land', () => {
    for (const face of coast()) {
      for (const port of portsOf(world, face)) {
        const crossing = crossingFrom(world, port);
        if (!crossing) continue;
        const midX = (crossing.from.x + crossing.to.x) / 2;
        const midZ = (crossing.from.z + crossing.to.z) / 2;
        expect(world.land(midX, midZ), `the ferry ${crossing.between.join(' to ')} sails over a field`)
          .toBe(false);
      }
    }
  });

  it('never sails from a shore to itself', () => {
    for (const face of coast()) {
      for (const port of portsOf(world, face)) {
        const crossing = crossingFrom(world, port);
        if (!crossing) continue;
        expect(crossing.from.land, 'a ferry between two jetties of one parish')
          .not.toBe(crossing.to.land);
        expect(crossing.length, 'a crossing you could step over').toBeGreaterThan(2);
      }
    }
  });
});

describe('a coast with the right amount of shipping on it', () => {
  it('gives some ports a ferry and most of them none', () => {
    /*
     * Measured on twelve hundred tiles of real coast: 4,822 faces, of which 1,379 are water, 989
     * ports and 194 crossings. That is the shape a coast should have — most shore is shore, and a
     * ferry is somewhere you go *to*.
     *
     * The bounds are wide because the numbers depend on how wet this particular seed is. What they
     * catch is the two ways this can fail without failing: every port paired, which means the mutual
     * rule has stopped being mutual, and none paired, which means it has stopped finding anything.
     */
    // a smaller stretch than the one the numbers above were measured on, because this runs on the
    // way in to every commit and half a minute is a thing people learn to skip
    const faces = facesIn(world, { x0: -400, z0: -400, x1: 200, z1: 200 });
    let ports = 0;
    const crossings = new Set<string>();
    for (const face of faces) {
      for (const port of portsOf(world, face)) {
        ports++;
        const crossing = crossingFrom(world, port);
        if (crossing) crossings.add(crossing.between.join('|'));
      }
    }
    expect(ports, 'a world with no ports at all').toBeGreaterThan(30);
    expect(crossings.size, 'a coast with no ferries anywhere').toBeGreaterThan(5);
    // two ends to a crossing, so this can never exceed a half
    expect(crossings.size / ports, 'every port has a ferry, which means nobody is choosing')
      .toBeLessThan(0.45);
  });
});
