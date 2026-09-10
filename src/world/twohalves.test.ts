import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { WORLD } from '../core/config';
import { KINDS } from '../entities/animals';
import { bodyBox, canStand } from '../entities/entity';
import { propFootprints } from '../entities/props';
import { BLOCKS_WALKING } from './biomes';
import { blocking } from './footprints';
import { GroundWorld } from './groundworld';
import { cleanIslands } from '../../server/protocol';
import { generateWebGraph } from './roadweb';
import { generateRoadGraph, islandAnchors } from './graph';
import { growWorld } from './growworld';
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
 *
 * ---
 *
 * What it is still for, now that the ground travels.
 *
 * The sentence this file opens with stopped being true while it was being written. A chunk of
 * country goes down the wire today: the page asks for what it has not got, the world sends the
 * tiles it is walking creatures across, and the page draws those rather than its own. Two halves
 * that are handed the same arrays cannot disagree about the height of a tile, and the seed grows
 * one country because there is now one expression in the game that grows one at all — see
 * `growworld.test.ts`, which is the test of that.
 *
 * So this bench is no longer the thing standing between a player and a country he cannot see. What
 * it is now is a test of the page's own generator, which is still there and still runs. A page
 * whose world has not answered draws the country rather than standing in the dark, and everything
 * below is the question of whether *that* country is the one the world would have sent. It is the
 * same four thousand points and the same disagreements; what has changed is that a failure here is
 * now a fault in a fallback rather than in the game.
 *
 * That is a demotion and it is worth being plain about it, because a bench nobody can say the
 * purpose of is a bench that gets deleted for the wrong reason or kept for none. The fallback is
 * load-bearing — it is what a hiccupping socket looks like instead of a black screen — and nothing
 * else in this repository would notice if it drifted.
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

  it('and is handed the whole of the country at the join, not a seed to guess from', () => {
    /*
     * The fault itself, kept as a case rather than as a memory.
     *
     * A seed is not a world: the same number grows a road country or a polygon one and they share
     * nothing. The server used to build the polygon one for everybody, so half the players were
     * walked about a land they could not see. What stops that coming back is not this file's
     * arithmetic — it is that everything a country is a function of travels with the join, so the
     * one call that grows one cannot be handed different arguments on the two sides.
     *
     * Three things, and the join line is read out of the source so that dropping any of them is a
     * failed build rather than a country nobody can see. The kind, because a seed grows two of
     * them. The islands, because where they hang is planned from the seed today and written into a
     * manifest for a world saved before that was true. And where the hero is standing, which is
     * not part of the country at all — it is what lets the world grow that acre of it before the
     * page asks, which is the difference between the page being sent the ground and the page
     * drawing its own and being corrected.
     */
    const protocol = readFileSync('server/protocol.ts', 'utf8');
    const join = protocol.split('\n').find((line) => line.includes("{ type: 'join';")) ?? '';
    expect(join, 'the join no longer says which world it is in').toContain('world: WorldKind');
    expect(join, 'the join no longer says where this world put its islands').toContain('islands?: Anchor[]');
    expect(join, 'the join no longer says where the hero is standing').toContain('x?: number');
    // and the one call itself, which `growworld.test.ts` holds to being the only one there is
    const sim = readFileSync('server/sim.ts', 'utf8');
    expect(sim, 'the server has gone back to picking the world itself')
      .toContain('growWorld(seed, kind, room?.islands)');
    covered.push('PASS      1  the country travels with the join, and the world grows what it is told');
  });

  it('and grows the same road country on both sides, islands and all', () => {
    /*
     * The second half of the same fault, and the one this bench could not see.
     *
     * Choosing the right *kind* of world is not enough: the page attached the islands to its road
     * tree and the server did not, so the same seed grew two countries and whichever filled a chunk
     * first won. Seed 1's third village is Elderholm without them and Brambleholm with them. It was
     * found as a hero standing in a named village in an empty field — the people from one world,
     * the ground from the other.
     *
     * Every other test in this file builds the same graph on both sides, which is why none of them
     * noticed: they compared two copies of the same half. This one grows a road world the way each
     * side grows it and asks whether they are the same place.
     *
     * The way each side grows it has since become one call with the islands as an argument, and the
     * islands travel — so what is worth testing here is the journey. The page's anchors are written
     * out as JSON, read back, and put through the guard that every join goes through, which is
     * exactly what happens to them between one half and the other. A guard that quietly rounded a
     * coordinate or dropped a seed would put the two halves back in different countries by a route
     * no amount of care in the generator could close.
     */
    for (const seed of [1, 3, 7]) {
      const mine = islandAnchors(generateRoadGraph(seed), seed);
      const asTheyArrive = cleanIslands(JSON.parse(JSON.stringify(mine)) as unknown);
      const page = new TerrainSampler(growWorld(seed, 'road', mine));
      const world = new TerrainSampler(growWorld(seed, 'road', asTheyArrive));
      const names = (s: TerrainSampler): string => s.structures.villages.map((v) => `${v.name}@${v.x.toFixed(1)},${v.z.toFixed(1)}`).join(' ');
      expect(names(world), `seed ${seed} is two different countries`).toBe(names(page));
    }
    covered.push('PASS      3  a road world is the same country on the page and in the world, islands included');
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
