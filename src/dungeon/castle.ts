import { mulberry32, type Rng } from '../core/rng';
import { beside, chestTiles, settleChests } from './castlefit';
import { centre, dress, roleFor, shrink, type Space } from './castlerooms';
import type { SpawnSpot } from '../entities/spawns';
import { BASE_LEVEL, DTile, reachable, type Chest, type Door, type DungeonMap, type Room } from './map';

/**
 * A castle, floor by floor.
 *
 * The three older places underground are one algorithm: scatter rooms on a grid, join each to the
 * nearest one already joined, and you get a warren. That is what a hole in the ground is, and it
 * is exactly wrong for a keep. A building is not a set of rooms that were connected afterwards —
 * it is a rectangle that was *divided*, so its rooms share walls, its corridors run the length of
 * a wing, and standing in one you can tell which way the outside is.
 *
 * So the plan here is a binary split of one big rectangle, and the two decisions that make it read
 * as architecture rather than as a nicer warren are both about the corridors:
 *
 *  - every split *reserves* a band of floor along the line it cuts on, rather than leaving a wall
 *    to be punched later. That band is a gallery: it runs the full width of whatever it divides,
 *    which is why a corridor in here goes somewhere instead of ending at a room;
 *  - the split axis strictly alternates, across then down then across. That is not a stylistic
 *    choice, it is what makes the plan connected with no joining pass at all: a child's band spans
 *    its own rectangle end to end in the direction its parent's band runs, so the two always touch.
 *    Get this wrong — pick the longer side each time, say — and half the galleries are parallel to
 *    their parent, never meet it, and the castle needs the same nearest-first joining pass that
 *    makes a warren look like a warren.
 *
 * Round the outside of the divided block runs a curtain gallery, and off its corners hang four
 * towers and a gatehouse, which is the silhouette that says "castle" on a map at a glance.
 *
 * Everything a player has to *solve* is in `puzzles` at the bottom, and every one of them is a
 * fact about the floor rather than a new verb: this is walked, opened and drawn by exactly the
 * same code as a vault, and the code does not know a castle from a barrow.
 */

