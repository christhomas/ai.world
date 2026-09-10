import type { Rng } from '../core/rng';
import { PropKind } from '../world/biomes';
import type { SpawnSpot } from '../entities/spawns';
import { BASE_LEVEL, DTile, WALL_LEVEL, type Furnishing, type Room, type Torch } from './map';

/**
 * What the rooms of a castle are *for*, and what stands in them.
 *
 * A vault does not need this file. Its rooms are all the same room — four walls, a torch, maybe a
 * chest — and that is right for a hole somebody dug: nobody lived in it. A castle is the opposite
 * claim. It was built by people who ate in one room, slept in another, kept their armour in a
 * third and their prisoners in a fourth, and if you cannot tell those four apart at a glance then
 * the whole thing is a vault with more corridors.
 *
 * So every chamber is given a use, and the use decides the furniture. That was written when a
 * castle was dressed out of a village's things — an altar standing in for a throne, a rack of
 * spears for a wall of arms — and the substitution it was waiting for has happened: `entities/
 * keep.ts` is the fourteen props a keep is actually furnished with, and the tables below ask for
 * them by name.
 *
 * There is a second question underneath the first, and it is the one that makes four floors worth
 * climbing rather than one floor climbed four times. A chamber's use is not rolled out of one list
 * — it is rolled out of the list for *this storey of the keep*, because a building is stacked. The
 * stores and the gaol are at the bottom by the gate, the garrison is over them, the chapel and the
 * library and the bedchambers are above that, and the lord is at the top. See `STOREYS`.
 */

/** What a space in the plan is: the shape decides how it is dressed and how it is lit. */
export type Sort = 'chamber' | 'hall' | 'throne' | 'gallery' | 'tower' | 'gatehouse' | 'ring' | 'undercroft';

/**
 * What a chamber was for. Rolled per room and never anything else, so a player who has learned
 * that the room with the anvil in it is where the spare swords are can go looking for one.
 */
export type Role =
  'guardroom' | 'armoury' | 'kitchen' | 'chapel' | 'crypt' | 'cells' | 'library' | 'store' | 'quarters';

/**
 * Which storey of the keep you are on, and therefore what its rooms are.
 *
 * This is the answer to the thing that was wrong with a castle after the furniture was built: all
 * four floors were the same floor. Every chamber rolled its use out of one list of eight, so a
 * floor came out as eighteen rooms of everything — measured on seed 4242, the top floor of a keep
 * held forty-one pews, twenty altars and four chapels, and the ground floor held seventeen pews
 * and a throne room's worth of nothing in particular. You could not tell which floor you were on
 * by looking at it, which for a building is the whole of the complaint.
 *
 * A keep is stacked, and it is stacked for reasons anybody can see from the plan: the heavy, wet,
 * defensible things are at the bottom where the gate is, the garrison is over them, the private
 * and the sacred rooms are above that, and the lord is at the top. So the roll is per storey, and
 * a list with a use twice in it is that use twice as likely. Eight entries each, because eighteen
 * chambers over eight slots is enough to make a floor read as mostly one thing without making it
 * read as only one thing — a floor of nothing but stores is a warehouse, not a castle.
 *
 * The roll still costs exactly one number out of the plan's own stream, which is deliberate: the
 * walls of every floor of every seed come out exactly where they came out before. Only what is
 * standing between them changed.
 */
const STOREYS: readonly (readonly Role[])[] = [
  // the ground: the gate, the gaol beside it, and everything a castle eats and stores. Three
  // stores out of eight was tried first and is a warehouse — measured, ninety-nine crates on one
  // floor — and giving the share to an armoury put sixty weapon racks down here, which is the
  // garrison floor's own picture. A third guardroom is the gate's own watch, and reads as one.
  ['store', 'store', 'kitchen', 'kitchen', 'cells', 'guardroom', 'guardroom', 'guardroom'],
  // the garrison: whoever holds the place, their arms and their beds
  ['guardroom', 'guardroom', 'armoury', 'armoury', 'quarters', 'kitchen', 'cells', 'store'],
  // the chapel floor, which is the one you remember, and the only floor with a crypt under an altar
  ['chapel', 'crypt', 'library', 'library', 'quarters', 'quarters', 'store', 'guardroom'],
  // the lord's own floor: his hall is the throne room, and the rest of it is his
  ['quarters', 'quarters', 'library', 'library', 'armoury', 'armoury', 'store', 'guardroom'],
];

