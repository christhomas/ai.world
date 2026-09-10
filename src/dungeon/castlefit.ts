import { PropKind } from '../world/biomes';
import { FURNITURE_BLOCKS } from '../world/footprints';
import { DTile, reachable, type DungeonMap } from './map';

/**
 * The last check a generated floor goes through: can it still be finished?
 *
 * A plan can be correct and a castle still be broken, because a plan is about walls and a castle
 * is about what is standing between them. This file is the one thing standing between the plan and
 * the things that fill a tile — the treasure, and the furniture — and the trouble they cause.
 *
 * It began as a file about chests, because for a long time a chest was the only solid thing
 * underground: `DungeonWorld.blocked` knew about the treasure and about nothing else, so a
 * castle's tables, barrels and weapon racks were walked straight through. The moment they were
 * measured, they became walls — and a wall dropped in the wrong place is a room nobody can enter.
 * On the first floor built with solid furniture, seed 3 lost a hundred and forty-eight tiles.
 */

/** Every tile a chest is standing on, as flat indices. */
export const chestTiles = (map: DungeonMap): Set<number> =>
  new Set(map.chests.map((c) => c.z * map.size + c.x));

/**
 * The bars of a cell, which are a wall the dressing happens to put there.
 *
 * Kept out of everything below, and the distinction is the whole reason this is not one list. A
 * cell is *meant* to be shut: bars that could be nudged aside to open up the floor behind them
 * would be a gaol with the door left open, and the settle would do exactly that, because from up
 * here a sealed cell and a sealed wing look identical. So the bars are counted as part of the
 * plan — the floor they shut off was never on offer — and the furniture is charged against what
 * is left.
 */
const STRUCTURAL: ReadonlySet<PropKind> = new Set([PropKind.Bars]);

/** Every tile a stick of furniture fills, bars aside: what the dressing costs the floor. */
function furnitureTiles(map: DungeonMap): Set<number> {
  const out = new Set<number>();
  for (const f of map.furniture) {
    if (!FURNITURE_BLOCKS.has(f.kind) || STRUCTURAL.has(f.kind)) continue;
    out.add(f.z * map.size + f.x);
  }
  return out;
}

/** And the tiles the bars fill, which are treated as though the plan had drawn a wall there. */
function barTiles(map: DungeonMap): Set<number> {
  const out = new Set<number>();
  for (const f of map.furniture) if (STRUCTURAL.has(f.kind)) out.add(f.z * map.size + f.x);
  return out;
}

/**
 * The floor the plan itself offers: everywhere you could walk if the only solid things were the
 * walls and the bars of the cells.
 *
 * This is the promise the settle below is measured against, and it is exported because a test that
 * checks the promise has to be able to state it in the same terms. Furniture may not cost the
 * floor a single tile beyond this — but a cell may, and does, because a gaol you can walk out of
 * is a corner of a room. Two answers to "what is a floor meant to offer" is how a check and the
 * thing it checks end up disagreeing about whether a castle is broken.
 */
export function floorThePlanOffers(map: DungeonMap, climb: number): Uint8Array {
  return reachable(map, map.entrance, true, climb, barTiles(map));
}

/** Can the hero stand on, or next to, a tile? Standing next to one is how a chest is opened. */
export function beside(seen: Uint8Array, map: DungeonMap, x: number, z: number): boolean {
  const at = (px: number, pz: number) =>
    px >= 0 && pz >= 0 && px < map.size && pz < map.size && seen[pz * map.size + px] === 1;
  return at(x, z) || at(x + 1, z) || at(x - 1, z) || at(x, z + 1) || at(x, z - 1);
}

