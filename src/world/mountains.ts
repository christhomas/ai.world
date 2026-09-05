import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { segDist2, type RoadGraph } from './graph';
import { FaceKind, type MeshRegion, type WorldMesh } from './mesh';

/**
 * Mountains, as a layer of their own.
 *
 * The ground generator answers one question — how high is it here, given how far off the road you
 * are — and answering it well makes a country you can walk across. It is the wrong tool for a
 * mountain: turning its dials up everywhere gives no cliffs and a great deal of collateral (raise
 * the roughness and villages move, and the bands that walk between them stop covering the map).
 *
 * So mountains are a separate stream off the world seed, placed as a handful of massifs at their
 * own anchors, exactly as villages and dungeons are placed. The ground stays the ground; a massif
 * is added on top of it in a few places. Both are pure functions of the seed, so a mountain has
 * the same shape every time it is looked at, on every machine, for the life of the world.
 *
 * The passes come free. Height here is measured from the road, so a massif laid across a road
 * leaves the road at the bottom of it and rears up on both sides: a corridor a few tiles wide with
 * a wall going up out of sight either hand, which is the one piece of country you cannot help
 * feeling something about.
 */

export const MOUNTAIN = {
  /** How many massifs a world gets. Few and enormous beats many and lumpy. */
  RANGES: 10,
  /** How high they stand, in terraces. A terrace is half a world unit, so 100 is fifty units. */
  TALLEST: 104,
  SHORTEST: 56,
  /** How far the base reaches, in tiles. */
  WIDEST: 96,
  NARROWEST: 46,
  /**
   * The share of the radius spent climbing. Small means a flat top and a near-vertical face; at
   * 0.22 a massif is mostly summit with a wall around it rather than a cone you can stroll up.
   */
  SHOULDER: 0.55,
  /**
   * Half the width of the corridor a road keeps through a massif, in tiles, and how far past that
   * the wall takes to reach full height.
   *
   * Very narrow on purpose. A road tile is never lifted at all — the sampler settles roads before
   * it ever asks about mountains — so a road crossing a massif is already a thread of ground at
   * the bottom of it. All this does is keep the verge walkable beside the road. Widen it and the
   * mountains dissolve: there is nowhere in this world more than 22 tiles from a road, and the
   * median is five, so a corridor of even eight tiles flattens everything.
   */
  PASS_HALF: 1.4,
  PASS_FADE: 2.2,
  /**
   * No massif comes nearer than this to a village. Deliberately further than the widest massif
   * reaches: a skirt overlapping a village does not bury it — villages sit on roads and roads are
   * never lifted — but it does take away the flat ground the houses need, so the village lays
   * itself out differently, which moves it, which changes the rounds the roaming bands walk. Two
   * villages in seed 1 stopped being visited at all before this was widened.
   */
  CLEAR_OF_VILLAGES: 60,
  /** Nor nearer than this to each other, so they read as separate ranges. */
  APART: 150,
  /**
   * How far inside the coast a massif has to stand, in tiles.
   *
   * The last couple of tiles before the sea are flattened to the shore's own level to make a
   * beach, and that flattening happens after the mountains are added, so a massif sitting on the
   * fringe is simply erased. Inland by a good margin or not at all.
   */
  INLAND: 30,
  /** How coarsely the world is searched for somewhere to stand a mountain, in tiles. */
  GRID: 22,
  /** How much of a bowl's reach is the floor the village stands on. */
  BOWL_FLOOR: 0.42,
  /** And how sharply the wall comes up off that floor, as a share of what is left. */
  BOWL_WALL: 0.2,
} as const;

/** One mountain: where it stands, how far it reaches, and how high it gets. */
export interface Massif {
  x: number;
  z: number;
  /** Tiles from the centre at which it has come back down to the ground. */
  radius: number;
  /** Terraces above the ground at the summit. */
  height: number;
  /**
   * Tiles at the middle where nothing is lifted at all, which turns the massif inside out.
   *
   * Nought for an ordinary mountain. Set, it becomes a ring of high country around a flat floor —
   * a village sits in the bowl with its ground untouched, the walls stand all round it, and the
   * roads it already had are the only ways in, because a road is never lifted. Done this way
   * rather than by dropping a mountain on top of a village, which does not bury it but does take
   * away the flat ground its houses need, so the village lays itself out somewhere else instead.
   */
  hollow: number;
}