/**
 * The one room a storey must have, whatever the rolls said.
 *
 * Eighteen chambers against eight slots makes the signature room nearly certain and nearly is not
 * a guarantee: a floor called the chapel floor with no chapel on it is worse than one that never
 * claimed to be. It costs no roll — the chamber furthest from the stair is simply told what it is
 * — so a seed builds the same walls it always did.
 */
const THE_STOREYS_OWN: readonly Role[] = ['cells', 'armoury', 'chapel', 'library'];

/** One rectangle of the plan, with what it is and what it is for. */
export interface Space {
  rect: Room;
  sort: Sort;
  /** Only chambers have a use; a corridor is a corridor. */
  role?: Role;
}

/**
 * How far apart torches sit along a wall.
 *
 * Four is what a vault uses, and the first try here was three on the grounds that a keep is lit
 * and a cave is not. Measured over thirty-two floors, three comes out between two hundred and
 * fifty and two hundred and seventy torches to a floor — every wall of every gallery bracketed the
 * whole way along, which does not read as a lit castle, it reads as a lamp shop. Six leaves the
 * light in pools with dark between them, which is what a corridor lit by fire looks like and where
 * the things that are not animals stand. It halves the count: a floor carries about a hundred and
 * fifty.
 */
const TORCH_SPACING = 6;

/**
 * And how far apart they sit down a gallery, which has to be a different number.
 *
 * A room is lit from four walls that face each other across ten or twenty tiles, so six along each
 * of them leaves the pools the note above wants. A gallery is three tiles wide and fifty long, and
 * its two long walls are a stride apart — so six along each of those is a bracket every three
 * tiles of walking, which is not a corridor lit by fire, it is a runway. Ten gives a pair of
 * brackets facing each other and then a stretch of dark, which is the same picture the number
 * above was chosen for, arrived at from a shape twenty times as long as it is wide.
 */
const WALK_SPACING = 10;

/**
 * How narrow a corridor has to be before it is not worth bracketing.
 *
 * The one-tile passages between two chambers are the deepest cut the plan makes and there are
 * eight of them on a floor, each with rock down both sides — so they were carrying a good share of
 * the torches on their own. A servants' passage is meant to be dark.
 */
const LIT_CORRIDOR = 2;

/**
 * How much of a chamber's floor is furniture, at most.
 *
 * Nine per cent, until the furniture became solid. The old reasoning is worth keeping because it
 * was right at the time: nothing underground stopped a walker, so a room packed with tables was a
 * room you walked through the tables of, and that looks worse than an empty one. Furniture is
 * measured now — `DungeonWorld` builds the same boxes a room does — so the argument for keeping a
 * hall bare has gone with it.
 *
 * Eighteen is twice what it was and it is what the difference looks like: at nine, the great hall
 * of Saltmarch is a bare floor with a bench in it; at eighteen it is a hall with tables, barrels
 * and benches you walk between. Measured, not guessed: a hundred and eighty-four solid sticks a
 * floor becomes two hundred and thirty-four, and across twenty-four dressed floors not one tile of
 * any of them is shut off, because `settleWhatFillsTiles` is what stands between the dressing and
 * a sealed room.
 *
 * What holds it here rather than higher is the camera. Past about a quarter the floor stops being
 * visible between the things standing on it, and a room read from above at this angle needs the
 * floor to read as floor.
 */
const CLUTTER = 0.18;

/** Everything the dressing pass works out, handed back in one piece. */
export interface Dressing {
  torches: Torch[];
  furniture: Furnishing[];
  /** What waits in each room; the ones a ghost keeps say so by name. @see SpawnSpot */
  monsterSpots: SpawnSpot[];
}

/** The plan, as much of it as the dressing needs to see. */
export interface Dressable {
  size: number;
  tiles: Uint8Array;
  levels: Uint8Array;
  spaces: Space[];
  rng: Rng;
  /** Counting from one at the gate: deeper floors are busier and worse haunted. */
  floor: number;
}

/**
 * Pick a use for a chamber, out of what this storey of the keep is for.
 *
 * Deterministic from the plan's own stream, so a seed is a castle — and exactly one number out of
 * it however many floors there are, which is what keeps every wall where it was.
 */
export function roleFor(rng: Rng, floor: number): Role {
  const storey = STOREYS[Math.min(Math.max(floor, 1), STOREYS.length) - 1];
  return storey[Math.floor(rng() * storey.length)];
}

