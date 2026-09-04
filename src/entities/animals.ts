import { Biome } from '../world/biomes';
import { MONSTER_KINDS } from './monsters';
import { VILLAIN_KINDS } from './villain';

/**
 * Animal and character definitions. Every creature is a handful of primitive parts with baked
 * colours, drawn through per-part InstancedMesh pools, so a herd of forty costs the same draw
 * calls as one. `anim` tags parts for the walk cycle; `tint` picks one of the instance's palette
 * colours so the same rig gives brown, black and white horses.
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

export type Behaviour = 'graze' | 'wander' | 'prowl' | 'fly' | 'swim' | 'hop' | 'travel' | 'hunt' | 'circle';

export interface AnimalKind {
  id: string;
  label: string;
  emoji: string;
  parts: PartDef[];
  scale: number;
  speed: number;       // tiles per second, walking
  runSpeed: number;
  herd: [number, number];
  behaviour: Behaviour;
  /** Each entry is one palette: up to 3 tints the parts can reference. */
  palettes: number[][];
  names: string[];
  lines: string[];
  altitude?: number;   // fliers
  /** Prey flee from the player; predators do not. */
  timid: boolean;
  /** Max height difference this kind can step across (default STEP_LIMIT). The hero climbs a full terrace. */
  climb?: number;
  /** Damage per bite for predators that attack the hero. */
  dangerous?: number;
  /**
   * Somebody's property. It can be killed like anything else, and the village will find out.
   * Kept on the kind rather than worked out from where it is standing, because a cow that has
   * wandered off is still a cow that belongs to whoever it wandered off from.
   */
  owned?: boolean;
  /** Hit points; creatures with hp can be killed by the hero. */
  hp?: number;
  /** Gold dropped when killed. */
  gold?: [number, number];
  /** Something to carry home, and how often it drops. */
  drop?: { id: string; chance: number };
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

function biped(o: { skin: number; hair: number; shirtTint: number; pantsColor: number; hairTint?: number }): P[] {
  return [
    box([0.3, 0.32, 0.3], [0, 1.32, 0], o.skin, { anim: 'head', pivot: [0, 1.16, 0] }),
    box([0.32, 0.16, 0.32], [0, 1.5, 0], o.hair, { tint: o.hairTint, anim: 'head', pivot: [0, 1.16, 0] }),
    box([0.06, 0.06, 0.05], [0.15, 1.34, 0.07], 0x222222, { anim: 'head', pivot: [0, 1.16, 0] }),
    box([0.06, 0.06, 0.05], [0.15, 1.34, -0.07], 0x222222, { anim: 'head', pivot: [0, 1.16, 0] }),
    box([0.22, 0.44, 0.36], [0, 0.94, 0], 0xffffff, { tint: o.shirtTint }),
    box([0.1, 0.4, 0.1], [0, 0.94, 0.25], o.skin, { anim: 'armL', pivot: [0, 1.14, 0.25] }),
    box([0.1, 0.4, 0.1], [0, 0.94, -0.25], o.skin, { anim: 'armR', pivot: [0, 1.14, -0.25] }),
    box([0.13, 0.46, 0.13], [0, 0.49, 0.09], o.pantsColor, { anim: 'legL', pivot: [0, 0.72, 0.09] }),
    box([0.13, 0.46, 0.13], [0, 0.49, -0.09], o.pantsColor, { anim: 'legR', pivot: [0, 0.72, -0.09] }),
    box([0.2, 0.08, 0.13], [0.03, 0.04, 0.09], 0x3a2a1a, { anim: 'legL', pivot: [0, 0.72, 0.09] }),
    box([0.2, 0.08, 0.13], [0.03, 0.04, -0.09], 0x3a2a1a, { anim: 'legR', pivot: [0, 0.72, -0.09] }),
  ];
}

const W = 0xffffff;