export const CASTLE = {
  /**
   * Tiles a side. A vault is 56 and a castle has to be visibly more building than that: at 76 the
   * divided block is 54 square, which is four rooms across each way with galleries between them
   * and still leaves room for towers standing proud of the wall. Much under 70 and the third
   * split has nothing left to cut; much over 90 and a floor is more walking than castle, and there
   * are four of them.
   */
  SIZE: 76,
  /**
   * How many floors you climb. Three is a vault, and this has to be more than a vault; five would
   * be a floor with nothing new on it, because `dungeonMonsters` in `entities/spawns.ts` runs out
   * of bands at three and anything deeper holds whatever the bottom holds. Four is the last floor
   * that is still a new fight.
   */
  FLOORS: 4,
  /** Rock kept between the outermost thing built and the edge of the map. */
  MARGIN: 3,
  /** A corner tower, tiles a side, centred on the corner of the keep so it stands proud of it. */
  TOWER: 9,
  /** The gatehouse straddles the middle of the south wall and is wider than it is deep. */
  GATE_WIDE: 11,
  /** The curtain gallery just inside the outer wall: two tiles, so it reads as a walk and not a gap. */
  RING: 2,
  /**
   * The smallest a piece of the plan may be before it stops dividing, in tiles including its walls.
   * At ten a leaf is an eight-by-eight chamber at worst, which holds a table, a fight and a torch
   * on each wall. At eight the rooms are cupboards; at twelve the third division never happens on
   * the narrow wing and half the floor comes out as four enormous rooms — thirteen rooms to a
   * floor rather than twenty, and a largest chamber of six hundred tiles rather than three hundred
   * and fifty.
   */
  MIN_LEAF: 10,
  /** How many times the block is divided. Four gives fifteen chambers and a great hall off them. */
  MAX_DEPTH: 4,
  /**
   * How wide the gallery reserved at each depth is. The first two are three tiles — the state
   * corridors, wide enough for the camera to see down — then two, then one, which is the servants'
   * passage between two chambers. Making them all wide turns the floor into a plaza with rooms
   * round the edge; making them all narrow loses the difference between a hall and a passage.
   */
  GALLERY: [3, 3, 2, 1],
  /**
   * Which division is left undone, giving the great hall. At three the hall keeps one chamber's
   * width and the height of the whole wing, so it comes out long — nine or so tiles by thirty —
   * which is the shape a hall is: a board down the middle and a dais at the far end. At two it is
   * a quarter of the floor and swallows the plan.
   */
  HALL_DEPTH: 3,
  /**
   * How far off centre a split may fall, as a share of what it is dividing.
   *
   * Zero is a barracks: every room the same size, laid out like a spreadsheet. A quarter was tried
   * and is too much — a first cut that far off centre leaves the narrow wing too thin for the
   * third division to happen at all, so half the castle comes out as four rooms the size of a
   * tithe barn while the other half is properly divided. Measured over thirty-two floors that is
   * seventeen rooms to a floor instead of twenty, and the largest chamber goes from three hundred
   * and fifty tiles of floor to five hundred and fifty. An eighth keeps the wings comparable and
   * still stops any two floors reading as the same plan.
   */
  SPLIT_SPREAD: 0.13,
  /**
   * How high the minstrels' gallery runs above its hall, in terraces.
   *
   * Three, and the number is load-bearing. The hero's `climb` is 0.56 against a `WORLD.STEP` of
   * 0.5, so one terrace is a step and two is a wall — but `ROPED_CLIMB` is 1.06, so somebody
   * carrying a climbing rope steps up two. Three is a wall to everybody, which is the only reason
   * the stair in the corner is the answer rather than a suggestion.
   */
  GALLERY_RISE: 3,
  /** The dais at the head of a hall: one terrace, so you walk up onto it without thinking about it. */
  DAIS_RISE: 1,
  /** How wide the gallery walk is. One tile is a ledge; two is somewhere to stand and look down. */
  GALLERY_WALK: 2,
  /**
   * How far up the hero can step, in terraces, and therefore what these tests are allowed to
   * assume. One: `climb` is 0.56 in `properties/people.json` against a `WORLD.STEP` of 0.5. If
   * that number ever changes, `GALLERY_RISE` has to be looked at again, because the gallery is
   * only a puzzle while it is out of reach.
   */
  HERO_CLIMB: 1,
} as const;

/** Where the keep's own wall stands, and how big it is: everything else is measured off these. */
const OUT = (CASTLE.TOWER - 1) / 2;                 // how far a corner tower reaches past the corner
const KEEP = CASTLE.MARGIN + OUT;                   // the keep's outer wall, in tiles from the edge
const KEEP_SIDE = CASTLE.SIZE - 2 * KEEP;
/** The divided block: inside the outer wall, the curtain gallery and its inner wall. */
const BLOCK = KEEP + 1 + CASTLE.RING + 1;
const BLOCK_SIDE = KEEP_SIDE - 2 * (1 + CASTLE.RING + 1);

/** Everything being built, passed down the recursion so the plan is one object and not six. */
interface Plan {
  size: number;
  tiles: Uint8Array;
  levels: Uint8Array;
  spaces: Space[];
  rng: Rng;
  floor: number;
}

