import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { generateWebGraph } from './roadweb';
import { GroundWorld } from './groundworld';
import { TerrainSampler } from './terrain';

/**
 * The ground as the simulation sees it.
 *
 * The game's own `ChunkManager` answers these questions for the player and draws the world while it
 * is at it. This answers them for a server that draws nothing, and the pair have to agree — a
 * creature the server walks into a lake is a creature the player watches drown.
 *
 * What is checked here is that it is the same ground, that it exists only where somebody is, and
 * that it forgets what nobody is near, because that last one is what stops a world that has been
 * walked across from growing until the machine gives out.
 */

const CS = WORLD.CHUNK_SIZE;
const world = (seed = 3): GroundWorld => new GroundWorld(new TerrainSampler(generateWebGraph(seed)));

describe('the ground, with nobody drawing it', () => {
  it('makes chunks only where somebody has reached, and says how many it made', () => {
    const ground = world();
    expect(ground.held).toBe(0);
    // three chunks either side of the one you are in: seven by seven
    const made = ground.reach(0, 0, 3);
    expect(made).toBe(49);
    expect(ground.held).toBe(49);
    // asking again for the same country costs nothing
    expect(ground.reach(0, 0, 3)).toBe(0);
  });

  it('answers about the ground it holds, and says nothing about ground it does not', () => {
    const ground = world();
    ground.reach(0, 0, 1);
    const near = ground.heightAt(2.5, 2.5);
    expect(near === null || Number.isFinite(near)).toBe(true);
    // far outside anything anybody has reached: unknown rather than guessed
    expect(ground.heightAt(9_000, 9_000)).toBeNull();
    expect(ground.blocked(9_000, 9_000), 'unknown ground is not walked into').toBe(true);
  });

  it('agrees with the terrain it was built from, tile for tile', () => {
    const sampler = new TerrainSampler(generateWebGraph(3));
    const ground = new GroundWorld(sampler);
    ground.reach(0, 0, 1);
    const sample = sampler.newSample();
    let checked = 0;
    for (let z = 0; z < CS; z += 3) {
      for (let x = 0; x < CS; x += 3) {
        sampler.sampleTile(x, z, sample);
        const said = ground.heightAt(x + 0.5, z + 0.5);
        if (said === null) continue;      // water and seabed are not walkable, which is its own answer
        checked++;
        // Either the ground itself or the rock standing on it, and never anything else. Within a
        // float's breadth: a chunk keeps its heights as 32-bit floats and the sampler works in 64,
        // so the two agree to about seven digits and no further.
        const asGround = Math.abs(said - sample.height) < 1e-4;
        expect(asGround || said > sample.height, `${x},${z}: ${said} against ${sample.height}`).toBe(true);
      }
    }
    expect(checked, 'there was land in the middle of the world to check').toBeGreaterThan(10);
  });

  it('knows a road when it is standing on one', () => {
    const sampler = new TerrainSampler(generateWebGraph(3));
    const ground = new GroundWorld(sampler);
    ground.reach(0, 0, 2);
    const sample = sampler.newSample();
    let roads = 0;
    for (let z = -CS; z < CS * 2; z += 2) {
      for (let x = -CS; x < CS * 2; x += 2) {
        sampler.sampleTile(x, z, sample);
        if (ground.isRoad(x + 0.5, z + 0.5)) roads++;
      }
    }
    // the hero starts at a crossroads, so there is certainly road in the middle of the world
    expect(roads).toBeGreaterThan(0);
  });

  it('forgets the country nobody is standing in', () => {
    const ground = world();
    ground.reach(0, 0, 2);
    ground.reach(600, 600, 2);
    expect(ground.held).toBe(50);

    // one player, in one place: everything else goes
    const dropped = ground.keepOnly([{ x: 0, z: 0 }], 2);
    expect(dropped).toBe(25);
    expect(ground.held).toBe(25);
    expect(ground.heightAt(600.5, 600.5), 'and what went is properly gone').toBeNull();
  });

  it('holds nothing at all when there is nobody anywhere', () => {
    const ground = world();
    ground.reach(0, 0, 2);
    expect(ground.keepOnly([], 2)).toBe(25);
    expect(ground.held).toBe(0);
  });
});
