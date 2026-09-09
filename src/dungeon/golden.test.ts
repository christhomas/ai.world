import { describe, expect, it } from 'vitest';
import { generateDungeon, type DungeonStyle } from './generate';
import { DungeonWorld } from './world';

/**
 * The three older places underground, pinned.
 *
 * This was written to answer one question while a castle was being added beside them: does a
 * vault, a cave or a thicket come out of this any differently than it did before? It is kept
 * because the question keeps coming back. A hole in the ground is grown from one seeded stream,
 * and anything that draws from that stream out of turn — a new roll, a loop entered one time
 * fewer, a list built in another order — moves every dungeon in every saved world without failing
 * anything, and the only way that is ever noticed is by somebody who knew what a barrow used to
 * look like.
 *
 * A castle is deliberately not in here. It has never shipped, so there is nothing about it to
 * keep faith with yet, and pinning it would make every honest tuning of its numbers a two-file
 * argument. `castle.test.ts` holds it to being the same castle from the same seed, which is the
 * part that matters while it is still being shaped.
 *
 * Two hashes rather than one, because they fail for different reasons. `layout` is what the
 * generator decided — the tiles and everything standing on them. `world` is what `DungeonWorld`
 * then makes of that: where the floor is, what a chunk says about it, and where the props end up.
 * A change to the mesh a floor is cut into moves the second and leaves the first exactly alone,
 * which is what happened when dungeon walls were given their height back: `corners` are read here
 * through `chunkData` and were nought everywhere before that fix, so a hash taken today is a hash
 * of walls that stand up.
 */

/** FNV-1a over a stream of numbers, the same cheap pin `world/golden.test.ts` uses. */
function fnv(values: Iterable<number>): string {
  let h = 0x811c9dc5;
  for (const v of values) {
    const q = Math.round(v * 1000) | 0;
    h ^= q & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Every seed and floor the pin covers: enough of them that a shifted stream cannot hide. */
const SEEDS = [1, 2, 7, 40, 601, 4242];

export function dungeonFingerprint(style: DungeonStyle): { layout: string; world: string } {
  const layout: number[] = [];
  const world: number[] = [];
  for (const seed of SEEDS) {
    for (let floor = 1; floor <= 3; floor++) {
      const map = generateDungeon(seed, style, floor);
      layout.push(seed, floor, map.size, ...map.tiles);
      for (const r of map.rooms) layout.push(r.x, r.z, r.w, r.h);
      layout.push(...map.entrance);
      for (const c of map.chests) layout.push(c.x, c.z, c.big ? 1 : 0, c.key ? 1 : 0);
      for (const t of map.torches) layout.push(t.x, t.z, t.rot);
      for (const d of map.doors) layout.push(d.x, d.z);
      for (const [x, z, kind] of map.monsterSpots) layout.push(x, z, kind ? kind.length : 0);
      layout.push(...(map.descent ?? [-1, -1]), ...(map.boss ?? [-1, -1]), map.levels ? 1 : 0, map.furniture.length);

      // and what the game then stands on it: the floor's height, its chunks, and its props
      const built = new DungeonWorld(map, `golden:${seed}`, style === 'vault' ? 'vault' : style);
      built.unlocked = floor % 2 === 0;
      for (let x = 0; x < map.size; x++) world.push(built.heightAt(x + 0.5, 20.5) ?? -1);
      for (let cz = 0; cz < built.chunksPerSide; cz++) {
        for (let cx = 0; cx < built.chunksPerSide; cx++) {
          const chunk = built.chunkData(cx, cz);
          world.push(...chunk.type, ...chunk.height, ...chunk.corners, ...chunk.water);
        }
      }
      for (const p of built.props(new Set())) world.push(p.kind, p.x, p.y, p.z, p.rot);
    }
  }
  return { layout: fnv(layout), world: fnv(world) };
}

describe('a hole in the ground is the hole it always was', () => {
  it('grows the same vault, cave and thicket it did before there was a castle', () => {
    for (const style of ['vault', 'cave', 'thicket'] as DungeonStyle[]) {
      expect(dungeonFingerprint(style), `a ${style} is not what it was`).toEqual(GOLDEN[style]);
    }
  });
});

/**
 * Recorded on the branch that added the castle (2026-09-10). Both numbers were taken off `main`
 * first, and `layout` came out identical to these on all three — which is the whole reason they
 * are worth writing down: a fourth kind of place was added to this directory and the three that
 * were already here did not move by a tile.
 *
 * `world` did move, once, and only there: taken with `corners` left out of the stream it is also
 * identical to `main`, so the floor's height, its chunk types, its water and every prop on it are
 * where they were, and what changed is that the rock now has corner heights and therefore stands
 * up. Moving either of these again is a decision about every saved world, not a formality — an
 * ordinary refactor leaves both exactly where they are.
 *
 * A cave and a thicket hash the same because they are the same floor. The generator branches on
 * `style !== 'vault'` and nothing below that asks which of the two it is; what separates them is
 * where you find one and what the light in it looks like, and neither of those is in here.
 */
const GOLDEN: Record<string, { layout: string; world: string }> = {
  vault: { layout: '3d28afbd', world: 'b5032505' },
  cave: { layout: 'f93d40c0', world: 'b5fe3155' },
  thicket: { layout: 'f93d40c0', world: 'b5fe3155' },
};
