import { WORLD } from '../core/config';

/**
 * The world cut into provinces: the unit of keeping, loading and forgetting.
 *
 * A world with an edge can be one file and one simulation. A world without one cannot: the state a
 * player leaves behind — a field sown, a chest opened, a village that remembers being robbed — grows
 * with every place anybody has ever been, and no machine holds all of it at once. So the world is
 * cut into squares, and a square is what gets loaded when somebody walks into it and written down
 * when the last of them leaves.
 *
 * It is deliberately *not* the unit the country is generated in. Generation is settled by a bounded
 * neighbourhood and cares nothing for these lines — a face, a road or a town may lie across one, and
 * both provinces work out the same face because neither is asked to. Provinces are for the state
 * that cannot be derived: what has been changed, what has been remembered, who has died. Confusing
 * the two is how a world grows seams, so they are separate here by construction and the tests below
 * say so.
 *
 * They are also who an agent belongs to, which is the second job and was added later. A herd is one
 * province's business for its whole life — the province its *home* is in, not the one it happens to
 * be standing in — and nothing ever walks from one to another. That is what makes a province
 * something a machine can pick up on its own: the alternative is a wolf halfway across a border,
 * which means two provinces are alive for as long as the walk lasts and neither can be caught up
 * without the other. `provinceOfHome` and `PROVINCE_REACH` at the bottom are that rule.
 *
 * The size is a compromise with only two ends. Small provinces mean more files, more loading and
 * more flushing as somebody walks; large ones mean carrying country nobody is near. Five hundred and
 * twelve tiles is thirty-two chunks square — about a minute and a half of walking end to end, which
 * is long enough that arriving somewhere new is rare and short enough that a province is a few
 * kilobytes of anybody's leavings.
 */

/** How wide a province is, in tiles. A power of two, so the arithmetic is a shift and never a rounding. */
export const PROVINCE = 512;

/** A province's name: the two numbers it is made of, which is all anybody needs to find it again. */
export type ProvinceId = string;

/** Which province a place is in. Negative country included, which `Math.floor` gets right and `|0` does not. */
export function provinceOf(x: number, z: number): ProvinceId {
  return `${Math.floor(x / PROVINCE)}:${Math.floor(z / PROVINCE)}`;
}

/** The two numbers back out of the name. */
export function provinceAt(id: ProvinceId): { px: number; pz: number } {
  const [px, pz] = id.split(':').map(Number);
  return { px, pz };
}

/** The corner a province begins at, in tiles. */
export function provinceCorner(id: ProvinceId): { x: number; z: number } {
  const { px, pz } = provinceAt(id);
  return { x: px * PROVINCE, z: pz * PROVINCE };
}

/**
 * Every province within reach of a place, including the one it is in.
 *
 * `reach` is in tiles, and it is what decides how far in front of a player state is made ready. A
 * province is loaded before it is needed rather than as it is entered, because loading a file is a
 * thing that can be waited for and walking over a line is not.
 */
export function provincesNear(x: number, z: number, reach: number): ProvinceId[] {
  const lowX = Math.floor((x - reach) / PROVINCE), highX = Math.floor((x + reach) / PROVINCE);
  const lowZ = Math.floor((z - reach) / PROVINCE), highZ = Math.floor((z + reach) / PROVINCE);
  const out: ProvinceId[] = [];
  for (let pz = lowZ; pz <= highZ; pz++) {
    for (let px = lowX; px <= highX; px++) out.push(`${px}:${pz}`);
  }
  return out;
}

/**
 * How far ahead of somebody the state is kept ready, in tiles.
 *
 * A chunk's worth beyond the ground they can see. The ground is streamed at a radius of its own and
 * this is deliberately wider: arriving in a province whose leavings have not been read yet would
 * mean a field that is sown looking bare for a moment, which is the kind of flicker a player
 * remembers.
 */
export const KEEP_READY = WORLD.CHUNK_SIZE * (WORLD.UNLOAD_RADIUS + 2);