/**
 * Shuffle anything that has walled something off — or walled itself in — onto a neighbouring tile,
 * and take away what still will not fit.
 *
 * A chest fills its tile, and it has to, or you could stand inside the treasure. Furniture fills
 * its own measured box for the same reason a table indoors does. That makes both of them walls,
 * and it happened on the very first castle built: the great chest goes at the middle of the throne
 * room's dais, the dais runs the width of the room, and on a room whose one doorway came out on
 * the middle of that wall the chest sat squarely in the gap. The throne room, the boss and the
 * treasure were all behind it, and the floor plan looked perfectly connected.
 *
 * The first attempt only asked whether each chest could be walked up to, which that castle passed:
 * you could stand in the doorway and open it. What you could not do was get past it. So the
 * measure is what these things cost the floor — how much of it they shut off, and how many chests
 * nobody can reach — and one is nudged a tile at a time for as long as that number goes down.
 *
 * When nothing can be improved by a nudge, the last resort is to take a stick of furniture out.
 * Never a chest, which is somebody's reward, and never bars, which are a wall: a room with one
 * fewer barrel in it is a room, and a wing nobody can enter is not. It is rare — most of what goes
 * wrong is fixed by a single step sideways — and it is the difference between a floor that is
 * dressed and a floor that is dressed and finishable.
 *
 * `climb` is in terraces and belongs to whoever is walking; a parameter rather than a constant
 * here because this file is about what fills a tile and not about the hero.
 */
export function settleWhatFillsTiles(map: DungeonMap, climb: number): void {
  const bars = barTiles(map);
  // the baseline everything else is charged against: the plan, and the cells it drew
  const free = floorThePlanOffers(map, climb);
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    const chests = chestTiles(map);
    const taken = new Set([...chests, ...furnitureTiles(map), ...bars]);
    const held = reachable(map, map.entrance, true, climb, taken);
    const cost = damage(map, free, held, chests, taken);
    if (cost === 0) return;
    const guilty = inTheWay(map, free, held, chests, taken);
    if (nudge(map, free, chests, taken, guilty, cost, climb)) continue;
    if (clearOnePiece(map, free, chests, bars, guilty, cost, climb)) continue;
    if (!clearThemAll(map, free, chests, bars, guilty, cost, climb)) return;
  }
}

/**
 * Which of the things standing about is actually in the way.
 *
 * Everything below used to try every chest and every stick of furniture on the floor, take the
 * first move that made the number go down, and start again. On a floor with three chests that was
 * fine. On a dressed castle floor it is a hundred and thirty things, and the first improvement
 * found is almost never the one that matters: a barrel shuffled out of a doorway somewhere else
 * frees one tile, the pass is spent, and the wing with the treasure in it is still sealed when the
 * budget runs out. Measured on seed 11: eight tiles and a chest nobody could reach, forty passes
 * spent, none of them on the barrel doing it.
 *
 * So the candidates are the things touching the trouble — anything standing next to a tile that
 * has been shut off, or next to a chest that cannot be walked up to. That is a handful rather than
 * a hundred, which is what makes it affordable to try them all and keep the best rather than the
 * first.
 */
function inTheWay(
  map: DungeonMap, free: Uint8Array, held: Uint8Array,
  chests: ReadonlySet<number>, taken: ReadonlySet<number>,
): Set<number> {
  const trouble: number[] = [];
  for (let i = 0; i < free.length; i++) if (free[i] === 1 && held[i] === 0 && !taken.has(i)) trouble.push(i);
  for (const i of chests) {
    const x = i % map.size, z = (i - x) / map.size;
    if (!beside(held, map, x, z)) trouble.push(i);
  }
  const out = new Set<number>();
  const spread = (from: readonly number[]): number[] => {
    const found: number[] = [];
    for (const i of from) {
      const x = i % map.size, z = (i - x) / map.size;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = (z + dz) * map.size + (x + dx);
          if (taken.has(j) && !out.has(j)) { out.add(j); found.push(j); }
        }
      }
    }
    return found;
  };
  /*
   * And then along, from one to the next, because a line of them is one obstacle.
   *
   * A single ring round the trouble is not enough and the undercroft is why: its island is reached
   * by stepping stones one tile wide, and two barrels standing on that line seal it. Only the
   * nearer barrel touches the shut-off floor; the further one touches only the nearer, and taking
   * away the near one alone changes nothing at all, so nothing was ever taken away. Furniture that
   * touches guilty furniture is part of the same obstacle.
   *
   * Capped, because a wall lined with barrels would otherwise chain the length of a hall and put
   * the whole row on trial for a doorway at one end of it. Four is a causeway's worth.
   */
  let edge = spread(trouble);
  for (let step = 0; step < CHAIN_REACH && edge.length; step++) edge = spread(edge);
  return out;
}

