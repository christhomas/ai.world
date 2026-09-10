import type { Rng } from '../core/rng';
import { PropKind } from '../world/biomes';
import type { SpawnSpot } from '../entities/spawns';
import { BASE_LEVEL, DTile, type Furnishing, type Room, type Torch } from './map';

/**
 * What the rooms of a castle are *for*, and what stands in them.
 *
 * A vault does not need this file. Its rooms are all the same room — four walls, a torch, maybe a
 * chest — and that is right for a hole somebody dug: nobody lived in it. A castle is the opposite
 * claim. It was built by people who ate in one room, slept in another, kept their armour in a
 * third and their prisoners in a fourth, and if you cannot tell those four apart at a glance then
 * the whole thing is a vault with more corridors.
 *
 * So every chamber is given a use, and the use decides the furniture. What that furniture is made
 * of is the compromise this file is currently living with: a castle wants thrones, banners, suits
 * of armour, long boards and braziers, and the prop catalogue has none of them. Everything below
 * is therefore built out of what a village and a chapel already own — an altar standing in for a
 * throne, a rack of spears for a wall of arms — and the list of what is actually wanted is written
 * down in `docs/worklist.md` so that the second pass is a substitution and not a redesign.
 */

/** What a space in the plan is: the shape decides how it is dressed and how it is lit. */
export type Sort = 'chamber' | 'hall' | 'throne' | 'gallery' | 'tower' | 'gatehouse' | 'ring' | 'undercroft';

/**
 * What a chamber was for. Rolled per room and never anything else, so a player who has learned
 * that the room with the anvil in it is where the spare swords are can go looking for one.
 */
export type Role = 'guardroom' | 'armoury' | 'kitchen' | 'chapel' | 'cells' | 'library' | 'store' | 'quarters';

const ROLES: readonly Role[] = ['guardroom', 'armoury', 'kitchen', 'chapel', 'cells', 'library', 'store', 'quarters'];

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
 * Nothing underground stops a walker — `DungeonWorld.blocked` knows about chests and nothing else
 * — so a room packed with tables is a room you walk through the tables of, which looks worse than
 * an empty one. This keeps a room readable from the top of an isometric camera: enough to say what
 * the room is, not so much that the floor disappears.
 */
const CLUTTER = 0.09;

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

/** Pick a use for a chamber. Deterministic from the plan's own stream, so a seed is a castle. */
export function roleFor(rng: Rng): Role {
  return ROLES[Math.floor(rng() * ROLES.length)];
}

/**
 * Light the castle, furnish it, and say what is walking about in it.
 *
 * One pass over the spaces rather than four, because every one of these answers depends on what
 * the room is: a chapel gets candles and a wight, a store gets crates and a rat, and a gallery
 * gets torches and nothing at all, because a corridor a monster is standing in is a corridor you
 * cannot use.
 */
export function dress(plan: Dressable): Dressing {
  const out: Dressing = { torches: [], furniture: [], monsterSpots: [] };
  for (const space of plan.spaces) {
    lightWalls(plan, space, out.torches);
    furnish(plan, space, out.furniture);
    populate(plan, space, out);
  }
  return out;
}

/** Torches on the rock that faces a room's floor, spaced along each of its four walls. */
function lightWalls(plan: Dressable, space: Space, out: Torch[]): void {
  // the ring runs right round the keep and would take sixty torches on its own; it is lit at its
  // corners and its gallery mouths by the rooms that open onto it instead
  if (space.sort === 'ring') return;
  const { rect } = space;
  if (space.sort === 'gallery' && Math.min(rect.w, rect.h) < LIT_CORRIDOR) return;
  const rock = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < plan.size && z < plan.size && plan.tiles[z * plan.size + x] === DTile.Rock;
  for (let x = rect.x + 1; x < rect.x + rect.w - 1; x += TORCH_SPACING) {
    if (rock(x, rect.z)) out.push({ x, z: rect.z, rot: -Math.PI / 2 });
    if (rock(x, rect.z + rect.h - 1)) out.push({ x, z: rect.z + rect.h - 1, rot: Math.PI / 2 });
  }
  for (let z = rect.z + 2; z < rect.z + rect.h - 1; z += TORCH_SPACING) {
    if (rock(rect.x, z)) out.push({ x: rect.x, z, rot: 0 });
    if (rock(rect.x + rect.w - 1, z)) out.push({ x: rect.x + rect.w - 1, z, rot: Math.PI });
  }
}

/** What each sort of room stands on its floor, out of the props that exist today. */
function furnish(plan: Dressable, space: Space, out: Furnishing[]): void {
  const kinds = KIT[space.sort === 'chamber' ? (space.role ?? 'store') : space.sort];
  if (kinds.length === 0) return;
  const inner = shrink(space.rect, 1);
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
 * The kit each sort of room is dressed out of.
 *
 * Read this as a shopping list with the wrong things in the basket: an `Altar` is standing in for
 * a throne and for a high table, a `WeaponRack` for a wall of arms, a `Forge` for a kitchen range.
 * Each of them is the right silhouette from above and the wrong object up close, which is the
 * trade being made until the props in the work list exist.
 */
const KIT: Record<Sort | Role, readonly PropKind[]> = {
  hall: [PropKind.Table, PropKind.Chair, PropKind.Chair, PropKind.Rug, PropKind.Candle],
  throne: [PropKind.Rug, PropKind.Candle, PropKind.Pew],
  gallery: [PropKind.Candle],
  ring: [],
  undercroft: [PropKind.Barrel],
  tower: [PropKind.Barrel, PropKind.Crate, PropKind.WeaponRack],
  gatehouse: [PropKind.WeaponRack, PropKind.Barrel, PropKind.Table],
  chamber: [PropKind.Crate, PropKind.Barrel],
  guardroom: [PropKind.Table, PropKind.Chair, PropKind.WeaponRack, PropKind.Barrel],
  armoury: [PropKind.WeaponRack, PropKind.WeaponRack, PropKind.Anvil, PropKind.Forge],
  kitchen: [PropKind.Barrel, PropKind.Crate, PropKind.Table, PropKind.Forge, PropKind.Cauldron],
  chapel: [PropKind.Pew, PropKind.Pew, PropKind.Candle, PropKind.Altar],
  cells: [PropKind.Bars, PropKind.Bars, PropKind.Crate],
  library: [PropKind.Shelf, PropKind.Shelf, PropKind.Table, PropKind.Chair],
  store: [PropKind.Crate, PropKind.Crate, PropKind.Barrel, PropKind.Shelf],
  quarters: [PropKind.Bed, PropKind.Table, PropKind.Chair, PropKind.Rug],
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
const HAUNTED_ALWAYS: ReadonlySet<Sort | Role> = new Set<Sort | Role>(['chapel', 'undercroft', 'throne']);
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
  const what = space.sort === 'chamber' ? (space.role ?? 'store') : space.sort;
  const room = HAUNTED_ALWAYS.has(what) || plan.rng() < HAUNT_CHANCE_PER_FLOOR * plan.floor;
  if (room && ghostsSoFar(out) < HAUNTS_AT_MOST + plan.floor) {
    out.monsterSpots.push([middle[0], middle[1], GHOST]);
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

/** The terrace a tile sits on, reading the plan's own array rather than a finished map. */
export function levelOf(plan: Dressable, x: number, z: number): number {
  const l = plan.levels[z * plan.size + x];
  return l === 0 ? BASE_LEVEL : l;
}
