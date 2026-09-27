import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { boundsOf } from './patchwork';
import { countryFor, partsOf, rebuildPatch } from './endless';
import { growPatch, terrainFor } from './growworld';
import { Manifest } from './manifest';
import { faceAt } from './localmesh';
import { kindOf, landOf } from './localland';
import { roadsOf } from './localroads';
import { FaceKind } from './mesh';
import { TerrainLayers, type TerrainLayer } from './terrainlayers';

const SEED = 3;
const WITHIN = boundsOf('0,0');
const CENTRE = { x: 284.9186586951837, z: 354.1312893293798 };
const LAND: TerrainLayer = { ...CENTRE, reach: 75, seed: 42, kind: 'land' };

describe('terrain-kind layers', () => {
  it('turns a sea face into land before roads and water are planned', () => {
    const bare = countryFor(SEED);
    const sea = faceAt(bare, CENTRE.x, CENTRE.z)!;
    expect(kindOf(bare, sea)).toBe(FaceKind.Sea);
    expect(roadsOf(bare, sea)).toHaveLength(0);

    const authored = countryFor(SEED, [LAND]);
    const land = faceAt(authored, CENTRE.x, CENTRE.z)!;
    expect(kindOf(authored, land)).toBe(FaceKind.Land);
    expect(landOf(authored)(CENTRE.x, CENTRE.z)).toBe(true);
    expect(roadsOf(authored, land).length).toBeGreaterThan(0);

    const original = growPatch(SEED, WITHIN);
    const manifest = new Manifest(SEED);
    manifest.terrain.push(LAND);
    const restored = new Manifest(SEED, JSON.parse(JSON.stringify(manifest.toJSON())));
    const changed = growPatch(SEED, WITHIN, [], terrainFor(restored));
    expect(changed.graph.edges.length).toBeGreaterThan(original.graph.edges.length);
    expect(changed.hydro.rivers.length).toBeGreaterThan(original.hydro.rivers.length);
  });

  it('rebuilds the same ground from patch parts and the terrain list', () => {
    const grown = growPatch(SEED, WITHIN, [], [LAND]);
    const parts = partsOf(grown);
    expect(parts.terrain).toEqual([LAND]);
    const rebuilt = rebuildPatch(SEED, WITHIN, parts);
    const cx = Math.floor(CENTRE.x / WORLD.CHUNK_SIZE), cz = Math.floor(CENTRE.z / WORLD.CHUNK_SIZE);
    expect(rebuilt.generateChunk(cx, cz)).toEqual(grown.generateChunk(cx, cz));
  });

  it('lets later layers win and keeps the indexed answer equal to a short list', () => {
    const sea: TerrainLayer = { ...LAND, kind: 'sea', seed: 43 };
    const far = Array.from({ length: 9 }, (_, i): TerrainLayer => ({
      x: 10_000 + i * 300, z: 10_000, reach: 50, seed: i, kind: 'sea',
    }));
    expect(new TerrainLayers([LAND, sea]).kindAt(CENTRE.x, CENTRE.z)).toBe(FaceKind.Sea);
    expect(new TerrainLayers([...far, LAND, sea]).kindAt(CENTRE.x, CENTRE.z)).toBe(FaceKind.Sea);
    expect(new TerrainLayers([...far, sea, LAND]).kindAt(CENTRE.x, CENTRE.z)).toBe(FaceKind.Land);
  });
});