export function generateCastle(seed: number, floor = 1): DungeonMap {
  // A different stride through the seed from the one vaults use, so a shrine and a castle that
  // happen to share an anchor seed are not the same rooms with different furniture in them.
  const rng = mulberry32(seed + floor * 6151);
  const size = CASTLE.SIZE;
  const plan: Plan = { size, tiles: new Uint8Array(size * size), levels: new Uint8Array(size * size), spaces: [], rng, floor };

  curtain(plan);
  towers(plan);
  gatehouse(plan);
  divide(plan, { x: BLOCK, z: BLOCK, w: BLOCK_SIDE, h: BLOCK_SIDE }, 0, null, true);
  openGalleriesOntoTheRing(plan);

  const map = puzzles(plan, floor);
  const dressing = dress(plan);
  map.torches = dressing.torches;
  map.furniture = dressing.furniture;
  // Nothing waits where you arrive, and nothing shares the sealed room with its lord. Both are
  // measured rather than filtered by tile, because a room's monsters are put at its middle and
  // the boss stands a tile off that: an exact match would have caught neither.
  const clear = (spot: SpawnSpot) =>
    Math.hypot(spot[0] - map.entrance[0], spot[1] - map.entrance[1]) > CLEAR_OF
    && (!map.boss || Math.hypot(spot[0] - map.boss[0], spot[1] - map.boss[1]) > CLEAR_OF);
  map.monsterSpots = dressing.monsterSpots.filter(clear);
  return map;
}

/**
 * How much room round the arrival tile and round the boss is left empty, in tiles.
 *
 * Four, which is a little over the width of the stair landing. Less and a floor can open with a
 * pack already inside your reach, which is a fight you did not choose; more and the first two
 * rooms of every floor are empty and the castle feels abandoned rather than held.
 */
const CLEAR_OF = 4;

// --- the shell -------------------------------------------------------------------------------

/** The curtain gallery: a walk two tiles wide running right round inside the keep's outer wall. */
function curtain(plan: Plan): void {
  const outer: Room = { x: KEEP, z: KEEP, w: KEEP_SIDE, h: KEEP_SIDE };
  const inner = shrink(outer, 1 + CASTLE.RING);
  for (let z = outer.z + 1; z < outer.z + outer.h - 1; z++) {
    for (let x = outer.x + 1; x < outer.x + outer.w - 1; x++) {
      const withinInner = x >= inner.x && z >= inner.z && x < inner.x + inner.w && z < inner.z + inner.h;
      if (!withinInner) plan.tiles[z * plan.size + x] = DTile.Floor;
    }
  }
  plan.spaces.push({ rect: outer, sort: 'ring' });
}

/**
 * Four corner towers, each centred on a corner of the keep.
 *
 * Centred rather than hung outside it, because a tower that only touches the wall needs a passage
 * cut to it and a passage cut to it can fail; centred, the tower's own floor swallows the corner
 * of the curtain gallery and is therefore joined to the castle by construction. It still stands
 * four tiles proud of the wall on two sides, which is all the silhouette needs.
 */
function towers(plan: Plan): void {
  const far = KEEP + KEEP_SIDE - 1;
  for (const [cx, cz] of [[KEEP, KEEP], [far, KEEP], [KEEP, far], [far, far]] as const) {
    const rect: Room = { x: cx - OUT, z: cz - OUT, w: CASTLE.TOWER, h: CASTLE.TOWER };
    carve(plan, shrink(rect, 1));
    plan.spaces.push({ rect, sort: 'tower' });
  }
}

/** The gate: a barbican straddling the middle of the south wall, where the way out is. */
function gatehouse(plan: Plan): void {
  const cx = KEEP + Math.floor(KEEP_SIDE / 2);
  const cz = KEEP + KEEP_SIDE - 1;
  const rect: Room = {
    x: cx - Math.floor(CASTLE.GATE_WIDE / 2), z: cz - OUT,
    w: CASTLE.GATE_WIDE, h: CASTLE.TOWER,
  };
  carve(plan, shrink(rect, 1));
  plan.spaces.push({ rect, sort: 'gatehouse' });
}