/**
 * Where the world's mountains stand.
 *
 * Anywhere on land that is far enough from a village and from the other massifs. Deliberately not
 * chosen for being far from a road: the roads are everywhere — nowhere in this world is more than
 * twenty-two tiles from one — so waiting for a gap big enough to hold a mountain means never
 * placing any. Roads crossing a massif are the point rather than the problem, because a road is
 * settled before the mountains are added and so is never lifted: it stays a thread of walkable
 * ground at the bottom of the thing, which is a pass.
 */
export function planMassifs(
  seed: number,
  graph: RoadGraph,
  villages: ReadonlyArray<{ x: number; z: number }>,
  /** How much room a point has: how far from a road, and how far inside the coast. Null at sea. */
  ground: (x: number, z: number) => { fromRoad: number; fromCoast: number } | null,
  /** The polygons, when the world was grown that way. Mountain country is decided there. */
  mesh: WorldMesh | null = null,
): Massif[] {
  const rng = mulberry32(derive(seed, SALT.MOUNTAINS));

  // With a mesh, the country has already been told where its mountains are: whole regions of it
  // are mountain rather than open land. A massif goes in the middle of each, sized to the region
  // it fills, so the height agrees with the map instead of being sprinkled over it.
  if (mesh) {
    const ranges: Massif[] = [];
    const highlands = mesh.regions.filter((r: MeshRegion) => r.kind === FaceKind.Mountain);
    highlands.sort((a, b) => b.faces.length - a.faces.length);
    for (const region of highlands) {
      if (ranges.length >= MOUNTAIN.RANGES) break;
      if (villages.some((v) => Math.hypot(v.x - region.cx, v.z - region.cz) < MOUNTAIN.CLEAR_OF_VILLAGES)) continue;
      // a region of n hexes covers about n * size^2 * 2.6, so this is the radius of a circle of
      // that area: a massif that fills its own territory and does not spill into the next one
      const reach = Math.sqrt(region.faces.length) * mesh.size * 0.9;
      ranges.push({
        x: region.cx, z: region.cz,
        radius: Math.max(MOUNTAIN.NARROWEST, Math.min(MOUNTAIN.WIDEST, reach)),
        height: Math.round(MOUNTAIN.SHORTEST + rng() * (MOUNTAIN.TALLEST - MOUNTAIN.SHORTEST)),
        hollow: 0,
      });
    }
    // One village in the world sits inside the mountains rather than beside them: a ring of high
    // country round a flat floor, with the roads it already had as the only ways in or out. The
    // start village is never chosen — being walled in on your first morning is a cage, not a
    // discovery — and neither is one already standing in a range.
    const bowlRadius = MOUNTAIN.NARROWEST + rng() * (MOUNTAIN.WIDEST - MOUNTAIN.NARROWEST);
    /** A wall is only a wall if it goes all the way round: no bowl half of which is open sea. */
    const ringedByLand = (v: { x: number; z: number }): boolean => {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        if (!ground(v.x + Math.cos(a) * bowlRadius * 0.85, v.z + Math.sin(a) * bowlRadius * 0.85)) return false;
      }
      return true;
    };
    const bowlAt = villages
      .filter((v) => Math.hypot(v.x, v.z) > MOUNTAIN.CLEAR_OF_VILLAGES * 2)
      .filter((v) => !ranges.some((m) => Math.hypot(m.x - v.x, m.z - v.z) < m.radius + MOUNTAIN.CLEAR_OF_VILLAGES))
      .filter(ringedByLand)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    if (bowlAt) {
      ranges.push({
        x: bowlAt.x, z: bowlAt.z, radius: bowlRadius,
        hollow: bowlRadius * MOUNTAIN.BOWL_FLOOR,
        height: Math.round(MOUNTAIN.SHORTEST + rng() * (MOUNTAIN.TALLEST - MOUNTAIN.SHORTEST)),
      });
    }

    return ranges;
  }

  // Somewhere solid to stand each one. Room means two things and both matter: far enough from a
  // road that the massif is not all pass, and far enough inside the coast that it is not all
  // beach. The second is the one that bit — the ground within a couple of tiles of the shore is
  // levelled flat to make a coastline, so the spots furthest from a road are the very spots where
  // a mountain gets shaved back to sea level.
  const spots: Array<{ x: number; z: number; room: number }> = [];
  const reach = graph.radius;
  for (let z = -reach; z <= reach; z += MOUNTAIN.GRID) {
    for (let x = -reach; x <= reach; x += MOUNTAIN.GRID) {
      if (Math.hypot(x, z) > reach - MOUNTAIN.WIDEST) continue;
      const here = ground(x, z);
      if (!here) continue;
      if (here.fromCoast < MOUNTAIN.INLAND) continue;
      spots.push({ x, z, room: Math.min(here.fromRoad, here.fromCoast) });
    }
  }
  spots.sort((a, b) => b.room - a.room);

  const out: Massif[] = [];
  for (const spot of spots) {
    if (out.length >= MOUNTAIN.RANGES) break;
    if (villages.some((v) => Math.hypot(v.x - spot.x, v.z - spot.z) < MOUNTAIN.CLEAR_OF_VILLAGES)) continue;
    if (out.some((m) => Math.hypot(m.x - spot.x, m.z - spot.z) < MOUNTAIN.APART)) continue;
    out.push({
      x: spot.x,
      z: spot.z,
      radius: MOUNTAIN.NARROWEST + rng() * (MOUNTAIN.WIDEST - MOUNTAIN.NARROWEST),
      height: Math.round(MOUNTAIN.SHORTEST + rng() * (MOUNTAIN.TALLEST - MOUNTAIN.SHORTEST)),
      hollow: 0,
    });
  }
  return out;
}