/**
 * Give the storey the room it is named for, and put a crypt under the chapel's floor.
 *
 * Two facts about a keep that a roll cannot be trusted with. The first is the signature room: the
 * chapel floor has a chapel on it because it is the chapel floor, and the chamber furthest from
 * the stair is the one told so, because that is the room a player reaches last and the one they
 * will remember the floor by.
 *
 * The second is the pair. A chapel with a crypt beside it is a different room from a chapel with a
 * library beside it: the sarcophagi belong *under the altar*, and the whole reason a keep is
 * frightening at the top of its stair is that you can see where the bodies are from the chapel
 * door. So the chamber nearest the chapel becomes the crypt whatever it rolled — never the
 * flooded one and never the sealed one, because those two already have a job.
 *
 * Runs after the puzzles have claimed their rooms and before anything is furnished, and spends no
 * randomness at all.
 */
export function giveTheStoreyItsRooms(plan: Dressable, from: [number, number]): void {
  const chambers = plan.spaces.filter((s) => s.sort === 'chamber');
  if (chambers.length === 0) return;
  const away = (s: Space) => Math.hypot(centre(s.rect)[0] - from[0], centre(s.rect)[1] - from[1]);

  const wanted = THE_STOREYS_OWN[Math.min(Math.max(plan.floor, 1), THE_STOREYS_OWN.length) - 1];
  if (!chambers.some((s) => s.role === wanted)) {
    [...chambers].sort((a, b) => away(b) - away(a))[0].role = wanted;
  }

  const chapel = chambers.find((s) => s.role === 'chapel');
  if (!chapel) return;
  const beside = chambers
    .filter((s) => s !== chapel && s.role !== 'chapel' && s.role !== 'crypt')
    .map((s) => ({ s, d: Math.hypot(centre(s.rect)[0] - centre(chapel.rect)[0], centre(s.rect)[1] - centre(chapel.rect)[1]) }))
    .sort((a, b) => a.d - b.d)[0];
  if (beside) beside.s.role = 'crypt';
}

/**
 * Light the castle, furnish it, and say what is walking about in it.
 *
 * One pass over the spaces rather than five, because every one of these answers depends on what
 * the room is: a chapel gets candles and a wight, a store gets crates and a rat, and a gallery
 * gets torches, a tapestry and a figure standing against each wall — but nothing living, because a
 * corridor a monster is standing in is a corridor you cannot use.
 */
export function dress(plan: Dressable): Dressing {
  const out: Dressing = { torches: [], furniture: [], monsterSpots: [] };
  for (const space of plan.spaces) {
    lightWalls(plan, space, out.torches);
    hangTheWalls(plan, space, out.furniture);
    hangTheLights(plan, space, out.furniture);
    furnish(plan, space, out.furniture);
    populate(plan, space, out);
  }
  return out;
}

/**
 * Where a space's walls are, which is not the same rectangle for a room and for a corridor.
 *
 * A chamber's rectangle *includes* its walls — `leaf` carves the inside of it and leaves the
 * boundary standing — so the wall of a chamber is the edge of its own rect. A gallery's rectangle
 * is the band that was carved, every tile of it floor, and its walls are the rock a tile outside
 * that. Nobody had noticed, because the symptom is a silence: `lightWalls` and `hangTheWalls` both
 * ask whether the boundary tile is rock, a gallery's boundary is its own floor, and so the answer
 * was no for every corridor in every castle. Fifteen stretches of gallery a floor, and not one
 * torch or tapestry on any of them — which is precisely the "long blank corridor" the hangings
 * table says it exists for, going unlit and unhung since the day it was written.
 */
function wallsOf(space: Space): Room {
  return space.sort === 'gallery' ? grow(space.rect, 1) : space.rect;
}

/** Torches on the rock that faces a room's floor, spaced along each of its four walls. */
function lightWalls(plan: Dressable, space: Space, out: Torch[]): void {
  // the ring runs right round the keep and would take sixty torches on its own; it is lit at its
  // corners and its gallery mouths by the rooms that open onto it instead
  if (space.sort === 'ring') return;
  if (space.sort === 'gallery' && Math.min(space.rect.w, space.rect.h) < LIT_CORRIDOR) return;
  const rect = wallsOf(space);
  const step = space.sort === 'gallery' ? WALK_SPACING : TORCH_SPACING;
  const rock = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < plan.size && z < plan.size && plan.tiles[z * plan.size + x] === DTile.Rock;
  for (let x = rect.x + 1; x < rect.x + rect.w - 1; x += step) {
    if (rock(x, rect.z)) out.push({ x, z: rect.z, rot: -Math.PI / 2 });
    if (rock(x, rect.z + rect.h - 1)) out.push({ x, z: rect.z + rect.h - 1, rot: Math.PI / 2 });
  }
  for (let z = rect.z + 2; z < rect.z + rect.h - 1; z += step) {
    if (rock(rect.x, z)) out.push({ x: rect.x, z, rot: 0 });
    if (rock(rect.x + rect.w - 1, z)) out.push({ x: rect.x + rect.w - 1, z, rot: Math.PI });
  }
}