/**
 * Cut the inner wall wherever a gallery runs up against it, so the galleries open onto the
 * curtain walk instead of stopping one tile short of it.
 *
 * Without this the divided block is a sealed box inside a ring: everything within it is connected
 * to everything else within it, the ring is connected to the towers and the gate, and the two
 * halves never meet. It is worth being explicit about because the failure would be invisible from
 * the plan — the picture is a castle either way, and you simply could not walk out of the middle
 * of it.
 */
function openGalleriesOntoTheRing(plan: Plan): void {
  const lo = BLOCK - 1, hi = BLOCK + BLOCK_SIDE;
  for (let n = BLOCK; n < BLOCK + BLOCK_SIDE; n++) {
    for (const [wx, wz, ix, iz] of [
      [n, lo, n, BLOCK], [n, hi, n, BLOCK + BLOCK_SIDE - 1],
      [lo, n, BLOCK, n], [hi, n, BLOCK + BLOCK_SIDE - 1, n],
    ] as const) {
      if (plan.tiles[iz * plan.size + ix] === DTile.Floor) plan.tiles[wz * plan.size + wx] = DTile.Floor;
    }
  }
}

// --- dividing the block ----------------------------------------------------------------------

/**
 * Divide a rectangle, reserving a gallery on the line it is cut along, and recurse.
 *
 * `gate` is a tile of the parent's gallery lying against this rectangle: a leaf punches the one
 * wall tile between that and its own floor and is thereby joined. An internal piece needs no gate,
 * because its own gallery touches its parent's — see the note at the top of the file for why that
 * is true and not merely usually true.
 *
 * `hall` marks the branch the great hall is on; it is carried down one child at a time and
 * whichever piece is holding it at `HALL_DEPTH` stops dividing and becomes the hall.
 */
function divide(plan: Plan, node: Room, depth: number, gate: [number, number] | null, hall: boolean): void {
  const band = CASTLE.GALLERY[Math.min(depth, CASTLE.GALLERY.length - 1)];
  const acrossX = depth % 2 === 0;
  const span = acrossX ? node.w : node.h;
  const room = depth >= CASTLE.MAX_DEPTH
    || (hall && depth >= CASTLE.HALL_DEPTH)
    || span < CASTLE.MIN_LEAF * 2 + band;
  if (room) {
    leaf(plan, node, gate, hall);
    return;
  }

  const cut = splitAt(plan.rng, span, band);
  const at = (acrossX ? node.x : node.z) + cut;
  const strip: Room = acrossX
    ? { x: at, z: node.z, w: band, h: node.h }
    : { x: node.x, z: at, w: node.w, h: band };
  carve(plan, strip);
  plan.spaces.push({ rect: strip, sort: 'gallery' });

  const near: Room = acrossX
    ? { x: node.x, z: node.z, w: cut, h: node.h }
    : { x: node.x, z: node.z, w: node.w, h: cut };
  const far: Room = acrossX
    ? { x: at + band, z: node.z, w: node.w - cut - band, h: node.h }
    : { x: node.x, z: at + band, w: node.w, h: node.h - cut - band };

  // a gate for each child, on the strip's own edge, level with the middle of the child it serves
  const [nx, nz] = centre(near), [fx, fz] = centre(far);
  const nearGate: [number, number] = acrossX ? [at, nz] : [nx, at];
  const farGate: [number, number] = acrossX ? [at + band - 1, fz] : [fx, at + band - 1];

  const hallGoesNear = hall && plan.rng() < 0.5;
  divide(plan, near, depth + 1, nearGate, hallGoesNear);
  divide(plan, far, depth + 1, farGate, hall && !hallGoesNear);
}

/** Where along a span to cut: near the middle, nudged, and never closer to an end than a room. */
function splitAt(rng: Rng, span: number, band: number): number {
  const middle = (span - band) / 2;
  const nudged = middle + (rng() - 0.5) * span * CASTLE.SPLIT_SPREAD;
  const most = span - band - CASTLE.MIN_LEAF;
  return Math.round(Math.max(CASTLE.MIN_LEAF, Math.min(most, nudged)));
}

