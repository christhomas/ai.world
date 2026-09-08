import { MONSTER_KINDS } from './monsters';
import { PROPERTIES, creature, type CreatureProperties } from './properties';
import { VILLAIN_KINDS } from './villain';

/**
 * The bodies every creature in the game is drawn with.
 *
 * Each one is a handful of primitive parts with baked colours, drawn through per-part
 * InstancedMesh pools, so a herd of forty costs the same draw calls as one. `anim` tags parts for
 * the walk cycle; `tint` picks one of the instance's palette colours so the same rig gives brown,
 * black and white horses.
 *
 * What a creature *is* — its pace, its bite, what it is worth — is not here any more. That is a
 * table of numbers, it is argued about far more often than this is, and it now lives in
 * `properties/` where somebody can change it without opening a source file. A shape cannot go the
 * same way: it is read by looking at it, and a hundred boxes written out as JSON would be a worse
 * file than this one and no more editable. So the two are joined at the bottom, and a rig with no
 * properties beside it — or properties with no rig — fails at load rather than quietly appearing
 * as a creature with no speed, or not appearing at all.
 */

export type PartShape = 'box' | 'cyl' | 'cone' | 'ico';
export type AnimRole = 'legL' | 'legR' | 'armL' | 'armR' | 'tail' | 'head' | 'wingL' | 'wingR' | 'cape';

export interface PartDef {
  shape: PartShape;
  /** box: [w,h,d]; cyl/cone: [rTop, height, rBottom]; ico: [radius]. */
  size: number[];
  /** Part centre relative to the root (root on the ground, creature faces +x). */
  offset: [number, number, number];
  color: number;
  /** Index into the instance palette; omit for a fixed colour. */
  tint?: number;
  anim?: AnimRole;
  /** Rotation pivot relative to root; defaults to the part's top centre for legs, its centre otherwise. */
  pivot?: [number, number, number];
  /** Named so it can be hidden: the hero's own hat gives way to a helm. */
  tag?: string;
  rot?: [number, number, number];
}

// half the game asks this file what a creature's behaviour is; the word is checked where the
// files that use it are read, so the type comes back through here rather than moving every import
export type { Behaviour } from './properties';

/** A creature entire: what it is, out of `properties/`, and the body it is drawn with. */
export interface AnimalKind extends CreatureProperties {
  parts: PartDef[];
}

type P = PartDef;
const box = (size: number[], offset: [number, number, number], color: number, extra: Partial<P> = {}): P => ({ shape: 'box', size, offset, color, ...extra });
const ico = (r: number, offset: [number, number, number], color: number, extra: Partial<P> = {}): P => ({ shape: 'ico', size: [r], offset, color, ...extra });
const cone = (rBottom: number, h: number, offset: [number, number, number], color: number, extra: Partial<P> = {}): P => ({ shape: 'cone', size: [0, h, rBottom], offset, color, ...extra });
const cyl = (r: number, h: number, offset: [number, number, number], color: number, extra: Partial<P> = {}): P => ({ shape: 'cyl', size: [r, h, r], offset, color, ...extra });

interface QuadOpts {
  body: [number, number, number];   // length (x), height, width
  bodyY: number;                    // body centre height
  legH: number; legW: number; legInset?: number;
  head: [number, number, number]; headOffset: [number, number, number];
  neck?: [number, number, number]; neckOffset?: [number, number, number]; neckRot?: number;
  bodyColor: number; bodyTint?: number; legColor?: number; legTint?: number; headColor?: number; headTint?: number;
  tail?: { size: number[]; offset: [number, number, number]; color: number; tint?: number; rot?: [number, number, number] };
  extras?: P[];
}

/** Generic four-legged rig: body, head, optional neck, four legs, optional tail, extras (horns, ears...). */
function quadruped(o: QuadOpts): P[] {
  const [bl, bh, bw] = o.body;
  const inset = o.legInset ?? 0.12;
  const legY = o.legH / 2;
  const legColor = o.legColor ?? o.bodyColor;
  const legTint = o.legTint ?? o.bodyTint;
  const parts: P[] = [
    box([bl, bh, bw], [0, o.bodyY, 0], o.bodyColor, { tint: o.bodyTint }),
    box(o.head, o.headOffset, o.headColor ?? o.bodyColor, { tint: o.headTint ?? o.bodyTint, anim: 'head', pivot: [o.headOffset[0] - o.head[0] / 2, o.headOffset[1], 0] }),
  ];
  if (o.neck && o.neckOffset) parts.push(box(o.neck, o.neckOffset, o.bodyColor, { tint: o.bodyTint, rot: [0, 0, o.neckRot ?? 0] }));
  const lx = bl / 2 - inset, lz = bw / 2 - o.legW / 2;
  parts.push(
    box([o.legW, o.legH, o.legW], [lx, legY, lz], legColor, { tint: legTint, anim: 'legL', pivot: [lx, o.legH, lz] }),
    box([o.legW, o.legH, o.legW], [lx, legY, -lz], legColor, { tint: legTint, anim: 'legR', pivot: [lx, o.legH, -lz] }),
    box([o.legW, o.legH, o.legW], [-lx, legY, lz], legColor, { tint: legTint, anim: 'legR', pivot: [-lx, o.legH, lz] }),
    box([o.legW, o.legH, o.legW], [-lx, legY, -lz], legColor, { tint: legTint, anim: 'legL', pivot: [-lx, o.legH, -lz] }),
  );
  if (o.tail) parts.push({ shape: 'box', size: o.tail.size, offset: o.tail.offset, color: o.tail.color, tint: o.tail.tint, anim: 'tail', rot: o.tail.rot, pivot: [o.tail.offset[0], o.tail.offset[1] + o.tail.size[1] / 2, o.tail.offset[2]] });
  if (o.extras) parts.push(...o.extras);
  return parts;
}

