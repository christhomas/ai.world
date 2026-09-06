import { FaceKind, faceAt, type WorldMesh } from './mesh';

/**
 * Mountain country: the ground itself rising, before any rock stands on it.
 *
 * The first version of the mountains was wrong in a way no amount of tuning would fix. It put peaks
 * on the ground the way a tree is put on the ground — a flat plain, and then a cone of rock rising
 * out of nowhere. That is not what a mountain is. A range is high *country*: the land tilts up for
 * miles before anything worth calling a peak, the valleys between the summits are themselves higher
 * than the plain, and you know you are in the mountains long before you are on one.
 *
 * So the land rises first, and here is where. A face the mesh marked as mountain is high ground; a
 * face bordering open country is the edge of it, and the further in a face is from that edge the
 * higher it stands. Peaks are built on top of what this returns, so a summit is high because it is
 * a rise on high ground rather than because a tall thing was dropped on a field.
 *
 * The rise is in the terraced heightfield rather than in the polygon rock, which matters for
 * everything else: it is walkable, rivers run down it, villages sit in its valleys, snow falls on
 * it, and the map draws it. The rock on top is only the last few hundred feet.
 */

export const HIGHLAND = {
  /**
   * How high the country stands for each step a face is from open ground, in terraces.
   *
   * A terrace is half a world unit, so the edge of a range stands about seven units above the
   * plain and the country behind it fourteen. That is the climb: by the time you are among the
   * peaks you have already walked up something.
   */
  PER_STEP: 14,
  /** However deep the country, the ground itself never rises past this, in terraces. */
  MOST: 40,
  /**
   * How far the ground round a mountain face is raised, as a share of the face's own reach.
   *
   * This is what makes foothills. A face is sixty to a hundred and fifty tiles across; at two and a
   * half times that, the ground begins tilting up a long way out in open country and goes on
   * rising all the way in. Narrower and a range is a plateau with a cliff round it, which is the
   * mistake this replaced — mountains standing up out of a flat plain like nothing else in nature.
   */
  REACH: 2.5,
  /**
   * How much of that reach is spent climbing, as against being high country already.
   *
   * At one the whole swell is a slope and there is no plateau at the top. At nought it is a mesa.
   * Two thirds gives a long approach and a broad shoulder of high ground for the peaks to stand on.
   */
  SHOULDER: 0.66,
} as const;

/** One face's worth of high country: where it is, how far its ground rises, and how high. */
export interface Highland {
  x: number;
  z: number;
  /** Tiles from the middle at which the ground is back down to the plain. */
  reach: number;
  /** Terraces the ground stands at the middle of it. */
  lift: number;
}

/**
 * The high country of a world: where the ground rises, and by how much.
 *
 * Worked out by walking inward from the edge of every range — faces touching open country are the
 * foothills, faces behind them stand higher — and then spread over a reach far wider than the faces
 * themselves, because a range is not the shape of the polygons that decided where it goes. What
 * comes out is a broad swell of country with the polygons' own peaks standing on top of it.
 */
export function highlandLift(mesh: WorldMesh): Highland[] {
  const depth = new Int32Array(mesh.faces.length).fill(-1);

  // the edge of the mountains: any mountain face with something that is not mountain beside it
  const edge: number[] = [];
  for (const face of mesh.faces) {
    if (face.kind !== FaceKind.Mountain) continue;
    const open = face.neighbours.some((n) => n < 0 || mesh.faces[n].kind !== FaceKind.Mountain);
    if (!open) continue;
    depth[face.id] = 1;
    edge.push(face.id);
  }
  // and inward from there, a step at a time
  for (let at = 0; at < edge.length; at++) {
    const here = mesh.faces[edge[at]];
    for (const next of here.neighbours) {
      if (next < 0 || mesh.faces[next].kind !== FaceKind.Mountain || depth[next] >= 0) continue;
      depth[next] = depth[here.id] + 1;
      edge.push(next);
    }
  }

  const country: Highland[] = [];
  for (const face of mesh.faces) {
    if (depth[face.id] < 0) continue;
    country.push({
      x: face.cx,
      z: face.cz,
      reach: Math.sqrt(face.area / Math.PI) * HIGHLAND.REACH,
      lift: Math.min(HIGHLAND.MOST, depth[face.id] * HIGHLAND.PER_STEP),
    });
  }
  return country;
}

/**
 * How high the ground stands at a point because of the country it is in, in terraces.
 *
 * The highest of what any range nearby makes of it, rather than the sum: two shoulders overlapping
 * make a saddle at the height of the higher one, which is what a saddle is. Smooth all the way out,
 * so there is no line anywhere that the ground steps across.
 */
export function highlandAt(country: ReadonlyArray<Highland>, x: number, z: number): number {
  let most = 0;
  for (const hill of country) {
    const away = Math.hypot(hill.x - x, hill.z - z);
    if (away >= hill.reach) continue;
    // flat-ish over the middle, falling away over the outer part of the reach
    const inward = (hill.reach - away) / (hill.reach * HIGHLAND.SHOULDER);
    const share = Math.max(0, Math.min(1, inward));
    const eased = share * share * (3 - 2 * share);
    most = Math.max(most, hill.lift * eased);
  }
  return most;
}
