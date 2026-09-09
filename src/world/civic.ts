import type { Rng } from '../core/rng';
import type { Biome } from './biomes';
import { StructureKind } from './kinds';
import type { Structure } from './structures';

/**
 * The buildings that face the village square.
 *
 * A house is put wherever the road leaves room for it. These three are not: a chapel, a town hall
 * and a watch house are all set out against the square, facing the well, with a path onto the
 * cobbles, and that shared way of standing is what makes them the village's buildings rather than
 * somebody's. It is one piece of placement used three times, so it is one file.
 *
 * It lives out of `structures.ts` because that file had grown past what anybody can read in a
 * sitting, and this was the seam: everything here is answered from the square, the ground and what
 * is already standing, and nothing here knows how a village is founded or how a road is laid.
 * `paddock.ts` was split off for the same reason and takes its world the same way — a plain object
 * of what it needs, handed in by whoever is doing the laying out.
 */

/** A building that stands on the square, and the tile you go in by. */
export interface Civic {
  building: Structure;
  /** The tile outside the door, on the square's side of it. */
  door: [number, number];
}

/** How the square's buildings are set out. Distances in tiles. */
export const SQUARE = {
  CHAPEL_ATTEMPTS: 12,
  /** How far beyond the square's edge the first ring of building plots sits. */
  OFFSET: 2.6,
  /** Tiles of path laid from a door back to the cobbles before giving up on reaching them. */
  PATH_MAX: 6,
  /**
   * Houses a village needs before it writes anything down about itself.
   *
   * Eight is where a settlement stops being a place where everybody knows everybody. Below it a
   * roll is a list of names each of which you could get by asking anyone in the street, and a fee
   * for reading it would be a joke; above it there are households nobody has met. In practice this
   * is the hub and the towns and nothing else — the small villages are capped at six houses, so a
   * hamlet cannot reach it however the ground falls, which is the intended answer.
   *
   * The watch house wants the same eight and one thing besides: a cell, which arrives at six. So
   * every watch house in the world has a lock-up down the street feeding its sheet, and no village
   * ends up with a sergeant who has nothing to write about. They are two buildings and not one
   * because they were two buildings: the lock-up is a room at the back of a cottage, and the watch
   * house is where the man who put you in it sits and keeps the book.
   */
  CIVIC_HOUSES: 8,
  CIVIC_ATTEMPTS: 24,           // directions round the square, every fifteen degrees of it
  CIVIC_RINGS: [2.6, 4.4, 6.2], // and three distances out from the square's edge, tried in turn
  CIVIC_SLACK: 1,               // terraces of give: one step up to a door is a stride, two is a wall
} as const;

/**
 * Snap an angle to the nearest quarter turn and return it with its unit step.
 *
 * Here rather than in `structures.ts` because this is what "facing the square" means, and the
 * square is what this file is about. Houses use it too — a house faces the road by the same rule —
 * so it is exported rather than kept.
 */
export function facing(angle: number): { rot: number; fx: number; fz: number } {
  const rot = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  return { rot, fx: Math.round(Math.cos(rot)), fz: Math.round(Math.sin(rot)) };
}

/** The square a building is being set against, and the ground round it. */
export interface SquareSide {
  /** The middle of the square and how far the cobbles reach, in tiles. */
  x: number;
  z: number;
  r: number;
  /** The terrace the square itself is on: what a door onto it has to be level with. */
  level: number;
  biome: Biome;
  /** Everything already standing, which is what the new building is added to. */
  all: Structure[];
  /**
   * Will these three by three tiles take a building, and on what terrace?
   *
   * Handed in because the answer belongs to whoever is laying the village out: it has to know
   * about door paths, about the yard ring round every house, and — for these buildings only —
   * that the square's own keep-clear rule is lifted, because a building on the square touches it.
   */
  ground: (tx: number, tz: number) => number | null;
}

/**
 * Set a building on the edge of the square, facing the well, with a short path onto the cobbles.
 *
 * `angleFor` is handed in rather than rolled here, and that is the whole of what separates the
 * three buildings that use this. The chapel has always tried the two sides of the road and then
 * wandered, and it must go on doing exactly that, down to which numbers it takes from the world's
 * stream — every village anybody has ever walked through has its chapel where that put it.
 *
 * `rings` are tried outermost, so a building always takes the nearest band to the square that will
 * have it. The other way round, an early direction with room two rings out beat a later direction
 * with room against the cobbles, and halls ended up in the back lanes for no reason.
 */
function placeBySquare(
  side: SquareSide, kind: StructureKind,
  angleFor: (attempt: number) => number, attempts: number,
  rings: readonly number[], slack: number,
): Civic | null {
  for (const ring of rings) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const a = angleFor(attempt);
      const dist = side.r + ring;
      const cx = Math.floor(side.x + Math.cos(a) * dist), cz = Math.floor(side.z + Math.sin(a) * dist);
      // asked for whatever terrace the ground offers and then held to `slack` of the square's,
      // which with no slack at all is the same question as asking for the square's outright
      const level = side.ground(cx, cz);
      if (level === null || Math.abs(level - side.level) > slack) continue;
      const { rot, fx, fz } = facing(Math.atan2(side.z - (cz + 0.5), side.x - (cx + 0.5)));
      const door: [number, number] = [cx + fx * 2, cz + fz * 2];
      const path: Array<[number, number]> = [];
      let px = door[0], pz = door[1];
      for (let i = 0; i < SQUARE.PATH_MAX && Math.hypot(px + 0.5 - side.x, pz + 0.5 - side.z) > side.r; i++) {
        path.push([px, pz]);
        px += fx; pz += fz;
      }
      const building: Structure = { kind, tx: cx, tz: cz, hw: 1, hd: 1, level, rot, biome: side.biome, path };
      side.all.push(building);
      return { building, door };
    }
  }
  return null;
}

/** The chapel: the two sides of the road first, then anywhere on the ring it will fit. */
export function placeChapel(side: SquareSide, rng: Rng, roadNormal: number): Civic | null {
  return placeBySquare(side, StructureKind.Church,
    (attempt) => attempt < 2 ? roadNormal + attempt * Math.PI : rng() * Math.PI * 2,
    SQUARE.CHAPEL_ATTEMPTS, [SQUARE.OFFSET], 0);
}

/**
 * A hall or a watch house, walked round the square from wherever it was told to start.
 *
 * Deliberately no randomness at all. A village's houses, its name and everything laid out after
 * them come off one stream in one order, so a hall that rolled for its direction would move every
 * village name in the world and every landmark between them — for a building that only ever wants
 * "somewhere on the square that is not taken". Walking the ring finds that, and finds it in a
 * different place in every village anyway, because the ground round each square differs.
 *
 * `turn` is which way round it walks, so the hall and the watch house set off from opposite points
 * and go opposite ways: whatever they end up settling for, they do not end up shoulder to shoulder
 * on the one side of the square that happened to be flat.
 *
 * They search harder than the chapel does — the whole ring rather than a dozen tries at it, two
 * more rings behind the first, and a terrace of give either way. They have to: the chapel is set
 * out before the houses and these are set out after, when the square is already surrounded. Held
 * to the chapel's rule, three towns in four came out with no hall, for want of anywhere rather
 * than for want of people.
 */
export function placeCivic(side: SquareSide, kind: StructureKind, from: number, turn: number): Civic | null {
  return placeBySquare(side, kind,
    (attempt) => from + turn * attempt * (Math.PI * 2 / SQUARE.CIVIC_ATTEMPTS),
    SQUARE.CIVIC_ATTEMPTS, SQUARE.CIVIC_RINGS, SQUARE.CIVIC_SLACK);
}
