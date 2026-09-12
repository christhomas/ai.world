import { box, cone, cyl, type PropPart } from './shapes';

/**
 * What a building site looks like on each of the mornings before it is finished.
 *
 * A house has had four states since the first one was commissioned — pegs and string, a frame open
 * to the weather, walls with the rafters on, and a cottage — and the reason it has four is the
 * reason this file exists: a building that appears on the last day is a purchase, and one you can
 * ride past twice and see changed is a thing being built. Everything else a builder could be told
 * to put up was pegs and string until its last morning, or in the case of a second storey nothing
 * whatever, which made three of the four entries in the catalogue a wait with nothing to look at.
 *
 * So each kind gets its own three states, told in the order the work is actually done in. A pool is
 * marked out, dug, and lined with dry stone before there is any water in it. A fountain is a circle
 * struck in the turf, a basin bedded on sand, and a column standing over a dry bowl. A storey is
 * timber delivered, a scaffold round the house, and a scaffold a lift higher with a hoist on it —
 * which is the honest answer to a job that has no site of its own, because the thing being altered
 * is the house that is already standing there and a frame drawn inside it would be a lie.
 *
 * They are part lists rather than props for the same reason the cottage and the chapel are: what a
 * thing is made of is data, and `props.ts` is the one place that says which number it is drawn
 * under. That file was also twenty lines from the length at which nothing in this game is allowed
 * to stay readable, and a building site is a subject in its own right.
 */

/**
 * The timber, stone and twine every site in this file is built out of.
 *
 * One palette across all four kinds, because one village's builder puts all four of them up: a
 * fountain rising out of stone nobody used on the house next to it would read as having arrived
 * from somewhere else rather than having been made here.
 */
const CUT = 0x6b4a2b;
const TIMBER = 0x8a6238;
const TWINE = 0xd8cfb4;
const STONE = 0x8f8f8f;
const DRESSED = 0xb4b4aa;
const SPOIL = 0x6b5540;
const TURF_LIFTED = 0x5b4a33;
const TANK = 0xbfae90;
const LIP = 0xd9cbb0;
const BASIN = 0x9a9a92;
/** Stone that has been laid and is still dry, which is the whole point of the stage before the last. */
const DRY = 0x8a8478;
const SLATE = 0x6e6e6e;

/**
 * A ladder leaning against something, given where its foot stands and how far it is tipped.
 *
 * Written once because two of the three storey stages want one and a builder only owns the one
 * ladder. `lean` is the angle off vertical in radians, and the rungs are placed along the leaning
 * axis rather than level, which is the difference between a ladder and a fence somebody has
 * dropped: the rungs have to stay square to the stiles when the whole thing tips.
 */
function ladder(x: number, z: number, lean: number): PropPart[] {
  const tilt: [number, number, number] = [lean, 0, 0];
  const middle = 1.3;
  const parts = [
    box(0.06, 2.6, 0.06, CUT, [x - 0.22, middle, z], [1, 1, 1], tilt),
    box(0.06, 2.6, 0.06, CUT, [x + 0.22, middle, z], [1, 1, 1], tilt),
  ];
  for (const along of [-1.0, -0.5, 0, 0.5, 1.0]) {
    parts.push(box(0.5, 0.05, 0.05, CUT, [
      x, middle + along * Math.cos(lean), z + along * Math.sin(lean),
    ], [1, 1, 1], tilt));
  }
  return parts;
}

/*
 * A house of the player's own, in the four states somebody riding past would recognise it in.
 *
 * They are built to the same 3x3 footprint and the same colours as the world's own cottages, so a
 * finished one belongs in the landscape rather than looking like a game object dropped on it — but
 * with a plain stone chimney the village houses do not have, because the one house that is yours
 * should be findable from the ridge without opening the map. The finished cottage itself is
 * `buildings.ts`'s `house`, with that chimney added; only the three unfinished states are here.
 */