/**
 * A person, in boxes.
 *
 * The old one was a cube with a slab of hair on it, a box for a body, and four sticks — two arms
 * pinned flat to the body's sides ending in nothing, and two legs. It read as an assembly rather
 * than as a figure: no shoulders for the arms to hang from, no hands on the ends of them, no neck,
 * and hair that sat on the head like a lid rather than growing out of it.
 *
 * It is still boxes — that is the game, and a person here should look cut from the same stock as
 * the houses. What it has now is the four things that make a stack of boxes read as somebody:
 *
 *   shoulders   a beam across the top of the chest, wider than the chest, so the arms hang off
 *               something rather than being stuck to a wall
 *   hands       a block on the end of each arm. An arm that stops is a stick; an arm that ends in
 *               a hand is an arm, and at this distance that is one block's worth of difference
 *   a neck      the head used to sit straight down on the chest, which is what gives a figure that
 *               hunched, shoulderless look from above — and above is where this camera is
 *   hair with a back to it  a fringe over the brow and a mass behind the skull, so the head has a
 *               silhouette. Everything at this distance is silhouette
 *
 * Sixteen boxes rather than twelve. They are merged per kind and drawn instanced, so the cost is
 * four more shapes in one geometry, not four more anything per villager.
 */
function biped(o: { skin: number; hair: number; shirtTint: number; pantsColor: number; hairTint?: number }): P[] {
  // the head rides a little higher than it did, and the gap it leaves is the neck
  const headY = 1.36, pivot: [number, number, number] = [0, 1.2, 0];
  return [
    box([0.14, 0.1, 0.16], [0, 1.15, 0], o.skin),
    box([0.3, 0.32, 0.3], [0, headY, 0], o.skin, { anim: 'head', pivot }),
    /*
     * The skull's own hair: a cap over the crown, a fringe at the brow, and the mass behind it.
     *
     * The cap used to sit at headY + 0.2, which is entirely above a head that ends at + 0.16 — so
     * it was not hair, it was a tall black hat balanced on top, and from behind the whole head read
     * as one black slab taller than the face. It sits down over the crown now, the way hair does.
     */
    box([0.32, 0.12, 0.32], [0, headY + 0.12, 0], o.hair, { tint: o.hairTint, anim: 'head', pivot }),
    box([0.08, 0.075, 0.32], [0.13, headY + 0.075, 0], o.hair, { tint: o.hairTint, anim: 'head', pivot }),
    box([0.09, 0.26, 0.31], [-0.135, headY + 0.01, 0], o.hair, { tint: o.hairTint, anim: 'head', pivot }),
    /*
     * An eye is a white with a dark pupil in front of it, not a black cube.
     *
     * One dark block each was what these were, and at the size a villager is actually seen at that
     * does not read as an eye looking at you — it reads as a hole, or as somebody with black
     * eyeballs. Two blocks apiece: the white set into the face, and a smaller pupil standing a
     * little proud of it, which is what gives the eye somewhere to be looking.
     */
    box([0.04, 0.075, 0.062], [0.145, headY + 0.02, 0.072], 0xf2efe6, { anim: 'head', pivot }),
    box([0.04, 0.075, 0.062], [0.145, headY + 0.02, -0.072], 0xf2efe6, { anim: 'head', pivot }),
    box([0.05, 0.05, 0.034], [0.155, headY + 0.014, 0.072], 0x2a2230, { anim: 'head', pivot }),
    box([0.05, 0.05, 0.034], [0.155, headY + 0.014, -0.072], 0x2a2230, { anim: 'head', pivot }),
    /*
     * Chest and legs the same length.
     *
     * The legs were 0.64 against a chest of 0.44 — half as long again — which is why the figure
     * read as lanky whatever else was done to it: a person is roughly half legs, and this one was
     * nearer three fifths, all of it below a short body. The hip has come down to 0.62 and the
     * chest has grown to meet the same shoulders, so the total height is exactly what it was and
     * only the waistline moved.
     *
     * The arms grew with the chest. They used to stop at 0.76, which was above the old hip and is
     * well above the new one; an arm that ends at the waist reads as a stump. They now reach the
     * top of the thigh, where a hand hangs.
     */
    box([0.27, 0.54, 0.36], [0, 0.89, 0], 0xffffff, { tint: o.shirtTint }),
    box([0.29, 0.11, 0.46], [0, 1.11, 0], 0xffffff, { tint: o.shirtTint }),
    box([0.1, 0.42, 0.1], [0, 0.93, 0.25], o.skin, { anim: 'armL', pivot: [0, 1.14, 0.25] }),
    box([0.1, 0.42, 0.1], [0, 0.93, -0.25], o.skin, { anim: 'armR', pivot: [0, 1.14, -0.25] }),
    box([0.12, 0.1, 0.12], [0, 0.68, 0.25], o.skin, { anim: 'armL', pivot: [0, 1.14, 0.25] }),
    box([0.12, 0.1, 0.12], [0, 0.68, -0.25], o.skin, { anim: 'armR', pivot: [0, 1.14, -0.25] }),
    /*
     * The leg reaches the boot.
     *
     * It used to stop at 0.26 while the boot lay from 0 to 0.08, leaving nearly two tenths of a
     * unit of nothing between them — an eighth of the whole figure. Standing still that reads as a
     * person floating a little above the ground; walking, the leg and the boot swing on the same
     * hip at different radii, so the gap opens and closes and the feet look like two blocks
     * following him about. This is what "they do not touch the ground" was.
     */
    // wider than they were, and set further out: two thirteen-hundredths sticks under a body twice
    // that across read as legs somebody had forgotten to finish
    box([0.15, 0.54, 0.15], [0, 0.35, 0.095], o.pantsColor, { anim: 'legL', pivot: [0, 0.62, 0.095] }),
    box([0.15, 0.54, 0.15], [0, 0.35, -0.095], o.pantsColor, { anim: 'legR', pivot: [0, 0.62, -0.095] }),
    /*
     * Two feet, not a plank.
     *
     * These were 0.2 by 0.15 apiece with their inside edges three hundredths of a unit apart — so
     * across the pair they covered 0.20 by 0.33, which is very nearly the footprint of the whole
     * torso, and they overhung the leg front and back. From directly above, which is where this
     * camera mostly is, that is not a pair of boots: it is one brown slab under the figure, the
     * same size as the figure, and it reads as something failing to render.
     *
     * Smaller, set further apart so there is daylight between them, and with the overhang all in
     * front where a toe goes rather than split evenly around the ankle.
     */
    box([0.17, 0.075, 0.115], [0.025, 0.038, 0.095], 0x3a2a1a, { anim: 'legL', pivot: [0, 0.62, 0.095] }),
    box([0.17, 0.075, 0.115], [0.025, 0.038, -0.095], 0x3a2a1a, { anim: 'legR', pivot: [0, 0.62, -0.095] }),
  ];
}

