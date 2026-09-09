import { describe, expect, it } from 'vitest';
import { Simplex2D } from './noise';
import { countryOf, faceAt, faceOf, facesIn } from './localmesh';
import { junctionsOf, roadBetween, roadName, roadsOf, townAt, type Land } from './localroads';

/**
 * A road built from the east is the road built from the west, and a town is called what it is called
 * whoever asks.
 *
 * This is B3, and it is the last piece before an endless world stops being an idea. The mesh already
 * agrees with itself across any distance (B2); what is checked here is everything built on top of
 * it: whether a border carries a road, where that road ends, which crossroads it runs into, whether
 * a town stands there, how big it is and what it is called. Each of those has to be the same answer
 * computed from either side of the thing, or the country has a seam in it — and a seam in a road
 * network is two halves of a village facing each other across a line neither can cross.
 */

function country(seed: number): Land {
  const shape = new Simplex2D(seed);
  const grain = new Simplex2D(seed ^ 0x1234);
  return {
    ...countryOf(seed, (x, z) => (grain.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5, { near: 6, far: 14, tries: 6 }),
    // land and sea from the same kind of field the drawn world uses: broad shapes, not noise
    land: (x, z) => shape.fbm(x * 0.0018, z * 0.0018, 3) > -0.15,
  };
}

const world = country(20260909);

/** A patch with enough dry ground in it to have a road network at all. */
const PATCH = { x0: 200, z0: 200, x1: 340, z1: 340 };

describe('roads that belong to the pair of faces they lie between', () => {
  it('are the same road computed from either side', () => {
    const faces = facesIn(world, PATCH);
    const byId = new Map(faces.map((f) => [f.id, f]));
    let compared = 0;
    for (const face of faces) {
      for (const road of roadsOf(world, face)) {
        const [, otherId] = road.between[0] === face.id ? road.between : [road.between[1], road.between[0]];
        const other = byId.get(otherId);
        if (!other) continue;                       // over the edge of the patch; tested from its side
        const back = roadBetween(world, other, face.id);
        expect(back, `${otherId} sees no road to ${face.id}, which sees one`).toBeTruthy();
        expect(back!.between).toEqual(road.between);
        expect(back!.length).toBeCloseTo(road.length, 6);
        // the ends, whichever order each side happened to find them in
        const mine = [road.ends[0], road.ends[1]].map((c) => `${c.x.toFixed(4)},${c.z.toFixed(4)}`).sort();
        const theirs = [back!.ends[0], back!.ends[1]].map((c) => `${c.x.toFixed(4)},${c.z.toFixed(4)}`).sort();
        expect(theirs).toEqual(mine);
        compared++;
      }
    }
    expect(compared, 'no roads were compared').toBeGreaterThan(20);
  });

  it('are named the same way round however they are asked for', () => {
    expect(roadName('a', 'b')).toEqual(roadName('b', 'a'));
  });

  it('never run over water', () => {
    for (const face of facesIn(world, PATCH)) {
      for (const road of roadsOf(world, face)) {
        // the rule is four of five soundings dry, so the middle of a road is land
        const midX = (road.ends[0].x + road.ends[1].x) / 2;
        const midZ = (road.ends[0].z + road.ends[1].z) / 2;
        expect(world.land(midX, midZ), `a road between ${road.between.join(' and ')} runs through the sea`).toBe(true);
      }
    }
  });

  it('are the same asked for cold as asked for as part of a wider country', () => {
    const site = world.scatter.sitesIn({ x0: 260, z0: 260, x1: 300, z1: 300 })[0];
    expect(site, 'nowhere to stand').toBeTruthy();
    const alone = roadsOf(world, faceOf(world, site)).map((r) => `${r.between.join('|')} ${r.length.toFixed(6)}`).sort();
    const wide = facesIn(world, { x0: 0, z0: 0, x1: 600, z1: 600 }).find((f) => f.id === site.id);
    expect(wide, 'the face vanished from the wider country').toBeTruthy();
    const inCompany = roadsOf(world, wide!).map((r) => `${r.between.join('|')} ${r.length.toFixed(6)}`).sort();
    expect(inCompany).toEqual(alone);
  });
});

describe('crossroads named by the faces that meet there', () => {
  it('are named the same by every face that meets there', () => {
    const faces = facesIn(world, PATCH);
    const byId = new Map(faces.map((f) => [f.id, f]));
    let compared = 0;
    for (const face of faces) {
      for (const junction of junctionsOf(world, face)) {
        expect(junction.id.split('|'), 'a junction of fewer than three faces').toHaveLength(junction.id.split('|').length);
        for (const memberId of junction.id.split('|')) {
          if (memberId === face.id) continue;
          const member = byId.get(memberId);
          if (!member) continue;
          const theirs = junctionsOf(world, member).find((j) => j.id === junction.id);
          expect(theirs, `${memberId} does not know the junction ${junction.id} it is part of`).toBeTruthy();
          expect(theirs!.x).toBeCloseTo(junction.x, 4);
          expect(theirs!.z).toBeCloseTo(junction.z, 4);
          expect(theirs!.roads, 'two faces disagree about how many roads meet').toBe(junction.roads);
          compared++;
        }
      }
    }
    expect(compared, 'no junctions were compared').toBeGreaterThan(20);
  });
});

describe('towns that are what they are wherever you ask from', () => {
  it('stand in the same place, with the same name and size, computed from any of their faces', () => {
    const faces = facesIn(world, PATCH);
    const byId = new Map(faces.map((f) => [f.id, f]));
    const towns = new Map<string, string>();
    let compared = 0;
    for (const face of faces) {
      for (const junction of junctionsOf(world, face)) {
        const town = townAt(world, junction);
        if (!town) continue;
        const saying = `${town.name} ${town.level} ${town.x.toFixed(4)},${town.z.toFixed(4)}`;
        const said = towns.get(town.id);
        if (said !== undefined) expect(saying, `two faces disagree about ${town.id}`).toBe(said);
        towns.set(town.id, saying);
        for (const memberId of town.id.split('|')) {
          const member = byId.get(memberId);
          if (!member || memberId === face.id) continue;
          const theirs = junctionsOf(world, member).find((j) => j.id === town.id);
          if (!theirs) continue;
          const alsoTown = townAt(world, theirs);
          expect(alsoTown, `${memberId} sees no town where ${face.id} sees ${town.name}`).toBeTruthy();
          expect(`${alsoTown!.name} ${alsoTown!.level}`).toBe(`${town.name} ${town.level}`);
          compared++;
        }
      }
    }
    expect(towns.size, 'a country with no towns in it').toBeGreaterThan(0);
    expect(compared, 'no towns were compared from more than one side').toBeGreaterThan(0);
  });

  it('are only where roads meet on dry ground', () => {
    for (const face of facesIn(world, PATCH)) {
      for (const junction of junctionsOf(world, face)) {
        const town = townAt(world, junction);
        if (!town) continue;
        expect(world.land(town.x, town.z), `${town.name} stands in the sea`).toBe(true);
        expect(junction.roads, `${town.name} stands at a dead end`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('are somewhere between rare and everywhere', () => {
    // a country that is all towns is a suburb; one with none is a wilderness. Neither is a country.
    const faces = facesIn(world, { x0: 0, z0: 0, x1: 400, z1: 400 });
    let junctions = 0, towns = 0;
    for (const face of faces) {
      for (const junction of junctionsOf(world, face)) {
        junctions++;
        if (townAt(world, junction)) towns++;
      }
    }
    expect(junctions, 'no crossroads at all').toBeGreaterThan(50);
    const share = towns / junctions;
    expect(share, `${(share * 100).toFixed(1)}% of crossroads have a town`).toBeGreaterThan(0.02);
    expect(share, `${(share * 100).toFixed(1)}% of crossroads have a town`).toBeLessThan(0.5);
  });

  it('has a name that comes from the place rather than from a list somebody keeps', () => {
    const first = faceAt(world, 250, 250);
    expect(first, 'nowhere to stand').toBeTruthy();
    const junction = junctionsOf(world, first!)[0];
    expect(junction, 'no crossroads here').toBeTruthy();
    // the same junction, named twice, without anything remembering the first answer
    const once = townAt(country(world.seed), junction);
    const again = townAt(country(world.seed), junction);
    expect(once?.name).toBe(again?.name);
    // and a different world calls it something else
    const elsewhere = townAt(country(world.seed + 1), junction);
    if (once && elsewhere) expect(elsewhere.name === once.name).toBe(false);
  });
});