/** Pegs and string: four corner stakes and a line between them, which is all a site is on day one. */
export const housePegs: PropPart[] = [
  ...([[-1.3, -1.3], [1.3, -1.3], [1.3, 1.3], [-1.3, 1.3]] as const).map(([x, z]) =>
    cyl(0.05, 0.07, 0.55, 5, CUT, [x, 0.27, z])),
  box(2.6, 0.02, 0.02, TWINE, [0, 0.5, -1.3]),
  box(2.6, 0.02, 0.02, TWINE, [0, 0.5, 1.3]),
  box(0.02, 0.02, 2.6, TWINE, [-1.3, 0.5, 0]),
  box(0.02, 0.02, 2.6, TWINE, [1.3, 0.5, 0]),
  box(1.1, 0.14, 0.5, CUT, [0.6, 0.07, 1.0]),
];

/** The frame: a sill on the ground and four uprights, open to the weather. */
export const houseFrame: PropPart[] = [
  box(2.6, 0.2, 2.6, CUT, [0, 0.1, 0]),
  ...([[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]] as const).map(([x, z]) =>
    box(0.18, 1.7, 0.18, TIMBER, [x, 0.85, z])),
  box(2.4, 0.14, 0.14, TIMBER, [0, 1.7, -1.1]),
  box(2.4, 0.14, 0.14, TIMBER, [0, 1.7, 1.1]),
  box(0.14, 0.14, 2.4, TIMBER, [-1.1, 1.7, 0]),
  box(0.14, 0.14, 2.4, TIMBER, [1.1, 1.7, 0]),
  box(0.1, 1.9, 0.1, CUT, [1.6, 0.95, -1.5], [1, 1, 1], [0, 0, 0.3]),
];

/** Walls up and the rafters on, but no slates: the state a house spends the longest in. */
export const houseRoof: PropPart[] = [
  box(2.6, 0.2, 2.6, CUT, [0, 0.1, 0]),
  box(2.4, 1.5, 2.4, 0xf1e4c8, [0, 0.95, 0]),
  box(0.08, 0.95, 0.62, 0x3a2a1a, [1.22, 0.68, 0]),
  ...([-1.0, -0.5, 0, 0.5, 1.0]).map((z) =>
    box(0.1, 1.5, 0.1, TIMBER, [-0.62, 2.3, z], [1, 1, 1], [0, 0, -0.72])),
  ...([-1.0, -0.5, 0, 0.5, 1.0]).map((z) =>
    box(0.1, 1.5, 0.1, TIMBER, [0.62, 2.3, z], [1, 1, 1], [0, 0, 0.72])),
  box(0.12, 0.12, 2.8, TIMBER, [0, 2.75, 0]),
  box(0.45, 1.2, 0.45, STONE, [-0.8, 1.3, 0]),
];

/**
 * The chimney that says which house is yours, at the height the roof it comes out of stands.
 *
 * A function of the storey count rather than two written-out stacks, because the wall it rises
 * through grows by a floor and the stack has to grow with it. This is the one part of a
 * commissioned house that `buildings.ts` does not already draw.
 */
export function chimney(storeys = 1): PropPart[] {
  const lift = (storeys - 1) * 1.2;
  return [
    box(0.5, 1.5, 0.5, STONE, [-0.8, 2.2 + lift, 0]),
    box(0.62, 0.16, 0.62, SLATE, [-0.8, 2.95 + lift, 0]),
  ];
}

/*
 * A bathing pool, which is a hole before it is anything else.
 *
 * The order is the order a man with a spade would do it in, and that is what makes the three worth
 * riding past: an oblong of string on the grass, then an open hole with the spoil banked round it,
 * then a dry stone tank with one side still to cope. Nothing is drawn as a pool with less water in
 * it, because a pool half full is a pool that leaks rather than a pool being built.
 */

/** Marked out: pegs, string, the turf inside them lifted, and the first spade of it heaped up. */
export const poolMarked: PropPart[] = [
  ...([[-1.55, -1.35], [1.55, -1.35], [1.55, 1.35], [-1.55, 1.35]] as const).map(([x, z]) =>
    cyl(0.05, 0.07, 0.55, 5, CUT, [x, 0.27, z])),
  box(3.1, 0.02, 0.02, TWINE, [0, 0.5, -1.35]),
  box(3.1, 0.02, 0.02, TWINE, [0, 0.5, 1.35]),
  box(0.02, 0.02, 2.7, TWINE, [-1.55, 0.5, 0]),
  box(0.02, 0.02, 2.7, TWINE, [1.55, 0.5, 0]),
  box(2.8, 0.06, 2.4, TURF_LIFTED, [0, 0.03, 0]),
  // the first spit of it heaped inside the string, because a pool stands three tiles off a house
  // and a spoil heap thrown outside the marking would be against somebody's wall
  cone(0.44, 0.36, 6, SPOIL, [-0.9, 0.18, 0.55]),
];

