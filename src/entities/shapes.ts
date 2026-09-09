import { WALKING_BAND, type Footprint } from '../world/footprints';

/**
 * The parts a prop is made of, and how much ground a list of them comes to.
 *
 * A prop used to be a list of `THREE` primitives. That made the drawing and the shape the same
 * thing, which was the point — but it also meant that *knowing how big a prop is* required a
 * renderer, so the world server, which draws nothing and owns where everybody is standing, had a
 * 3D library rolled into its container image to measure a cottage with.
 *
 * Creatures had already solved this: `entities/animals.ts` is part lists — shape, size, offset,
 * colour — and the renderer turns them into geometry, so a wolf's `body` box falls out of the same
 * data the wolf is drawn from and anything at all can read it. This is that vocabulary for props.
 * The renderer builds `THREE` geometry out of these (`render/geometry.ts`); the box below is
 * worked out from the same numbers with no renderer in the room.
 *
 * The arguments are in the order the `THREE` constructors took them, deliberately: the catalogue
 * was converted from primitives to data a line at a time, and keeping the numbers in the same
 * order is what made that conversion something a person could check by eye.
 */

export type PropShape = 'box' | 'cyl' | 'cone' | 'ico' | 'dodec' | 'prism';

export interface PropPart {
  shape: PropShape;
  /**
   * box, prism: `[width, height, depth]`
   * cyl: `[radiusTop, radiusBottom, height, faces]`
   * cone: `[radius, height, faces]`
   * ico, dodec: `[radius, detail]`
   *
   * `faces` and `detail` are part of the size because they are part of the shape: a six-sided
   * trunk is 0.87 of its radius across one way and the full radius the other, and that difference
   * is what you walk into. A round prop measured as though it were round would be wider than the
   * one on the screen.
   */
  size: number[];
  /** Part centre relative to the prop's own middle, which is where it is planted. A prism's is the middle of its base. */
  offset: [number, number, number];
  color: number;
  scale?: [number, number, number];
  /** Euler angles in radians, applied Z then Y then X — the order `THREE.Euler` defaults to. */
  rot?: [number, number, number];
}

type Placed = [number, number, number];
type Extras = [scale?: [number, number, number], rot?: [number, number, number]];
interface Turned { scale?: [number, number, number]; rot?: [number, number, number] }

const extras = (scale?: [number, number, number], rot?: [number, number, number]): Turned => {
  const out: Turned = {};
  if (scale) out.scale = scale;
  if (rot) out.rot = rot;
  return out;
};

export const box = (w: number, h: number, d: number, color: number, offset: Placed, ...rest: Extras): PropPart =>
  ({ shape: 'box', size: [w, h, d], offset, color, ...extras(...rest) });
export const cyl = (rTop: number, rBottom: number, h: number, faces: number, color: number, offset: Placed, ...rest: Extras): PropPart =>
  ({ shape: 'cyl', size: [rTop, rBottom, h, faces], offset, color, ...extras(...rest) });
export const cone = (r: number, h: number, faces: number, color: number, offset: Placed, ...rest: Extras): PropPart =>
  ({ shape: 'cone', size: [r, h, faces], offset, color, ...extras(...rest) });
export const ico = (r: number, detail: number, color: number, offset: Placed, ...rest: Extras): PropPart =>
  ({ shape: 'ico', size: [r, detail], offset, color, ...extras(...rest) });
export const dodec = (r: number, detail: number, color: number, offset: Placed, ...rest: Extras): PropPart =>
  ({ shape: 'dodec', size: [r, detail], offset, color, ...extras(...rest) });
/** Triangular prism with the ridge along z, base at the offset's y: every pitched roof in the game. */
export const prism = (w: number, h: number, d: number, color: number, offset: Placed): PropPart =>
  ({ shape: 'prism', size: [w, h, d], offset, color });

/** The golden ratio, which is the whole of an icosahedron and most of a dodecahedron. */
const PHI = (1 + Math.sqrt(5)) / 2;