/**
 * What hangs on a room's walls, which is a different question from what stands on its floor.
 *
 * A banner, a tapestry and a window are fixed to rock rather than set down on flagstones, so they
 * are placed the way a torch is — on the rock face that looks into the room, turned to face it —
 * and not by the scatter that puts barrels about. Getting that wrong is very visible: a banner
 * lying in the middle of a floor reads as a dropped rug.
 *
 * It matters more than it sounds. A stone wall with nothing on it is exactly what makes a castle
 * corridor read as a mine, and the difference between the two is entirely what is hanging up.
 */
const HANGINGS: Partial<Record<Sort | Role, readonly PropKind[]>> = {
  // a great hall is where a house says whose it is
  hall: [PropKind.Banner, PropKind.Banner, PropKind.Tapestry],
  throne: [PropKind.Banner, PropKind.Banner, PropKind.StainedWindow],
  // a long blank corridor is the thing this is most for
  gallery: [PropKind.Tapestry, PropKind.StainedWindow],
  chapel: [PropKind.StainedWindow, PropKind.StainedWindow],
  library: [PropKind.Tapestry],
  quarters: [PropKind.Tapestry],
  // a wall of arms hangs its lord's device over itself
  armoury: [PropKind.Banner],
  /*
   * And the one that is worth the trouble: a window over the flood.
   *
   * The undercroft is the room a player stands longest in, because crossing it is a puzzle, and
   * until now it was a black pool with barrels round it. A stained window goes on glowing when
   * everything round it has gone dark — so the water has something to carry, and the room reads as
   * a cellar of a building rather than as a cave with a puddle in it.
   *
   * Nothing hangs in a crypt or a cell on purpose. A crypt with a window in it is a chapel, and
   * light is the last thing a gaol has.
   */
  undercroft: [PropKind.StainedWindow],
};

/**
 * Everything that is fixed to rock rather than set down on a floor.
 *
 * Derived from the table above rather than written out again, and exported because anything that
 * checks where furniture stands has to know the difference: a banner on a floor tile is a dropped
 * rug, and a banner reported as "inside a wall" is a banner doing its job.
 */
export const HANGS_ON_WALLS: ReadonlySet<PropKind> =
  new Set(Object.values(HANGINGS).flatMap((list) => [...(list ?? [])]));

/** How far apart things hang, in tiles. Wider than the torches: a wall of banners is a bunting. */
const HANGING_SPACING = 9;

/**
 * Hang whatever this room hangs, on the rock that faces its floor.
 *
 * Walks the same four walls `lightWalls` does and for the same reason — those are the faces a
 * player can see — but starts at a different offset along each of them, so a banner and a torch do
 * not end up on the same tile fighting for it.
 */
function hangTheWalls(plan: Dressable, space: Space, out: Furnishing[]): void {
  const kinds = HANGINGS[whatItIs(space)];
  if (!kinds || kinds.length === 0) return;
  if (Math.min(space.rect.w, space.rect.h) < LIT_CORRIDOR) return;
  const rect = wallsOf(space);
  if (Math.min(rect.w, rect.h) < 3) return;
  const rock = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < plan.size && z < plan.size && plan.tiles[z * plan.size + x] === DTile.Rock;
  const hang = (x: number, z: number, rot: number): void => {
    if (!rock(x, z) || out.some((f) => f.x === x && f.z === z)) return;
    // From the top of the wall, which has to be said out loud: the tile under a hanging is rock,
    // rock carries no level of its own, and a `Furnishing` with no level on it is drawn at the
    // level of its tile. Left unsaid, every banner in every castle hung from the flagstones
    // downwards with two inches of pole showing, which from this camera reads as a dropped rug —
    // the precise failure the note above this function warns about.
    out.push({ kind: kinds[Math.floor(plan.rng() * kinds.length)], x, z, rot, level: WALL_LEVEL });
  };
  // offset by three from the torches' own start, so the two never ask for the same stone
  for (let x = rect.x + 4; x < rect.x + rect.w - 1; x += HANGING_SPACING) {
    hang(x, rect.z, -Math.PI / 2);
    hang(x, rect.z + rect.h - 1, Math.PI / 2);
  }
  for (let z = rect.z + 5; z < rect.z + rect.h - 1; z += HANGING_SPACING) {
    hang(rect.x, z, 0);
    hang(rect.x + rect.w - 1, z, Math.PI);
  }
}

