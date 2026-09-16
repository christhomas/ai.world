import { WORLD } from '../core/config';
import type { ChunkData } from './ground';
import { propSpot } from './propstream';

/**
 * How dark the ground goes where something else touches it.
 *
 * This world has no textures at all: every surface is one flat vertex colour, so light is the only
 * channel any detail can arrive through. Until this existed, nothing in the game went darker where
 * two surfaces met — the grass at the foot of a cliff was exactly as bright as the grass a hundred
 * tiles off, and the grass under a cottage was too. That is what makes a prop read as a sticker
 * laid on the map instead of a block sitting on it: a thing standing on the ground and a thing
 * painted on the ground look identical when neither of them costs the ground any light.
 *
 * ## Why this is baked rather than drawn
 *
 * The obvious answer is screen-space occlusion — a pass that reads the depth and normals of
 * whatever is actually on screen, sees the cart that moved and the door that opened, and darkens
 * the creases it finds. It is the better answer and it is not available yet: it needs a composer
 * to hang a pass on, which needs a seam between the scene graph and the renderer, which is two
 * other items' worth of work (#249, #250).
 *
 * What is available is the half of this world that already has no renderer in it. `world/mesher.ts`
 * hands out `MeshData` — positions, normals, colours, indices as plain typed arrays — and that is
 * deliberate: the server has to know the shape of the country without owning a graphics library.
 * A contact baked into those colours costs nothing per frame, needs no pipeline, and is identical
 * on every rig anybody ever writes, because it is in the mesh rather than in the drawing of it.
 *
 * What it cannot do is the moving half. A baked shade does not know that a hero is standing against
 * a wall or that a cart has been pushed across a yard, and it never will. It knows where the
 * country stands and where the things rooted in it are, which is most of what a person looks at.
 *
 * ## The shape of the answer
 *
 * One number per *tile corner*, not per tile. Corners are shared between the four tiles that meet
 * at them, so working them out once is what keeps two neighbouring quads agreeing about how dark
 * their join is — a per-tile answer would leave a grid of seams exactly where the eye is already
 * looking. Every corner of every tile of the chunk is covered, and every input a corner needs is
 * inside the chunk's own one-tile apron, so two chunks that share an edge compute the same numbers
 * for it from the same data and the join is invisible.
 */

/**
 * What stands about each corner of a chunk, and what sits on it.
 *
 * `stands` is the height of the tallest surface meeting that corner. `under` is what the props
 * rooted near it have already taken out of the light there. The two are kept apart because they
 * answer different questions: a step only darkens what is *below* it, so the first has to be
 * compared against the height of the surface being coloured, while a prop darkens the ground it
 * is planted on whatever height that ground happens to be.
 */
export interface ContactField {
  /** Corners across one row: `CHUNK_SIZE + 1`, because a row of N tiles has N + 1 corners. */
  readonly pitch: number;
  readonly stands: Float32Array;
  readonly under: Float32Array;
}

/**
 * How much light a full terrace of standing surface takes out of the ground at its foot.
 *
 * A third, which sounds like a great deal written down and is about right on screen: this is the
 * darkest line in a scene made entirely of flat colours, and if it is timid the terrace goes on
 * reading as a painted line rather than as a step you could sit on.
 */
const CREASE_DEPTH = 0.3;

/** The rise at which a crease is as dark as it gets. One terrace: past that a wall is just a wall. */
const CREASE_REACH = WORLD.STEP;

/**
 * How much light a prop takes out of the ground directly beneath it.
 *
 * Less than a crease, deliberately. A cliff meets the ground along a line and shuts the sky out of
 * it; a tree meets the ground at a trunk and the sky gets in all round, and a world where every
 * shrub sat in a black disc would read as a world of holes.
 *
 * Two numbers, because there are two sorts of thing standing in this country and they meet the
 * ground quite differently. Something somebody built has walls that come down to the grass the
 * whole way round and takes the light with them. Something that grew stands on a stem, and the
 * light gets in under it — a great deal of it under a sapling and rather less under an oak, which
 * is why the grown figure is multiplied by the size the prop was rolled at.
 *
 * The distinction is *depth* and not width, and that is a fact about the mesh rather than a
 * preference. The ground carries one vertex per tile corner, so the narrowest patch of shade it
 * can hold is about a tile across whatever is standing on it; a cottage's contact and an oak's
 * are the same size on this grid, and pretending otherwise would only move the numbers about
 * without moving a pixel.
 */
const GROWN_DEPTH = 0.22;
const PLANTED_DEPTH = 0.32;

