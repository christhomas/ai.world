import { WORLD } from '../core/config';
import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { PropKind } from './biomes';
import type { IslandInfo } from './graph';
import type { Massif } from './mountains';
import { Simplex2D } from './noise';

/**
 * The villages in the clouds.
 *
 * An island is a place you sail to. This is the same idea taken up: a piece of country floating
 * over one of the world's islands, with a village on it, a spring at the top of it, and the water
 * from that spring going over the edge and falling the whole way down to the island underneath.
 * You cannot walk there and you cannot sail there. The only way up is an eagle, waiting at the
 * bottom of the fall, which is what makes it worth arriving at.
 *
 * Two decisions here are worth stating, because neither is the obvious one.
 *
 * It is *additional* geometry, and nothing here touches the ground. The tempting way to build a
 * sky island is to take the tiles of the island below and lift them, and that would destroy the
 * thing the idea is actually about — the island below has to be there, correct, and worth looking
 * down at from the rim. So none of this goes through the terrain sampler, the chunk generator or
 * the mesh, only reads them, and the world's generation fingerprint is untouched by all of it.
 *
 * And the *site* comes from the world's islands while the *outline* comes from noise. The site has
 * to be an island because the image is one island hanging over another; the outline cannot be the
 * island's own coastline shrunk, because a coastline at a quarter scale is no longer a coastline —
 * it is the handful of polygons it was cut from with their corners showing.
 */

export const SKY = {
  /**
   * How many sky islands a world gets at most.
   *
   * Two, not four. The whole value of the place is that getting there is an expedition, and a
   * world with one over every island is a world where the clouds are just more scenery.
   */
  MOST: 2,
  /**
   * How high the island's lowest terrace floats above the sea, in world units.
   *
   * This is the one number the whole look depends on. Much lower and it is a hill on stilts rather
   * than something in the sky; much higher and it leaves the picture — the camera is orthographic
   * and `zoom` units tall, and a thing `h` above the ground sits about `0.71h` up the screen, so
   * at 26 the island and the land under it are both in one frame at any zoom past about 40, which
   * is the shot the idea was for. The waterfall has to be seen from top to bottom or there is no
   * point drawing it.
   */
  FLOAT: 26,
  /** The sky island's reach as a share of the island's it floats over, and the bounds on that. */
  SHRINK: 0.26,
  SMALLEST: 16,
  LARGEST: 28,
  /**
   * How far off the middle of the island below the sky island hangs, as a share of that island's
   * reach. Small: past about a quarter the fall goes over the coast and into the sea, and the
   * water landing on the island below is the whole picture.
   */
  DRIFT: 0.16,
  /**
   * And where else to look when there is no land under the drifted spot, as shares of the island's
   * reach: back at the middle, then further out.
   *
   * A polygon world's "island" is a centre and a reach, and the reach can be most of a continent
   * with open water in the middle of it. Without somewhere else to try, eight worlds out of ten
   * grown that way had no village in the sky at all.
   */
  ELSEWHERE: [0, 0.3, 0.45],
  /**
   * Clear air that must be left between the highest ground under the site and the island's keel.
   *
   * A massif is up to fifty-two units tall, which is twice this island's height, so a mountain on
   * the island below would come straight through the village square. Sites without that clearance
   * are passed over rather than lifted, because raising one island to clear its own mountain puts
   * it out of the frame and out of the point.
   */
  HEADROOM: 10,
  /**
   * How deep the keel hangs below the rock band at the rim, in world units.
   *
   * With the band above it that is fifteen or so of island between the village square and the
   * bottom of the thing, which still leaves ten units of air under it at sea level. Deeper and the
   * point of the keel comes down into the trees of the island below.
   */
  KEEL: 9,
  /** Terraces from the rim up to the crown, and how much the noise is allowed to disagree. */
  CROWN: 3,
  ROUGH: 1.1,
  /** How coarse the ground's own roll is, and how coarse the bites out of the rim are. */
  GROUND_SCALE: 0.045,
  RIM_SCALE: 1.7,
  /** How much of the rim's reach the noise may take away. Past a half it stops reading as an island. */
  RIM_BITE: 0.28,
  /** The flat square in the middle, and the shelf of level ground the village stands on around it. */
  SQUARE: 4.5,
  PLATEAU: 5.5,
  /** The spring in the square, and the channel that carries it away, both as radii in tiles. */
  POOL: 2.4,
  CHANNEL: 1.1,
  /** How many houses the village runs to, and how far out from the square they stand. */
  HOUSES: 6,
  HOUSE_RING: 7.4,
  /** How far in from the rim the eagle's perch stands. Far enough to land on, near enough to see over. */
  PERCH_INSET: 3.5,
  /**
   * How far past the lip the falling water has got by the time it reaches the ground, in tiles.
   *
   * Water leaving a lip keeps the speed it had and only gains downward, so it lands out from the
   * cliff rather than against it. Kept here rather than with the drawing because it is what decides
   * which way the stream is sent — the fall has to come down on the island, not beside it.
   */
  PLUME: 3.2,
  /** How far from the foot of the fall the search for dry ground gives up, in tiles. */
  CRAG_HUNT: 20,
  /**
   * How near the foot of the fall the eagles will notice somebody, in tiles.
   *
   * Wide. Everywhere else in this game a thing you can talk to is a doorway or a stall and wants
   * you standing at it; this is a bird in the spray at the bottom of a waterfall, and the cost of
   * a player walking through the one place in the world that goes up without finding it is that
   * the whole place may as well not exist.
   */
  CALL: 7,
} as const;