/** What each sort of room stands on its floor, out of the props that exist today. */
function furnish(plan: Dressable, space: Space, out: Furnishing[]): void {
  const which = whatItIs(space);
  const kinds = KIT[which];
  if (kinds.length === 0) return;
  const inner = shrink(space.rect, 1);

  // what the room is for, before what the room happens to contain
  const piece = CENTREPIECE[which];
  if (piece && inner.w >= 3 && inner.h >= 3) {
    const x = inner.x + Math.floor(piece.at[0] * (inner.w - 1));
    const z = inner.z + Math.floor(piece.at[1] * (inner.h - 1));
    if (plan.tiles[z * plan.size + x] === DTile.Floor && !out.some((f) => f.x === x && f.z === z)) {
      /*
       * Facing into the room, and lying down it where that is a thing the piece cares about.
       *
       * A throne at the head of a hall looks down it, and a hearth against the far wall has its
       * back to that wall; both of those the fractions above already settle, because everything in
       * this file is built facing +z. What the fractions cannot settle is a board. A long table is
       * three tiles laid along x, and a great hall is nine tiles by thirty — so in three halls out
       * of four the one piece the room is named for was laid across the room instead of down it,
       * with a bench on each end wall. `along` turns it to lie the long way of whatever it is in.
       */
      const turned = piece.along && inner.h > inner.w;
      out.push({ kind: piece.kind, x, z, rot: turned ? Math.PI / 2 : 0 });
    }
  }
  if (space.sort === 'gallery') { lineTheWalk(plan, space.rect, kinds, out); return; }

  const budget = Math.max(1, Math.round(inner.w * inner.h * CLUTTER));
  for (let n = 0; n < budget; n++) {
    const kind = kinds[Math.floor(plan.rng() * kinds.length)];
    const x = inner.x + Math.floor(plan.rng() * inner.w);
    const z = inner.z + Math.floor(plan.rng() * inner.h);
    if (plan.tiles[z * plan.size + x] !== DTile.Floor) continue;
    if (out.some((f) => f.x === x && f.z === z)) continue;
    out.push({ kind, x, z, rot: Math.floor(plan.rng() * 4) * (Math.PI / 2) });
  }
}

/**
 * Dress a corridor, which is a different job from dressing a room: along the walls, never across.
 *
 * The scatter above works on `shrink(rect, 1)`, because a chamber's rectangle includes its walls
 * and the inside of it is where the furniture goes. A gallery's rectangle is all floor and three
 * tiles wide at its widest, so shrinking it by one leaves exactly the line down the middle — the
 * one line of a corridor that must stay clear. Every suit of armour in every gallery of every
 * castle was therefore standing in the middle of the walk, and the settle spent its budget
 * shoving them about because that is what a wall across a corridor looks like from up here.
 *
 * So a walk is lined instead. Both edge lanes, never two things within a tile of each other —
 * because two figures facing each other across a two-tile gallery is not a gallery, it is a door
 * — and nothing at all in the one-tile servants' passages, which are meant to be dark and empty
 * both.
 */
function lineTheWalk(plan: Dressable, r: Room, kinds: readonly PropKind[], out: Furnishing[]): void {
  if (Math.min(r.w, r.h) < LIT_CORRIDOR) return;
  const alongZ = r.h > r.w;
  const run = alongZ ? r.h : r.w;
  const lanes: Array<[number, number]> = alongZ
    ? [[r.x, 0], [r.x + r.w - 1, Math.PI]]
    : [[r.z, -Math.PI / 2], [r.z + r.h - 1, Math.PI / 2]];
  const budget = Math.max(1, Math.round(lanes.length * run * CLUTTER));
  for (let n = 0; n < budget; n++) {
    const kind = kinds[Math.floor(plan.rng() * kinds.length)];
    const [lane, rot] = lanes[Math.floor(plan.rng() * lanes.length)];
    const at = Math.floor(plan.rng() * run);
    const x = alongZ ? lane : r.x + at;
    const z = alongZ ? r.z + at : lane;
    if (plan.tiles[z * plan.size + x] !== DTile.Floor) continue;
    if (out.some((f) => Math.abs(f.x - x) <= 1 && Math.abs(f.z - z) <= 1)) continue;
    out.push({ kind, x, z, rot });
  }
}