export const KINDS: Record<string, AnimalKind> = {
  // the things that are not wildlife, kept in their own file because they are not animals
  ...MONSTER_KINDS,
  ...VILLAIN_KINDS,
  cow: {
    id: 'cow', label: 'Cow', emoji: '🐄', scale: 1.15, speed: 0.9, runSpeed: 3, herd: [3, 6], behaviour: 'graze', timid: true, hp: 6, owned: true, drop: { id: 'meat', chance: 1 },
    palettes: [[0xf2f2f2], [0x6b4a2b], [0x2b2b2b], [0xd9c3a3]],
    names: ['Bessie', 'Daisy', 'Clover', 'Buttercup', 'Maple', 'Moo'],
    lines: ['Moooo~', 'Got hay?', '*chews cud*', '*swishes tail*'],
    parts: quadruped({
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
    }),
  },
  sheep: {
    id: 'sheep', label: 'Sheep', emoji: '🐑', scale: 0.85, speed: 0.9, runSpeed: 3.2, herd: [4, 8], behaviour: 'graze', timid: true, hp: 4, owned: true, drop: { id: 'meat', chance: 1 },
    palettes: [[0xf4f1e6], [0xe8e0cc], [0x3a3a3a]],
    names: ['Dolly', 'Woolly', 'Shaun', 'Baa', 'Fluff', 'Nimbus'],
    lines: ['Baaa.', '*nibbles*', '*stares blankly*', 'Baa?'],
    parts: quadruped({
      body: [0.7, 0.5, 0.5], bodyY: 0.55, legH: 0.3, legW: 0.1, head: [0.26, 0.24, 0.22], headOffset: [0.45, 0.6, 0],
      bodyColor: W, bodyTint: 0, legColor: 0x2b2b2b, headColor: 0x2b2b2b, headTint: undefined,
      extras: [box([0.05, 0.1, 0.05], [0.4, 0.74, 0.1], 0x2b2b2b, { anim: 'head', pivot: [0.32, 0.6, 0] }), box([0.05, 0.1, 0.05], [0.4, 0.74, -0.1], 0x2b2b2b, { anim: 'head', pivot: [0.32, 0.6, 0] })],
    }),
  },
  horse: {
    id: 'horse', label: 'Horse', emoji: '🐴', scale: 1.25, speed: 1.4, runSpeed: 5, herd: [2, 4], behaviour: 'graze', timid: true, hp: 8, owned: true, drop: { id: 'meat', chance: 1 },
    palettes: [[0x7a4a2a, 0x2b1a10], [0x2b2b2b, 0x111111], [0xe8e0d0, 0xcfc4b0], [0xb5652f, 0xf0e8d8]],
    names: ['Epona', 'Storm', 'Chestnut', 'Willow', 'Comet', 'Dusty'],
    lines: ['*neighs*', '*snorts*', '*stamps hoof*', 'Nicker~'],
    parts: quadruped({
      body: [1.0, 0.5, 0.42], bodyY: 0.85, legH: 0.6, legW: 0.1, head: [0.4, 0.22, 0.2], headOffset: [0.85, 1.25, 0],
      neck: [0.22, 0.55, 0.2], neckOffset: [0.55, 1.1, 0], neckRot: -0.6,
      bodyColor: W, bodyTint: 0,
      tail: { size: [0.06, 0.45, 0.06], offset: [-0.5, 0.75, 0], color: W, tint: 1, rot: [0, 0, 0.5] },
      extras: [box([0.5, 0.08, 0.08], [0.55, 1.36, 0], W, { tint: 1, rot: [0, 0, -0.6] }), box([0.05, 0.1, 0.04], [0.72, 1.4, 0.07], W, { tint: 0, anim: 'head', pivot: [0.65, 1.25, 0] }), box([0.05, 0.1, 0.04], [0.72, 1.4, -0.07], W, { tint: 0, anim: 'head', pivot: [0.65, 1.25, 0] })],
    }),
  },
  chicken: {
    id: 'chicken', label: 'Chicken', emoji: '🐔', scale: 0.75, speed: 1.2, runSpeed: 3.5, herd: [3, 6], behaviour: 'hop', timid: true, hp: 1, owned: true, drop: { id: 'meat', chance: 1 },
    palettes: [[0xffffff], [0xc9803a], [0x3a3a3a]],
    names: ['Nugget', 'Clucky', 'Pecky', 'Henrietta', 'Bawk'],
    lines: ['Bawk!', '*pecks*', 'Cluck~', 'BUG!'],
    parts: [
      ico(0.24, [0, 0.36, 0], W, { tint: 0 }),
      ico(0.13, [0.18, 0.56, 0], W, { tint: 0, anim: 'head', pivot: [0.1, 0.45, 0] }),
      box([0.06, 0.1, 0.03], [0.18, 0.68, 0], 0xdd3322, { anim: 'head', pivot: [0.1, 0.45, 0] }),
      cone(0.04, 0.1, [0.31, 0.54, 0], 0xffaa00, { rot: [0, 0, -Math.PI / 2], anim: 'head', pivot: [0.1, 0.45, 0] }),
      cyl(0.015, 0.14, [0.03, 0.09, 0.06], 0xee9900, { anim: 'legL', pivot: [0.03, 0.16, 0.06] }),
      cyl(0.015, 0.14, [0.03, 0.09, -0.06], 0xee9900, { anim: 'legR', pivot: [0.03, 0.16, -0.06] }),
      box([0.12, 0.16, 0.03], [-0.2, 0.44, 0], W, { tint: 0, anim: 'tail', rot: [0, 0, 0.7] }),
    ],
  },
  deer: {
    id: 'deer', label: 'Deer', emoji: '🦌', scale: 1.1, speed: 1.2, runSpeed: 5.5, herd: [2, 5], behaviour: 'graze', timid: true, hp: 3, drop: { id: 'meat', chance: 0.8 },
    palettes: [[0xa87a4a, 0xe8d8c0], [0x8a6238, 0xe0d0b8]],
    names: ['Fawn', 'Bramble', 'Hazel', 'Rowan', 'Thistle'],
    lines: ['*ears twitch*', '*freezes*', '*nibbles leaves*', '*bounds away*'],
    parts: quadruped({
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
    }),
  },
  rabbit: {
    id: 'rabbit', label: 'Rabbit', emoji: '🐇', scale: 0.6, speed: 1.5, runSpeed: 4.5, herd: [2, 5], behaviour: 'hop', timid: true, hp: 1, drop: { id: 'meat', chance: 0.9 },
    palettes: [[0xb08a5a], [0x8a8a8a], [0xf2f2f2], [0x5a4a3a]],
    names: ['Thumper', 'Clover', 'Nibbles', 'Hazel', 'Flopsy'],
    lines: ['*twitches nose*', '*thumps*', '*nibbles*', '*hops off*'],
    parts: [
      box([0.5, 0.32, 0.3], [0, 0.26, 0], W, { tint: 0 }),
      box([0.28, 0.24, 0.24], [0.3, 0.42, 0], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0] }),
      box([0.06, 0.3, 0.1], [0.28, 0.66, 0.07], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0], rot: [0, 0, -0.2] }),
      box([0.06, 0.3, 0.1], [0.28, 0.66, -0.07], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0], rot: [0, 0, -0.2] }),
      ico(0.07, [-0.26, 0.3, 0], 0xf6f6f6, { anim: 'tail' }),
      box([0.1, 0.16, 0.08], [0.16, 0.08, 0.1], W, { tint: 0, anim: 'legL', pivot: [0.16, 0.16, 0.1] }),
      box([0.1, 0.16, 0.08], [0.16, 0.08, -0.1], W, { tint: 0, anim: 'legR', pivot: [0.16, 0.16, -0.1] }),
      box([0.2, 0.16, 0.1], [-0.14, 0.08, 0.1], W, { tint: 0, anim: 'legR', pivot: [-0.14, 0.16, 0.1] }),
      box([0.2, 0.16, 0.1], [-0.14, 0.08, -0.1], W, { tint: 0, anim: 'legL', pivot: [-0.14, 0.16, -0.1] }),
    ],
  },
  fox: {
    id: 'fox', label: 'Fox', emoji: '🦊', scale: 0.75, speed: 1.6, runSpeed: 5, herd: [1, 2], behaviour: 'prowl', timid: false, hp: 2, drop: { id: 'meat', chance: 0.7 },
    palettes: [[0xe0702a, 0xf4ede0]],
    names: ['Rusty', 'Ember', 'Vixen', 'Sly', 'Cinder'],
    lines: ['*yips*', '*sniffs the air*', '*watches you*', '*pounces at nothing*'],
    parts: quadruped({
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
    }),
  },
  bear: {
    id: 'bear', label: 'Bear', emoji: '🐻', scale: 1.5, speed: 0.8, runSpeed: 4, herd: [1, 2], behaviour: 'prowl', timid: false, dangerous: 2, hp: 6, gold: [15, 40], drop: { id: 'fang', chance: 0.45 },
    palettes: [[0x5a3a22, 0x8a6a4a], [0x2b2b2b, 0x5a5a5a]],
    names: ['Bruno', 'Grizz', 'Mabel', 'Kodiak', 'Honey'],
    lines: ['*low growl*', '*sniffs*', '*scratches tree*', '*yawns hugely*'],
    parts: quadruped({
      body: [0.9, 0.6, 0.55], bodyY: 0.62, legH: 0.36, legW: 0.16, legInset: 0.16, head: [0.36, 0.34, 0.34], headOffset: [0.56, 0.78, 0],
      bodyColor: W, bodyTint: 0,
      extras: [
        box([0.16, 0.12, 0.2], [0.74, 0.7, 0], W, { tint: 1, anim: 'head', pivot: [0.38, 0.78, 0] }),
        box([0.06, 0.05, 0.08], [0.82, 0.74, 0], 0x111111, { anim: 'head', pivot: [0.38, 0.78, 0] }),
        ico(0.07, [0.5, 0.98, 0.14], W, { tint: 0, anim: 'head', pivot: [0.38, 0.78, 0] }),
        ico(0.07, [0.5, 0.98, -0.14], W, { tint: 0, anim: 'head', pivot: [0.38, 0.78, 0] }),
      ],
    }),
  },
  camel: {
    id: 'camel', label: 'Camel', emoji: '🐪', scale: 1.3, speed: 1.0, runSpeed: 3.5, herd: [2, 4], behaviour: 'graze', timid: true, hp: 8, owned: true, drop: { id: 'meat', chance: 1 },
    palettes: [[0xc9a26a], [0xb08a50], [0xd8bb8a]],
    names: ['Sahara', 'Dune', 'Sirocco', 'Mirage', 'Amber'],
    lines: ['*chews slowly*', '*spits*', '*hums*', '*blinks lazily*'],
    parts: quadruped({
      body: [1.0, 0.46, 0.4], bodyY: 0.92, legH: 0.7, legW: 0.1, head: [0.34, 0.2, 0.18], headOffset: [0.9, 1.4, 0],
      neck: [0.18, 0.62, 0.18], neckOffset: [0.6, 1.2, 0], neckRot: -0.45,
      bodyColor: W, bodyTint: 0,
      tail: { size: [0.05, 0.3, 0.05], offset: [-0.5, 0.85, 0], color: W, tint: 0 },
      extras: [ico(0.26, [-0.05, 1.2, 0], W, { tint: 0 })],
    }),
  },
  lizard: {
    id: 'lizard', label: 'Lizard', emoji: '🦎', scale: 0.5, speed: 1.2, runSpeed: 4, herd: [1, 3], behaviour: 'wander', timid: true,
    palettes: [[0x7fa33a], [0xb08a3a], [0x5a8a5a]],
    names: ['Ziggy', 'Gecko', 'Scales', 'Dusty', 'Basil'],
    lines: ['*basks*', '*flicks tongue*', '*skitters*', '*does push-ups*'],
    parts: [
      box([0.6, 0.14, 0.24], [0, 0.1, 0], W, { tint: 0 }),
      box([0.24, 0.12, 0.18], [0.4, 0.12, 0], W, { tint: 0, anim: 'head', pivot: [0.28, 0.1, 0] }),
      box([0.5, 0.08, 0.08], [-0.55, 0.08, 0], W, { tint: 0, anim: 'tail', pivot: [-0.3, 0.08, 0] }),
      box([0.08, 0.1, 0.16], [0.2, 0.06, 0.18], W, { tint: 0, anim: 'legL', pivot: [0.2, 0.1, 0.12] }),
      box([0.08, 0.1, 0.16], [0.2, 0.06, -0.18], W, { tint: 0, anim: 'legR', pivot: [0.2, 0.1, -0.12] }),
      box([0.08, 0.1, 0.16], [-0.2, 0.06, 0.18], W, { tint: 0, anim: 'legR', pivot: [-0.2, 0.1, 0.12] }),
      box([0.08, 0.1, 0.16], [-0.2, 0.06, -0.18], W, { tint: 0, anim: 'legL', pivot: [-0.2, 0.1, -0.12] }),
    ],
  },
  vulture: {
    id: 'vulture', label: 'Vulture', emoji: '🦅', scale: 0.9, speed: 2.5, runSpeed: 2.5, herd: [1, 3], behaviour: 'fly', timid: false, altitude: 7, hp: 2, gold: [4, 12], drop: { id: 'bone', chance: 0.3 },
    palettes: [[0x3a3a3a, 0xe0a0a0]],
    names: ['Scavenger', 'Gloom', 'Vulpecula', 'Carrion'],
    lines: ['*circles*', '*screeches*', '*eyes you hungrily*'],
    parts: [
      box([0.5, 0.18, 0.22], [0, 0, 0], W, { tint: 0 }),
      ico(0.1, [0.32, 0.06, 0], W, { tint: 1, anim: 'head', pivot: [0.2, 0, 0] }),
      cone(0.03, 0.12, [0.44, 0.04, 0], 0xd0b040, { rot: [0, 0, -Math.PI / 2] }),
      box([0.4, 0.04, 0.9], [0, 0.06, 0.55], W, { tint: 0, anim: 'wingL', pivot: [0, 0.06, 0.1] }),
      box([0.4, 0.04, 0.9], [0, 0.06, -0.55], W, { tint: 0, anim: 'wingR', pivot: [0, 0.06, -0.1] }),
      box([0.24, 0.04, 0.3], [-0.34, 0.02, 0], W, { tint: 0, anim: 'tail' }),
    ],
  },
  frog: {
    id: 'frog', label: 'Frog', emoji: '🐸', scale: 0.4, speed: 1.4, runSpeed: 3.5, herd: [2, 5], behaviour: 'hop', timid: true,
    palettes: [[0x5fa83a], [0x8ab04a], [0x3a7a3a]],
    names: ['Ribbit', 'Hopper', 'Croak', 'Lily', 'Puddle'],
    lines: ['Ribbit!', '*croaks*', '*blinks*', '*splash*'],
    parts: [
      box([0.5, 0.26, 0.4], [0, 0.18, 0], W, { tint: 0 }),
      ico(0.08, [0.2, 0.36, 0.12], 0xf5e04a, { anim: 'head', pivot: [0.1, 0.25, 0] }),
      ico(0.08, [0.2, 0.36, -0.12], 0xf5e04a, { anim: 'head', pivot: [0.1, 0.25, 0] }),
      box([0.3, 0.12, 0.12], [-0.2, 0.08, 0.25], W, { tint: 0, anim: 'legL', pivot: [-0.1, 0.14, 0.25] }),
      box([0.3, 0.12, 0.12], [-0.2, 0.08, -0.25], W, { tint: 0, anim: 'legR', pivot: [-0.1, 0.14, -0.25] }),
      box([0.1, 0.16, 0.08], [0.2, 0.08, 0.2], W, { tint: 0, anim: 'legR', pivot: [0.2, 0.16, 0.2] }),
      box([0.1, 0.16, 0.08], [0.2, 0.08, -0.2], W, { tint: 0, anim: 'legL', pivot: [0.2, 0.16, -0.2] }),
    ],
  },
  duck: {
    id: 'duck', label: 'Duck', emoji: '🦆', scale: 0.6, speed: 0.8, runSpeed: 2, herd: [2, 5], behaviour: 'swim', timid: true, hp: 1, drop: { id: 'meat', chance: 0.9 },
    palettes: [[0x4a6a3a, 0x7a5a3a], [0xf4f0e0, 0xf4f0e0], [0x6a4a2a, 0x8a6a4a]],
    names: ['Quackers', 'Puddles', 'Mallard', 'Waddles', 'Splash'],
    lines: ['Quack!', '*paddles*', '*dabbles*', '*preens*'],
    parts: [
      box([0.5, 0.22, 0.32], [0, 0.16, 0], W, { tint: 1 }),
      ico(0.12, [0.26, 0.42, 0], W, { tint: 0, anim: 'head', pivot: [0.16, 0.3, 0] }),
      cyl(0.06, 0.22, [0.18, 0.3, 0], W, { tint: 0 }),
      box([0.14, 0.05, 0.1], [0.38, 0.4, 0], 0xf0a020, { anim: 'head', pivot: [0.16, 0.3, 0] }),
      box([0.16, 0.06, 0.12], [-0.28, 0.22, 0], W, { tint: 1, anim: 'tail', rot: [0, 0, 0.5] }),
    ],
  },
  shark: {
    id: 'shark', label: 'Shark', emoji: '🦈', scale: 1.5, speed: 1.6, runSpeed: 6.5, herd: [2, 3], behaviour: 'circle', timid: false,
    dangerous: 2, hp: 5, gold: [12, 30], drop: { id: 'fang', chance: 0.5 },
    palettes: [[0x39464f, 0xdfe6ea], [0x2d383f, 0xd4dde3]],
    names: ['Grey', 'Notch', 'Old Scar', 'The Fin'],
    lines: ['*circles*', '*a fin cuts the water*'],
    parts: [
      box([1.5, 0.42, 0.5], [0, 0.1, 0], W, { tint: 0 }),
      box([1.45, 0.2, 0.46], [0, -0.04, 0], W, { tint: 1 }),
      cone(0.26, 0.6, [0.92, 0.08, 0], W, { tint: 0, rot: [0, 0, -Math.PI / 2] }),
      // the fin, raked back: from a boat this is the whole animal
      cone(0.24, 0.95, [-0.05, 0.62, 0], W, { tint: 0, rot: [0, 0, -0.3] }),
      box([0.1, 0.5, 0.5], [-0.92, 0.16, 0], W, { tint: 0, anim: 'tail', pivot: [-0.7, 0.1, 0] }),
      box([0.36, 0.08, 0.3], [0.2, -0.1, 0.3], W, { tint: 0, rot: [0.3, 0, 0] }),
      box([0.36, 0.08, 0.3], [0.2, -0.1, -0.3], W, { tint: 0, rot: [-0.3, 0, 0] }),
    ],
  },
  orca: {
    id: 'orca', label: 'Orca', emoji: '🐋', scale: 2.1, speed: 1.9, runSpeed: 7.5, herd: [1, 2], behaviour: 'circle', timid: false,
    dangerous: 3, hp: 9, gold: [30, 70], drop: { id: 'fang', chance: 0.7 },
    palettes: [[0x1c2026, 0xf2f5f7]],
    names: ['Blackfin', 'Two-Patch', 'The Matriarch', 'Cutwater'],
    lines: ['*rolls to look at you*', '*breathes out hard*'],
    parts: [
      box([1.7, 0.55, 0.62], [0, 0.12, 0], W, { tint: 0 }),
      box([1.6, 0.26, 0.58], [0, -0.08, 0], W, { tint: 1 }),
      box([0.3, 0.16, 0.2], [0.5, 0.3, 0.24], W, { tint: 1 }),
      box([0.3, 0.16, 0.2], [0.5, 0.3, -0.24], W, { tint: 1 }),
      cone(0.3, 0.55, [1.0, 0.1, 0], W, { tint: 0, rot: [0, 0, -Math.PI / 2] }),
      cone(0.22, 0.8, [0, 0.7, 0], W, { tint: 0 }),
      box([0.12, 0.6, 0.66], [-1.05, 0.18, 0], W, { tint: 0, anim: 'tail', pivot: [-0.8, 0.12, 0] }),
      box([0.44, 0.09, 0.34], [0.24, -0.12, 0.36], W, { tint: 0, rot: [0.35, 0, 0] }),
      box([0.44, 0.09, 0.34], [0.24, -0.12, -0.36], W, { tint: 0, rot: [-0.35, 0, 0] }),
    ],
  },
  heron: {
    id: 'heron', label: 'Heron', emoji: '🪶', scale: 1.0, speed: 0.6, runSpeed: 2, herd: [1, 2], behaviour: 'wander', timid: true, hp: 1, drop: { id: 'meat', chance: 0.8 },
    palettes: [[0x9aa8b4, 0xe8eef2]],
    names: ['Stilt', 'Grey', 'Reed', 'Patience'],
    lines: ['*stands perfectly still*', '*stalks*', '*strikes at a fish*'],
    parts: [
      box([0.5, 0.26, 0.28], [0, 0.75, 0], W, { tint: 0 }),
      cyl(0.05, 0.55, [0.22, 1.1, 0], W, { tint: 1, rot: [0, 0, -0.3] }),
      ico(0.1, [0.34, 1.38, 0], W, { tint: 1, anim: 'head', pivot: [0.3, 1.3, 0] }),
      cone(0.03, 0.3, [0.5, 1.36, 0], 0xe0b040, { rot: [0, 0, -Math.PI / 2], anim: 'head', pivot: [0.3, 1.3, 0] }),
      cyl(0.025, 0.6, [0.02, 0.3, 0.07], 0x3a3a3a, { anim: 'legL', pivot: [0.02, 0.6, 0.07] }),
      cyl(0.025, 0.6, [0.02, 0.3, -0.07], 0x3a3a3a, { anim: 'legR', pivot: [0.02, 0.6, -0.07] }),
      box([0.2, 0.04, 0.16], [-0.3, 0.8, 0], W, { tint: 0, anim: 'tail' }),
    ],
  },
  goat: {
    id: 'goat', label: 'Goat', emoji: '🐐', scale: 0.9, speed: 1.1, runSpeed: 4, herd: [2, 5], behaviour: 'graze', timid: true, hp: 3, drop: { id: 'meat', chance: 0.7 },
    palettes: [[0xe8e0d0], [0x8a8a8a], [0x5a4a3a], [0xd8c8a8]],
    names: ['Billy', 'Nanny', 'Crag', 'Pebble', 'Scramble'],
    lines: ['*bleats*', '*chews*', '*headbutts rock*', 'Meh-eh-eh'],
    parts: quadruped({
      body: [0.66, 0.4, 0.34], bodyY: 0.58, legH: 0.4, legW: 0.09, head: [0.3, 0.22, 0.2], headOffset: [0.52, 0.78, 0],
      neck: [0.16, 0.34, 0.16], neckOffset: [0.4, 0.68, 0], neckRot: -0.5,
      bodyColor: W, bodyTint: 0,
      tail: { size: [0.05, 0.12, 0.05], offset: [-0.34, 0.72, 0], color: W, tint: 0, rot: [0, 0, -0.6] },
      extras: [
        cone(0.04, 0.24, [0.48, 0.98, 0.07], 0x6b5a4a, { rot: [0, 0, 0.6], anim: 'head', pivot: [0.37, 0.78, 0] }),
        cone(0.04, 0.24, [0.48, 0.98, -0.07], 0x6b5a4a, { rot: [0, 0, 0.6], anim: 'head', pivot: [0.37, 0.78, 0] }),
        box([0.06, 0.16, 0.05], [0.6, 0.62, 0], W, { tint: 0, anim: 'head', pivot: [0.37, 0.78, 0] }),
      ],
    }),
  },
  eagle: {
    id: 'eagle', label: 'Eagle', emoji: '🦅', scale: 1.0, speed: 3, runSpeed: 3, herd: [1, 2], behaviour: 'fly', timid: false, altitude: 9, hp: 2, gold: [6, 18], drop: { id: 'fang', chance: 0.2 },
    palettes: [[0x5a3a22, 0xf4f0e8]],
    names: ['Talon', 'Skye', 'Aquila', 'Summit'],
    lines: ['*soars*', '*cries out*', '*scans the ground*'],
    parts: [
      box([0.5, 0.18, 0.22], [0, 0, 0], W, { tint: 0 }),
      ico(0.1, [0.32, 0.06, 0], W, { tint: 1, anim: 'head', pivot: [0.2, 0, 0] }),
      cone(0.03, 0.12, [0.44, 0.04, 0], 0xf0c040, { rot: [0, 0, -Math.PI / 2] }),
      box([0.42, 0.04, 1.0], [0, 0.06, 0.6], W, { tint: 0, anim: 'wingL', pivot: [0, 0.06, 0.1] }),
      box([0.42, 0.04, 1.0], [0, 0.06, -0.6], W, { tint: 0, anim: 'wingR', pivot: [0, 0.06, -0.1] }),
      box([0.24, 0.04, 0.3], [-0.34, 0.02, 0], W, { tint: 1, anim: 'tail' }),
    ],
  },
  hare: {
    id: 'hare', label: 'Snow Hare', emoji: '🐇', scale: 0.65, speed: 1.6, runSpeed: 5, herd: [2, 4], behaviour: 'hop', timid: true, hp: 1, drop: { id: 'meat', chance: 0.9 },
    palettes: [[0xf6f6f6], [0xe8e8f0]],
    names: ['Frost', 'Flurry', 'Drift', 'Powder'],
    lines: ['*twitches*', '*sniffs snow*', '*bounds off*'],
    parts: [
      box([0.5, 0.32, 0.3], [0, 0.26, 0], W, { tint: 0 }),
      box([0.28, 0.24, 0.24], [0.3, 0.42, 0], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0] }),
      box([0.06, 0.32, 0.1], [0.28, 0.66, 0.07], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0], rot: [0, 0, -0.2] }),
      box([0.06, 0.32, 0.1], [0.28, 0.66, -0.07], W, { tint: 0, anim: 'head', pivot: [0.2, 0.35, 0], rot: [0, 0, -0.2] }),
      box([0.1, 0.16, 0.08], [0.16, 0.08, 0.1], W, { tint: 0, anim: 'legL', pivot: [0.16, 0.16, 0.1] }),
      box([0.1, 0.16, 0.08], [0.16, 0.08, -0.1], W, { tint: 0, anim: 'legR', pivot: [0.16, 0.16, -0.1] }),
      box([0.2, 0.16, 0.1], [-0.14, 0.08, 0.1], W, { tint: 0, anim: 'legR', pivot: [-0.14, 0.16, 0.1] }),
      box([0.2, 0.16, 0.1], [-0.14, 0.08, -0.1], W, { tint: 0, anim: 'legL', pivot: [-0.14, 0.16, -0.1] }),
    ],
  },
  wolf: {
    id: 'wolf', label: 'Wolf', emoji: '🐺', scale: 0.95, speed: 1.5, runSpeed: 5.5, herd: [2, 4], behaviour: 'prowl', timid: false, dangerous: 1, hp: 3, gold: [8, 20], drop: { id: 'pelt', chance: 0.5 },
    palettes: [[0x8a8a8a, 0xd8d8d8], [0x5a5a5a, 0xa8a8a8], [0xe8e8e8, 0xffffff]],
    names: ['Fang', 'Luna', 'Ghost', 'Ash', 'Howl'],
    lines: ['*low growl*', '*howls*', '*watches you*', '*pads silently*'],
    parts: quadruped({
      body: [0.76, 0.32, 0.28], bodyY: 0.5, legH: 0.36, legW: 0.08, head: [0.3, 0.22, 0.22], headOffset: [0.52, 0.62, 0],
      bodyColor: W, bodyTint: 0,
      tail: { size: [0.4, 0.1, 0.1], offset: [-0.55, 0.5, 0], color: W, tint: 0, rot: [0, 0, 0.3] },
      extras: [
        box([0.16, 0.1, 0.14], [0.7, 0.56, 0], W, { tint: 1, anim: 'head', pivot: [0.37, 0.62, 0] }),
        box([0.05, 0.12, 0.06], [0.45, 0.78, 0.08], W, { tint: 0, anim: 'head', pivot: [0.37, 0.62, 0] }),
        box([0.05, 0.12, 0.06], [0.45, 0.78, -0.08], W, { tint: 0, anim: 'head', pivot: [0.37, 0.62, 0] }),
        box([0.4, 0.14, 0.24], [0, 0.34, 0], W, { tint: 1 }),
      ],
    }),
  },
  elk: {
    id: 'elk', label: 'Elk', emoji: '🦌', scale: 1.35, speed: 1.1, runSpeed: 5, herd: [2, 4], behaviour: 'graze', timid: true, hp: 5, drop: { id: 'meat', chance: 0.9 },
    palettes: [[0x5a4232, 0xd8c8b0], [0x6a5040, 0xe0d0b8]],
    names: ['Antler', 'Bram', 'Tundra', 'Moss'],
    lines: ['*snorts steam*', '*bellows*', '*paws the snow*'],
    parts: quadruped({
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
    }),
  },
  traveller: {
    id: 'traveller', label: 'Traveller', emoji: '🧑', scale: 1.0, speed: 1.3, runSpeed: 1.3, herd: [1, 2], behaviour: 'travel', timid: false, hp: 5,
    palettes: [
      [0xe74c3c, 0x2c1810], [0x3498db, 0x8b4513], [0x2ecc71, 0xffd700], [0x9b59b6, 0x6c5ce7], [0xf39c12, 0x00ced1],
      [0x1abc9c, 0xff69b4], [0xe91e63, 0x2c1810], [0x00bcd4, 0xff4500],
    ],
    names: ['Alex', 'Nova', 'Kai', 'Zeph', 'Mira', 'Tolan', 'Wren', 'Idris', 'Suri', 'Bram'],
    lines: ['Hello!', '*waves*', 'Nice day for a walk.', 'The road goes on and on...', 'Seen any bears?', 'Hi there~', 'Mind the cliffs.'],
    parts: biped({ skin: 0xffdab9, hair: W, hairTint: 1, shirtTint: 0, pantsColor: 0x334466 }),
  },
  villager: {
    id: 'villager', label: 'Villager', emoji: '🧑‍🌾', scale: 1.0, speed: 1.1, runSpeed: 1.1, herd: [2, 4], behaviour: 'wander', timid: false, hp: 6,
    palettes: [
      [0xc0392b, 0x2c1810], [0x2980b9, 0x8b4513], [0x27ae60, 0xffd700], [0x8e44ad, 0x6c5ce7], [0xd35400, 0x00ced1],
      [0x16a085, 0xff69b4], [0x7f8c8d, 0x2c1810], [0xf1c40f, 0x4a2a10],
    ],
    names: ['Ella', 'Tomas', 'Greta', 'Piet', 'Anouk', 'Rolf', 'Maren', 'Jory', 'Hild', 'Oskar'],
    lines: ['Welcome to {village}!', 'Not much happens in {village}, and we like it that way.', 'The well water here is the sweetest around.', 'Watch the road at night.', 'Lovely weather for it.', 'Have you seen the old ruins?', '{village} has stood here for generations.'],
    parts: biped({ skin: 0xffdab9, hair: W, hairTint: 1, shirtTint: 0, pantsColor: 0x4a3a2a }),
  },
  rat: {
    id: 'rat', label: 'Cave Rat', emoji: '🐀', scale: 0.6, speed: 1.6, runSpeed: 3.4, herd: [2, 4], behaviour: 'hunt', timid: false, dangerous: 1, hp: 2, gold: [2, 8],
    palettes: [[0x6a5a4a, 0xd8b8a8], [0x4a4a4a, 0xb8b8b8]],
    names: ['Gnasher', 'Scritch', 'Whisker', 'Nibbler'],
    lines: ['*hisses*', '*scurries*'],
    parts: quadruped({
      body: [0.5, 0.22, 0.22], bodyY: 0.26, legH: 0.14, legW: 0.06, head: [0.22, 0.18, 0.18], headOffset: [0.34, 0.32, 0],
      bodyColor: W, bodyTint: 0,
      tail: { size: [0.5, 0.05, 0.05], offset: [-0.5, 0.24, 0], color: W, tint: 1, rot: [0, 0, 0.2] },
      extras: [
        box([0.08, 0.1, 0.03], [0.28, 0.44, 0.08], W, { tint: 1, anim: 'head', pivot: [0.23, 0.32, 0] }),
        box([0.08, 0.1, 0.03], [0.28, 0.44, -0.08], W, { tint: 1, anim: 'head', pivot: [0.23, 0.32, 0] }),
        box([0.1, 0.06, 0.08], [0.46, 0.28, 0], W, { tint: 1, anim: 'head', pivot: [0.23, 0.32, 0] }),
      ],
    }),
  },
  bat: {
    id: 'bat', label: 'Bat', emoji: '🦇', scale: 0.7, speed: 3.2, runSpeed: 3.2, herd: [2, 4], behaviour: 'fly', timid: false, dangerous: 1, hp: 1, gold: [1, 5], altitude: 2.4,
    palettes: [[0x3a2a3a, 0x7a5a7a]],
    names: ['Flitter', 'Dusk', 'Screech'],
    lines: ['*screeches*'],
    parts: [
      ico(0.16, [0, 0, 0], W, { tint: 0 }),
      box([0.08, 0.12, 0.04], [0.02, 0.16, 0.06], W, { tint: 0 }),
      box([0.08, 0.12, 0.04], [0.02, 0.16, -0.06], W, { tint: 0 }),
      box([0.3, 0.03, 0.55], [0, 0.04, 0.34], W, { tint: 1, anim: 'wingL', pivot: [0, 0.04, 0.08] }),
      box([0.3, 0.03, 0.55], [0, 0.04, -0.34], W, { tint: 1, anim: 'wingR', pivot: [0, 0.04, -0.08] }),
    ],
  },
  slime: {
    id: 'slime', label: 'Slime', emoji: '🟢', scale: 0.8, speed: 1.0, runSpeed: 2.2, herd: [1, 3], behaviour: 'hunt', timid: false, dangerous: 1, hp: 3, gold: [4, 12], drop: { id: 'gem', chance: 0.08 },
    palettes: [[0x4fbf6f], [0x4f8fbf], [0xbf5f8f]],
    names: ['Blob', 'Squish', 'Ooze', 'Gel'],
    lines: ['*squelch*', '*wobbles*'],
    parts: [
      ico(0.42, [0, 0.32, 0], W, { tint: 0, anim: 'head', pivot: [0, 0, 0] }),
      ico(0.16, [0.22, 0.42, 0.14], 0x111111, { anim: 'head', pivot: [0, 0, 0] }),
      ico(0.16, [0.22, 0.42, -0.14], 0x111111, { anim: 'head', pivot: [0, 0, 0] }),
    ],
  },
  skeleton: {
    id: 'skeleton', label: 'Skeleton', emoji: '💀', scale: 1.0, speed: 1.5, runSpeed: 3.0, herd: [1, 2], behaviour: 'hunt', timid: false, dangerous: 2, hp: 4, gold: [10, 25], drop: { id: 'bone', chance: 0.6 },
    palettes: [[0xe8e4d8, 0x5a4632]],
    names: ['Bones', 'Rattle', 'Marrow', 'Grim'],
    lines: ['*clatters*', '*jaw creaks*'],
    parts: [
      box([0.28, 0.3, 0.28], [0, 1.3, 0], W, { tint: 0, anim: 'head', pivot: [0, 1.12, 0] }),
      box([0.07, 0.07, 0.05], [0.15, 1.34, 0.07], 0x111111, { anim: 'head', pivot: [0, 1.12, 0] }),
      box([0.07, 0.07, 0.05], [0.15, 1.34, -0.07], 0x111111, { anim: 'head', pivot: [0, 1.12, 0] }),
      box([0.16, 0.42, 0.3], [0, 0.92, 0], W, { tint: 0 }),
      box([0.08, 0.4, 0.08], [0, 0.94, 0.22], W, { tint: 0, anim: 'armL', pivot: [0, 1.12, 0.22] }),
      box([0.08, 0.4, 0.08], [0, 0.94, -0.22], W, { tint: 0, anim: 'armR', pivot: [0, 1.12, -0.22] }),
      box([0.1, 0.44, 0.1], [0, 0.48, 0.08], W, { tint: 0, anim: 'legL', pivot: [0, 0.7, 0.08] }),
      box([0.1, 0.44, 0.1], [0, 0.48, -0.08], W, { tint: 0, anim: 'legR', pivot: [0, 0.7, -0.08] }),
      box([0.06, 0.7, 0.06], [0.1, 0.85, 0.3], W, { tint: 1, anim: 'armL', pivot: [0, 1.12, 0.22], rot: [0, 0, 0.3] }),
    ],
  },
  troll: {
    id: 'troll', label: 'Cave Troll', emoji: '👹', scale: 1.9, speed: 1.2, runSpeed: 3.6, herd: [1, 1], behaviour: 'hunt', timid: false,
    dangerous: 3, hp: 22, gold: [200, 320], drop: { id: 'gem', chance: 1 },
    palettes: [[0x6a7a5a, 0x3a4a32], [0x7a6a5a, 0x4a3a2a]],
    names: ['Grumthar', 'Old Stonejaw', 'The Warden', 'Bruk'],
    lines: ['*roars*', '*the floor shakes*'],
    parts: [
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
    ],
  },
  shopkeeper: {
    id: 'shopkeeper', label: 'Shopkeeper', emoji: '🧑‍🍳', scale: 1.0, speed: 0.6, runSpeed: 0.6, herd: [1, 1], behaviour: 'wander', timid: false,
    palettes: [[0xffffff, 0x2c1810], [0xf5deb3, 0x8b4513], [0xdcdcdc, 0x4a2a10], [0xe8e0c8, 0x6c5ce7]],
    names: ['Berta', 'Hamund', 'Lise', 'Corvin', 'Margit', 'Oswin', 'Tilda', 'Renn'],
    lines: ['Welcome, welcome! Have a look around.', 'Best prices in {village}, I promise.', 'Come back any time.'],
    parts: [
      ...biped({ skin: 0xffdab9, hair: W, hairTint: 1, shirtTint: 0, pantsColor: 0x3a2a1a }),
      box([0.24, 0.5, 0.3], [0.02, 0.62, 0], 0x8a4a2a),
    ],
  },
  hero: {
    id: 'hero', label: 'You', emoji: '🧝', scale: 1.06, speed: 5.5, runSpeed: 5.5, herd: [1, 1], behaviour: 'wander', timid: false, climb: 0.56,
    palettes: [[0x2fb36a, 0xf2d15c]],
    names: ['You'],
    lines: ['...'],
    parts: [
      ...biped({ skin: 0xffdab9, hair: W, hairTint: 1, shirtTint: 0, pantsColor: 0x4a3a2a }),
      // hat, brim, belt, cape: a silhouette you can find in a crowd of villagers
      cone(0.22, 0.5, [0, 1.78, 0], 0x2fb36a, { anim: 'head', pivot: [0, 1.16, 0], tag: 'hat' }),
      box([0.42, 0.05, 0.42], [0, 1.6, 0], 0x1f7a48, { anim: 'head', pivot: [0, 1.16, 0], tag: 'hat' }),
      box([0.24, 0.07, 0.38], [0, 0.74, 0], 0x5a3a1a),
      box([0.05, 0.62, 0.36], [-0.14, 0.86, 0], 0xc0392b, { anim: 'cape', pivot: [-0.12, 1.16, 0], tag: 'cape' }),
    ],
  },
};