/** Where a sky island floats, before anything is known about its shape. */
export interface SkySite {
  /** Manifest anchor id. */
  id: string;
  /** The island it hangs over, by that island's own id. */
  over: string;
  x: number;
  z: number;
  radius: number;
  /** World-unit height of the island's lowest terrace. */
  y: number;
}

/** One thing standing on a sky island: a house, the loft, a tree, the crag the bird lands on. */
export interface SkyProp {
  kind: PropKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  scale: number;
}

/** Where the water goes over the edge, and which way it is thrown as it falls. */
export interface SkyFall {
  /** Tile centre of the lip, and the surface height of the water there. */
  x: number;
  z: number;
  lipY: number;
  /** Unit direction the stream is running when it runs out of island. */
  dx: number;
  dz: number;
  /** Half-width of the falling column, in tiles. */
  width: number;
}

/**
 * A sky island, as plain data: a small tile grid at cloud height with a village on it.
 *
 * Shaped like a chunk on purpose — heights, water surfaces and blocking in flat arrays indexed the
 * same way — so the thing that walks on it and the thing that draws it read it the way they read
 * the ground, and neither needs a second idea of what a tile is.
 */
export interface SkyIsland {
  site: SkySite;
  name: string;
  /** Tile coordinates of grid cell (0,0), and the grid's size. */
  x0: number;
  z0: number;
  w: number;
  h: number;
  /** Top surface of each tile in world units; NaN where there is no island. */
  top: Float32Array;
  /** Water surface where a tile is spring or stream, 0 elsewhere. */
  water: Float32Array;
  /** 1 where something stands that nobody may walk through. */
  blocked: Uint8Array;
  props: SkyProp[];
  /** Where the eagle sets you down, and takes you off from, up on the island. */
  perch: { x: number; z: number };
  /**
   * And where it waits for you on the ground: at the foot of the fall, on the island below.
   *
   * The one place in the world you can ask to be taken up, and put there because it is the one
   * place nobody has to be told about. A column of water coming out of the sky can be seen from
   * halfway across the island; you walk to where it lands, and the birds are standing in the
   * spray. An invisible spot on a beach with a hint in the corner of the screen would have been
   * the same mechanism and none of the discovery.
   */
  crag: { x: number; z: number };
  /** Where the loft stands, and so where its keeper is spoken to. */
  loft: { x: number; z: number };
  fall: SkyFall;
}

const NAMES = [
  'Highfall', 'Cloudmere', 'Rainhead', 'Overhold', 'Sunder Aerie',
  'Mistgarth', 'Skyfurrow', 'Thunderstep',
];

/**
 * Which of the world's islands has another one floating over it.
 *
 * Sites are taken from the islands themselves — a sky island is one island hanging over another,
 * and hanging one over open sea would put a village where nothing could ever be seen underneath
 * it. Islands with a mountain under the site are passed over: see `HEADROOM`.
 *
 * The order is the island list's own, so the same seed picks the same islands on every machine.
 */
