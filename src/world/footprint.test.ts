import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from './graph';
import { TerrainSampler } from './terrain';
import { footprintLevel } from './footprint';
import { StructureKind } from './structures';
import { TileType } from './terrain';

/**
 * The player can now commission a house by walking somewhere and saying there, and whether the
 * ground will take one is answered by this — the same function the world uses when it decides
 * where a village's own houses go.
 *
 * The claim worth pinning is that it really is the same answer. Two implementations of "will this
 * ground take a building" would drift, and the one that drifted would be the one the player was
 * standing on: you would be told no on a spot with a cottage twenty paces away on identical
 * ground. So the test is that every house the world put down is on ground this accepts.
 */
describe('ground that will take a building', () => {
  const sampler = new TerrainSampler(generateRoadGraph(1));

  it('accepts every plot the world itself chose to put a house on', () => {
    const houses = sampler.structures.all.filter((s) => s.kind === StructureKind.House);
    expect(houses.length).toBeGreaterThan(20);
    for (const h of houses) {
      expect(footprintLevel(sampler, h.tx, h.tz, h.hw, h.hd, null), `${h.tx},${h.tz}`).toBe(h.level);
    }
  });

  it('refuses open water, whatever else is true of it', () => {
    const sample = sampler.newSample();
    let water: [number, number] | null = null;
    for (let x = -300; x < 300 && !water; x += 3) {
      for (let z = -300; z < 300; z += 3) {
        sampler.sampleTile(x, z, sample);
        if (sample.type === TileType.Water) { water = [x, z]; break; }
      }
    }
    expect(water).not.toBeNull();
    expect(footprintLevel(sampler, water![0], water![1], 1, 1, null)).toBeNull();
  });

  it('refuses a road, because a house across the lane is a house nobody can reach', () => {
    const node = generateRoadGraph(1).nodes[0];
    const sample = sampler.newSample();
    sampler.sampleTile(Math.floor(node.x), Math.floor(node.z), sample);
    expect(sample.type).toBe(TileType.Road);
    expect(footprintLevel(sampler, Math.floor(node.x), Math.floor(node.z), 1, 1, null)).toBeNull();
  });

  it('refuses a plot that straddles two terraces, because a house is not a staircase', () => {
    const sample = sampler.newSample();
    let step: [number, number] | null = null;
    for (let x = -200; x < 200 && !step; x += 1) {
      for (let z = -200; z < 200; z += 1) {
        sampler.sampleTile(x, z, sample);
        if (sample.type !== TileType.Ground && sample.type !== TileType.GroundAlt) continue;
        const here = sample.level;
        sampler.sampleTile(x + 1, z, sample);
        const land = sample.type === TileType.Ground || sample.type === TileType.GroundAlt;
        if (land && sample.level === here + 1) { step = [x, z]; break; }
      }
    }
    expect(step).not.toBeNull();
    // the footprint is centred on the lower tile and reaches across the step
    expect(footprintLevel(sampler, step![0] + 1, step![1], 1, 1, null)).toBeNull();
  });
});