/** Dug: the floor of the hole, the spoil banked all the way round it, and a plank to get out by. */
export const poolDug: PropPart[] = [
  box(3.0, 0.08, 2.6, 0x3f3528, [0, 0.04, 0]),
  box(3.5, 0.34, 0.3, SPOIL, [0, 0.17, 1.5]),
  box(3.5, 0.34, 0.3, SPOIL, [0, 0.17, -1.5]),
  box(0.3, 0.34, 2.7, SPOIL, [1.6, 0.17, 0]),
  box(0.3, 0.34, 2.7, SPOIL, [-1.6, 0.17, 0]),
  box(1.2, 0.06, 0.5, TIMBER, [1.3, 0.24, 0.6], [1, 1, 1], [0, 0, -0.18]),
  // and the stone that will line it, dressed and stacked on the bank it was tipped over
  box(0.7, 0.14, 0.5, TANK, [-1.55, 0.41, -0.9]),
  box(0.6, 0.12, 0.42, TANK, [-1.55, 0.54, -0.9]),
];

/** Lined: the tank built and dry, three sides coped and the last slabs stacked by the fourth. */
export const poolLined: PropPart[] = [
  box(3.0, 0.24, 2.6, TANK, [0, 0.12, 0]),
  box(2.4, 0.06, 2.0, DRY, [0, 0.2, 0]),
  box(0.3, 0.34, 2.6, LIP, [1.5, 0.3, 0]),
  box(0.3, 0.34, 2.6, LIP, [-1.5, 0.3, 0]),
  box(3.0, 0.34, 0.3, LIP, [0, 0.3, 1.3]),
  box(2.2, 0.34, 0.3, LIP, [-0.4, 0.3, -1.3]),
  box(0.62, 0.16, 0.44, LIP, [1.35, 0.08, -1.72]),
  box(0.56, 0.14, 0.38, LIP, [1.35, 0.23, -1.72]),
];

/*
 * A fountain, which is two days and therefore three things worth looking at rather than four.
 *
 * The smallest job in the catalogue and the one most likely to be missed altogether, so what it
 * shows has to be legible from the road at a glance: a circle on the grass, a stone ring, and then
 * a column standing over a bowl with nothing coming out of it. The water is the last thing, which
 * is also true of a real one — the pipe is connected after the mason has gone.
 */

/** Struck out: the round scored into the turf with a peg and a line, and the sand it beds on. */
export const fountainMarked: PropPart[] = [
  cyl(1.2, 1.2, 0.04, 10, TURF_LIFTED, [0, 0.02, 0]),
  cyl(0.05, 0.07, 0.5, 5, CUT, [0, 0.25, 0]),
  box(1.15, 0.02, 0.02, TWINE, [0.58, 0.48, 0]),
  cone(0.38, 0.32, 6, 0xcfc0a0, [1.3, 0.16, 0.6]),
];

/** Bedded: the basin laid and dry, with the column's stone dressed and stacked beside it. */
export const fountainBasin: PropPart[] = [
  cyl(1.05, 1.15, 0.34, 10, BASIN, [0, 0.17, 0]),
  cyl(0.92, 0.92, 0.06, 10, DRY, [0, 0.34, 0]),
  box(0.44, 0.3, 0.44, DRESSED, [1.45, 0.15, 0.55]),
  box(0.38, 0.26, 0.38, DRESSED, [1.45, 0.43, 0.55]),
];

/** Standing and dry: everything built, nothing running, and a bucket for what the pipe cannot do yet. */
export const fountainDry: PropPart[] = [
  cyl(1.05, 1.15, 0.34, 10, BASIN, [0, 0.17, 0]),
  cyl(0.92, 0.92, 0.06, 10, DRY, [0, 0.34, 0]),
  cyl(0.2, 0.26, 0.9, 8, DRESSED, [0, 0.75, 0]),
  cyl(0.42, 0.1, 0.16, 10, DRESSED, [0, 1.24, 0]),
  cyl(0.15, 0.12, 0.26, 8, CUT, [1.35, 0.13, 0.5]),
];