/** A chamber: its floor is the rectangle less its walls, and one wall tile is its door. */
function leaf(plan: Plan, node: Room, gate: [number, number] | null, hall: boolean): void {
  carve(plan, shrink(node, 1));
  if (gate) {
    // the wall tile between the gallery and this floor is on the line joining them
    const [gx, gz] = gate;
    const dx = gx < node.x ? 1 : gx >= node.x + node.w ? -1 : 0;
    const dz = gz < node.z ? 1 : gz >= node.z + node.h ? -1 : 0;
    plan.tiles[(gz + dz) * plan.size + (gx + dx)] = DTile.Floor;
  }
  plan.spaces.push({ rect: node, sort: hall ? 'hall' : 'chamber', role: hall ? undefined : roleFor(plan.rng) });
}

function carve(plan: Plan, r: Room): void {
  for (let z = r.z; z < r.z + r.h; z++) {
    for (let x = r.x; x < r.x + r.w; x++) plan.tiles[z * plan.size + x] = DTile.Floor;
  }
}

// --- what there is to solve ------------------------------------------------------------------

/**
 * Turn a plan into a floor with things to do on it.
 *
 * Three puzzles, and the constraint every one of them was designed under is that there is no hint
 * system in this game and there is not going to be one, so the room has to say what it wants by
 * being looked at. That rules out anything remembered — a lever pulled two rooms ago, a sequence
 * of plates — and leaves the two things a player can always see: where the floor is, and how high
 * it is. Both of those the engine already enforces, and neither needs a verb that does not exist.
 *
 *  1. **The barred stair.** The way up is in a chamber whose every doorway is a portcullis, and
 *     the warden's key is in a chest somewhere you can reach without passing one. You know because
 *     the door is drawn across the gap, the map paints it red, and pressing Enter at it says the
 *     way is barred. This is the vault's own lock-and-key, moved off the treasure and onto the
 *     stair, which is what makes four floors a climb rather than four rooms.
 *
 *  2. **The drowned undercroft.** A chamber flooded to the sills with the prize on an island in
 *     the middle, crossed on a line of stepping stones with false ones scattered either side. You
 *     know because you can see the water and the stones from directly above, which is where this
 *     camera is. The false stones are never next to anything you can stand on, so no route but the
 *     laid one exists — a maze made of what you cannot step on rather than of walls.
 *
 *  3. **The minstrels' gallery.** A walk along one wall of the great hall three terraces up, with
 *     a single stair at one end of it. Three terraces is past what the hero can climb even with a
 *     rope, so the gallery is visibly there, visibly has something on it, and cannot be got at
 *     except by finding the stair. You know because you can see it above you and walk under it.
 *
 * Two and three take turns holding the warden's key, so the floor you are on decides which of them
 * you have to finish; the other holds gold. Both are always built, and both are always solvable —
 * the tests walk them from the entrance with the real hero's own climb.
 */