/** The corners of the two round solids, written as their constructors write them, at radius 1. */
function solidCorners(shape: 'ico' | 'dodec'): Placed[] {
  const raw: Placed[] = shape === 'ico'
    ? [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
       [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
       [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]]
    : [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
       [0, -1 / PHI, -PHI], [0, -1 / PHI, PHI], [0, 1 / PHI, -PHI], [0, 1 / PHI, PHI],
       [-1 / PHI, -PHI, 0], [-1 / PHI, PHI, 0], [1 / PHI, -PHI, 0], [1 / PHI, PHI, 0],
       [-PHI, 0, -1 / PHI], [PHI, 0, -1 / PHI], [-PHI, 0, 1 / PHI], [PHI, 0, 1 / PHI]];
  return raw.map(unit);
}

function unit([x, y, z]: Placed): Placed {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

function gap(a: Placed, b: Placed): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The faces of a round solid, at radius 1.
 *
 * Found rather than tabulated, so there is no index table copied out of the library to get wrong.
 * An icosahedron's faces are its triples of mutually neighbouring corners, and a neighbour is one
 * an edge away, and an edge is the shortest gap there is. A dodecahedron is the icosahedron's
 * dual, so its twelve faces point exactly where an icosahedron's twelve corners are, and each is
 * the five corners furthest along that direction.
 *
 * `detail` subdivides, which only the icosahedron is ever asked for: at 1 every edge gains its
 * midpoint and every face becomes four, all pushed back out onto the sphere. That is why a
 * detail-1 ball reaches its full radius along each axis and a detail-0 one stops at 0.851 of it.
 * Nothing in the game is drawn smoother than that, and anything that asks for smoother says so
 * here rather than quietly getting a box that is the wrong size.
 */
function solidFaces(shape: 'ico' | 'dodec', detail: number): Placed[][] {
  const corners = solidCorners(shape);
  if (shape === 'dodec') {
    if (detail !== 0) throw new Error(`a dodecahedron at detail ${detail}: only 0 is drawn in this game, and only 0 can be measured`);
    return solidCorners('ico').map((n) =>
      [...corners].sort((a, b) => dot(b, n) - dot(a, n)).slice(0, 5));
  }
  if (detail > 1) throw new Error(`an icosahedron at detail ${detail}: only 0 and 1 are drawn in this game, and only those can be measured`);
  let edge = Infinity;
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) edge = Math.min(edge, gap(corners[i], corners[j]));
  }
  const near = (a: Placed, b: Placed) => gap(a, b) < edge + 1e-9;
  const faces: Placed[][] = [];
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      if (!near(corners[i], corners[j])) continue;
      for (let k = j + 1; k < corners.length; k++) {
        if (near(corners[i], corners[k]) && near(corners[j], corners[k])) faces.push([corners[i], corners[j], corners[k]]);
      }
    }
  }
  if (detail === 0) return faces;
  return faces.flatMap(([a, b, c]) => {
    const [ab, bc, ca] = [middle(a, b), middle(b, c), middle(c, a)];
    return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
  });
}

