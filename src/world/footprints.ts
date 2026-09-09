import type { PropKind } from './biomes';

/**
 * How much ground a prop takes up, as the things that walk round them need it.
 *
 * The measurements themselves are not here: they belong to the prop, and are worked out from the
 * parts it is written down as by `entities/shapes.ts`. What is here is the two rules that decide
 * what is measured and what the least of it may be — the walking band and the minimum block —
 * because they are rules about walking rather than facts about a shape, and because the worlds
 * that walk things need them and have never seen a prop drawn.
 *
 * There used to be a table of forty-six rows here, with a test that rebuilt every prop and failed
 * if a row had drifted. It was accurate and it was the wrong shape: a table is a second place the
 * truth is written, so a prop that was drawn and never listed had no box, blocked nothing, and
 * broke no test — the drift test could compare the rows it had and never notice the one that was
 * missing. Measuring cannot be short of a prop that exists.
 */

/** How much ground one prop takes up: half-extents in tiles, along its own axes, before turning. */
export interface Footprint {
  hw: number;
  hd: number;
}

/**
 * The footprint of every prop that blocks the way, by kind.
 *
 * A port rather than a table: the game reads the catalogue, the server reads the same catalogue,
 * and a test can hand over whatever it likes. Nothing in `world/` needs to know which of those it
 * is talking to, or whether anybody has drawn anything.
 */
export interface Footprints {
  get(kind: PropKind): Footprint | undefined;
}

/**
 * The footprints of the things that stop you in a particular world.
 *
 * Measuring says how big everything is; this says which of them you cannot walk through, and the
 * two are different questions with different answers in different places. A pew stops you in a
 * church and there are no pews on a hillside; a flower has a size everywhere and stops nobody.
 */
export function blocking(all: Footprints, which: ReadonlySet<PropKind>): Footprints {
  return { get: (kind) => (which.has(kind) ? all.get(kind) : undefined) };
}

/**
 * The band a walker meets, in world units: mid-shin to chest.
 *
 * This is what makes boxes usable rather than merely accurate. Below it are the things you step
 * onto — a doorstep, a plinth, a flagstone — and taking those would seal every door in the game,
 * which the first measurement duly did. Above it are the things you walk under: a tree's crown, a
 * stall's roof, a cottage's eaves. Taking whole bounding boxes would make a wood impassable, which
 * is the same bug arrived at from the other side.
 *
 * A face counts if it spans the band, not if it has a corner in it — a wall is a box whose only
 * vertices are at the floor and the ceiling, and measuring corners found no walls at all.
 */
export const WALKING_BAND = { low: 0.3, high: 1.4 } as const;

/**
 * The least ground any solid thing takes up, whatever it measures.
 *
 * Not a measurement — a rule, and the reason for it is that nobody can jump. A hero walks 0.058 of
 * a tile between frames, and the honest measurements include a signpost 0.04 thick, a fence rail at
 * 0.06 and a noticeboard at 0.1. A stride steps clean over those between one frame and the next, so
 * a thing you can plainly see is a thing you walk through — which is the whole complaint this began
 * with, in miniature.
 *
 * So everything solid is at least this much of an obstacle. It makes a signpost stubbier than it
 * looks; a fence you cannot walk through is worth more than a fence of exactly the right thickness
 * that you can. The measurements stay honest in the table above, and this is applied where the
 * boxes are built.
 */
export const MIN_BLOCK = 0.22;