/** How far along a line of furniture the blame is allowed to travel. */
const CHAIN_REACH = 4;

/** The old name, kept because a castle asks for this before it has any furniture to settle. */
export const settleChests = settleWhatFillsTiles;

/** Move whichever thing in the way is improved most by a step, and say whether any was. */
function nudge(
  map: DungeonMap, free: Uint8Array,
  chests: ReadonlySet<number>, taken: ReadonlySet<number>, guilty: ReadonlySet<number>,
  cost: number, climb: number,
): boolean {
  const movable: Array<{ x: number; z: number; move: (x: number, z: number) => void }> = [
    ...map.chests.map((c) => ({ x: c.x, z: c.z, move: (x: number, z: number) => { c.x = x; c.z = z; } })),
    ...map.furniture
      .filter((f) => FURNITURE_BLOCKS.has(f.kind) && !STRUCTURAL.has(f.kind))
      .map((f) => ({ x: f.x, z: f.z, move: (x: number, z: number) => { f.x = x; f.z = z; } })),
  ];
  let best: { move: (x: number, z: number) => void; x: number; z: number } | null = null;
  let bestCost = cost;
  for (const thing of movable) {
    const home = thing.z * map.size + thing.x;
    if (!guilty.has(home)) continue;                 // standing nowhere near the trouble
    for (const [dx, dz] of ROUND_ABOUT) {
      const nx = thing.x + dx, nz = thing.z + dz, i = nz * map.size + nx;
      if (nx < 1 || nz < 1 || nx >= map.size - 1 || nz >= map.size - 1) continue;
      if (map.tiles[i] !== DTile.Floor || taken.has(i)) continue;
      const trial = new Set(taken);
      trial.delete(home);
      trial.add(i);
      // a chest that moved is still a chest, so the set of chest tiles moves with it
      const trialChests = chests.has(home) ? new Set([...chests].filter((c) => c !== home)).add(i) : chests;
      const after = damage(map, free, reachable(map, map.entrance, true, climb, trial), trialChests, trial);
      if (after < bestCost) { bestCost = after; best = { move: thing.move, x: nx, z: nz }; }
    }
  }
  if (!best) return false;
  best.move(best.x, best.z);
  return true;
}

/**
 * Take out the one stick of furniture whose absence helps most, when nothing can be nudged.
 *
 * The last resort, and it is needed: a doorway one tile wide with a barrel in it has nowhere to
 * nudge the barrel *to*, because every neighbour is either rock or the room it is sealing. Tried
 * in order and the best kept rather than the first that helps — two barrels flanking a gap are
 * each harmless alone and impassable together, so removing whichever comes first in the list may
 * do nothing at all.
 */
function clearOnePiece(
  map: DungeonMap, free: Uint8Array, chests: ReadonlySet<number>, bars: ReadonlySet<number>,
  guilty: ReadonlySet<number>, cost: number, climb: number,
): boolean {
  let best = -1, bestCost = cost;
  for (let i = 0; i < map.furniture.length; i++) {
    const f = map.furniture[i];
    if (!FURNITURE_BLOCKS.has(f.kind) || STRUCTURAL.has(f.kind)) continue;
    if (!guilty.has(f.z * map.size + f.x)) continue;
    const without = map.furniture.filter((_, n) => n !== i);
    const taken = new Set([
      ...chests,
      ...without.filter((g) => FURNITURE_BLOCKS.has(g.kind) && !STRUCTURAL.has(g.kind)).map((g) => g.z * map.size + g.x),
      ...bars,
    ]);
    const after = damage(map, free, reachable(map, map.entrance, true, climb, taken), chests, taken);
    if (after < bestCost) { bestCost = after; best = i; }
  }
  if (best < 0) return false;
  map.furniture.splice(best, 1);
  return true;
}