export function planSkyIslands(
  seed: number,
  islands: readonly IslandInfo[],
  massifs: readonly Massif[],
  /**
   * Whether there is dry ground at a point on the world below. Optional only so that the shape of
   * a sky island can be tested without growing a world first: in the game it is always passed, and
   * without it a site can end up hanging over open sea, where the fall lands in the water and the
   * eagle that would carry you up is standing on it.
   */
  overLand: (x: number, z: number) => boolean = () => true,
): SkySite[] {
  const rng = mulberry32(derive(seed, SALT.SKY));
  const out: SkySite[] = [];
  for (const island of islands) {
    if (out.length >= SKY.MOST) break;
    const radius = Math.max(SKY.SMALLEST, Math.min(SKY.LARGEST, Math.round(island.radius * SKY.SHRINK)));
    // a massif whose skirt reaches under the island would come up through the village square
    const inTheWay = massifs.some((m) =>
      Math.hypot(m.x - island.x, m.z - island.z) < m.radius + radius
      && m.height * WORLD.STEP > SKY.FLOAT - SKY.HEADROOM);
    if (inTheWay) continue;
    // Nudged off the island's exact middle, because dead centre is the one arrangement that reads
    // as a lid rather than as a thing floating over another thing: with the sky island offset you
    // can see coast on one side of it and open water on the other, and the shadow it throws lands
    // somewhere you can walk to. Never far enough to hang the waterfall out over the sea.
    //
    // The dice go first and the ground below gets a veto. An "island" is only a centre and a reach
    // — in a polygon world the reach can be most of a continent, and the middle of it can be open
    // water — so a site is kept only where there is genuinely land underneath it. Nowhere on this
    // island qualifies, and it simply does not get one; a village in the sky over nothing has no
    // waterfall worth drawing and nowhere for the bird to wait.
    const first = rng() * Math.PI * 2;
    let site: SkySite | null = null;
    for (const share of [SKY.DRIFT, ...SKY.ELSEWHERE]) {
      const away = island.radius * share;
      for (let k = 0; k < 8 && !site; k++) {
        const angle = first + (k / 8) * Math.PI * 2;
        const x = Math.round(island.x + Math.cos(angle) * away);
        const z = Math.round(island.z + Math.sin(angle) * away);
        if (overLand(x, z)) site = { id: `sky:${x},${z}`, over: island.id, x, z, radius, y: SKY.FLOAT };
      }
      if (site) break;
    }
    if (site) out.push(site);
  }
  return out;
}

/**
 * Cut the island out of the sky and put a village on it.
 *
 * Everything here comes off the anchor's own seed, so a sky island keeps its shape for the life of
 * the world however the mainland is regenerated around it, exactly as an island anchor does.
 *
 * `landBelow` is the one thing it asks of the world underneath, and it asks it for one reason: the
 * whole idea is water falling onto the island below, so the edge the stream goes over is chosen to
 * be an edge with that island under it. Left out, the direction is simply whatever the dice say,
 * and about two falls in five come down in the shallows beside the island instead of onto it.
 */