/*
 * A second storey, which is the awkward one and was drawn as nothing at all for exactly that reason.
 *
 * Every other job in the catalogue stands on ground of its own. A storey shares its tile with the
 * finished cottage it is being added to — both are drawn, because both are commissions — so
 * anything put here is seen *through and around* a house that is already standing. A frame would
 * therefore be a timber skeleton inside a room a player can walk into, which is why nothing was
 * the honest answer for as long as the only idea was a frame.
 *
 * Scaffolding is the answer that was missing. It goes round the outside of a building rather than
 * inside it, it is unmistakably work being done to something that is already there, and it comes
 * down on the last morning leaving the house a floor taller — which is precisely what finishing
 * this job does. The poles stand clear of the eaves at 1.72 out, because the roof is three tiles
 * across and a pole through it would be worse than no pole at all.
 */

/** The makings, delivered: cut timber stacked clear of the door, and the ladder against the gable. */
export const storeyTimber: PropPart[] = [
  box(2.4, 0.16, 0.5, TIMBER, [-0.2, 0.08, -1.95]),
  box(2.4, 0.16, 0.5, TIMBER, [-0.2, 0.24, -1.95]),
  box(2.2, 0.16, 0.46, TIMBER, [-0.2, 0.4, -1.95]),
  // a beam across two legs to cut it on, which is a builder's whole workshop out of doors
  box(1.6, 0.12, 0.16, CUT, [0.9, 0.7, 1.85]),
  box(0.1, 0.7, 0.1, CUT, [0.3, 0.35, 1.85]),
  box(0.1, 0.7, 0.1, CUT, [1.5, 0.35, 1.85]),
  ...ladder(0.6, -1.75, 0.28),
];

/**
 * The corner poles of a scaffold, and the ledgers that tie them together at a working height.
 *
 * Both standing stages are the same idea at two heights, so the parts are made rather than written
 * out twice: the difference between a scaffold at eaves height and one that has gone a lift above
 * the ridge is two numbers, and writing it twice would let the two drift apart.
 */
function scaffold(height: number, lifts: readonly number[]): PropPart[] {
  const out = ([[-1.72, -1.72], [1.72, -1.72], [1.72, 1.72], [-1.72, 1.72]] as const).map(([x, z]) =>
    cyl(0.07, 0.08, height, 6, CUT, [x, height / 2, z]));
  for (const at of lifts) {
    out.push(box(3.6, 0.08, 0.08, CUT, [0, at, -1.72]));
    out.push(box(3.6, 0.08, 0.08, CUT, [0, at, 1.72]));
    out.push(box(0.08, 0.08, 3.44, CUT, [-1.72, at, 0]));
    out.push(box(0.08, 0.08, 3.44, CUT, [1.72, at, 0]));
  }
  return out;
}

/** Up: poles to the eaves, ledgers round all four sides, and a plank walkway on the door side. */
export const storeyScaffold: PropPart[] = [
  ...scaffold(3.2, [1.75, 2.95]),
  box(0.55, 0.05, 3.44, TIMBER, [1.72, 1.8, 0]),
  ...ladder(0.6, -1.95, 0.24),
];

/** A lift higher: a second walkway over the ridge, a hoist beam, and slates stacked to go back on. */
export const storeyRaised: PropPart[] = [
  ...scaffold(4.4, [1.75, 2.95, 4.1]),
  box(0.55, 0.05, 3.44, TIMBER, [1.72, 1.8, 0]),
  box(0.55, 0.05, 3.44, TIMBER, [-1.72, 3.0, 0]),
  // the beam the new floor's timbers come up on, with a rope hanging off the end of it
  box(1.4, 0.1, 0.1, TIMBER, [1.05, 4.3, 0]),
  box(0.03, 1.1, 0.03, TWINE, [0.4, 3.75, 0]),
  box(0.5, 0.12, 0.7, SLATE, [-1.72, 3.09, 0.5]),
  box(0.46, 0.1, 0.62, SLATE, [-1.72, 3.23, 0.5]),
  ...ladder(0.6, -1.95, 0.24),
];