const dot = (a: Placed, b: Placed): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const middle = (a: Placed, b: Placed): Placed => unit([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);

/**
 * The pieces of one part that the walking band is asked about separately, in the prop's own space.
 *
 * Most of a prop is measured whole. A box, a prism, a barrel, a fir: every side of those runs the
 * full height of the part, so the moment any of it reaches the band, a face that is as wide as the
 * part is wide has reached it too, and asking about the sides one at a time would give the same
 * answer more slowly.
 *
 * A ball is the exception, and it is not a small one. A crown of leaves can have its widest point
 * over your head and its underside at your knee, and only the underside is anything you could walk
 * into — so the round solids are asked face by face. A birch is the prop that says so: its two
 * crowns hang just far enough down to clip the top of the band, and measured whole rather than
 * face by face it is 6cm wider than the tree that is drawn.
 */
function partPieces(p: PropPart): Placed[][] {
  switch (p.shape) {
    case 'box': {
      const [w, h, d] = p.size;
      const out: Placed[] = [];
      for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) for (const z of [-d / 2, d / 2]) out.push([x, y, z]);
      return [out];
    }
    case 'cyl': return [ring(p.size[0], p.size[1], p.size[2], p.size[3])];
    case 'cone': return [ring(0, p.size[0], p.size[1], p.size[2])];
    case 'ico':
    case 'dodec': {
      const r = p.size[0];
      return solidFaces(p.shape, p.size[1]).map((face) => face.map(([x, y, z]): Placed => [x * r, y * r, z * r]));
    }
    case 'prism': {
      const [w, h, d] = p.size;
      const [x, z] = [w / 2, d / 2];
      // base square and the two ends of the ridge; y runs from the base rather than the middle
      return [[[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [0, h, -z], [0, h, z]]];
    }
  }
}

/** The corners of a cylinder's two rings, at the angles `THREE` puts them: x on the sine, z on the cosine. */
function ring(rTop: number, rBottom: number, h: number, faces: number): Placed[] {
  const out: Placed[] = [];
  for (let i = 0; i < faces; i++) {
    const theta = (i / faces) * Math.PI * 2;
    const [s, c] = [Math.sin(theta), Math.cos(theta)];
    out.push([rTop * s, h / 2, rTop * c], [rBottom * s, -h / 2, rBottom * c]);
  }
  return out;
}

/** One part's corners where they actually end up: scaled, turned, and planted on the prop. */
export function partPoints(p: PropPart): Placed[] {
  return placedPieces(p).flat();
}

function placedPieces(p: PropPart): Placed[][] {
  const [sx, sy, sz] = p.scale ?? [1, 1, 1];
  const [rx, ry, rz] = p.rot ?? [0, 0, 0];
  const [cx, cy, cz] = [Math.cos(rx), Math.cos(ry), Math.cos(rz)];
  const [nx, ny, nz] = [Math.sin(rx), Math.sin(ry), Math.sin(rz)];
  return partPieces(p).map((piece) => piece.map(([lx, ly, lz]): Placed => {
    // scale, then turn, then plant: the same matrix the renderer composes for the mesh
    let [x, y, z] = [lx * sx, ly * sy, lz * sz];
    [x, y] = [x * cz - y * nz, x * nz + y * cz];
    [x, z] = [x * cy + z * ny, -x * ny + z * cy];
    [y, z] = [y * cx - z * nx, y * nx + z * cx];
    return [x + p.offset[0], y + p.offset[1], z + p.offset[2]];
  }));
}

/**
 * How much ground a prop takes up: the half-extents of everything in it a walker would meet.
 *
 * This is the answer the old measurement gave by rebuilding the mesh and reading its triangles
 * back — the same numbers to six decimal places for every prop in the game, the seventh being
 * where the mesh's single-precision vertices and this arithmetic part company.
 * `world/footprints.test.ts` holds the two side by side, so a shape added to the catalogue that
 * the drawing and the measuring disagree about is a failing test rather than a wall the player
 * cannot see.
 *
 * Only what reaches into the walking band counts — see `WALKING_BAND`, which explains why the band
 * and not the whole prop. A piece counts if any of it is in there rather than if a corner of it
 * is: a wall is a box whose only corners are at the floor and the ceiling, and a rule that wanted
 * a corner in the band found no walls at all, which is how the first version of this let you into
 * a house through any side of it.
 *
 * The extents are about the prop's own middle, where it is planted, and the wider side wins:
 * a palm leans, so its trunk reaches 0.32 out one way and 0.18 the other, and the box holds both.
 */
export function footprintOf(parts: readonly PropPart[]): Footprint | null {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of parts) {
    for (const piece of placedPieces(p)) {
      let low = Infinity, high = -Infinity;
      for (const [, y] of piece) { low = Math.min(low, y); high = Math.max(high, y); }
      if (high < WALKING_BAND.low || low > WALKING_BAND.high) continue;
      for (const [x, , z] of piece) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
  }
  if (minX === Infinity) return null;
  return { hw: Math.max(-minX, maxX), hd: Math.max(-minZ, maxZ) };
}