/**
 * How far a contact reaches across the ground, and how much of that is full dark.
 *
 * A tile centre is 0.707 tiles from each of its own four corners, so anything under `CONTACT_CORE`
 * would leave a prop standing in the middle of its tile darkening precisely nothing: the corners
 * are the only places a colour can be put, and they are all further off than that. This is the
 * one number in the file set by where the vertices are rather than by how light behaves.
 *
 * `CONTACT_REACH` may not pass 1.25 tiles, and that is a hard limit rather than a taste: the chunk
 * carries one tile of apron, so the furthest-off prop it can see stands 1.25 tiles from a corner
 * on its edge. Reach past that and a tree on one side of a chunk join stops darkening ground on
 * the other, which is a visible seam running the length of every chunk in the world.
 */
const CONTACT_CORE = 0.72;
const CONTACT_REACH = 1.2;

/** No contact, however many things meet at one corner, takes more than this much of the light. */
const DARKEST = 0.55;

/**
 * Work out the contacts of one chunk.
 *
 * Two passes over the apron and nothing clever. The first reads the corner heights the terrain
 * already carries and keeps the tallest surface at each corner; the second walks every tile the
 * chunk holds, including its apron, and stamps whatever is rooted there onto the corners within
 * reach of it.
 */
export function contactField(chunk: ChunkData, seed: number): ContactField {
  const CS = WORLD.CHUNK_SIZE;
  const pitch = CS + 1;
  const stands = new Float32Array(pitch * pitch).fill(-Infinity);
  const under = new Float32Array(pitch * pitch).fill(1);

  // which corner of a tile sits at which of its four (x, z) offsets: 0 = NW, 1 = NE, 2 = SE, 3 = SW
  const OFFSETS: readonly [number, number, number][] = [[0, 0, 0], [1, 0, 1], [1, 1, 2], [0, 1, 3]];

  for (let lz = -1; lz <= CS; lz++) {
    for (let lx = -1; lx <= CS; lx++) {
      const i = (lz + 1) * chunk.size + (lx + 1);
      for (const [dx, dz, k] of OFFSETS) {
        const cx = lx + dx, cz = lz + dz;
        if (cx < 0 || cz < 0 || cx > CS || cz > CS) continue;
        const y = chunk.corners[i * 4 + k];
        const at = cz * pitch + cx;
        if (y > stands[at]) stands[at] = y;
      }

      const spot = propSpot(chunk, seed, lx, lz);
      if (!spot) continue;
      const depth = spot.planted ? PLANTED_DEPTH : GROWN_DEPTH * spot.scale;
      // the prop's world position, back in the chunk's own tile coordinates
      const px = spot.x - chunk.cx * CS, pz = spot.z - chunk.cz * CS;
      const lo = Math.max(0, Math.ceil(px - CONTACT_REACH)), hi = Math.min(CS, Math.floor(px + CONTACT_REACH));
      const loz = Math.max(0, Math.ceil(pz - CONTACT_REACH)), hiz = Math.min(CS, Math.floor(pz + CONTACT_REACH));
      for (let cz = loz; cz <= hiz; cz++) {
        for (let cx = lo; cx <= hi; cx++) {
          const gap = Math.hypot(cx - px, cz - pz);
          if (gap >= CONTACT_REACH) continue;
          // full dark under the thing itself, then off to nothing across the rest of the reach
          const close = Math.min(1, (CONTACT_REACH - gap) / (CONTACT_REACH - CONTACT_CORE));
          under[cz * pitch + cx] *= 1 - depth * close;
        }
      }
    }
  }
  return { pitch, stands, under };
}

/**
 * How much of its colour a surface keeps at one corner, as a multiplier on the light.
 *
 * `y` is the height of the surface being coloured at that corner, and it is the whole of what makes
 * this a contact rather than a smear. Occlusion comes from above: ground at the foot of a step has
 * a terrace standing over it and goes dark, ground at the top of the same step is a convex edge
 * with the whole sky on it and does not move — and both of those are the same corner, asked twice.
 *
 * A wall face gets its gradient out of the same question for free. Its top vertices sit level with
 * the ground above, so they are asked about a surface nothing stands over and come back unchanged;
 * its foot sits a drop below and comes back darkened by exactly the amount the ground it lands on
 * is darkened by, so the wall and the floor agree along the crease to the last bit instead of
 * meeting at a step in the shading.
 */
export function contactShade(field: ContactField, cx: number, cz: number, y: number): number {
  const at = cz * field.pitch + cx;
  const rise = field.stands[at] - y;
  const crease = rise <= 0 ? 1 : 1 - CREASE_DEPTH * Math.min(1, rise / CREASE_REACH);
  return Math.max(DARKEST, crease * field.under[at]);
}