/**
 * Anything that belongs somewhere: a herd, a village, a den.
 *
 * Two numbers structurally rather than the `Herd` this is nearly always asked about, because
 * `world` may not import `entities` — the layer test allows two of those and both are already
 * spent — and because it should not want to. Which province a thing belongs to is a fact about a
 * pair of coordinates and nothing whatever about creatures.
 *
 * `readonly` is the load-bearing word. A `Herd`'s `homeX` and `homeZ` are readonly on the class,
 * fixed by the constructor and never assigned again, and that is the whole of why the answer below
 * cannot change under anybody.
 */
export interface Homed {
  readonly homeX: number;
  readonly homeZ: number;
}

/**
 * The province an agent belongs to, and the only answer to that question.
 *
 * It is deliberately *not* `provinceOf(e.x, e.z)`, which is the answer everything else would reach
 * for and is wrong. Where a creature is standing moves; a herd wanders, and a herd whose anchor
 * happens to drift eight tiles over a line would change hands twice a minute — which means two
 * provinces have to be loaded to know whose it is, and that is exactly the independence provinces
 * exist to buy. Where it *belongs* does not move, so this is settled once, when the herd is made,
 * and is the same answer on every machine that has ever seen it.
 *
 * Derived rather than stored for the usual reason: a copy of this on the herd would be a second
 * thing that can be wrong, and there is no third state for it to be in.
 */
export function provinceOfHome(home: Homed): ProvinceId {
  return provinceOf(home.homeX, home.homeZ);
}

/**
 * How far outside its own province an agent may stand, in tiles.
 *
 * Belonging to one province does not mean staying inside it, and it must not: a wolf that vanished
 * at an invisible line would be a far worse thing than anything this is fixing. A herd spawned
 * against a border grazes over it, and it is still its own province's business while it does. What
 * has to be true is that the overhang is *bounded*, because everything else rests on that.
 *
 * The window this has to sit in is narrower than it looks, and both ends are the game's numbers
 * rather than anybody's taste.
 *
 * The floor is seventy-six. The widest thing that lives in a province today is a villager of a hub:
 * his posts stand out to 1.9 times a village radius of 26, and the hours that are not postings let
 * him range up to another 26 about wherever the last one left him. A bound under that would put a
 * man outside the only province that knows who he is.
 *
 * The ceiling is a hundred, and it is `KEEP_READY` less `ACTIVE_RANGE`. A player is told about
 * creatures out to the range they are thought in; any one of those may be this far the wrong side
 * of its own line; and the province that owns it must already be to hand, or walking towards a
 * border means reading a file at the moment somebody can see over it. A hundred and forty-four
 * ready, forty-four of it spent on sight, and a hundred left. The other ceiling is half a province
 * — past 256 an agent could overhang a province that does not touch its own, and catching one up
 * would mean loading three — but sight is the binding one by a factor of two and a half.
 *
 * Ninety-six is six chunks, which is inside that window with four tiles to spare at the top and
 * twenty at the bottom. `provinces.test.ts` holds both ends to the game's own leashes, ranges and
 * village radii, so making a village twice as big — or telling a player about creatures further off
 * — is a failed build rather than a creature that quietly belongs nowhere.
 */
export const PROVINCE_REACH = 96;

/**
 * Do these two provinces touch — or are they the same one?
 *
 * The check that makes the bound above worth having. An agent may be outside its own province and
 * may not be *far* outside it, and "not far" said exactly is "in a province that shares a border or
 * a corner with the one it belongs to". Which is what lets a province be caught up on its own: the
 * ground its agents can reach is its own and its eight neighbours', and never a ninth.
 */
export function adjoins(a: ProvinceId, b: ProvinceId): boolean {
  const one = provinceAt(a), two = provinceAt(b);
  return Math.abs(one.px - two.px) <= 1 && Math.abs(one.pz - two.pz) <= 1;
}

/** Where a province's leavings are written. One file each, named as the province is. */
export function provincePath(dataDir: string, seed: number, id: ProvinceId): string {
  const { px, pz } = provinceAt(id);
  const stem = `${seed}/${px}_${pz}.json`;
  return dataDir ? `${dataDir}/${stem}` : stem;
}
