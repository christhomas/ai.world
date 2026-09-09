/**
 * What a body is made of, and the two generators most of them come out of.
 *
 * A creature is a handful of primitive parts with baked colours, drawn through per-part
 * InstancedMesh pools, so a herd of forty costs the same draw calls as one. `anim` tags parts for
 * the walk cycle; `tint` picks one of the instance's palette colours so the same rig gives brown,
 * black and white horses.
 *
 * The rigs themselves are not here any more — they are a file each in `models/creatures/`, and
 * `models.ts` reads them. What is left is the vocabulary those files are written in: the shape of
 * a part, and `biped` and `quadruped`, which between them draw two thirds of the bestiary. A file
 * that says `"from": "quadruped"` is asking for the function below with the arguments it names, so
 * a change here is a change to every four-legged animal in the game at once — which is the reason
 * the generators exist and the reason this file is worth reading before touching one.
 *
 * They were private inside `animals.ts`, and `monsters.ts` and `villain.ts` each wrote their own
 * copy of the four primitives rather than reach in. Both copies are gone: there is one of each
 * here, and the files that used to hold rigs hold none.
 */

export type PartShape = 'box' | 'cyl' | 'cone' | 'ico';

/**
 * The parts of a body the walk cycle knows how to move, as a list rather than as a union, because
 * a model file has to be held to it at load: `"anim": "legl"` is a leg that never swings, and a
 * creature that stands perfectly still while walking is a fault nobody reports for weeks.
 */
export const ANIM_ROLES = ['legL', 'legR', 'armL', 'armR', 'tail', 'head', 'wingL', 'wingR', 'cape'] as const;
export type AnimRole = (typeof ANIM_ROLES)[number];

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

type P = PartDef;

/**
 * The four shapes anything in this world is cut from.
 *
 * Each takes its size the way somebody describing the shape would say it — a cone is a base and a
 * height, a cylinder is a radius and a height — rather than the way `size` stores it. That is why
 * a model file writes `"cone": [0.04, 0.24]` and not the padded triple underneath: the file speaks
 * the same language as these four, because these four are what it is calling.
 */
export const box = (size: number[], offset: [number, number, number], color: number, extra: Partial<P> = {}): P =>
  ({ shape: 'box', size, offset, color, ...extra });
export const ico = (r: number, offset: [number, number, number], color: number, extra: Partial<P> = {}): P =>
  ({ shape: 'ico', size: [r], offset, color, ...extra });
export const cone = (rBottom: number, h: number, offset: [number, number, number], color: number, extra: Partial<P> = {}): P =>
  ({ shape: 'cone', size: [0, h, rBottom], offset, color, ...extra });
export const cyl = (r: number, h: number, offset: [number, number, number], color: number, extra: Partial<P> = {}): P =>
  ({ shape: 'cyl', size: [r, h, r], offset, color, ...extra });

export interface QuadOpts {
  body: [number, number, number];   // length (x), height, width
  bodyY: number;                    // body centre height
  legH: number; legW: number; legInset?: number;
  head: [number, number, number]; headOffset: [number, number, number];
  neck?: [number, number, number]; neckOffset?: [number, number, number]; neckRot?: number;
  bodyColor: number; bodyTint?: number; legColor?: number; legTint?: number; headColor?: number; headTint?: number;
  tail?: { size: number[]; offset: [number, number, number]; color: number; tint?: number; rot?: [number, number, number] };
}

/**
 * Generic four-legged rig: body, head, optional neck, four legs, optional tail.
 *
 * Horns, ears, muzzles and humps are not arguments to this. They are the `parts` list in the model
 * file, laid on after whatever this returns, which is where the extras used to go and reads the
 * same way — the animal, then the two or three things that make it that animal rather than another
 * one of the same build.
 */
export function quadruped(o: QuadOpts): P[] {
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
  return parts;
}

/**
 * How a person is built, as a multiplier on the width of the body.
 *
 * Every villager in this game was the same sixteen boxes in different trousers. Up close that is
 * fine — you can read their names — and at the distance this camera watches a street from it means
 * a village is one man repeated eleven times. A crowd made of one body is not a crowd.
 *
 * Only the width, and only of the parts that carry flesh: the chest, the shoulders, the arms, the
 * legs. Not the height, because height is `scale` and that already exists and moves the whole
 * figure including its hat; not the head, because a head that grew with the belly reads as a
 * different species rather than a different diet.
 *
 * A number rather than a set of named types, so that a village can be a spread rather than three
 * kinds of person — and the spread is what makes it a crowd. One is the man the game has always
 * drawn, which is why every existing rig is unchanged by this.
 */
export type Build = number;