function puzzles(plan: Plan, floor: number): DungeonMap {
  const { size } = plan;
  const chambers = plan.spaces.filter((s) => s.sort === 'chamber');
  const hallSpace = plan.spaces.find((s) => s.sort === 'hall') ?? chambers[0];

  const entrance = arrivalOf(plan, floor);
  plan.tiles[entrance[1] * size + entrance[0]] = DTile.Stairs;

  const away = (s: Space) => Math.hypot(centre(s.rect)[0] - entrance[0], centre(s.rect)[1] - entrance[1]);
  const sealed = [...chambers].sort((a, b) => away(b) - away(a))[0] ?? hallSpace;
  const flooded = [...chambers].filter((s) => s !== sealed).sort((a, b) => away(b) - away(a))[0] ?? hallSpace;

  const last = floor >= CASTLE.FLOORS;
  if (last) sealed.sort = 'throne';
  if (flooded !== hallSpace) flooded.sort = 'undercroft';

  const island = drown(plan, flooded.rect);
  const balcony = minstrels(plan, hallSpace.rect);

  // The sealed chamber holds the way up, or on the last floor the lord of the place and the prize.
  // At the top the room is a throne room and the prize stands on the dais with its owner in front
  // of it, because a chest you have to walk round something to reach is a fight and a chest in the
  // middle of the floor is a formality.
  const [sx, sz] = centre(sealed.rect);
  const dais = daisOf(sealed.rect);
  const [dx, dz] = centre(dais);
  const doors: Door[] = doorwaysOf(plan, sealed.rect);
  for (const d of doors) plan.tiles[d.z * size + d.x] = DTile.Door;
  const descent: [number, number] | null = last ? null : [sx + 1, sz];
  if (descent) plan.tiles[descent[1] * size + descent[0]] = DTile.Descent;
  let boss: [number, number] | null = null;
  const chests: Chest[] = [last ? { x: dx, z: dz, big: true } : { x: sx, z: sz, big: true }];
  if (last) {
    raise(plan, dais, BASE_LEVEL + CASTLE.DAIS_RISE);
    boss = stepOff(dais, dx, dz);
  }

  // the key hangs where this floor's puzzle put it, and the other prize is gold
  const onTheGallery = floor % 2 === 1;
  const keySpot = onTheGallery ? balcony : island;
  const goldSpot = onTheGallery ? island : balcony;
  if (keySpot) chests.push({ x: keySpot[0], z: keySpot[1], big: false, key: true });
  if (goldSpot) chests.push({ x: goldSpot[0], z: goldSpot[1], big: false });

  // `rooms` is places, not floor: the galleries and the curtain walk are how you get between them
  // and counting them would make the number in the debug readout mean nothing.
  const places = plan.spaces.filter((s) => s.sort !== 'gallery' && s.sort !== 'ring');
  const map: DungeonMap = {
    size, tiles: plan.tiles, rooms: places.map((s) => s.rect), entrance, chests,
    torches: [], doors, monsterSpots: [], floor, descent, boss,
    levels: plan.levels, furniture: [],
  };

  settleChests(map, CASTLE.HERO_CLIMB);

  // The one thing that must never ship: a key behind the door it opens. Everything above is meant
  // to make that impossible, and "meant to" is what a check is for — if the warden's key has ended
  // up on the wrong side of the portcullis, the portcullis is not there.
  const open = reachable(map, entrance, false, CASTLE.HERO_CLIMB, chestTiles(map));
  if (chests.some((c) => c.key && !beside(open, map, c.x, c.z))) {
    for (const d of doors) plan.tiles[d.z * size + d.x] = DTile.Floor;
    map.doors = [];
  }
  return map;
}

/**
 * Where the hero stands on arriving: in the gatehouse on the ground floor, in the stair turret on
 * every floor above it.
 *
 * The same turret each time, and always the one diagonally opposite the corner the sealed chamber
 * tends to fall in, because the chamber is chosen as the one furthest from wherever you came in.
 * So climbing the castle is a diagonal walk across the whole of each floor rather than a hunt for
 * a stair that could be anywhere — and a keep has one stair turret, which is what a keep looks
 * like from outside as well.
 */
function arrivalOf(plan: Plan, floor: number): [number, number] {
  const sort = floor === 1 ? 'gatehouse' : 'tower';
  const spaces = plan.spaces.filter((s) => s.sort === sort);
  const rect = (sort === 'tower' ? spaces[spaces.length - 1] : spaces[0]).rect;
  return centre(rect);
}