export interface SpawnWeight { kind: string; weight: number }

/** Herd kinds per biome, on land. */
export const BIOME_ANIMALS: Record<Biome, SpawnWeight[]> = {
  [Biome.Plains]: [{ kind: 'cow', weight: 4 }, { kind: 'sheep', weight: 4 }, { kind: 'horse', weight: 2 }, { kind: 'chicken', weight: 3 }, { kind: 'rabbit', weight: 2 }],
  [Biome.Forest]: [{ kind: 'deer', weight: 5 }, { kind: 'rabbit', weight: 3 }, { kind: 'fox', weight: 2 }, { kind: 'bear', weight: 1 }],
  [Biome.Desert]: [{ kind: 'camel', weight: 3 }, { kind: 'lizard', weight: 4 }, { kind: 'vulture', weight: 2 }],
  [Biome.Swamp]: [{ kind: 'frog', weight: 5 }, { kind: 'heron', weight: 2 }, { kind: 'duck', weight: 3 }],
  [Biome.Mountain]: [{ kind: 'goat', weight: 5 }, { kind: 'eagle', weight: 2 }, { kind: 'wolf', weight: 1 }],
  [Biome.Snow]: [{ kind: 'hare', weight: 4 }, { kind: 'wolf', weight: 2 }, { kind: 'elk', weight: 3 }],
};

/** Monsters per dungeon depth band; deeper rooms get nastier things. */
export const DUNGEON_MONSTERS: SpawnWeight[] = [
  { kind: 'rat', weight: 5 }, { kind: 'bat', weight: 4 }, { kind: 'slime', weight: 3 }, { kind: 'skeleton', weight: 2 },
];

/** Kinds that spawn on water tiles instead of land. */
export const WATER_ANIMALS: Record<Biome, SpawnWeight[]> = {
  [Biome.Plains]: [{ kind: 'duck', weight: 1 }],
  [Biome.Forest]: [{ kind: 'duck', weight: 1 }],
  [Biome.Desert]: [],
  [Biome.Swamp]: [{ kind: 'duck', weight: 2 }, { kind: 'frog', weight: 1 }],
  [Biome.Mountain]: [],
  [Biome.Snow]: [],
};

export function pickKind(list: readonly SpawnWeight[], r: number): string | null {
  if (list.length === 0) return null;
  let total = 0;
  for (const p of list) total += p.weight;
  let t = r * total;
  for (const p of list) {
    t -= p.weight;
    if (t <= 0) return p.kind;
  }
  return list[list.length - 1].kind;
}
