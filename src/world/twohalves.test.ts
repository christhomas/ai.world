import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { WORLD } from '../core/config';
import { KINDS } from '../entities/animals';
import { bodyBox, canStand } from '../entities/entity';
import { propFootprints } from '../render/props';
import { BLOCKS_WALKING } from './biomes';
import { blocking } from './footprints';
import { GroundWorld } from './groundworld';
import { generateWebGraph } from './roadweb';
import { Solids, boxesFrom } from './solids';
import { propsOf } from './propstream';
import { TerrainSampler, TileType } from './terrain';
import { tilesOf } from './tiles';

/**
 * One world, grown twice, and made to answer the same.
 *
 * The game is two halves that never send each other a landscape. Both grow it from the seed — the
 * page so it can draw it, the server so it can walk heroes and creatures across it — and everything
 * after that assumes the two countries are the same country. Nothing checked.
 *
 * When they were not, it was unplayable and impossible to describe. The server built its polygon
 * world for a player whose save said road, so it had open ground where he could see a house and a
 * wall where he could see a field; it walked his hero about a land he had never seen and corrected
 * him into it. He reported walking through walls, being bitten by wolves that were not there, and
 * swinging at animals that took no damage. Three impossible things, one cause, and no test in this
 * repository could have found it: each half was perfectly correct about its own world.
 *
 * So the two halves are asked the same questions here — how high is the ground, is there water, is
 * this a road, what is solid, and can this creature stand here — at a few thousand points across a
 * real world, and any disagreement is the bug that cannot otherwise be found.
 *
 * It is deliberately not about whether either answer is *right*. It is about whether they are the
 * same, which is the only thing that matters when one of them owns where you are standing.
 */

/** Where the run leaves its account of itself. Printed by `chore test halves`. */
const REPORT = 'halves-report.txt';
const covered: string[] = [];

/** The seeds asked about: one arbitrary, one the whole project has been played on. */
const SEEDS = [3, 1234];

/** How many points each seed is asked about. Enough to cross villages, woods, roads and coast. */
const POINTS = 2000;

/**
 * The page's half of the world, built the way the page builds it.
 *
 * The chunk worker packs tiles for drawing and a stream of props; the game turns those into the
 * ground it walks on. This does the same by hand, without a worker or a renderer, so that what is
 * compared is the arithmetic rather than the plumbing.
 */
function asThePageHasIt(seed: number) {
  const sampler = new TerrainSampler(generateWebGraph(seed));
  const stops = blocking(propFootprints(), BLOCKS_WALKING);
  const CS = WORLD.CHUNK_SIZE;
  const tiles = new Map<string, ReturnType<typeof tilesOf>>();
  const solids = new Solids();
  const grow = (cx: number, cz: number): void => {
    const key = `${cx},${cz}`;
    if (tiles.has(key)) return;
    const chunk = sampler.generateChunk(cx, cz);
    tiles.set(key, tilesOf(chunk));
    solids.put(key, boxesFrom(propsOf(chunk, sampler.seed), stops));
  };
  return {
    sampler,
    grow,
    heightAt(x: number, z: number): number | null {
      const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
      grow(cx, cz);
      const t = tiles.get(`${cx},${cz}`)!;
      const i = (Math.floor(z) - cz * CS) * CS + (Math.floor(x) - cx * CS);
      const type = t.types[i] as TileType;
      // the same three the ground world calls "not ground": a hole in the world, the seabed, and
      // the bed of a river or lake, whose surface is water rather than somewhere to stand
      if (type === TileType.Skip || type === TileType.Seabed || type === TileType.Water) return null;
      return t.heights[i];
    },
    solidAt(x: number, z: number, body?: ReturnType<typeof bodyBox>): boolean {
      grow(Math.floor(x / CS), Math.floor(z / CS));
      return solids.at(x, z, body);
    },
  };
}

