import type { RoadGraph } from './graph';
import type { Simplex2D } from './noise';
import { couldHoldAVillage } from './structures';

/**
 * A road that is not a ruled line.
 *
 * The web is grown as straight runs between its nodes, and a road that is straight for as far as
 * the ground lets it be is what made every road in the world look like the same road — nothing in a
 * landscape is straight unless somebody surveyed it that way. But the surveyed line is also what
 * the rivers, the villages and the landmarks were laid out against, and bending *that* bends a
 * river across a village square. So the world keeps two distances to a road: the one it was built
 * on, and the one it is drawn with. This is the second.
 */

/** How far the drawn road leans off the surveyed line at most, in tiles, and how long a lean lasts. */
const WANDER = 5;
const WANDER_SCALE = 0.02;
/**
 * How far from water a road has to be before it may lean at all, in tiles, and how far from a
 * village.
 *
 * Water because a road bent seaward is a road under the sea, and a village nobody can walk to. A
 * village because its houses are set out against the surveyed line, and a road that leans while
 * they do not is a road through somebody's parlour. Both fade rather than switch, which is what
 * keeps the drawn line continuous.
 */
export const DRY_ENOUGH = 10;
const CLEAR_OF_TOWN = 26;

/**
 * How freely the road at each node may be drawn off its surveyed line, worked out once when the
 * world is stood up.
 *
 * A road is surveyed from its nodes, so that is where the questions are asked: how far is this
 * junction from water, and how far from a village? Far from both, and the road through it may
 * lean. Near either, and it may not — a lean towards a shore is a road under the sea, and a lean
 * through a village is a road through a parlour, because the houses were set out against the
 * surveyed line. In between it fades, which is what keeps the drawn line continuous: a road that
 * leaned right up to the beach and then stopped would have a step in it.
 *
 * A road-tree world has no coastline to fall off — land there is a band around the road itself,
 * several times wider than any lean — so only its villages hold it straight.
 */
export function wanderFactors(graph: RoadGraph, dryness: ((x: number, z: number) => number) | null): Float32Array {
  const out = new Float32Array(graph.nodes.length);
  // Every node a village could ever be set out on, which is a question the graph can answer
  // before the villages exist: the towns the web grew round, the hub, and the wide deep branches
  // the village placer chooses from. A road holds its surveyed line near all of them.
  const settled = graph.nodes.filter((n, i) => couldHoldAVillage(n) || graph.towns.includes(i));
  settled.push(graph.nodes[0]);
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    const dry = dryness ? Math.min(1, dryness(n.x, n.z)) : 1;
    let clear = 1;
    for (const town of settled) {
      clear = Math.min(clear, Math.hypot(town.x - n.x, town.z - n.z) / CLEAR_OF_TOWN);
      if (clear <= 0) break;
    }
    out[i] = Math.min(dry, clear);
  }
  return out;
}


/**
 * How far the drawn road stands off its surveyed line at a point, in tiles.
 *
 * The noise is read at the point rather than along the road, which is the trick that keeps the
 * drawing joined up: two roads meeting at a junction ask the field in the same place and are pushed
 * the same way, so a junction stays a junction.
 */
export function bendAt(free: number, noise: Simplex2D, x: number, z: number): number {
  return WANDER * free * noise.fbm(x * WANDER_SCALE, z * WANDER_SCALE, 2);
}