/** The floor tiles on a chamber's boundary that lead out of it: where a portcullis drops. */
function doorwaysOf(plan: Plan, r: Room): Door[] {
  const out: Door[] = [];
  const floorAt = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < plan.size && z < plan.size && plan.tiles[z * plan.size + x] === DTile.Floor;
  for (let x = r.x; x < r.x + r.w; x++) {
    if (floorAt(x, r.z)) out.push({ x, z: r.z });
    if (floorAt(x, r.z + r.h - 1)) out.push({ x, z: r.z + r.h - 1 });
  }
  for (let z = r.z + 1; z < r.z + r.h - 1; z++) {
    if (floorAt(r.x, z)) out.push({ x: r.x, z });
    if (floorAt(r.x + r.w - 1, z)) out.push({ x: r.x + r.w - 1, z });
  }
  return out;
}

/** One tile off the front edge of the dais, facing the room: where its owner stands. */
function stepOff(dais: Room, x: number, z: number): [number, number] {
  return dais.w >= dais.h ? [x, dais.z - 1] : [dais.x - 1, z];
}

/** The head of a hall, one terrace up: where a throne stands and where a boss waits on it. */
function daisOf(r: Room): Room {
  const inner = shrink(r, 1);
  const deep = Math.min(3, Math.max(1, Math.floor(Math.min(inner.w, inner.h) / 3)));
  return inner.w >= inner.h
    ? { x: inner.x + inner.w - deep, z: inner.z, w: deep, h: inner.h }
    : { x: inner.x, z: inner.z + inner.h - deep, w: inner.w, h: deep };
}

/**
 * Flood a chamber, leaving a line of stepping stones from its doorway to an island in the middle.
 *
 * The route is laid first and the water poured round it, rather than the other way about, because
 * a route carved out of water afterwards is a route that can fail to exist. The false stones are
 * then placed only where nothing walkable already touches them, which is what makes them false:
 * you can see them, you cannot get to them, and neither can they accidentally bridge to the
 * island and give the room a second answer.
 */
function drown(plan: Plan, r: Room): [number, number] | null {
  const inner = shrink(r, 1);
  if (inner.w < 5 || inner.h < 5) return null;
  const bank = doorwaysOf(plan, r).map(({ x, z }) => nearestInside(inner, x, z));
  if (bank.length === 0) return null;

  const [ix, iz] = centre(inner);
  const island: Array<[number, number]> = [];
  for (let z = iz - 1; z <= iz + 1; z++) for (let x = ix - 1; x <= ix + 1; x++) island.push([x, z]);

  // an L from each bank tile to the island: two straight runs, which is a path a person can read
  const path: Array<[number, number]> = [];
  for (const [bx, bz] of bank) {
    for (let x = Math.min(bx, ix); x <= Math.max(bx, ix); x++) path.push([x, bz]);
    for (let z = Math.min(bz, iz); z <= Math.max(bz, iz); z++) path.push([ix, z]);
  }

  const dry = new Set<number>([...bank, ...island, ...path].map(([x, z]) => z * plan.size + x));
  for (let z = inner.z; z < inner.z + inner.h; z++) {
    for (let x = inner.x; x < inner.x + inner.w; x++) {
      if (!dry.has(z * plan.size + x)) plan.tiles[z * plan.size + x] = DTile.Water;
    }
  }

  // false stones: only where all four neighbours are water, so they lead nowhere and join nothing
  for (let z = inner.z + 1; z < inner.z + inner.h - 1; z++) {
    for (let x = inner.x + 1; x < inner.x + inner.w - 1; x++) {
      if (plan.tiles[z * plan.size + x] !== DTile.Water) continue;
      if (plan.rng() > 0.16) continue;
      const alone = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .every(([dx, dz]) => plan.tiles[(z + dz) * plan.size + (x + dx)] === DTile.Water);
      if (alone) plan.tiles[z * plan.size + x] = DTile.Floor;
    }
  }
  return [ix, iz];
}