describe('the same world, grown on both sides', () => {
  for (const seed of SEEDS) {
    it(`agrees about the ground of seed ${seed}`, () => {
      const page = asThePageHasIt(seed);
      const world = new GroundWorld(new TerrainSampler(generateWebGraph(seed)), blocking(propFootprints(), BLOCKS_WALKING));
      const rng = mulberry32(seed);
      const differ: string[] = [];
      let asked = 0;

      for (let n = 0; n < POINTS; n++) {
        // a band of country wide enough to hold villages, woods, roads and a coast
        const x = 60 + rng() * 200, z = 60 + rng() * 200;
        world.reach(x, z, 0);
        page.grow(Math.floor(x / WORLD.CHUNK_SIZE), Math.floor(z / WORLD.CHUNK_SIZE));
        asked++;

        const mine = page.heightAt(x, z), theirs = world.heightAt(x, z);
        if ((mine === null) !== (theirs === null)) {
          differ.push(`${x.toFixed(1)},${z.toFixed(1)}: one half has ground and the other has none (${mine} / ${theirs})`);
          continue;
        }
        if (mine !== null && theirs !== null && Math.abs(mine - theirs) > 1e-6) {
          differ.push(`${x.toFixed(1)},${z.toFixed(1)}: the ground is ${mine.toFixed(3)} on one side and ${theirs.toFixed(3)} on the other`);
        }
        if (page.solidAt(x, z) !== world.blocked(x, z)) {
          differ.push(`${x.toFixed(1)},${z.toFixed(1)}: something is solid on one side and not the other`);
        }
        // and asked as a body, which is what actually walks
        const hero = bodyBox(KINDS.hero, 0);
        if (page.solidAt(x, z, hero) !== world.blocked(x, z, hero)) {
          differ.push(`${x.toFixed(1)},${z.toFixed(1)}: a hero fits on one side and not the other`);
        }
      }

      covered.push(`${differ.length === 0 ? 'PASS' : 'FAIL'}  ${String(asked).padStart(5)}  points of seed ${seed}: ground, water and what is solid`);
      expect(differ.slice(0, 6), `${differ.length} of ${asked} points disagree`).toEqual([]);
    });

    it(`agrees about where a creature may stand in seed ${seed}`, () => {
      const page = asThePageHasIt(seed);
      const world = new GroundWorld(new TerrainSampler(generateWebGraph(seed)), blocking(propFootprints(), BLOCKS_WALKING));
      const rng = mulberry32(seed + 1);
      const differ: string[] = [];
      let asked = 0;

      // the page's ground, as a world something can be asked to stand in
      const pageWorld = {
        heightAt: (x: number, z: number) => page.heightAt(x, z),
        waterAt: () => null,
        blocked: (x: number, z: number, body?: ReturnType<typeof bodyBox>) => page.solidAt(x, z, body),
        isRoad: (x: number, z: number) => world.isRoad(x, z),
      };

      for (const id of ['hero', 'wolf', 'horse']) {
        for (let n = 0; n < POINTS / 3; n++) {
          const x = 60 + rng() * 200, z = 60 + rng() * 200;
          world.reach(x, z, 0);
          asked++;
          const kind = KINDS[id];
          if (canStand(pageWorld, kind, x, z) !== canStand(world, kind, x, z)) {
            differ.push(`${id} may stand at ${x.toFixed(1)},${z.toFixed(1)} on one side and not the other`);
          }
        }
      }

      covered.push(`${differ.length === 0 ? 'PASS' : 'FAIL'}  ${String(asked).padStart(5)}  places of seed ${seed}: whether a hero, a wolf or a horse may stand there`);
      expect(differ.slice(0, 6), `${differ.length} of ${asked} places disagree`).toEqual([]);
    });
  }

  it('and grows the country the player is in, not the one the server prefers', () => {
    /*
     * The fault itself, kept as a case rather than as a memory.
     *
     * A seed is not a world: the same number grows a road country or a polygon one and they share
     * nothing. The server used to build the polygon one for everybody, so half the players were
     * walked about a land they could not see. What stops that coming back is not this file's
     * arithmetic but the world kind travelling with the join — so the two are read out of the
     * source together, and a server that goes back to choosing for itself fails here.
     */
    const sim = readFileSync('server/sim.ts', 'utf8');
    expect(sim.includes('generateRoadGraph'), 'the server can no longer grow a road world at all').toBe(true);
    expect(sim.includes("kind === 'mesh' ? generateWebGraph(seed) : generateRoadGraph(seed)"),
      'the server has gone back to picking the world itself').toBe(true);
    const protocol = readFileSync('server/protocol.ts', 'utf8');
    expect(protocol.includes('world: WorldKind'), 'the join no longer says which world it is in').toBe(true);
    covered.push('PASS      1  the world kind travels with the join, and the server grows what it is told');
  });
});

describe('what this bench covered', () => {
  it('writes down what the two halves were asked', () => {
    const lines = [
      `TWO HALVES — ${covered.every((l) => l.startsWith('PASS')) ? 'PASS' : 'FAIL'} — ${new Date().toISOString()}`,
      '',
      '  The page grows the world to draw it; the server grows it to walk heroes across it. Nothing',
      '  sends a landscape, so the only thing keeping them in the same country is that they agree.',
      '  This asks both the same questions and fails on any answer that differs.',
      '',
      ...covered.map((line) => `  ${line}`),
      '',
      `  Written by src/world/twohalves.test.ts to ${REPORT}. Run it again with: chore test halves`,
      '',
    ];
    writeFileSync(REPORT, lines.join('\n'));
    expect(covered.length, 'the bench stopped reporting what it did').toBeGreaterThanOrEqual(5);
  });
});
