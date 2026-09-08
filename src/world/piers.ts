import type { Pier } from './structures';
import type { TerrainSampler, TileSample } from './terrain';
import { TileType } from './terrain';

/**
 * Laying a jetty out from a shore.
 *
 * An island and the mainland each get one facing the other, and a ferry runs between the two dock
 * tiles at their ends. Out of `structures.ts` because it is the one job in there that is about a
 * coast rather than about a settlement, and that file had run out of room.
 */

/** Deck tiles laid into the water once the land has run out. */
const PIER_LENGTH = 6;

/** How far a jetty will walk looking for a coast before giving up on this direction. */
const PIER_WALK_MAX = 260;

/** How many points along a crossing are asked whether they are water. */
const SOUNDINGS = 96;

/**
 * Is the water between two docks actually water all the way?
 *
 * The ferry between them is not a simulation — it is a position worked out from the clock, sliding
 * along the straight line from one dock to the other. So that line had better be sea, and for half
 * the islands in the game it was not: measured across three worlds, ferry lines ran 61, 65 and 93
 * of their 121 sample points over dry land. A ship sailing through an island is exactly what that
 * looks like from the beach.
 */
function crossingIsClear(sampler: TerrainSampler, sample: TileSample, from: Pier, to: Pier): boolean {
  for (let s = 0; s <= SOUNDINGS; s++) {
    const t = s / SOUNDINGS;
    const x = Math.floor(from.dockX + (to.dockX - from.dockX) * t);
    const z = Math.floor(from.dockZ + (to.dockZ - from.dockZ) * t);
    sampler.sampleTile(x, z, sample);
    const type = sample.type;
    const wet = type === TileType.Skip || type === TileType.Seabed || type === TileType.Water;
    if (!wet) return false;
  }
  return true;
}

/**
 * Walk from a start point toward a direction (snapped to an axis) until the land ends, then lay
 * `PIER_LENGTH` deck tiles into the sea. Null if the walk never reaches a coast.
 */
export function planPier(
  sampler: TerrainSampler, sample: TileSample, island: string, side: Pier['side'],
  fromX: number, fromZ: number, dirX: number, dirZ: number,
): Pier | null {
  const dx = Math.abs(dirX) >= Math.abs(dirZ) ? Math.sign(dirX) : 0;
  const dz = dx === 0 ? Math.sign(dirZ) || 1 : 0;
  let x = Math.floor(fromX), z = Math.floor(fromZ);
  let lastLandLevel = 1;
  for (let i = 0; i < PIER_WALK_MAX; i++) {
    sampler.sampleTile(x, z, sample);
    const land = sample.type !== TileType.Skip && sample.type !== TileType.Seabed;
    if (!land) {
      if (i === 0) return null;
      const tiles: Array<[number, number]> = [];
      for (let k = 0; k < PIER_LENGTH; k++) tiles.push([x + dx * k, z + dz * k]);
      return { island, side, tiles, dx, dz, level: lastLandLevel, dockX: x + dx * PIER_LENGTH, dockZ: z + dz * PIER_LENGTH };
    }
    if (sample.type !== TileType.Water && sample.type !== TileType.Bridge) lastLandLevel = Math.max(1, Math.round(sample.level));
    x += dx; z += dz;
  }
  return null;
}

/**
 * Where a ring of start points is tried from, in tiles out from the middle of a shore.
 *
 * Eight directions at three distances plus the middle itself: enough to find a coast that faces
 * the right way on an island whose nearest point does not.
 */
const TRIES: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [[0, 0]];
  for (const r of [12, 24, 36]) {
    for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
      out.push([Math.round(ux * r), Math.round(uz * r)]);
    }
  }
  return out;
})();

/** A place with a middle: an island, or the road node the ferry runs to. */
export interface Shore {
  x: number;
  z: number;
}

/**
 * The two jetties of a ferry line, which have to face each other across open water.
 *
 * Aiming them at each other is not enough to manage it. Each walks out from a point along one axis
 * and stops at the first coast, so on a ragged shore the two end up on rays that miss, and the
 * straight line between their ends cuts back across the island. That matters more here than it
 * would elsewhere, because a ferry is not sailed: it is a position worked out from the clock,
 * sliding down that line. Measured over three worlds before this, crossings ran 61, 65 and 93 of
 * their 121 soundings over dry land — one of them three-quarters aground, which is a ship sailing
 * through an island as seen from the beach.
 *
 * So both shores are surveyed first and then paired, and the shortest crossing with clear water
 * all the way is the one that gets built — the nearest shore being the one anybody would actually
 * have put a jetty on. An island with no clear crossing gets no ferry, which is honest: not
 * everywhere is reachable by boat, and a ferry that sails through a hill is worse than no ferry.
 *
 * Surveying first is also what makes it affordable. Pairing every start point against every other
 * would be a thousand coast walks per island; this is sixty-eight walks and then arithmetic.
 */
export function pairJetties(
  sampler: TerrainSampler, sample: TileSample, island: Shore & { id: string }, mainland: Shore,
): { islandPier: Pier | null; mainPier: Pier | null } {
  const dx = mainland.x - island.x, dz = mainland.z - island.z;

  /** Every jetty this shore could have, along either axis, from any of those start points. */
  const shore = (side: Pier['side'], from: Shore, awayX: number, awayZ: number): Pier[] => {
    const found: Pier[] = [];
    for (const [ax, az] of [[awayX, 0], [0, awayZ], [-awayX, 0], [0, -awayZ]] as Array<[number, number]>) {
      if (ax === 0 && az === 0) continue;
      for (const [ox, oz] of TRIES) {
        const pier = planPier(sampler, sample, island.id, side, from.x + ox, from.z + oz, ax, az);
        if (pier) found.push(pier);
      }
    }
    return found;
  };

  const fromIsland = shore('island', island, dx, dz);
  const fromMain = shore('mainland', mainland, -dx, -dz);

  let islandPier: Pier | null = null, mainPier: Pier | null = null;
  let shortest = Infinity;
  for (const from of fromIsland) {
    for (const to of fromMain) {
      const across = Math.hypot(to.dockX - from.dockX, to.dockZ - from.dockZ);
      // a crossing you could step over is two jetties on the same beach, not a ferry
      if (across >= shortest || across < 2) continue;
      if (!crossingIsClear(sampler, sample, from, to)) continue;
      islandPier = from; mainPier = to; shortest = across;
    }
  }
  return { islandPier, mainPier };
}