/** Smoothstep, so a flank meets the ground without a crease along the bottom of it. */
function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * How many terraces the mountains add here.
 *
 * Two shapes multiplied. The first is the massif itself: flat on top, falling away over the last
 * `SHOULDER` of its reach, so the face is a wall rather than a slope. The second is the pass — the
 * road keeps a corridor through, and the wall only reaches full height a few tiles beyond it.
 *
 * `roadDist` is how far this point is from the middle of the nearest road, which the sampler has
 * already worked out. Nought inside the corridor means a road never has a mountain put on top of
 * it, so everywhere the roads reach stays reachable however high the country gets.
 */
export function upliftRawAt(x: number, z: number, massifs: readonly Massif[], roadDist: number): number {
  if (massifs.length === 0) return 0;
  const pass = smooth((roadDist - MOUNTAIN.PASS_HALF) / MOUNTAIN.PASS_FADE);
  if (pass <= 0) return 0;

  let most = 0;
  for (const m of massifs) {
    const away = Math.hypot(x - m.x, z - m.z);
    if (away >= m.radius) continue;
    let shelf: number;
    if (m.hollow <= 0) {
      // an ordinary mountain: 1 across the summit, falling to 0 over the outer SHOULDER
      shelf = smooth((m.radius - away) / (m.radius * MOUNTAIN.SHOULDER));
    } else {
      // a bowl: nothing at all on the floor, a wall coming up off its rim, then the same fall away
      if (away <= m.hollow) continue;
      const span = m.radius - m.hollow;
      const out = away - m.hollow;
      shelf = Math.min(
        smooth(out / Math.max(1, span * MOUNTAIN.BOWL_WALL)),
        smooth((span - out) / Math.max(1, span * MOUNTAIN.SHOULDER)),
      );
    }
    const lift = m.height * shelf;
    if (lift > most) most = lift;
  }
  return most * pass;
}

/**
 * The same, in whole terraces, which is what the ground is built out of.
 *
 * The unrounded figure is what the corners of a mountain tile are drawn from, so a face comes out
 * as one leaning surface rather than a hundred steps; the rounded one is what the tile *is*, and
 * so what anybody walking into it has to climb.
 */
export function upliftAt(x: number, z: number, massifs: readonly Massif[], roadDist: number): number {
  return Math.round(upliftRawAt(x, z, massifs, roadDist));
}