/**
 * The lights that hang over a hall, which are the one thing a keep has that a cellar cannot.
 *
 * A torch is a bracket and a bracket is on a wall, so the middle of a room thirty tiles long is
 * dark whatever is done to its edges. The braziers in the scatter answer half of that and stand on
 * the floor taking up room; a chandelier hangs above where the ceiling would be and takes up none,
 * which is why it is not in `FURNITURE_BLOCKS` and why it is placed by a pass of its own rather
 * than rolled for. Rolled for, it would turn up in the corner of a store cupboard.
 *
 * Down the middle at the quarter and the three-quarter of the room's long axis, so a hall gets two
 * and reads as lit from above along its length. Never on the tile a centrepiece or a chest has
 * already claimed — a chandelier is drawn over the top of whatever is under it, and a light
 * hanging directly over the great chest looks like a spotlight rather than a room.
 */
function hangTheLights(plan: Dressable, space: Space, out: Furnishing[]): void {
  if (space.sort !== 'hall' && space.sort !== 'throne') return;
  const inner = shrink(space.rect, 1);
  if (Math.min(inner.w, inner.h) < 3) return;
  const alongZ = inner.h >= inner.w;
  for (const share of [0.3, 0.7]) {
    const x = alongZ ? inner.x + Math.floor(inner.w / 2) : inner.x + Math.round(share * (inner.w - 1));
    const z = alongZ ? inner.z + Math.round(share * (inner.h - 1)) : inner.z + Math.floor(inner.h / 2);
    if (plan.tiles[z * plan.size + x] !== DTile.Floor) continue;
    if (out.some((f) => f.x === x && f.z === z)) continue;
    out.push({ kind: PropKind.Chandelier, x, z, rot: 0 });
  }
}

/**
 * Cobwebs in the corners of a room something is keeping.
 *
 * The prop was built to be information rather than decoration and then nothing placed it, so it
 * was neither. A castle's haunted rooms are known to the generator and were known to nobody else
 * until you were standing in one — which is the opposite of the argument `game/haunts.ts` makes,
 * that a world you can reason about beforehand is worth more than one that startles you. This is
 * the sentence the room says from its doorway.
 *
 * The four inner corners, because a corner is where a web belongs and because four of them read as
 * a room nobody has swept rather than as one dusty patch. Whatever the scatter has already put in
 * a corner keeps it: a cobweb is worth less than a sarcophagus.
 */
function web(plan: Dressable, r: Room, out: Furnishing[]): void {
  const inner = shrink(r, 1);
  if (inner.w < 3 || inner.h < 3) return;
  for (const [x, z] of [
    [inner.x, inner.z], [inner.x + inner.w - 1, inner.z],
    [inner.x, inner.z + inner.h - 1], [inner.x + inner.w - 1, inner.z + inner.h - 1],
  ] as const) {
    if (plan.tiles[z * plan.size + x] !== DTile.Floor) continue;
    if (out.some((f) => f.x === x && f.z === z)) continue;
    out.push({ kind: PropKind.Cobweb, x, z, rot: 0 });
  }
}

/**
 * The kit each sort of room is dressed out of.
 *
 * This was written as a shopping list with the wrong things in the basket — an `Altar` standing in
 * for a throne, a `Table` for the board down a hall — and the things it was waiting for exist now,
 * so it is a shopping list with the right things in it. What is left of the compromise is the
 * ordinary village furniture that a castle genuinely does own: a crate is a crate and a barrel is
 * a barrel wherever they are stacked.
 *
 * The rule about what is *not* here is the one worth keeping in mind. A room's signature piece
 * belongs in `CENTREPIECE` and not in this list, because a scatter puts a thing wherever the roll
 * lands: an altar rolled into a corner is a block of stone, and four of them in one chapel is a
 * mason's yard. Anything the eye counts belongs to the room; anything the eye reads as clutter
 * belongs here.
 */