/** What a build may be, and why the ends are where they are. */
export const BUILD = {
  /**
   * The narrowest and the broadest a person gets, as a share of the ordinary body.
   *
   * Three quarters is a thin man rather than a starved one; a half is a stick, and this world's
   * arms are already a tenth of a unit across, so halving them leaves a limb thinner than the hand
   * on the end of it. Four thirds is a heavy man whose arms still hang clear of his sides — past
   * about one and a half the upper arm intersects the chest at rest, which reads as a mistake and
   * not as a build.
   */
  THINNEST: 0.78,
  BROADEST: 1.34,
} as const;

export interface BipedOpts {
  skin: number; hair: number; shirtTint: number; pantsColor: number; hairTint?: number;
  /**
   * How broad this person is. One is the ordinary body, and every rig that does not ask for
   * anything gets exactly the figure it had before builds existed.
   *
   * The arms move outward with the chest rather than only growing, because an arm that widened in
   * place would end up inside the ribs of a heavy man; the legs move outward by less than the chest,
   * because a heavy man's legs are closer to under him than his shoulders are.
   */
  build?: Build;
  /**
   * Which palette entries the trousers, the boots and the arms are painted from, for a person
   * whose clothes change.
   *
   * Only the hero has them. What he is wearing repaints his own legs, feet and arms rather than
   * hanging a second pair over them, and a palette entry is the only thing an instanced rig can
   * change per person. A villager's trousers are the colour they are cut from, so they stay a plain
   * colour and cost nothing.
   *
   * The arms are the late one, and they are worth explaining. Mail leaves them bare and should:
   * a mail shirt is a shirt, and the man in it has sleeves of cloth or nothing at all. Plate does
   * not — a harness is vambrace and rerebrace as much as breastplate, and a plated chest over two
   * pink arms is somebody who put on half a suit. So the arms had to be able to take a colour
   * before there was anything to paint them with, and `worn.ts` decides which pieces do it.
   */
  pantsTint?: number; bootTint?: number; armTint?: number;
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
export function biped(o: BipedOpts): P[] {
  // the head rides a little higher than it did, and the gap it leaves is the neck
  const headY = 1.36, pivot: [number, number, number] = [0, 1.2, 0];
  /*
   * How broad this one is, and where the limbs sit because of it.
   *
   * `wide` is the chest and shoulders. `arm` and `leg` are the limbs' own thickness, which grows
   * more slowly than the trunk does — a heavy man is mostly heavy about the middle, and arms that
   * kept pace with the belly read as a strongman rather than a baker. `hang` and `stance` are where
   * they hang from: the arms move out with the shoulders or they end up inside the ribs, and the
   * legs move out by less, because a broad man's legs stay nearer to under him than his shoulders.
   */
  const wide = o.build ?? 1;
  const arm = 1 + (wide - 1) * 0.55;
  const leg = 1 + (wide - 1) * 0.5;
  const hang = 0.25 * wide;
  const stance = 0.095 * (1 + (wide - 1) * 0.4);
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
    box([0.27 * wide, 0.54, 0.36 * wide], [0, 0.89, 0], 0xffffff, { tint: o.shirtTint }),
    box([0.29 * wide, 0.11, 0.46 * wide], [0, 1.11, 0], 0xffffff, { tint: o.shirtTint }),
    box([0.1, 0.42, 0.1 * arm], [0, 0.93, hang], o.skin, { tint: o.armTint, anim: 'armL', pivot: [0, 1.14, hang] }),
    box([0.1, 0.42, 0.1 * arm], [0, 0.93, -hang], o.skin, { tint: o.armTint, anim: 'armR', pivot: [0, 1.14, -hang] }),
    // the hands go with the arms: a gauntlet is part of the harness, and a plated sleeve ending in
    // a bare fist is the same half-a-suit the arms were
    box([0.12, 0.1, 0.12], [0, 0.68, hang], o.skin, { tint: o.armTint, anim: 'armL', pivot: [0, 1.14, hang] }),
    box([0.12, 0.1, 0.12], [0, 0.68, -hang], o.skin, { tint: o.armTint, anim: 'armR', pivot: [0, 1.14, -hang] }),
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
    box([0.15, 0.54, 0.15 * leg], [0, 0.35, stance], o.pantsColor, { tint: o.pantsTint, anim: 'legL', pivot: [0, 0.62, stance] }),
    box([0.15, 0.54, 0.15 * leg], [0, 0.35, -stance], o.pantsColor, { tint: o.pantsTint, anim: 'legR', pivot: [0, 0.62, -stance] }),
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
    box([0.17, 0.075, 0.115], [0.025, 0.038, stance], 0x3a2a1a, { tint: o.bootTint, anim: 'legL', pivot: [0, 0.62, stance] }),
    box([0.17, 0.075, 0.115], [0.025, 0.038, -stance], 0x3a2a1a, { tint: o.bootTint, anim: 'legR', pivot: [0, 0.62, -stance] }),
  ];
}
