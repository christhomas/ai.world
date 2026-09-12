import { describe, expect, it } from 'vitest';
import { WORLD } from '../core/config';
import { generateWebGraph } from './roadweb';
import { propFootprints } from '../entities/props';
import { GroundWorld, patchedCountry } from './groundworld';
import { PATCH, Patchwork } from './patchwork';
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
const world = (seed = 3): GroundWorld => new GroundWorld(new TerrainSampler(generateWebGraph(seed)), propFootprints());

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
    const ground = new GroundWorld(sampler, propFootprints());
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
    const ground = new GroundWorld(sampler, propFootprints());
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

/**
 * And the same ground over a country that has no whole.
 *
 * Everything above holds one sampler and asks it everything, which is what a world with an edge is.
 * An endless one is a patchwork: the square you are standing in is one sampler, the square next
 * door is another, and no object anywhere holds both. `Country` is what `GroundWorld` actually
 * needs stated small enough that both can satisfy it, and these are the questions that were asked
 * of the one sampler and now have to be asked across a seam.
 *
 * The last of them is the one worth having. A survey of a country that is still being made can only
 * honestly report the country somebody has walked into, and the way that goes wrong is not a wrong
 * answer — it is a survey that quietly grows half a province to be thorough.
 */
describe('the ground, when the country is grown a square at a time', () => {
  const SEED = 4242;
  const both = (): { ground: GroundWorld; patches: Patchwork } => {
    const patches = new Patchwork(SEED);
    patches.patch('0,0');
    patches.patch('1,0');
    return { ground: new GroundWorld(patchedCountry(patches), propFootprints()), patches };
  };

  it('walks on ground painted by whichever square the chunk falls in', () => {
    const { ground } = both();
    // a chunk either side of the seam at x = 512, and both of them real ground rather than a hole
    for (const x of [PATCH - 40, PATCH + 40]) {
      ground.reach(x, PATCH / 2, 1);
      const standing = ground.heightAt(x, PATCH / 2);
      const wet = ground.waterAt(x, PATCH / 2);
      expect(standing !== null || wet !== null, `nothing at all at ${x}`).toBe(true);
    }
  });

  it('surveys the villages of every square that has been grown, and no others', () => {
    const { ground, patches } = both();
    const mine = [...ground.villages].map((v) => `${v.x.toFixed(2)},${v.z.toFixed(2)}`).sort();
    const theirs = patches.inHand()
      .flatMap((s) => s.structures.villages)
      .map((v) => `${v.x.toFixed(2)},${v.z.toFixed(2)}`).sort();
    expect(theirs.length, 'two squares of country with nobody living in either').toBeGreaterThan(1);
    expect(mine).toEqual(theirs);
  });

  it('finds a village and a jetty in the square next door', () => {
    const { ground, patches } = both();
    const east = patches.patch('1,0').structures;
    const village = east.villages[0];
    expect(village, 'no village in the eastern square to look for').toBeDefined();
    // asked from the square to the west of the one it is in, which is the question a single sampler
    // could not answer at all: its window stops at its own edge
    expect(ground.atAVillage(village.x, village.z, 1)).toBe(true);
    expect(ground.peopled(village.x, village.z)).toBe(true);
    const pier = [...patches.inHand().flatMap((s) => s.structures.piers)][0];
    if (pier) expect(ground.atAPier(pier.dockX + 0.5, pier.dockZ + 0.5, 1)).toBe(true);
  });

  it('grows no country to answer a question about what is near a point', () => {
    // the property that makes any of this affordable: these are asked while creatures are being
    // walked, and a survey that grew a square would be most of a second in the middle of a tick
    const { ground, patches } = both();
    const grown = patches.grown;
    ground.atAVillage(PATCH, PATCH / 2, 60);
    ground.peopled(PATCH, PATCH / 2);
    ground.atAPier(PATCH, PATCH / 2, 60);
    void ground.villages;
    void ground.piers;
    expect(patches.grown, 'a question about somewhere grew country to answer it').toBe(grown);
  });
});