const KIT: Record<Sort | Role, readonly PropKind[]> = {
  hall: [PropKind.LongTable, PropKind.Chair, PropKind.Brazier, PropKind.Rug, PropKind.Statue],
  throne: [PropKind.Rug, PropKind.Brazier, PropKind.SuitOfArmour, PropKind.Statue],
  // a walk lined with figures, which is what a gallery is for; the candles are the low light
  gallery: [PropKind.SuitOfArmour, PropKind.Statue, PropKind.Candle],
  ring: [],
  // a flooded cellar has whatever floated: no coffins, they are the crypt's, one floor up
  undercroft: [PropKind.Barrel, PropKind.Crate],
  tower: [PropKind.Barrel, PropKind.Crate, PropKind.WeaponRack],
  gatehouse: [PropKind.WeaponRack, PropKind.Barrel, PropKind.Brazier],
  chamber: [PropKind.Crate, PropKind.Barrel],
  guardroom: [PropKind.Table, PropKind.Chair, PropKind.WeaponRack, PropKind.Brazier],
  armoury: [PropKind.WeaponRack, PropKind.WeaponRack, PropKind.Anvil, PropKind.SuitOfArmour],
  kitchen: [PropKind.Barrel, PropKind.Crate, PropKind.Table, PropKind.Cauldron],
  chapel: [PropKind.Pew, PropKind.Pew, PropKind.Candle, PropKind.Statue],
  // the room under the chapel, and the only room in the keep that is nothing but its own dead
  crypt: [PropKind.Sarcophagus, PropKind.Sarcophagus, PropKind.Candle, PropKind.Statue],
  cells: [PropKind.Bars, PropKind.Bars, PropKind.Crate],
  library: [PropKind.Shelf, PropKind.Shelf, PropKind.Table, PropKind.Chair],
  store: [PropKind.Crate, PropKind.Crate, PropKind.Barrel, PropKind.Shelf],
  quarters: [PropKind.Bed, PropKind.Table, PropKind.Chair, PropKind.Rug],
};

/**
 * The one thing a room is *for*, put where the room is built round it.
 *
 * Everything in `KIT` is scattered: a barrel goes wherever the roll lands, which is right for a
 * barrel and wrong for a throne. A high seat that turned up three tiles off-centre with a rug over
 * it would be a chair somebody had left out. So the piece that gives a room its name is placed
 * first, on the tile the room was laid out around, and the scatter fills in what is left.
 *
 * `at` is a fraction across the room and a fraction down it, so a hall four tiles deep and a hall
 * fourteen deep both put the thing in the same *place* rather than the same number of tiles in.
 * `along` says the piece is longer than it is wide and wants turning to lie down the room.
 */
const CENTREPIECE: Partial<Record<Sort | Role, { kind: PropKind; at: [number, number]; along?: true }>> = {
  // the head of the room, backed against the far wall from the door
  throne: { kind: PropKind.Throne, at: [0.5, 0.12] },
  // down the middle of the hall, where the board goes
  hall: { kind: PropKind.LongTable, at: [0.5, 0.5], along: true },
  // against a wall, because that is where a chimney can be
  kitchen: { kind: PropKind.GreatHearth, at: [0.5, 0.12] },
  // and the rooms the props built tonight were for, each with the piece that names it
  chapel: { kind: PropKind.Altar, at: [0.5, 0.14] },
  crypt: { kind: PropKind.Sarcophagus, at: [0.5, 0.5], along: true },
  /*
   * A spiral stair in each corner tower, which is what a tower is.
   *
   * It cannot go on the middle tile, and that is not an accident of this table: on every floor
   * above the ground the hero arrives at the middle of a tower, `puzzles` has already stamped that
   * tile as `Stairs`, and a centrepiece only ever stands on plain floor. So it stands a couple of
   * tiles short of the middle and you walk out of the stair you came up beside the stair going on
   * up — which is the picture, and is also the reason there is exactly one of these per tower now
   * rather than the six or nine the scatter used to leave lying about a floor.
   */
  tower: { kind: PropKind.TowerStair, at: [0.5, 0.22] },
  /*
   * And the gate itself.
   *
   * The gatehouse straddles the south wall, so the far side of it is the way out; a portcullis on
   * that edge is the thing you walked in under, and there is rock behind it, so it bars nothing
   * that was ever on offer. It was in the gatehouse's scatter before, which meant one to five of
   * them standing about in the middle of the guard room like furniture in a shop window.
   */
  gatehouse: { kind: PropKind.Portcullis, at: [0.5, 0.92] },
};

/**
 * How much of a floor has something living in it.
 *
 * A castle is not a warren and should not be one fight per doorway: the count below is per
 * chamber, and corridors, the ring and the gate are left empty on purpose so that there is
 * somewhere to back into. It rises with the floor the same way a vault's does.
 */
