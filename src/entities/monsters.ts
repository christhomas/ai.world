import type { AnimalKind, PartDef } from './animals';

/**
 * The things in this world that are not wildlife.
 *
 * Every other creature in the game is an animal with a job. It grazes or it hunts, it flees or it
 * does not, and a sword settles the argument either way round. These two are here to be arguments
 * a sword does not settle, so that the kit sold for surviving them, a warding draught, a shield,
 * a head start, has something to be for.
 *
 * The non-obvious decision is the wight's missing hit points. A kind with no `hp` is one that a
 * swing steps straight over, so a blade passing through a spirit is not a special case written
 * into the fight code: it is the absence of one. What does answer a wight is daylight, its own
 * ground, and a draught, and where a wight is at all lives in `game/haunts.ts`, one layer up.
 */

export const MONSTER = {
  /**
   * The ogre's pace, in tiles a second, coming and ambling alike. It has one: a thing carrying
   * that much of itself has no walk and no run, only a walk it never stops using. Well under the
   * hero's own 5.5, which is the whole of what it offers, and near enough to it that a head start
   * spent deciding is a head start spent.
   */
  OGRE_PACE: 3.4,
  /** What one swing of its arm costs, out of ten hearts. Twice, and you are running regardless. */
  OGRE_HIT: 4,
  /** How long it takes to put down. Fighting it is a decision rather than a reflex. */
  OGRE_HP: 30,
  /** What it was keeping, for anybody who sees that decision through. */
  OGRE_GOLD_LOW: 90,
  OGRE_GOLD_HIGH: 180,
  /** How often the hoard has something in it worth carrying home. */
  OGRE_HOARD: 0.4,
  /**
   * The wight's pace, above the hero's on purpose: a spirit you can outrun is a spirit nobody
   * ever buys a draught for. It has one pace as well, and for the opposite reason: it does not
   * walk anywhere, it is simply nearer than it was.
   */
  WIGHT_PACE: 5.8,
  /** What its touch costs. Less than the ogre's, and it never stops arriving. */
  WIGHT_TOUCH: 2,
} as const;

/** The creatures this file adds, by the name the kind table knows them under. */
export type MonsterId = 'ogre' | 'wight';

/**
 * The same primitive factories `animals.ts` builds its rigs from. They are private over there, so
 * they are written out again here rather than reached into; exporting them from `animals.ts` and
 * importing them is the tidier end state, and removes this paragraph with it.
 */
type P = PartDef;
const box = (size: number[], offset: [number, number, number], color: number, extra: Partial<P> = {}): P =>
  ({ shape: 'box', size, offset, color, ...extra });
const ico = (r: number, offset: [number, number, number], color: number, extra: Partial<P> = {}): P =>
  ({ shape: 'ico', size: [r], offset, color, ...extra });
const cone = (rBottom: number, h: number, offset: [number, number, number], color: number, extra: Partial<P> = {}): P =>
  ({ shape: 'cone', size: [0, h, rBottom], offset, color, ...extra });

/** Stands in for a palette tint: the instance's own colours are painted over it at spawn. */
const W = 0xffffff;

/**
 * The monsters, in the shape the kind table takes. Merge this into `KINDS` and everything that
 * already knows how to spawn, draw, animate and fight a creature knows how to do it to these.
 *
 * The numbers that decide how a fight goes come from `MONSTER` above. The numbers in the part
 * lists do not: they are a shape, and a shape is read by looking at it rather than by being told.
 */