const W = 0xffffff;


export const KINDS: Record<string, AnimalKind> = {
  // the things that are not wildlife, kept in their own file because they are not animals
  ...MONSTER_KINDS,
  ...VILLAIN_KINDS,
  cow: creature('cow', quadruped({
    body: [0.9, 0.5, 0.48], bodyY: 0.62, legH: 0.38, legW: 0.12, head: [0.32, 0.3, 0.28], headOffset: [0.58, 0.72, 0],
    bodyColor: W, bodyTint: 0, legColor: 0x3a2a1a,
    tail: { size: [0.05, 0.3, 0.05], offset: [-0.47, 0.6, 0], color: 0x3a2a1a },
    extras: [
      box([0.16, 0.14, 0.2], [0.72, 0.62, 0], 0xf0b8a8, { anim: 'head', pivot: [0.42, 0.72, 0] }),
      box([0.05, 0.05, 0.08], [0.6, 0.9, 0.12], 0xe8dcc0, { anim: 'head', pivot: [0.42, 0.72, 0] }),
      box([0.05, 0.05, 0.08], [0.6, 0.9, -0.12], 0xe8dcc0, { anim: 'head', pivot: [0.42, 0.72, 0] }),
      box([0.22, 0.16, 0.03], [0.05, 0.62, 0.25], 0x333333, { tint: 1 }),
      box([0.18, 0.14, 0.03], [-0.25, 0.55, -0.25], 0x333333, { tint: 1 }),
    ],
  })),
  sheep: creature('sheep', quadruped({
    body: [0.7, 0.5, 0.5], bodyY: 0.55, legH: 0.3, legW: 0.1, head: [0.26, 0.24, 0.22], headOffset: [0.45, 0.6, 0],
    bodyColor: W, bodyTint: 0, legColor: 0x2b2b2b, headColor: 0x2b2b2b, headTint: undefined,
    extras: [box([0.05, 0.1, 0.05], [0.4, 0.74, 0.1], 0x2b2b2b, { anim: 'head', pivot: [0.32, 0.6, 0] }), box([0.05, 0.1, 0.05], [0.4, 0.74, -0.1], 0x2b2b2b, { anim: 'head', pivot: [0.32, 0.6, 0] })],
  })),
  horse: creature('horse', quadruped({
    body: [1.0, 0.5, 0.42], bodyY: 0.85, legH: 0.6, legW: 0.1, head: [0.4, 0.22, 0.2], headOffset: [0.85, 1.25, 0],
    neck: [0.22, 0.55, 0.2], neckOffset: [0.55, 1.1, 0], neckRot: -0.6,
    bodyColor: W, bodyTint: 0,
    tail: { size: [0.06, 0.45, 0.06], offset: [-0.5, 0.75, 0], color: W, tint: 1, rot: [0, 0, 0.5] },
    extras: [box([0.5, 0.08, 0.08], [0.55, 1.36, 0], W, { tint: 1, rot: [0, 0, -0.6] }), box([0.05, 0.1, 0.04], [0.72, 1.4, 0.07], W, { tint: 0, anim: 'head', pivot: [0.65, 1.25, 0] }), box([0.05, 0.1, 0.04], [0.72, 1.4, -0.07], W, { tint: 0, anim: 'head', pivot: [0.65, 1.25, 0] })],
  })),
  chicken: creature('chicken', [
    ico(0.24, [0, 0.36, 0], W, { tint: 0 }),
    ico(0.13, [0.18, 0.56, 0], W, { tint: 0, anim: 'head', pivot: [0.1, 0.45, 0] }),
    box([0.06, 0.1, 0.03], [0.18, 0.68, 0], 0xdd3322, { anim: 'head', pivot: [0.1, 0.45, 0] }),
    cone(0.04, 0.1, [0.31, 0.54, 0], 0xffaa00, { rot: [0, 0, -Math.PI / 2], anim: 'head', pivot: [0.1, 0.45, 0] }),
    cyl(0.015, 0.14, [0.03, 0.09, 0.06], 0xee9900, { anim: 'legL', pivot: [0.03, 0.16, 0.06] }),
    cyl(0.015, 0.14, [0.03, 0.09, -0.06], 0xee9900, { anim: 'legR', pivot: [0.03, 0.16, -0.06] }),
    box([0.12, 0.16, 0.03], [-0.2, 0.44, 0], W, { tint: 0, anim: 'tail', rot: [0, 0, 0.7] }),
  ]),
  deer: creature('deer', quadruped({
    body: [0.8, 0.42, 0.34], bodyY: 0.78, legH: 0.6, legW: 0.08, head: [0.3, 0.2, 0.18], headOffset: [0.7, 1.2, 0],
    neck: [0.16, 0.5, 0.16], neckOffset: [0.5, 1.02, 0], neckRot: -0.5,
    bodyColor: W, bodyTint: 0,
    tail: { size: [0.06, 0.14, 0.08], offset: [-0.42, 0.8, 0], color: W, tint: 1 },
    extras: [
      box([0.04, 0.3, 0.04], [0.62, 1.42, 0.08], 0x6b4a2b, { anim: 'head', pivot: [0.55, 1.2, 0], rot: [0.3, 0, 0.2] }),
      box([0.04, 0.3, 0.04], [0.62, 1.42, -0.08], 0x6b4a2b, { anim: 'head', pivot: [0.55, 1.2, 0], rot: [-0.3, 0, 0.2] }),
      box([0.14, 0.04, 0.04], [0.62, 1.5, 0.12], 0x6b4a2b, { anim: 'head', pivot: [0.55, 1.2, 0] }),
      box([0.14, 0.04, 0.04], [0.62, 1.5, -0.12], 0x6b4a2b, { anim: 'head', pivot: [0.55, 1.2, 0] }),
      box([0.12, 0.08, 0.16], [0.86, 1.15, 0], W, { tint: 1, anim: 'head', pivot: [0.55, 1.2, 0] }),
    ],
  })),
  rabbit: creature('rabbit', [
    box([0.5, 0.32, 0.3], [0, 0.26, 0], W, { tint: 0 }),
    box([0.28, 0.24, 0.24], [0.3, 0.42, 0], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0] }),
    box([0.06, 0.3, 0.1], [0.28, 0.66, 0.07], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0], rot: [0, 0, -0.2] }),
    box([0.06, 0.3, 0.1], [0.28, 0.66, -0.07], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0], rot: [0, 0, -0.2] }),
    ico(0.07, [-0.26, 0.3, 0], 0xf6f6f6, { anim: 'tail' }),
    box([0.1, 0.16, 0.08], [0.16, 0.08, 0.1], W, { tint: 0, anim: 'legL', pivot: [0.16, 0.16, 0.1] }),
    box([0.1, 0.16, 0.08], [0.16, 0.08, -0.1], W, { tint: 0, anim: 'legR', pivot: [0.16, 0.16, -0.1] }),
    box([0.2, 0.16, 0.1], [-0.14, 0.08, 0.1], W, { tint: 0, anim: 'legR', pivot: [-0.14, 0.16, 0.1] }),
    box([0.2, 0.16, 0.1], [-0.14, 0.08, -0.1], W, { tint: 0, anim: 'legL', pivot: [-0.14, 0.16, -0.1] }),
  ]),
  fox: creature('fox', quadruped({
    body: [0.6, 0.26, 0.24], bodyY: 0.4, legH: 0.28, legW: 0.07, head: [0.26, 0.2, 0.2], headOffset: [0.42, 0.5, 0],
    bodyColor: W, bodyTint: 0, legColor: 0x2b1a10,
    tail: { size: [0.4, 0.14, 0.14], offset: [-0.5, 0.42, 0], color: W, tint: 0, rot: [0, 0, 0.35] },
    extras: [
      box([0.14, 0.1, 0.12], [0.58, 0.44, 0], W, { tint: 1, anim: 'head', pivot: [0.3, 0.5, 0] }),
      box([0.05, 0.12, 0.06], [0.36, 0.64, 0.07], W, { tint: 0, anim: 'head', pivot: [0.3, 0.5, 0] }),
      box([0.05, 0.12, 0.06], [0.36, 0.64, -0.07], W, { tint: 0, anim: 'head', pivot: [0.3, 0.5, 0] }),
      box([0.12, 0.12, 0.13], [-0.7, 0.5, 0], W, { tint: 1, anim: 'tail', pivot: [-0.3, 0.42, 0] }),
      box([0.3, 0.12, 0.2], [0.05, 0.3, 0], W, { tint: 1 }),
    ],
  })),
  bear: creature('bear', quadruped({
    body: [0.9, 0.6, 0.55], bodyY: 0.62, legH: 0.36, legW: 0.16, legInset: 0.16, head: [0.36, 0.34, 0.34], headOffset: [0.56, 0.78, 0],
    bodyColor: W, bodyTint: 0,
    extras: [
      box([0.16, 0.12, 0.2], [0.74, 0.7, 0], W, { tint: 1, anim: 'head', pivot: [0.38, 0.78, 0] }),
      box([0.06, 0.05, 0.08], [0.82, 0.74, 0], 0x111111, { anim: 'head', pivot: [0.38, 0.78, 0] }),
      ico(0.07, [0.5, 0.98, 0.14], W, { tint: 0, anim: 'head', pivot: [0.38, 0.78, 0] }),
      ico(0.07, [0.5, 0.98, -0.14], W, { tint: 0, anim: 'head', pivot: [0.38, 0.78, 0] }),
    ],
  })),
  camel: creature('camel', quadruped({
    body: [1.0, 0.46, 0.4], bodyY: 0.92, legH: 0.7, legW: 0.1, head: [0.34, 0.2, 0.18], headOffset: [0.9, 1.4, 0],
    neck: [0.18, 0.62, 0.18], neckOffset: [0.6, 1.2, 0], neckRot: -0.45,
    bodyColor: W, bodyTint: 0,
    tail: { size: [0.05, 0.3, 0.05], offset: [-0.5, 0.85, 0], color: W, tint: 0 },
    extras: [ico(0.26, [-0.05, 1.2, 0], W, { tint: 0 })],
  })),
  lizard: creature('lizard', [
    box([0.6, 0.14, 0.24], [0, 0.1, 0], W, { tint: 0 }),
    box([0.24, 0.12, 0.18], [0.4, 0.12, 0], W, { tint: 0, anim: 'head', pivot: [0.28, 0.1, 0] }),
    box([0.5, 0.08, 0.08], [-0.55, 0.08, 0], W, { tint: 0, anim: 'tail', pivot: [-0.3, 0.08, 0] }),
    box([0.08, 0.1, 0.16], [0.2, 0.06, 0.18], W, { tint: 0, anim: 'legL', pivot: [0.2, 0.1, 0.12] }),
    box([0.08, 0.1, 0.16], [0.2, 0.06, -0.18], W, { tint: 0, anim: 'legR', pivot: [0.2, 0.1, -0.12] }),
    box([0.08, 0.1, 0.16], [-0.2, 0.06, 0.18], W, { tint: 0, anim: 'legR', pivot: [-0.2, 0.1, 0.12] }),
    box([0.08, 0.1, 0.16], [-0.2, 0.06, -0.18], W, { tint: 0, anim: 'legL', pivot: [-0.2, 0.1, -0.12] }),
  ]),
  vulture: creature('vulture', [
    box([0.5, 0.18, 0.22], [0, 0, 0], W, { tint: 0 }),
    ico(0.1, [0.32, 0.06, 0], W, { tint: 1, anim: 'head', pivot: [0.2, 0, 0] }),
    cone(0.03, 0.12, [0.44, 0.04, 0], 0xd0b040, { rot: [0, 0, -Math.PI / 2] }),
    box([0.4, 0.04, 0.9], [0, 0.06, 0.55], W, { tint: 0, anim: 'wingL', pivot: [0, 0.06, 0.1] }),
    box([0.4, 0.04, 0.9], [0, 0.06, -0.55], W, { tint: 0, anim: 'wingR', pivot: [0, 0.06, -0.1] }),
    box([0.24, 0.04, 0.3], [-0.34, 0.02, 0], W, { tint: 0, anim: 'tail' }),
  ]),
  frog: creature('frog', [
    box([0.5, 0.26, 0.4], [0, 0.18, 0], W, { tint: 0 }),
    ico(0.08, [0.2, 0.36, 0.12], 0xf5e04a, { anim: 'head', pivot: [0.1, 0.25, 0] }),
    ico(0.08, [0.2, 0.36, -0.12], 0xf5e04a, { anim: 'head', pivot: [0.1, 0.25, 0] }),
    box([0.3, 0.12, 0.12], [-0.2, 0.08, 0.25], W, { tint: 0, anim: 'legL', pivot: [-0.1, 0.14, 0.25] }),
    box([0.3, 0.12, 0.12], [-0.2, 0.08, -0.25], W, { tint: 0, anim: 'legR', pivot: [-0.1, 0.14, -0.25] }),
    box([0.1, 0.16, 0.08], [0.2, 0.08, 0.2], W, { tint: 0, anim: 'legR', pivot: [0.2, 0.16, 0.2] }),
    box([0.1, 0.16, 0.08], [0.2, 0.08, -0.2], W, { tint: 0, anim: 'legL', pivot: [0.2, 0.16, -0.2] }),
  ]),
  duck: creature('duck', [
    box([0.5, 0.22, 0.32], [0, 0.16, 0], W, { tint: 1 }),
    ico(0.12, [0.26, 0.42, 0], W, { tint: 0, anim: 'head', pivot: [0.16, 0.3, 0] }),
    cyl(0.06, 0.22, [0.18, 0.3, 0], W, { tint: 0 }),
    box([0.14, 0.05, 0.1], [0.38, 0.4, 0], 0xf0a020, { anim: 'head', pivot: [0.16, 0.3, 0] }),
    box([0.16, 0.06, 0.12], [-0.28, 0.22, 0], W, { tint: 1, anim: 'tail', rot: [0, 0, 0.5] }),
  ]),
  shark: creature('shark', [
    box([1.5, 0.42, 0.5], [0, 0.1, 0], W, { tint: 0 }),
    box([1.45, 0.2, 0.46], [0, -0.04, 0], W, { tint: 1 }),
    cone(0.26, 0.6, [0.92, 0.08, 0], W, { tint: 0, rot: [0, 0, -Math.PI / 2] }),
    // the fin, raked back: from a boat this is the whole animal
    cone(0.24, 0.95, [-0.05, 0.62, 0], W, { tint: 0, rot: [0, 0, -0.3] }),
    box([0.1, 0.5, 0.5], [-0.92, 0.16, 0], W, { tint: 0, anim: 'tail', pivot: [-0.7, 0.1, 0] }),
    box([0.36, 0.08, 0.3], [0.2, -0.1, 0.3], W, { tint: 0, rot: [0.3, 0, 0] }),
    box([0.36, 0.08, 0.3], [0.2, -0.1, -0.3], W, { tint: 0, rot: [-0.3, 0, 0] }),
  ]),
  orca: creature('orca', [
    box([1.7, 0.55, 0.62], [0, 0.12, 0], W, { tint: 0 }),
    box([1.6, 0.26, 0.58], [0, -0.08, 0], W, { tint: 1 }),
    box([0.3, 0.16, 0.2], [0.5, 0.3, 0.24], W, { tint: 1 }),
    box([0.3, 0.16, 0.2], [0.5, 0.3, -0.24], W, { tint: 1 }),
    cone(0.3, 0.55, [1.0, 0.1, 0], W, { tint: 0, rot: [0, 0, -Math.PI / 2] }),
    cone(0.22, 0.8, [0, 0.7, 0], W, { tint: 0 }),
    box([0.12, 0.6, 0.66], [-1.05, 0.18, 0], W, { tint: 0, anim: 'tail', pivot: [-0.8, 0.12, 0] }),
    box([0.44, 0.09, 0.34], [0.24, -0.12, 0.36], W, { tint: 0, rot: [0.35, 0, 0] }),
    box([0.44, 0.09, 0.34], [0.24, -0.12, -0.36], W, { tint: 0, rot: [-0.35, 0, 0] }),
  ]),
  heron: creature('heron', [
    box([0.5, 0.26, 0.28], [0, 0.75, 0], W, { tint: 0 }),
    cyl(0.05, 0.55, [0.22, 1.1, 0], W, { tint: 1, rot: [0, 0, -0.3] }),
    ico(0.1, [0.34, 1.38, 0], W, { tint: 1, anim: 'head', pivot: [0.3, 1.3, 0] }),
    cone(0.03, 0.3, [0.5, 1.36, 0], 0xe0b040, { rot: [0, 0, -Math.PI / 2], anim: 'head', pivot: [0.3, 1.3, 0] }),
    cyl(0.025, 0.6, [0.02, 0.3, 0.07], 0x3a3a3a, { anim: 'legL', pivot: [0.02, 0.6, 0.07] }),
    cyl(0.025, 0.6, [0.02, 0.3, -0.07], 0x3a3a3a, { anim: 'legR', pivot: [0.02, 0.6, -0.07] }),
    box([0.2, 0.04, 0.16], [-0.3, 0.8, 0], W, { tint: 0, anim: 'tail' }),
  ]),
  goat: creature('goat', quadruped({
    body: [0.66, 0.4, 0.34], bodyY: 0.58, legH: 0.4, legW: 0.09, head: [0.3, 0.22, 0.2], headOffset: [0.52, 0.78, 0],
    neck: [0.16, 0.34, 0.16], neckOffset: [0.4, 0.68, 0], neckRot: -0.5,
    bodyColor: W, bodyTint: 0,
    tail: { size: [0.05, 0.12, 0.05], offset: [-0.34, 0.72, 0], color: W, tint: 0, rot: [0, 0, -0.6] },
    extras: [
      cone(0.04, 0.24, [0.48, 0.98, 0.07], 0x6b5a4a, { rot: [0, 0, 0.6], anim: 'head', pivot: [0.37, 0.78, 0] }),
      cone(0.04, 0.24, [0.48, 0.98, -0.07], 0x6b5a4a, { rot: [0, 0, 0.6], anim: 'head', pivot: [0.37, 0.78, 0] }),
      box([0.06, 0.16, 0.05], [0.6, 0.62, 0], W, { tint: 0, anim: 'head', pivot: [0.37, 0.78, 0] }),
    ],
  })),
  eagle: creature('eagle', [
    box([0.5, 0.18, 0.22], [0, 0, 0], W, { tint: 0 }),
    ico(0.1, [0.32, 0.06, 0], W, { tint: 1, anim: 'head', pivot: [0.2, 0, 0] }),
    cone(0.03, 0.12, [0.44, 0.04, 0], 0xf0c040, { rot: [0, 0, -Math.PI / 2] }),
    box([0.42, 0.04, 1.0], [0, 0.06, 0.6], W, { tint: 0, anim: 'wingL', pivot: [0, 0.06, 0.1] }),
    box([0.42, 0.04, 1.0], [0, 0.06, -0.6], W, { tint: 0, anim: 'wingR', pivot: [0, 0.06, -0.1] }),
    box([0.24, 0.04, 0.3], [-0.34, 0.02, 0], W, { tint: 1, anim: 'tail' }),
  ]),
  hare: creature('hare', [
    box([0.5, 0.32, 0.3], [0, 0.26, 0], W, { tint: 0 }),
    box([0.28, 0.24, 0.24], [0.3, 0.42, 0], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0] }),
    box([0.06, 0.32, 0.1], [0.28, 0.66, 0.07], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0], rot: [0, 0, -0.2] }),
    box([0.06, 0.32, 0.1], [0.28, 0.66, -0.07], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0], rot: [0, 0, -0.2] }),
    box([0.1, 0.16, 0.08], [0.16, 0.08, 0.1], W, { tint: 0, anim: 'legL', pivot: [0.16, 0.16, 0.1] }),
    box([0.1, 0.16, 0.08], [0.16, 0.08, -0.1], W, { tint: 0, anim: 'legR', pivot: [0.16, 0.16, -0.1] }),
    box([0.2, 0.16, 0.1], [-0.14, 0.08, 0.1], W, { tint: 0, anim: 'legR', pivot: [-0.14, 0.16, 0.1] }),
    box([0.2, 0.16, 0.1], [-0.14, 0.08, -0.1], W, { tint: 0, anim: 'legL', pivot: [-0.14, 0.16, -0.1] }),
  ]),
  wolf: creature('wolf', quadruped({
    body: [0.76, 0.32, 0.28], bodyY: 0.5, legH: 0.36, legW: 0.08, head: [0.3, 0.22, 0.22], headOffset: [0.52, 0.62, 0],
    bodyColor: W, bodyTint: 0,
    tail: { size: [0.4, 0.1, 0.1], offset: [-0.55, 0.5, 0], color: W, tint: 0, rot: [0, 0, 0.3] },
    extras: [
      box([0.16, 0.1, 0.14], [0.7, 0.56, 0], W, { tint: 1, anim: 'head', pivot: [0.37, 0.62, 0] }),
      box([0.05, 0.12, 0.06], [0.45, 0.78, 0.08], W, { tint: 0, anim: 'head', pivot: [0.37, 0.62, 0] }),
      box([0.05, 0.12, 0.06], [0.45, 0.78, -0.08], W, { tint: 0, anim: 'head', pivot: [0.37, 0.62, 0] }),
      box([0.4, 0.14, 0.24], [0, 0.34, 0], W, { tint: 1 }),
    ],
  })),
  elk: creature('elk', quadruped({
    body: [0.9, 0.48, 0.38], bodyY: 0.85, legH: 0.62, legW: 0.09, head: [0.34, 0.22, 0.2], headOffset: [0.78, 1.3, 0],
    neck: [0.18, 0.55, 0.18], neckOffset: [0.55, 1.1, 0], neckRot: -0.5,
    bodyColor: W, bodyTint: 0,
    tail: { size: [0.06, 0.14, 0.08], offset: [-0.47, 0.88, 0], color: W, tint: 1 },
    extras: [
      box([0.05, 0.4, 0.05], [0.7, 1.55, 0.1], 0x8a7a5a, { anim: 'head', pivot: [0.61, 1.3, 0], rot: [0.35, 0, 0.25] }),
      box([0.05, 0.4, 0.05], [0.7, 1.55, -0.1], 0x8a7a5a, { anim: 'head', pivot: [0.61, 1.3, 0], rot: [-0.35, 0, 0.25] }),
      box([0.24, 0.05, 0.05], [0.66, 1.68, 0.18], 0x8a7a5a, { anim: 'head', pivot: [0.61, 1.3, 0] }),
      box([0.24, 0.05, 0.05], [0.66, 1.68, -0.18], 0x8a7a5a, { anim: 'head', pivot: [0.61, 1.3, 0] }),
      box([0.2, 0.05, 0.05], [0.78, 1.75, 0.22], 0x8a7a5a, { anim: 'head', pivot: [0.61, 1.3, 0] }),
      box([0.2, 0.05, 0.05], [0.78, 1.75, -0.22], 0x8a7a5a, { anim: 'head', pivot: [0.61, 1.3, 0] }),
    ],
  })),
  traveller: creature('traveller', biped({ skin: 0xffdab9, hair: W, hairTint: 1, shirtTint: 0, pantsColor: 0x334466 })),
  villager: creature('villager', biped({ skin: 0xffdab9, hair: W, hairTint: 1, shirtTint: 0, pantsColor: 0x4a3a2a })),
  rat: creature('rat', quadruped({
    body: [0.5, 0.22, 0.22], bodyY: 0.26, legH: 0.14, legW: 0.06, head: [0.22, 0.18, 0.18], headOffset: [0.34, 0.32, 0],
    bodyColor: W, bodyTint: 0,
    tail: { size: [0.5, 0.05, 0.05], offset: [-0.5, 0.24, 0], color: W, tint: 1, rot: [0, 0, 0.2] },
    extras: [
      box([0.08, 0.1, 0.03], [0.28, 0.44, 0.08], W, { tint: 1, anim: 'head', pivot: [0.23, 0.32, 0] }),
      box([0.08, 0.1, 0.03], [0.28, 0.44, -0.08], W, { tint: 1, anim: 'head', pivot: [0.23, 0.32, 0] }),
      box([0.1, 0.06, 0.08], [0.46, 0.28, 0], W, { tint: 1, anim: 'head', pivot: [0.23, 0.32, 0] }),
    ],
  })),
  bat: creature('bat', [
    ico(0.16, [0, 0, 0], W, { tint: 0 }),
    box([0.08, 0.12, 0.04], [0.02, 0.16, 0.06], W, { tint: 0 }),
    box([0.08, 0.12, 0.04], [0.02, 0.16, -0.06], W, { tint: 0 }),
    box([0.3, 0.03, 0.55], [0, 0.04, 0.34], W, { tint: 1, anim: 'wingL', pivot: [0, 0.04, 0.08] }),
    box([0.3, 0.03, 0.55], [0, 0.04, -0.34], W, { tint: 1, anim: 'wingR', pivot: [0, 0.04, -0.08] }),
  ]),
  slime: creature('slime', [
    ico(0.42, [0, 0.32, 0], W, { tint: 0, anim: 'head', pivot: [0, 0, 0] }),
    ico(0.16, [0.22, 0.42, 0.14], 0x111111, { anim: 'head', pivot: [0, 0, 0] }),
    ico(0.16, [0.22, 0.42, -0.14], 0x111111, { anim: 'head', pivot: [0, 0, 0] }),
  ]),
  skeleton: creature('skeleton', [
    box([0.28, 0.3, 0.28], [0, 1.3, 0], W, { tint: 0, anim: 'head', pivot: [0, 1.12, 0] }),
    box([0.07, 0.07, 0.05], [0.15, 1.34, 0.07], 0x111111, { anim: 'head', pivot: [0, 1.12, 0] }),
    box([0.07, 0.07, 0.05], [0.15, 1.34, -0.07], 0x111111, { anim: 'head', pivot: [0, 1.12, 0] }),
    box([0.16, 0.42, 0.3], [0, 0.92, 0], W, { tint: 0 }),
    box([0.08, 0.4, 0.08], [0, 0.94, 0.22], W, { tint: 0, anim: 'armL', pivot: [0, 1.12, 0.22] }),
    box([0.08, 0.4, 0.08], [0, 0.94, -0.22], W, { tint: 0, anim: 'armR', pivot: [0, 1.12, -0.22] }),
    box([0.1, 0.44, 0.1], [0, 0.48, 0.08], W, { tint: 0, anim: 'legL', pivot: [0, 0.7, 0.08] }),
    box([0.1, 0.44, 0.1], [0, 0.48, -0.08], W, { tint: 0, anim: 'legR', pivot: [0, 0.7, -0.08] }),
    box([0.06, 0.7, 0.06], [0.1, 0.85, 0.3], W, { tint: 1, anim: 'armL', pivot: [0, 1.12, 0.22], rot: [0, 0, 0.3] }),
  ]),
  troll: creature('troll', [
    box([0.5, 0.5, 0.5], [0, 1.75, 0], W, { tint: 0, anim: 'head', pivot: [0, 1.5, 0] }),
    box([0.12, 0.1, 0.08], [0.26, 1.82, 0.14], 0xf5d76e, { anim: 'head', pivot: [0, 1.5, 0] }),
    box([0.12, 0.1, 0.08], [0.26, 1.82, -0.14], 0xf5d76e, { anim: 'head', pivot: [0, 1.5, 0] }),
    box([0.14, 0.2, 0.1], [0.24, 1.6, 0.1], 0xe8e0cc, { anim: 'head', pivot: [0, 1.5, 0] }),
    box([0.7, 0.85, 0.62], [0, 1.15, 0], W, { tint: 0 }),
    box([0.28, 0.9, 0.28], [0, 1.2, 0.5], W, { tint: 1, anim: 'armL', pivot: [0, 1.55, 0.5] }),
    box([0.28, 0.9, 0.28], [0, 1.2, -0.5], W, { tint: 1, anim: 'armR', pivot: [0, 1.55, -0.5] }),
    box([0.3, 0.75, 0.3], [0, 0.38, 0.2], W, { tint: 1, anim: 'legL', pivot: [0, 0.75, 0.2] }),
    box([0.3, 0.75, 0.3], [0, 0.38, -0.2], W, { tint: 1, anim: 'legR', pivot: [0, 0.75, -0.2] }),
    box([0.2, 1.0, 0.2], [0.1, 1.0, 0.62], 0x6b4a2b, { anim: 'armL', pivot: [0, 1.55, 0.5], rot: [0, 0, 0.4] }),
  ]),
  yeti: creature('yeti', [
    box([0.52, 0.5, 0.5], [0, 1.72, 0], W, { tint: 0, anim: 'head', pivot: [0, 1.48, 0] }),
    box([0.1, 0.09, 0.08], [0.28, 1.8, 0.13], 0x2a3b4a, { anim: 'head', pivot: [0, 1.48, 0] }),
    box([0.1, 0.09, 0.08], [0.28, 1.8, -0.13], 0x2a3b4a, { anim: 'head', pivot: [0, 1.48, 0] }),
    box([0.78, 0.86, 0.66], [0, 1.12, 0], W, { tint: 0 }),
    box([0.3, 0.98, 0.3], [0, 1.16, 0.54], W, { tint: 1, anim: 'armL', pivot: [0, 1.54, 0.54] }),
    box([0.3, 0.98, 0.3], [0, 1.16, -0.54], W, { tint: 1, anim: 'armR', pivot: [0, 1.54, -0.54] }),
    box([0.32, 0.7, 0.32], [0, 0.36, 0.21], W, { tint: 1, anim: 'legL', pivot: [0, 0.72, 0.21] }),
    box([0.32, 0.7, 0.32], [0, 0.36, -0.21], W, { tint: 1, anim: 'legR', pivot: [0, 0.72, -0.21] }),
  ]),
  bigfoot: creature('bigfoot', [
    box([0.46, 0.46, 0.46], [0, 1.62, 0], W, { tint: 0, anim: 'head', pivot: [0, 1.4, 0] }),
    box([0.09, 0.08, 0.07], [0.25, 1.69, 0.12], 0xf5d76e, { anim: 'head', pivot: [0, 1.4, 0] }),
    box([0.09, 0.08, 0.07], [0.25, 1.69, -0.12], 0xf5d76e, { anim: 'head', pivot: [0, 1.4, 0] }),
    box([0.68, 0.8, 0.6], [0, 1.06, 0], W, { tint: 0 }),
    box([0.26, 1.02, 0.26], [0, 1.1, 0.5], W, { tint: 1, anim: 'armL', pivot: [0, 1.46, 0.5] }),
    box([0.26, 1.02, 0.26], [0, 1.1, -0.5], W, { tint: 1, anim: 'armR', pivot: [0, 1.46, -0.5] }),
    box([0.28, 0.66, 0.28], [0, 0.34, 0.19], W, { tint: 1, anim: 'legL', pivot: [0, 0.68, 0.19] }),
    box([0.28, 0.66, 0.28], [0, 0.34, -0.19], W, { tint: 1, anim: 'legR', pivot: [0, 0.68, -0.19] }),
  ]),
  shopkeeper: creature('shopkeeper', [
    ...biped({ skin: 0xffdab9, hair: W, hairTint: 1, shirtTint: 0, pantsColor: 0x3a2a1a }),
    box([0.24, 0.5, 0.3], [0.02, 0.62, 0], 0x8a4a2a),
  ]),
  hero: creature('hero', [
    ...biped({ skin: 0xffdab9, hair: W, hairTint: 1, shirtTint: 0, pantsColor: 0x4a3a2a }),
    /*
     * Hat, brim, belt, cape: a silhouette you can find in a crowd of villagers.
     *
     * The brim sits on the hair rather than above it. It used to be at 1.6 with the head ending at
     * 1.48, so it floated a tenth of a unit clear of the crown — a hat hovering over a head, which
     * from a distance is a hat and from close up is a mistake. The head has since moved up as well,
     * and the pivots move with it: a hat that turns about a different point from the head it is on
     * swings loose every time the hero looks round.
     */
    /*
     * The hat, which is what makes him findable in a crowd, built out of the same stock as the
     * rest of him.
     *
     * It used to be a smooth six-sided cone sitting on a square brim the width of his shoulders —
     * the only cone on any person in a world made entirely of boxes, and a brim that stuck out
     * further either side of his head than his own arms do. Together they read as a party hat, and
     * from above, which is where this camera is, mostly what you saw of the hero was a green disc.
     *
     * A cap in three steps instead: a crown over the hair, a narrower band above it, a block at the
     * peak. Still a shape nothing else in the game has, so it still does its job at a hundred
     * paces, and the brim is a short peak over the face rather than a plate all the way round.
     */
    box([0.15, 0.045, 0.3], [0.155, 1.53, 0], 0x1f7a48, { anim: 'head', pivot: [0, 1.2, 0], tag: 'hat' }),
    box([0.33, 0.12, 0.33], [0, 1.575, 0], 0x2fb36a, { anim: 'head', pivot: [0, 1.2, 0], tag: 'hat' }),
    box([0.24, 0.1, 0.24], [0, 1.685, 0], 0x2fb36a, { anim: 'head', pivot: [0, 1.2, 0], tag: 'hat' }),
    box([0.14, 0.08, 0.14], [0, 1.775, 0], 0x1f7a48, { anim: 'head', pivot: [0, 1.2, 0], tag: 'hat' }),
    box([0.31, 0.07, 0.4], [0, 0.66, 0], 0x5a3a1a),
    box([0.05, 0.6, 0.36], [-0.16, 0.87, 0], 0xc0392b, { anim: 'cape', pivot: [-0.14, 1.16, 0], tag: 'cape' }),
  ]),
};

// A creature written into properties/ that nothing draws would never appear in the world, and the
// file would go on looking as though it had. `creature` catches the other way round, so between
// them the two directories have to agree about what exists.
for (const id of Object.keys(PROPERTIES)) {
  if (!KINDS[id]) throw new Error(`properties/: "${id}" has properties but no body, so nothing in the game would ever draw it`);
}
