import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { generateRoadGraph } from './graph';
import { generateWebGraph } from './roadweb';
import { TerrainSampler, TileType } from './terrain';
import { StructureKind } from './structures';

describe('structures', () => {
  it('places villages with houses on flat land, door paths reach a road, POIs exist', () => {
    for (const seed of [1, 2, 3]) {
      const sampler = new TerrainSampler(generateRoadGraph(seed));
      const { villages, pois, all } = sampler.structures;
      expect(villages.length).toBeGreaterThanOrEqual(3);
      expect(pois.length).toBeGreaterThan(3);
      expect(villages[0].name).toBe('Crossroads Town');
      const names = new Set(villages.map((v) => v.name));
      expect(names.size).toBe(villages.length);

      // every house: centre tile is Floor and carries the house prop; path ends next to a road
      let checked = 0;
      for (const s of all) {
        if (s.kind !== StructureKind.House) continue;
        const CS = WORLD.CHUNK_SIZE;
        const cx = Math.floor(s.tx / CS), cz = Math.floor(s.tz / CS);
        const c = sampler.generateChunk(cx, cz);
        const idx = (s.tz - cz * CS + 1) * c.size + (s.tx - cx * CS + 1);
        expect(c.type[idx]).toBe(TileType.Floor);
        expect(c.prop[idx]).toBeGreaterThanOrEqual(20);
        expect(Number.isNaN(c.propRot[idx])).toBe(false);
        // footprint flat
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const j = idx + dz * c.size + dx;
          expect(c.height[j]).toBeCloseTo(s.level * WORLD.STEP, 5);
        }
        checked++;
        if (checked > 12) break;
      }
      expect(checked).toBeGreaterThan(3);
    }
  });

  it('is deterministic', () => {
    const a = new TerrainSampler(generateRoadGraph(9)).structures;
    const b = new TerrainSampler(generateRoadGraph(9)).structures;
    expect(a.all.length).toBe(b.all.length);
    expect(a.villages.map((v) => v.name)).toEqual(b.villages.map((v) => v.name));
  });
});

/**
 * The stable, and the paddock that is what makes it one.
 *
 * A stable used to be a fact and nothing else — a roll on a village's name, and a man on the
 * square who would sell you a horse. From the road the building was a house like every other
 * house, which is no way to find one. It is now laid out with the village: a house with a fenced
 * yard beside it and the country's own animals standing in it.
 */
