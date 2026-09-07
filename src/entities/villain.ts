import type { AnimalKind, PartDef } from './animals';
import { creature } from './properties';

/**
 * The one figure in this world who is neither wildlife nor a thing out of a barrow: a man, and the
 * only man in the game worth being frightened of.
 *
 * Everything else that means you harm is a shape you learn once. A wolf is a wolf, an ogre is
 * weight and a wight is cold, and having met one you have met them all. There is exactly one of
 * him, he turns up perhaps five times in the life of a villager, and the whole point of the rig
 * below is that the first time you see that outline across a field you know which of those two
 * kinds of evening you are having.
 *
 * The decision worth explaining is that he keeps his hit points and the hero's own climb. The
 * wight has neither, and its missing hit points are how a blade passes through it without a line
 * of code anywhere saying so. He is the opposite case on purpose: the sword works, the terrace
 * trick that saves you from an ogre does not, and the fight is a fight you can win. Those numbers
 * and the argument for each of them are in `properties/villain.json`; what happens at the end of a
 * fight he is losing is not this file's business and is deliberately not written here, because a
 * creature kind has no business knowing it is a story. That lives one layer up.
 */

/** The creature this file adds, by the name the kind table and `behaviours/villain.json` know him under. */
export type VillainId = 'nettle';

/**
 * The same primitive factories `animals.ts` builds its rigs from, and `monsters.ts` after it. They
 * are private over there, so they are written out again here rather than reached into; exporting
 * them once and importing them in both places is the tidier end state.
 */
type P = PartDef;
const box = (size: number[], offset: [number, number, number], color: number, extra: Partial<P> = {}): P =>
  ({ shape: 'box', size, offset, color, ...extra });
const cyl = (r: number, h: number, offset: [number, number, number], color: number, extra: Partial<P> = {}): P =>
  ({ shape: 'cyl', size: [r, h, r], offset, color, ...extra });

/** Stands in for a palette tint: the instance's own colours are painted over it at spawn. */
const W = 0xffffff;

/** Where the hat turns, which is the head's pivot: every part of it has to swing on the same point. */
const NECK: [number, number, number] = [0, 1.74, 0];

/**
 * Old Nettle, in the shape the kind table takes. Merge this into `KINDS` and everything that
 * already knows how to spawn, draw, animate and fight a creature knows how to do it to him.
 *
 * The rig is built for one camera. From an isometric view you see the top of a thing before you
 * see its face, so the whole silhouette is a wide flat disc over a vertical line: a hat brim
 * nothing else in the game has, on a body drawn thin enough to disappear behind it. At the
 * distance where an ogre is still a lump and a villager is still a villager, that is already
 * unmistakably him.
 */
export const VILLAIN_KINDS: Record<VillainId, AnimalKind> = {
  nettle: creature('nettle', [
    // two stalks for legs, set close together. Nothing else in the game stands on a base this
    // narrow, and it is what makes the brim above look as wide as it does
    box([0.13, 0.62, 0.13], [0, 0.31, 0.11], W, { tint: 0, anim: 'legL', pivot: [0, 0.62, 0.11] }),
    box([0.13, 0.62, 0.13], [0, 0.31, -0.11], W, { tint: 0, anim: 'legR', pivot: [0, 0.62, -0.11] }),
    // the coat: long, and narrow front to back so he reads as an edge rather than a body
    box([0.26, 1.06, 0.42], [0, 1.09, 0], W, { tint: 0 }),
    // shoulders as a thin plank. From above this is the only horizontal below the hat, which is
    // what stops the brim looking like a hat floating on a stick
    box([0.16, 0.09, 0.74], [0, 1.64, 0], W, { tint: 0 }),
    box([0.11, 0.13, 0.11], [0, 1.75, 0], W, { tint: 1 }),
    box([0.21, 0.25, 0.2], [0.02, 1.88, 0], W, { tint: 1, anim: 'head', pivot: NECK }),
    // and no face on it. The brim keeps the head in its own shade from every angle the camera
    // has, so eyes would be two pixels nobody ever sees; the absence is the better answer
    cyl(0.6, 0.05, [0, 2.03, 0], W, { tint: 2, anim: 'head', pivot: NECK }),
    cyl(0.19, 0.3, [0, 2.2, 0], W, { tint: 2, anim: 'head', pivot: NECK }),
    // arms hung long, past the knee, and swinging from the shoulder plank
    box([0.1, 0.96, 0.1], [0, 1.14, 0.32], W, { tint: 0, anim: 'armL', pivot: [0, 1.62, 0.32] }),
    box([0.1, 0.96, 0.1], [0, 1.14, -0.32], W, { tint: 0, anim: 'armR', pivot: [0, 1.62, -0.32] }),
    box([0.12, 0.12, 0.12], [0, 0.68, 0.32], W, { tint: 1, anim: 'armL', pivot: [0, 1.62, 0.32] }),
    box([0.12, 0.12, 0.12], [0, 0.68, -0.32], W, { tint: 1, anim: 'armR', pivot: [0, 1.62, -0.32] }),
    // the switch he carries, leaning out from the hand that holds it: the reach arrives before he does
    box([0.05, 1.42, 0.05], [0.24, 1.0, -0.36], 0x4d6b34, { anim: 'armR', pivot: [0, 1.62, -0.32], rot: [0, 0, 0.34] }),
    // a coat tail that trails behind him, and is the only part of him that ever looks hurried
    box([0.05, 1.12, 0.46], [-0.15, 1.06, 0], W, { tint: 0, anim: 'cape', pivot: [-0.13, 1.62, 0] }),
  ]),
};