export function buildSkyIsland(
  site: SkySite,
  anchorSeed: number,
  landBelow?: (x: number, z: number) => boolean,
): SkyIsland {
  const shape = new Simplex2D(derive(anchorSeed, SALT.SKY));
  const rng = mulberry32(derive(anchorSeed, SALT.SKY ^ 0xa17));
  const R = site.radius;
  const w = Math.ceil(R * 2) + 3;
  const h = w;
  const x0 = Math.round(site.x - R) - 1;
  const z0 = Math.round(site.z - R) - 1;
  const n = w * h;
  const top = new Float32Array(n).fill(Number.NaN);
  const water = new Float32Array(n);
  const blocked = new Uint8Array(n);

  /** How far the island reaches in a given direction: the rim, bitten into by its own noise. */
  const reach = (angle: number): number => {
    const bite = shape.fbm(Math.cos(angle) * SKY.RIM_SCALE, Math.sin(angle) * SKY.RIM_SCALE, 3);
    return R * (1 - SKY.RIM_BITE * (0.5 + 0.5 * bite));
  };

  for (let gz = 0; gz < h; gz++) {
    for (let gx = 0; gx < w; gx++) {
      const px = x0 + gx + 0.5, pz = z0 + gz + 0.5;
      const dx = px - site.x, dz = pz - site.z;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      if (d > reach(Math.atan2(dz, dx))) continue;
      // the crown in the middle falling away to the rim, roughened so it is not a wedding cake
      const t = Math.min(1, d / Math.max(1, reach(Math.atan2(dz, dx))));
      const roll = shape.fbm(px * SKY.GROUND_SCALE, pz * SKY.GROUND_SCALE, 2);
      let rise = Math.round((1 - t) * SKY.CROWN + roll * SKY.ROUGH);
      // the village needs somewhere level to stand, and a square on a slope is a hillside
      if (d < SKY.SQUARE + SKY.PLATEAU) rise = SKY.CROWN;
      top[gz * w + gx] = site.y + Math.max(0, Math.min(SKY.CROWN + 1, rise)) * WORLD.STEP;
    }
  }

  const idx = (tx: number, tz: number): number => {
    const gx = Math.floor(tx) - x0, gz = Math.floor(tz) - z0;
    return gx < 0 || gz < 0 || gx >= w || gz >= h ? -1 : gz * w + gx;
  };

  // The spring, and the cut it has made for itself on its way to the edge. Water is a terrace
  // below the ground it runs through, exactly as a river is, so it reads as a channel rather than
  // as a puddle sitting on the grass.
  const sink = (i: number): void => {
    // once only: the channel is walked in half-tile steps and crosses its own tiles several
    // times, and a bed cut afresh on every pass digs a trench right through the island
    if (i < 0 || Number.isNaN(top[i]) || water[i] > 0) return;
    const bed = top[i] - WORLD.STEP;
    top[i] = bed;
    water[i] = bed + WORLD.WATER_Y;
  };
  for (let gz = 0; gz < h; gz++) {
    for (let gx = 0; gx < w; gx++) {
      const px = x0 + gx + 0.5, pz = z0 + gz + 0.5;
      if (Math.hypot(px - site.x, pz - site.z) <= SKY.POOL) sink(gz * w + gx);
    }
  }

  // Which way the stream leaves. The dice pick a direction and then the ground below gets a say:
  // eight tries round the compass, keeping the first that has the island underneath it. Rolled
  // first and tested after, so the same seed starts from the same place whether or not anybody
  // handed us a world to look down at.
  let phi = rng() * Math.PI * 2;
  if (landBelow) {
    for (let k = 0; k < 8; k++) {
      const a = phi + (k / 8) * Math.PI * 2;
      // the plume is thrown clear of the lip as it drops, so it arrives a few tiles further out
      const out = reach(a) + SKY.PLUME;
      if (landBelow(site.x + Math.cos(a) * out, site.z + Math.sin(a) * out)) { phi = a; break; }
    }
  }
  const fx = Math.cos(phi), fz = Math.sin(phi);
  let lip = { x: site.x, z: site.z, i: idx(site.x, site.z) };
  for (let step = SKY.POOL; step < R + 2; step += 0.5) {
    const px = site.x + fx * step, pz = site.z + fz * step;
    const centre = idx(px, pz);
    if (centre < 0 || Number.isNaN(top[centre])) break;
    for (let o = -SKY.CHANNEL; o <= SKY.CHANNEL; o += 0.5) {
      sink(idx(px - fz * o, pz + fx * o));
    }
    lip = { x: Math.floor(px) + 0.5, z: Math.floor(pz) + 0.5, i: centre };
  }

  /** The nearest tile to (x,z) somebody could actually stand on, searched outward in rings. */
  const footing = (x: number, z: number): { x: number; z: number } => {
    for (let r = 0; r < R; r += 1) {
      for (let a = 0; a < 16; a++) {
        const angle = (a / 16) * Math.PI * 2;
        const px = Math.floor(x + Math.cos(angle) * r) + 0.5;
        const pz = Math.floor(z + Math.sin(angle) * r) + 0.5;
        const i = idx(px, pz);
        if (i >= 0 && !Number.isNaN(top[i]) && water[i] === 0 && blocked[i] === 0) return { x: px, z: pz };
      }
    }
    return { x: site.x, z: site.z };
  };

  const props: SkyProp[] = [];
  const stand = (kind: PropKind, at: { x: number; z: number }, rot: number, scale = 1): void => {
    const i = idx(at.x, at.z);
    if (i < 0 || Number.isNaN(top[i]) || water[i] > 0 || blocked[i] === 1) return;
    props.push({ kind, x: at.x, z: at.z, y: top[i], rot, scale });
    blocked[i] = 1;
  };

  // The village: houses round the square, facing in, and the loft on the far side of the water
  // from the perch so that arriving and doing business are two different walks.
  const start = rng() * Math.PI * 2;
  for (let k = 0; k < SKY.HOUSES; k++) {
    const a = start + (k / SKY.HOUSES) * Math.PI * 2;
    stand(
      PropKind.HouseMountain,
      footing(site.x + Math.cos(a) * SKY.HOUSE_RING, site.z + Math.sin(a) * SKY.HOUSE_RING),
      Math.round((a + Math.PI) / (Math.PI / 2)) * (Math.PI / 2),
    );
  }
  const loftAt = footing(site.x - fx * (SKY.SQUARE + 1.5), site.z - fz * (SKY.SQUARE + 1.5));
  stand(PropKind.Tower, loftAt, phi);
  stand(PropKind.Well, footing(site.x + SKY.POOL + 1.5, site.z), 0);

  // The perch: out at the rim, looking back over the drop, so the first thing you see when the
  // bird sets you down is the whole island below you. The crag itself goes on a neighbouring tile
  // and the hero lands beside it, because a boulder is solid and standing inside one is a way to
  // arrive somewhere unable to move.
  const perchAngle = phi + Math.PI;
  const perchAt = footing(
    site.x + Math.cos(perchAngle) * Math.max(2, reach(perchAngle) - SKY.PERCH_INSET),
    site.z + Math.sin(perchAngle) * Math.max(2, reach(perchAngle) - SKY.PERCH_INSET),
  );
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const beside = { x: perchAt.x + dx, z: perchAt.z + dz };
    const i = idx(beside.x, beside.z);
    if (i < 0 || Number.isNaN(top[i]) || water[i] > 0 || blocked[i] === 1) continue;
    stand(PropKind.Boulder, beside, rng() * Math.PI * 2, 1.5);
    break;
  }

  // a few trees, out where the village is not
  for (let k = 0; k < 14; k++) {
    const a = rng() * Math.PI * 2;
    const d = SKY.SQUARE + SKY.PLATEAU + 1 + rng() * Math.max(1, R - SKY.SQUARE - SKY.PLATEAU - 2);
    const spot = footing(site.x + Math.cos(a) * d, site.z + Math.sin(a) * d);
    if (Math.hypot(spot.x - site.x, spot.z - site.z) < SKY.SQUARE + SKY.PLATEAU) continue;
    stand(rng() < 0.5 ? PropKind.Fir : PropKind.Pine, spot, rng() * Math.PI * 2, 0.8 + rng() * 0.5);
  }

  // Where the fall arrives, and so where the birds are. Shuffled onto ground somebody can stand
  // on if the plume happens to come down in the shallows — the eagle is no use to anybody
  // treading water.
  const foot = { x: lip.x + fx * SKY.PLUME, z: lip.z + fz * SKY.PLUME };
  let crag = foot;
  if (landBelow && !landBelow(crag.x, crag.z)) {
    for (let r = 2; r <= SKY.CRAG_HUNT && !landBelow(crag.x, crag.z); r += 2) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = foot.x + Math.cos(a) * r;
        const z = foot.z + Math.sin(a) * r;
        if (landBelow(x, z)) { crag = { x, z }; break; }
      }
    }
    // Still nothing: walk back along the plume towards the middle of the island. The ground under
    // the sky island's own centre is dry by construction — the planner would not have put it here
    // otherwise — so this always arrives somewhere, and a bird standing under the island rather
    // than in the spray is a worse place to find but never an impossible one.
    for (let t = 0.1; t <= 1.001 && !landBelow(crag.x, crag.z); t += 0.1) {
      crag = {
        x: foot.x + (site.x - foot.x) * t,
        z: foot.z + (site.z - foot.z) * t,
      };
    }
  }

  const name = NAMES[Math.floor(rng() * NAMES.length)];
  return {
    site, name, x0, z0, w, h, top, water, blocked, props,
    perch: perchAt,
    loft: loftAt,
    crag,
    fall: {
      x: lip.x, z: lip.z,
      lipY: water[lip.i] > 0 ? water[lip.i] : site.y + WORLD.WATER_Y,
      dx: fx, dz: fz,
      width: SKY.CHANNEL + 0.4,
    },
  };
}

/** Grid index of a world position, or -1 when it is off the island. */
export function skyIndex(isle: SkyIsland, x: number, z: number): number {
  const gx = Math.floor(x) - isle.x0, gz = Math.floor(z) - isle.z0;
  return gx < 0 || gz < 0 || gx >= isle.w || gz >= isle.h ? -1 : gz * isle.w + gx;
}

/** Whether a point is on the island at all, water and blocked tiles included. */
export function onSkyIsland(isle: SkyIsland, x: number, z: number): boolean {
  const i = skyIndex(isle, x, z);
  return i >= 0 && !Number.isNaN(isle.top[i]);
}