const MONSTER_ROOM_CHANCE = 0.62;

/**
 * Which rooms are kept by something a sword does not answer.
 *
 * The chapel and the crypt-cold undercroft always are, because those are the two rooms in a keep
 * a player expects it of, and a haunt that is a surprise every time is a haunt nobody can plan
 * around — the whole argument in `game/haunts.ts` is that a world you can reason about beforehand
 * is worth more than one that startles you. Everything else is rolled, and rolled higher the
 * further up you have climbed.
 */
const HAUNTED_ALWAYS: ReadonlySet<Sort | Role> = new Set<Sort | Role>(['chapel', 'crypt', 'undercroft', 'throne']);
const HAUNT_CHANCE_PER_FLOOR = 0.06;

/**
 * How many haunts a floor may hold at most, before the floor number is added.
 *
 * A wight has no hit points, which is not a balance number but a whole missing case in the fight
 * code: a blade goes through one. Everything a player can do about that — daylight, its own
 * ground, a warding draught — costs something they had to bring, so a floor with five of them on
 * it is not frightening, it is a floor you cannot afford to be on. Two at the gate rising to five
 * at the top leaves the sword useful and the ghosts worth avoiding.
 */
export const HAUNTS_AT_MOST = 1;

/**
 * What a haunted room keeps.
 *
 * A wight, and it is named here rather than rolled for, because that is the difference between a
 * ghost and a monster: `spawnMonsters` rolls an unnamed spot against the table for the depth, and
 * a spot that says `wight` gets one whatever floor it is on.
 */
export const GHOST = 'wight';

/** How many rooms on this floor a ghost has already been given. */
const ghostsSoFar = (out: Dressing): number => out.monsterSpots.filter((s) => s[2] === GHOST).length;

function populate(plan: Dressable, space: Space, out: Dressing): void {
  if (space.sort === 'ring' || space.sort === 'gallery' || space.sort === 'gatehouse') return;
  const middle = centre(space.rect);
  const room = HAUNTED_ALWAYS.has(whatItIs(space)) || plan.rng() < HAUNT_CHANCE_PER_FLOOR * plan.floor;
  if (room && ghostsSoFar(out) < HAUNTS_AT_MOST + plan.floor) {
    out.monsterSpots.push([middle[0], middle[1], GHOST]);
    // and the room says so from its doorway, which is the whole of what a cobweb is for
    web(plan, space.rect, out.furniture);
    return; // one keeper to a room: a wight with a pack of rats round it is a scrum, not a fright
  }
  if (plan.rng() < MONSTER_ROOM_CHANCE) out.monsterSpots.push(middle);
  for (let extra = 1; extra < plan.floor; extra++) {
    if (plan.rng() < MONSTER_ROOM_CHANCE * 0.5) out.monsterSpots.push([middle[0] + 1, middle[1] + 1]);
  }
}

/** The middle of a rectangle, in tiles. */
export function centre(r: Room): [number, number] {
  return [r.x + Math.floor(r.w / 2), r.z + Math.floor(r.h / 2)];
}

/** The same rectangle with `by` tiles taken off every side. */
export function shrink(r: Room, by: number): Room {
  return { x: r.x + by, z: r.z + by, w: Math.max(0, r.w - by * 2), h: Math.max(0, r.h - by * 2) };
}

/** And the same rectangle with `by` tiles put back on: a corridor's walls are one tile out. */
function grow(r: Room, by: number): Room {
  return { x: r.x - by, z: r.z - by, w: r.w + by * 2, h: r.h + by * 2 };
}

/**
 * What to dress a space as: its use where it has one, and what it is where it has not.
 *
 * Three places used to write this ternary out and a fourth was about to. A chamber is dressed by
 * what it is *for* and everything else — a hall, a tower, the gate, the flooded cellar — is
 * dressed by what it *is*, and `store` is the fallback because a room somebody forgot to give a
 * use to is a room full of crates, which is what a castle does with a room it has no use for.
 */
function whatItIs(space: Space): Sort | Role {
  return space.sort === 'chamber' ? (space.role ?? 'store') : space.sort;
}

/** The terrace a tile sits on, reading the plan's own array rather than a finished map. */
export function levelOf(plan: Dressable, x: number, z: number): number {
  const l = plan.levels[z * plan.size + x];
  return l === 0 ? BASE_LEVEL : l;
}