/**
 * Take out every piece that is in the way at once, when taking them out one at a time does nothing.
 *
 * The case this exists for is a causeway. The drowned undercroft is an island of floor in a pool,
 * reached by a line of stepping stones a single tile wide, and the dressing is perfectly happy to
 * stand a barrel on one of them. Two barrels on that line, and neither can be nudged — every
 * neighbour is water — and removing either one on its own changes nothing at all, because the
 * other still seals the island. So the floor with the treasure on it was walled off by a pair of
 * barrels that each looked innocent, and seed 11 lost its undercroft, its chest and eight tiles.
 *
 * Blunt on purpose, and bounded: it only ever touches what is standing against the trouble, it is
 * the last thing tried, and it is undone if it does not help. A room short of two barrels reads as
 * a room; a room nobody can enter reads as nothing at all.
 */
function clearThemAll(
  map: DungeonMap, free: Uint8Array, chests: ReadonlySet<number>, bars: ReadonlySet<number>,
  guilty: ReadonlySet<number>, cost: number, climb: number,
): boolean {
  const before = map.furniture;
  const kept = before.filter((f) =>
    !FURNITURE_BLOCKS.has(f.kind) || STRUCTURAL.has(f.kind) || !guilty.has(f.z * map.size + f.x));
  if (kept.length === before.length) return false;
  const taken = new Set([
    ...chests,
    ...kept.filter((g) => FURNITURE_BLOCKS.has(g.kind) && !STRUCTURAL.has(g.kind)).map((g) => g.z * map.size + g.x),
    ...bars,
  ]);
  const after = damage(map, free, reachable(map, map.entrance, true, climb, taken), chests, taken);
  if (after >= cost) return false;
  map.furniture = kept;
  return true;
}

/**
 * What these things cost this floor: every tile shut off behind one, and a heavy price for any
 * chest that cannot be walked up to at all.
 *
 * The price is heavy on purpose — a chest nobody can open is worse than any amount of floor nobody
 * can reach, because the floor is at least still a castle. Only chests are charged that way: a
 * barrel you cannot walk up to is a barrel in a corner, which is where barrels go.
 */
function damage(
  map: DungeonMap, free: Uint8Array, held: Uint8Array,
  chests: ReadonlySet<number>, taken: ReadonlySet<number>,
): number {
  let n = 0;
  for (let i = 0; i < free.length; i++) if (free[i] === 1 && held[i] === 0 && !taken.has(i)) n++;
  for (const i of chests) {
    const x = i % map.size, z = (i - x) / map.size;
    if (!beside(held, map, x, z)) n += SHUT_IN;
  }
  return n;
}

/** Tiles a thing may be shuffled onto, nearest first. */
const ROUND_ABOUT: ReadonlyArray<readonly [number, number]> =
  [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/**
 * How many single moves are allowed before the arrangement is accepted as it stands.
 *
 * Was six, for a floor with two or three chests on it. A dressed castle floor has upwards of forty
 * solid sticks of furniture and a single doorway may want two of them moved, so the budget is what
 * a floor can actually need rather than what a treasure room needed. Each pass is one walk of the
 * floor per candidate and a floor is a hundred tiles square, so this is the expensive part of
 * generating a castle and is still under a tenth of a second.
 */
const SETTLE_PASSES = 40;

/** What one unopenable chest is worth in tiles of shut-off floor: more than a floor could hold. */
const SHUT_IN = 10000;