/**
 * A walk along one wall of the great hall, three terraces up, with one stair to it.
 *
 * Along *one* wall, and that is not the obvious choice. A balcony round both long sides looks
 * better and cannot be built: the hall's own doorway is punched through one of its walls, and a
 * balcony running along that wall turns the doorway into a lip three terraces high, which makes
 * the great hall a room nobody can get into. So the wall is chosen from the ones no door comes
 * through, which on a hall with one door leaves three to pick from.
 *
 * The stair is three tiles of hall floor climbing one terrace each into the near end of the walk —
 * exactly what the hero can manage, and one more than a climbing rope buys anybody. Returns the
 * tile the chest up there stands on, or null where the hall came out too small to be worth it.
 */
function minstrels(plan: Plan, r: Room): [number, number] | null {
  const inner = shrink(r, 1);
  const walk = CASTLE.GALLERY_WALK;
  const rise = CASTLE.GALLERY_RISE;
  // a hall needs room for the walk, the stair beside it and a floor left over to look up from
  if (Math.min(inner.w, inner.h) < walk + 4 || Math.min(inner.w, inner.h) < rise + 2) return null;
  const doors = doorwaysOf(plan, r);

  /** The four walls, longest first, with the ledge each would carry and the stair up to it. */
  const sides = [
    { free: !doors.some((d) => d.x === r.x), ledge: { x: inner.x, z: inner.z, w: walk, h: inner.h }, dx: 1, dz: 0 },
    { free: !doors.some((d) => d.x === r.x + r.w - 1), ledge: { x: inner.x + inner.w - walk, z: inner.z, w: walk, h: inner.h }, dx: -1, dz: 0 },
    { free: !doors.some((d) => d.z === r.z), ledge: { x: inner.x, z: inner.z, w: inner.w, h: walk }, dx: 0, dz: 1 },
    { free: !doors.some((d) => d.z === r.z + r.h - 1), ledge: { x: inner.x, z: inner.z + inner.h - walk, w: inner.w, h: walk }, dx: 0, dz: -1 },
  ].filter((s) => s.free).sort((a, b) => b.ledge.w * b.ledge.h - a.ledge.w * a.ledge.h);
  const side = sides[0];
  if (!side) return null;

  raise(plan, side.ledge, BASE_LEVEL + rise);

  // The stair stands on the hall floor immediately off the ledge and climbs along it: the top
  // tread is level with the walk and touching it, and each tread below is one terrace lower, so
  // the last of them is a single step off the floor of the hall.
  const { ledge, dx, dz } = side;
  const alongZ = dx !== 0;
  const footX = alongZ ? (dx > 0 ? ledge.x + walk : ledge.x - 1) : ledge.x;
  const footZ = alongZ ? ledge.z : (dz > 0 ? ledge.z + walk : ledge.z - 1);
  for (let n = 0; n < rise; n++) {
    const tx = alongZ ? footX : footX + n;
    const tz = alongZ ? footZ + n : footZ;
    if (plan.tiles[tz * plan.size + tx] !== DTile.Floor) return null;
    plan.levels[tz * plan.size + tx] = BASE_LEVEL + rise - n;
  }
  // the prize sits at the far end of the walk from the stair, so it is a walk and not a reach
  return alongZ
    ? [ledge.x + Math.floor(walk / 2), ledge.z + ledge.h - 1]
    : [ledge.x + ledge.w - 1, ledge.z + Math.floor(walk / 2)];
}

/** Put a rectangle of already-carved floor up onto a terrace. Rock is left where it is. */
function raise(plan: Plan, r: Room, level: number): void {
  for (let z = r.z; z < r.z + r.h; z++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = z * plan.size + x;
      if (plan.tiles[i] === DTile.Floor) plan.levels[i] = level;
    }
  }
}

/** The tile just inside a rectangle from a point on its boundary. */
function nearestInside(r: Room, x: number, z: number): [number, number] {
  return [
    Math.max(r.x, Math.min(r.x + r.w - 1, x)),
    Math.max(r.z, Math.min(r.z + r.h - 1, z)),
  ];
}