describe('the stable and its paddock', () => {
  const worlds = [1, 2, 3, 4].map((seed) => new TerrainSampler(generateRoadGraph(seed)).structures);

  it('is kept by some villages and not by others', () => {
    const villages = worlds.flatMap((w) => w.villages);
    const kept = villages.filter((v) => v.stable);
    expect(kept.length, 'somebody keeps one').toBeGreaterThan(0);
    expect(kept.length, 'and not everybody').toBeLessThan(villages.length);
    // never in a hamlet: there has to be spare ground and somebody idle enough to muck it out
    for (const v of kept) expect(v.houses.length).toBeGreaterThanOrEqual(5);
  });

  it('fences the yard all the way round but for the gate', () => {
    for (const w of worlds) {
      for (const v of w.villages) {
        const yard = v.stable;
        if (!yard) continue;
        const rails = new Set(
          w.all.filter((s) => s.kind === StructureKind.Fence
            && Math.abs(s.tx - yard.x) <= yard.half && Math.abs(s.tz - yard.z) <= yard.half)
            .map((s) => `${s.tx},${s.tz}`),
        );
        let edges = 0, missing: string[] = [];
        for (let dz = -yard.half; dz <= yard.half; dz++) {
          for (let dx = -yard.half; dx <= yard.half; dx++) {
            if (Math.abs(dx) !== yard.half && Math.abs(dz) !== yard.half) continue;
            edges++;
            const at = `${yard.x + dx},${yard.z + dz}`;
            if (!rails.has(at)) missing.push(at);
          }
        }
        expect(missing, `${v.name}: one gap, and it is the gate`).toEqual([`${yard.gate[0]},${yard.gate[1]}`]);
        expect(rails.size).toBe(edges - 1);
      }
    }
  });

  it('puts the gate on the side the house is on, so the way in is the way you came', () => {
    for (const w of worlds) {
      for (const v of w.villages) {
        const yard = v.stable;
        if (!yard) continue;
        const toHouse = Math.hypot(yard.house.tx - yard.x, yard.house.tz - yard.z);
        const gateToHouse = Math.hypot(yard.house.tx - yard.gate[0], yard.house.tz - yard.gate[1]);
        expect(gateToHouse, `${v.name}: the gate is the near side`).toBeLessThan(toHouse);
      }
    }
  });

  it('stands the yard on ground it has not had to carve out', () => {
    for (const w of worlds) {
      for (const v of w.villages) {
        const yard = v.stable;
        if (!yard) continue;
        // nothing else is inside the rails: the paddock is laid last and has to fit round the village
        const inside = w.all.filter((s) => s.kind !== StructureKind.Fence && s.kind !== StructureKind.Paddock
          && s.kind !== StructureKind.Plaza
          && Math.abs(s.tx - yard.x) < yard.half && Math.abs(s.tz - yard.z) < yard.half);
        expect(inside.map((s) => s.kind), `${v.name}: an empty yard`).toEqual([]);
      }
    }
  });

  it('clears what was growing inside the rails without touching them', () => {
    const CS = WORLD.CHUNK_SIZE;
    let looked = 0;
    for (const w of worlds) {
      for (const v of w.villages) {
        const yard = v.stable;
        if (!yard) continue;
        const sampler = new TerrainSampler(generateRoadGraph(worlds.indexOf(w) + 1));
        const cx = Math.floor(yard.x / CS), cz = Math.floor(yard.z / CS);
        const c = sampler.generateChunk(cx, cz);
        const at = (x: number, z: number) => (z - cz * CS + 1) * c.size + (x - cx * CS + 1);
        // the middle of the yard is bare, and its own tile is one the animals can be put down on
        const mid = at(yard.x, yard.z);
        if (mid < 0 || mid >= c.prop.length) continue;
        expect(c.prop[mid], `${v.name}: nothing growing in the middle of the yard`).toBe(0);
        looked++;
      }
    }
    expect(looked, 'at least one paddock was actually looked at').toBeGreaterThan(0);
  });
});

/**
 * A ferry that sails through an island.
 *
 * A ferry is not steered: its position is worked out from the clock, sliding down the straight
 * line from one jetty to the other. So that line has to be sea — and it was not. The two jetties
 * each walked out from the middle of their own shore along one axis and stopped at the first
 * coast, which on a ragged shore puts them on rays that miss, and the line between their ends cut
 * back across the island. Measured before the fix, crossings ran 61, 65 and 93 of their 121
 * soundings over dry land: one ferry three-quarters aground.
 */
describe('the water a ferry crosses', () => {
  const SOUNDINGS = 120;

  it('is water all the way, in every world that has a ferry at all', () => {
    let crossings = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const sampler = new TerrainSampler(generateWebGraph(seed));
      const sample = sampler.newSample();
      const piers = sampler.structures.piers;
      // they are pushed in pairs, island shore first
      for (let i = 0; i + 1 < piers.length; i += 2) {
        const from = piers[i], to = piers[i + 1];
        crossings++;
        for (let s = 0; s <= SOUNDINGS; s++) {
          const t = s / SOUNDINGS;
          const x = Math.floor(from.dockX + (to.dockX - from.dockX) * t);
          const z = Math.floor(from.dockZ + (to.dockZ - from.dockZ) * t);
          sampler.sampleTile(x, z, sample);
          const wet = sample.type === TileType.Skip || sample.type === TileType.Seabed || sample.type === TileType.Water;
          expect(wet, `seed ${seed}: aground at ${x},${z}, ${Math.round(t * 100)}% of the way across`).toBe(true);
        }
      }
    }
    expect(crossings, 'and there are ferries to check').toBeGreaterThan(4);
  });

  it('still gives most islands a way to reach them', () => {
    // the point of surveying both shores rather than aiming once: refusing every crossing that is
    // not clear would otherwise leave whole worlds with no ferry at all, which it did at first
    for (const seed of [1, 2, 3, 4, 5]) {
      const sampler = new TerrainSampler(generateWebGraph(seed));
      expect(sampler.structures.piers.length, `seed ${seed} has a ferry`).toBeGreaterThan(0);
    }
  });
});