export const MONSTER_KINDS: Record<MonsterId, AnimalKind> = {
  ogre: {
    id: 'ogre', label: 'Ogre', emoji: '🧌', scale: 2.2, herd: [1, 1], behaviour: 'hunt', timid: false,
    speed: MONSTER.OGRE_PACE, runSpeed: MONSTER.OGRE_PACE,
    hp: MONSTER.OGRE_HP, dangerous: MONSTER.OGRE_HIT,
    gold: [MONSTER.OGRE_GOLD_LOW, MONSTER.OGRE_GOLD_HIGH],
    drop: { id: 'nugget', chance: MONSTER.OGRE_HOARD },
    // no `climb`, so the default step limit applies and a terrace wall is a wall to it. The hero
    // steps up a full terrace and it cannot follow: the second thing you can do about it for free
    palettes: [[0x6d6a5a, 0x494336], [0x5f5548, 0x3e372e], [0x77705e, 0x51493a]],
    names: ['Grendel', 'Old Hunger', 'Stoneshoulder', 'The Thing in the Ruin', 'Bruk-Who-Stayed'],
    lines: ['*the ground comes up through your boots*', '*it has already started walking*', '*a slow, wet breath*'],
    parts: [
      // short legs set well under the mass, so the whole animal reads as weight rather than height
      box([0.36, 0.62, 0.36], [0, 0.31, 0.28], W, { tint: 1, anim: 'legL', pivot: [0, 0.62, 0.28] }),
      box([0.36, 0.62, 0.36], [0, 0.31, -0.28], W, { tint: 1, anim: 'legR', pivot: [0, 0.62, -0.28] }),
      box([0.86, 0.9, 0.94], [0.02, 1.2, 0], W, { tint: 0 }),
      // the hump: from an isometric camera this is most of the silhouette, and it is what says
      // "not a large man" at the distance you still have time to turn round at
      box([0.66, 0.34, 1.06], [-0.1, 1.66, 0], W, { tint: 1 }),
      box([0.44, 0.42, 0.5], [0.3, 1.7, 0], W, { tint: 0, anim: 'head', pivot: [0.02, 1.55, 0] }),
      box([0.09, 0.08, 0.07], [0.5, 1.78, 0.13], 0xf5d76e, { anim: 'head', pivot: [0.02, 1.55, 0] }),
      box([0.09, 0.08, 0.07], [0.5, 1.78, -0.13], 0xf5d76e, { anim: 'head', pivot: [0.02, 1.55, 0] }),
      box([0.1, 0.18, 0.08], [0.48, 1.54, 0.11], 0xe8e0cc, { anim: 'head', pivot: [0.02, 1.55, 0] }),
      box([0.1, 0.18, 0.08], [0.48, 1.54, -0.11], 0xe8e0cc, { anim: 'head', pivot: [0.02, 1.55, 0] }),
      box([0.32, 1.05, 0.32], [0.04, 1.1, 0.62], W, { tint: 1, anim: 'armL', pivot: [0.04, 1.62, 0.62] }),
      box([0.32, 1.05, 0.32], [0.04, 1.1, -0.62], W, { tint: 1, anim: 'armR', pivot: [0.04, 1.62, -0.62] }),
      ico(0.26, [0.04, 0.56, 0.62], W, { tint: 1, anim: 'armL', pivot: [0.04, 1.62, 0.62] }),
      ico(0.26, [0.04, 0.56, -0.62], W, { tint: 1, anim: 'armR', pivot: [0.04, 1.62, -0.62] }),
      // the log it carries, swinging with the arm that holds it: the warning arrives before it does
      box([0.28, 1.5, 0.28], [0.34, 0.85, 0.78], 0x4a3524, { anim: 'armL', pivot: [0.04, 1.62, 0.62], rot: [0, 0, 0.45] }),
    ],
  },

  wight: {
    id: 'wight', label: 'Barrow Wight', emoji: '👻', scale: 1.15, herd: [1, 1], behaviour: 'hunt', timid: false,
    speed: MONSTER.WIGHT_PACE, runSpeed: MONSTER.WIGHT_PACE,
    dangerous: MONSTER.WIGHT_TOUCH,
    // no `hp`, and no gold or drop to go with it. A swing looks for creatures with hit points and
    // finds none here, so the blade goes through; nothing you cannot kill has anything to loot
    palettes: [[0x2b3446, 0xa9d8f0], [0x333040, 0xcfe6f5]],
    names: ['The Pale Watch', 'What Was Buried Here', 'The Cold One', 'A Grey Figure'],
    lines: [
      '*your blade goes through it, and it does not notice*',
      '*the cold arrives a moment before it does*',
      '*it will not follow you off this ground*',
      '*first light is a long way off*',
    ],
    parts: [
      // no legs at all: a hem that narrows away to nothing above the grass. That absence is the
      // tell from any distance, and it is why the walk cycle has nothing to swing down there
      cone(0.4, 0.95, [0, 0.56, 0], W, { tint: 0, rot: [Math.PI, 0, 0] }),
      box([0.34, 0.5, 0.56], [0, 1.06, 0], W, { tint: 0 }),
      box([0.36, 0.38, 0.42], [0, 1.46, 0], W, { tint: 0, anim: 'head', pivot: [0, 1.3, 0] }),
      cone(0.3, 0.44, [0, 1.82, 0], W, { tint: 0, anim: 'head', pivot: [0, 1.3, 0] }),
      // two cold lights where a face is not
      box([0.06, 0.09, 0.06], [0.19, 1.48, 0.1], W, { tint: 1, anim: 'head', pivot: [0, 1.3, 0] }),
      box([0.06, 0.09, 0.06], [0.19, 1.48, -0.1], W, { tint: 1, anim: 'head', pivot: [0, 1.3, 0] }),
      box([0.1, 0.52, 0.1], [0, 1.0, 0.31], W, { tint: 1, anim: 'armL', pivot: [0, 1.26, 0.31] }),
      box([0.1, 0.52, 0.1], [0, 1.0, -0.31], W, { tint: 1, anim: 'armR', pivot: [0, 1.26, -0.31] }),
      box([0.05, 0.8, 0.44], [-0.16, 1.0, 0], W, { tint: 0, anim: 'cape', pivot: [-0.14, 1.3, 0] }),
    ],
  },
};

/** Can a blade reach this creature at all? Anything with no hit points is beyond one. */
export function canBeCut(kind: { hp?: number }): boolean {
  return (kind.hp ?? 0) > 0;
}
