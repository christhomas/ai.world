import { mulberry32 } from '../core/rng';
import { columns, dome, rows, brightness, shade, type Fill } from './pixels';
import { ahoge, behindHair, fringe } from './portraitHair';

/**
 * A face, drawn as pixel art from whoever it belongs to.
 *
 * The game grows its terrain, its villages and its people from a seed, and its faces are no
 * different: everything here is decided by a number derived from a person's id, so Greta Vos has
 * the same face every time you meet her, on every machine, without a single image being shipped.
 *
 * Three things make a village of twenty read as twenty people rather than one drawing in
 * different colours, and they are worth stating because they are what this file is arranged
 * around:
 *
 *   the silhouette   hair is the shape you recognise from across a room, so it varies most:
 *                    height above the head, length below it, twin tails, a bun, spikes
 *   the eyes         size, spacing and the tilt of the lash line, which is where an anime face
 *                    keeps its personality
 *   the head itself  round, long, or pointed at the chin, at two or three sizes
 *
 * Colour is deliberately the least of it. Two faces that differ only in palette look like the
 * same person twice; two that differ in silhouette look like strangers even in the same colours.
 *
 * At 48x56 there is room for eyes, a fringe and a collar and nothing else, and every mark is
 * outlined in one dark ink so it reads against any background.
 */

/** The grid every face is drawn on. */
export const FACE = { W: 48, H: 56 } as const;

export type Stage = 'child' | 'adult';

export interface Face {
  /** Any number: the same one always gives the same face. */
  seed: number;
  stage: Stage;
  /** What they do, which decides their hat and the colour of their collar. */
  trade: string;
  /** Mouth open, for the person currently speaking. */
  talking?: boolean;
}

/** The line drawn around everything, which is what makes pixel art read. */
export const INK = '#1a1420';

const SKIN = ['#ffdfc0', '#f4cba4', '#e0ab7d', '#c08a5c', '#96603a', '#6d4326'];

/**
 * Hair. The first nine are the colours hair comes in; the rest are the colours it comes in when
 * the drawing is anime, and a village is livelier for having a few of them about.
 */
const HAIR = [
  '#f0e0b0', '#d9b26a', '#b5763a', '#8f3423', '#6b4423', '#46566f', '#3d2a1a', '#241a14', '#b8bcc8',
  '#e88ab0', '#7fc6a5', '#8fa8e8', '#b98fe0', '#f2f2f8', '#e8703c', '#5fb0c8', '#c8d84a',
];
const NATURAL_HAIR = 9;
const VIVID_CHANCE = 0.3;
/** Hair must differ from the skin under it by at least this much brightness, or it is a smudge. */
const CONTRAST = 0.17;

const EYES = ['#3a6ea5', '#43713e', '#6b4a24', '#7d3f5c', '#33333f', '#2f6b6b', '#a03a4a', '#6a4aa0', '#c08a2a'];

/** What each trade puts on its head, and the colour it wears. */
const DRESS: Record<string, { wear: string; hat: Hat }> = {
  innkeeper: { wear: '#8a5a3a', hat: 'none' },
  seller: { wear: '#7a5a9a', hat: 'scarf' },
  farmer: { wear: '#6a8a3a', hat: 'straw' },
  hunter: { wear: '#4a5a3a', hat: 'hood' },
  constable: { wear: '#2a3a7a', hat: 'helm' },
  doctor: { wear: '#dcdce6', hat: 'band' },
  soldier: { wear: '#6a2a2a', hat: 'helm' },
  sailor: { wear: '#2a5a7a', hat: 'cap' },
  climber: { wear: '#7a6a3a', hat: 'cap' },
  explorer: { wear: '#5a6a4a', hat: 'brim' },
  store: { wear: '#7a5a9a', hat: 'scarf' },
  smith: { wear: '#5a4a44', hat: 'band' },
  inn: { wear: '#8a5a3a', hat: 'none' },
  apothecary: { wear: '#dcdce6', hat: 'band' },
};
const PLAIN = { wear: '#59668c', hat: 'none' as Hat };

type Hat = 'none' | 'straw' | 'hood' | 'helm' | 'band' | 'cap' | 'brim' | 'scarf';

/** The shape of a head, which decides how wide it is and what happens at the chin. */
export type HeadShape = 'round' | 'long' | 'pointed' | 'broad';
/** How the eyes are cut, which is most of what makes a face look like somebody. */
export type EyeShape = 'round' | 'sharp' | 'soft' | 'closed';
/** What the hair does below the ears — the half of the silhouette you see first. */
export type HairLength = 'crop' | 'bob' | 'long' | 'twin' | 'side' | 'bun';
/** And what it does above and in front. */
export type Fringe = 'straight' | 'parted' | 'curtain' | 'swept' | 'oneEye' | 'bare';
/** What their face is doing when nothing in particular is happening. */
export type Mood = 'easy' | 'bright' | 'stern' | 'tired';

export interface Palette {
  skin: string; hair: string; eye: string; wear: string;
  head: HeadShape;
  /** How big the head is in the frame, -1 small, 0 usual, 1 large. */
  scale: number;
  eyes: EyeShape;
  /** How tall the eyes are, which is the difference between wide-eyed and half asleep. */
  eyeH: number;
  /** How far apart, which changes a face more than anything but the hair. */
  spacing: number;
  hair2: HairLength;
  fringe: Fringe;
  /** How much hair stands up above the head, and whether it does so in spikes. */
  volume: number;
  spiky: boolean;
  brow: number;
  mood: Mood;
  /** A single hair that will not lie down. Nothing says more with two pixels. */
  ahoge: boolean;
  blush: boolean;
  freckles: boolean;
  glasses: boolean;
  earring: boolean;
  clip: boolean;
  beard: boolean;
}

const HEADS: HeadShape[] = ['round', 'long', 'pointed', 'broad'];
const EYE_SHAPES: EyeShape[] = ['round', 'round', 'sharp', 'soft'];
const LENGTHS: HairLength[] = ['crop', 'bob', 'long', 'twin', 'side', 'bun'];
const FRINGES: Fringe[] = ['straight', 'parted', 'curtain', 'swept', 'oneEye', 'bare'];
const MOODS: Mood[] = ['easy', 'bright', 'stern', 'tired'];

/** A face for somebody, from anything that identifies them. */
export function faceOf(id: string, trade: string, stage: Stage, talking = false): Face {
  return { seed: hash(id), stage, trade, talking };
}

/** What this face is made of. Exported so the choices can be checked without a canvas. */
export function paletteFor(face: Face): Palette {
  const rng = mulberry32(face.seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  const young = face.stage === 'child';

  const skin = pick(SKIN);
  const mood = pick(MOODS);
  return {
    skin,
    hair: hairFor(skin, rng),
    eye: pick(EYES),
    wear: (DRESS[face.trade] ?? PLAIN).wear,
    head: pick(HEADS),
    scale: Math.floor(rng() * 3) - 1,
    // a cheerful face sometimes has its eyes shut altogether, which at this size is two arcs
    eyes: mood === 'bright' && rng() < 0.35 ? 'closed' : pick(EYE_SHAPES),
    eyeH: (young ? 8 : 7) + Math.floor(rng() * 4),
    spacing: 3 + Math.floor(rng() * 4),
    hair2: pick(LENGTHS),
    fringe: pick(FRINGES),
    volume: 1 + Math.floor(rng() * 5),
    spiky: rng() < 0.28,
    brow: Math.floor(rng() * 3),
    mood,
    ahoge: rng() < 0.28,
    blush: rng() < 0.35,
    freckles: rng() < 0.2,
    glasses: rng() < 0.14,
    earring: rng() < 0.16,
    clip: rng() < 0.18,
    beard: !young && rng() < 0.18,
  };
}

/** Where everything sits on the grid, worked out once from the rolls. */
export interface Build {
  x: number; y: number; w: number; h: number;
  eyeY: number; eyeW: number; eyeH: number; gap: number;
  neckY: number; shoulderY: number;
  /** How much narrower the head gets at the chin. */
  taper: number;
}

function buildFor(p: Palette, young: boolean): Build {
  const base = young ? 24 : 27;
  const wide = p.head === 'broad' ? 4 : p.head === 'long' ? -2 : p.head === 'pointed' ? -1 : 1;
  const w = base + wide + p.scale;
  const h = (young ? 27 : 32) + (p.head === 'long' ? 4 : 0) + p.scale;
  const x = Math.round((FACE.W - w) / 2);
  const y = (young ? 11 : 6) - Math.round(p.scale / 2);

  return {
    x, y, w, h,
    eyeY: y + Math.round(h * (young ? 0.48 : 0.46)),
    eyeW: 7 + Math.max(0, Math.round((w - 27) / 3)),
    eyeH: p.eyeH,
    gap: p.spacing,
    neckY: y + h,
    shoulderY: Math.min(46, y + h + 5),
    taper: p.head === 'pointed' ? 4 : p.head === 'long' ? 2 : 0,
  };
}

/**
 * Draw a face onto a canvas. The canvas is set to the grid size; make it bigger with CSS and
 * `image-rendering: pixelated`, which is what keeps the pixels square.
 */
export function drawFace(canvas: HTMLCanvasElement, face: Face): void {
  canvas.width = FACE.W;
  canvas.height = FACE.H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, FACE.W, FACE.H);
  paint((x, y, w, h, colour) => { ctx.fillStyle = colour; ctx.fillRect(x, y, w, h); }, face);
}

/** The drawing itself, kept apart from the canvas so it can be tested and drawn anywhere. */
export function paint(fill: Fill, face: Face): void {
  const p = paletteFor(face);
  const young = face.stage === 'child';
  const b = buildFor(p, young);
  const hat = (DRESS[face.trade] ?? PLAIN).hat;

  behindHair(fill, p, b, young);
  shoulders(fill, p.wear, b);
  neck(fill, p.skin, b);
  head(fill, p.skin, b);
  ears(fill, p.skin, b);
  if (p.earring) earring(fill, b);
  eyes(fill, p, b);
  brows(fill, p, b);
  if (p.freckles) freckles(fill, p.skin, b);
  if (p.blush) blush(fill, b);
  noseAndMouth(fill, p, b, face.talking === true);
  if (p.beard) beard(fill, p.hair, b);
  fringe(fill, p, b);
  if (p.ahoge) ahoge(fill, p.hair, b);
  if (p.clip) hairclip(fill, b);
  if (p.glasses) glasses(fill, b);
  headwear(fill, hat, b);
}

/**
 * Hair that can actually be seen against this skin. Dark hair on dark skin at this size is a
 * silhouette with nothing inside it, so a colour is only allowed if it is far enough from the
 * skin in brightness. Measuring that rather than guessing is what keeps every face legible.
 */
function hairFor(skin: string, rng: () => number): string {
  const vivid = rng() < VIVID_CHANCE;
  const from = vivid ? HAIR.slice(NATURAL_HAIR) : HAIR.slice(0, NATURAL_HAIR);
  const light = brightness(skin);
  const usable = from.filter((colour) => Math.abs(brightness(colour) - light) >= CONTRAST);
  const pool = usable.length > 0 ? usable : HAIR.filter((c) => Math.abs(brightness(c) - light) >= CONTRAST);
  return pool[Math.floor(rng() * pool.length)];
}

/** The bust: shoulders, and the collar of whatever they work in. */
function shoulders(fill: Fill, wear: string, b: Build): void {
  const y = b.shoulderY;
  fill(5, y + 1, 38, FACE.H - y, INK);
  fill(6, y + 2, 36, FACE.H - y, wear);
  fill(3, y + 5, 42, FACE.H - y - 5, INK);
  fill(4, y + 6, 40, FACE.H - y - 6, wear);
  fill(19, y + 2, 10, 3, shade(wear, 1.3));               // light on the collar
}

function neck(fill: Fill, skin: string, b: Build): void {
  fill(19, b.neckY - 3, 10, 9, INK);
  fill(20, b.neckY - 3, 8, 8, shade(skin, 0.8));
}

/**
 * The head.
 *
 * Full width across the brow, then closing in towards the chin by however much the shape calls
 * for. Drawn twice — once a pixel larger in ink, once in skin — which is how a silhouette gets
 * an outline without any edge-walking.
 */
function head(fill: Fill, skin: string, b: Build): void {
  const { x, y, w, h, taper } = b;
  const cx = x + Math.round(w / 2);
  const half = w / 2;

  // the top is rounded, the middle is straight, and the jaw closes in
  const shape = (grow: number) => (t: number): number => {
    const crown = t < 0.18 ? dome(t / 0.18) : 1;
    const jaw = t < 0.62 ? 1 : 1 - ((t - 0.62) / 0.38) ** 1.7 * (taper / half + 0.16);
    return half * crown * jaw + grow;
  };

  rows(fill, cx, y - 1, h + 3, shape(1), INK);
  rows(fill, cx, y, h + 1, shape(0), skin);
  rows(fill, cx, y + h - 4, 4, (t) => shape(0)(0.9 + t * 0.1) - 1, shade(skin, 0.9));   // the chin
}

function ears(fill: Fill, skin: string, b: Build): void {
  const y = b.eyeY + 2;
  fill(b.x - 2, y, 3, 6, INK);
  fill(b.x + b.w - 1, y, 3, 6, INK);
  fill(b.x - 1, y + 1, 2, 4, shade(skin, 0.9));
  fill(b.x + b.w - 1, y + 1, 2, 4, shade(skin, 0.9));
}

function earring(fill: Fill, b: Build): void {
  const y = b.eyeY + 8;
  fill(b.x - 2, y, 2, 2, INK);
  fill(b.x - 2, y, 1, 1, '#e8c860');
}

/**
 * The eyes, which are the whole face at this size.
 *
 * Three things carry it: a heavy lash line along the top, an iris filling most of the opening,
 * and one white pixel high in the corner. That highlight is the difference between a face looking
 * at you and a face with two holes in it. The tilt of the lash line does the rest — lifted at the
 * outer corner reads as sharp, dropped reads as gentle, and a plain arc with no white at all
 * reads as somebody smiling with their eyes shut.
 */
function eyes(fill: Fill, p: Palette, b: Build): void {
  const span = b.eyeW * 2 + b.gap;
  const left = b.x + Math.round((b.w - span) / 2);
  const right = left + b.eyeW + b.gap;
  const { eyeY: y, eyeW: w, eyeH: h } = b;

  for (const [at, x] of [left, right].entries()) {
    const mirrored = at === 1;
    const outer = mirrored ? x + w - 1 : x;

    if (p.eyes === 'closed') {
      // an arc curving upwards — the shape a shut, smiling eye makes, and nothing else
      const mid = y + Math.round(h / 2);
      columns(fill, x, mid - 2, w, (t) => 2, INK);
      columns(fill, x + 1, mid - 3, w - 2, (t) => (Math.abs(t - 0.5) < 0.34 ? 2 : 0), INK);
      fill(x, mid, 2, 2, INK);
      fill(x + w - 2, mid, 2, 2, INK);
      continue;
    }

    const lift = p.eyes === 'sharp' ? -1 : p.eyes === 'soft' ? 1 : 0;
    fill(x, y, w, 2, INK);
    if (lift !== 0) {
      // the outer third of the lash line moves, and that is the whole of the expression
      fill(mirrored ? x + w - 3 : x, y + lift, 3, 2, INK);
    }

    fill(x, y + 2, w, h - 4, '#ffffff');
    fill(x, y + 2, w, 1, shade(p.skin, 0.55));            // the lid's shadow on the white
    fill(x + 1, y + 2, w - 2, h - 5, p.eye);              // the iris fills most of the opening
    fill(x + 1, y + h - 4, w - 2, 1, shade(p.eye, 0.6));
    fill(x + Math.round(w / 2) - 1, y + 3, 2, h - 7, '#100c16');   // a tall pupil, not a square
    fill(mirrored ? x + w - 3 : x + 1, y + 3, 2, 2, '#ffffff');    // the light in it
    fill(mirrored ? x + 1 : x + w - 3, y + h - 5, 1, 1, '#ffffff');
    fill(outer, y + 2, 1, h - 4, INK);                    // only the outer corner is drawn in
    fill(x, y + h - 2, w, 1, shade(p.skin, 0.75));        // the lower lid, barely there
  }
}

/** Brows say more about a face than anything except the eyes, and they carry the mood. */
function brows(fill: Fill, p: Palette, b: Build): void {
  const span = b.eyeW * 2 + b.gap;
  const left = b.x + Math.round((b.w - span) / 2);
  const right = left + b.eyeW + b.gap;
  const y = b.eyeY - (p.mood === 'stern' ? 4 : p.mood === 'bright' ? 6 : 5);
  const colour = shade(p.hair, 0.8);
  const w = b.eyeW;

  if (p.mood === 'stern') {                               // drawn down towards the nose
    fill(left, y, w - 1, 2, colour);
    fill(left + w - 3, y + 1, 3, 2, colour);
    fill(right + 1, y, w - 1, 2, colour);
    fill(right, y + 1, 3, 2, colour);
    return;
  }
  if (p.brow === 0) {
    fill(left, y, w, 2, colour);
    fill(right, y, w, 2, colour);
  } else if (p.brow === 1) {                              // raised at the outer edge
    fill(left, y + 1, w - 2, 2, colour);
    fill(left - 1, y, 3, 2, colour);
    fill(right + 2, y + 1, w - 2, 2, colour);
    fill(right + w - 2, y, 3, 2, colour);
  } else {                                                // softly curved
    fill(left + 1, y + 1, w - 2, 2, colour);
    fill(left, y + 2, 2, 1, colour);
    fill(right + 1, y + 1, w - 2, 2, colour);
    fill(right + w - 2, y + 2, 2, 1, colour);
  }
}

function freckles(fill: Fill, skin: string, b: Build): void {
  const y = b.eyeY + b.eyeH + 1;
  const colour = shade(skin, 0.78);
  for (const dx of [3, 6, 9]) {
    fill(b.x + dx, y + (dx % 2), 1, 1, colour);
    fill(b.x + b.w - dx - 1, y + (dx % 2), 1, 1, colour);
  }
}

function blush(fill: Fill, b: Build): void {
  const y = b.eyeY + b.eyeH;
  fill(b.x + 2, y, 5, 2, '#e8888833');
  fill(b.x + b.w - 7, y, 5, 2, '#e8888833');
  fill(b.x + 3, y + 1, 3, 1, '#e07a7a55');
  fill(b.x + b.w - 6, y + 1, 3, 1, '#e07a7a55');
}

/** A nose that is barely there, and a mouth that carries the rest of the expression. */
function noseAndMouth(fill: Fill, p: Palette, b: Build, talking: boolean): void {
  const middle = b.x + Math.round(b.w / 2);
  const noseY = b.eyeY + b.eyeH + 2;
  fill(middle - 1, noseY, 2, 2, shade(p.skin, 0.78));

  const y = Math.min(b.y + b.h - 5, noseY + 4);
  if (talking) {
    const wide = p.mood === 'bright';
    fill(middle - (wide ? 5 : 4), y - 1, wide ? 10 : 8, 6, INK);
    fill(middle - (wide ? 4 : 3), y, wide ? 8 : 6, 4, '#8c3d44');
    fill(middle - 2, y + 1, 4, 2, '#c4676c');
    return;
  }
  if (p.mood === 'bright') {                              // turned up at the corners
    fill(middle - 3, y, 6, 2, INK);
    fill(middle - 4, y - 1, 2, 2, INK);
    fill(middle + 2, y - 1, 2, 2, INK);
    fill(middle - 2, y, 4, 1, '#b06868');
    return;
  }
  if (p.mood === 'tired') {                               // small, and off to one side
    fill(middle - 2, y, 4, 2, INK);
    fill(middle - 1, y, 2, 1, '#b06868');
    return;
  }
  if (p.mood === 'stern') {                               // flat, ends turned down
    fill(middle - 3, y, 6, 2, INK);
    fill(middle - 4, y + 1, 2, 2, INK);
    fill(middle + 2, y + 1, 2, 2, INK);
    return;
  }
  fill(middle - 3, y, 6, 2, INK);
  fill(middle - 2, y, 4, 1, '#b06868');
  fill(middle - 3, y + 1, 6, 1, shade(p.skin, 0.82));
}

/** A beard: along the jaw and under the chin, leaving the mouth clear. */
function beard(fill: Fill, hair: string, b: Build): void {
  const top = b.eyeY + b.eyeH + 1;
  const bottom = b.y + b.h;
  const cx = b.x + Math.round(b.w / 2);
  const colour = shade(hair, 0.72);

  rows(fill, cx, top, bottom - top, (t) => (b.w / 2 - 1) * (1 - t * 0.35), colour);
  rows(fill, cx, top, 4, (t) => (b.w / 2 - 2) * (1 - t) * 0.9, '#00000000');   // clear of the mouth
  fill(cx - 4, top + 4, 8, 2, colour);
}

function hairclip(fill: Fill, b: Build): void {
  const y = b.y + 3;
  fill(b.x + b.w - 8, y, 6, 3, INK);
  fill(b.x + b.w - 7, y, 4, 2, '#e8c860');
}

function glasses(fill: Fill, b: Build): void {
  const span = b.eyeW * 2 + b.gap;
  const left = b.x + Math.round((b.w - span) / 2) - 1;
  const y = b.eyeY - 1;
  const h = b.eyeH + 1;
  const w = b.eyeW + 2;
  for (const x of [left, left + b.eyeW + b.gap]) {
    fill(x, y, w, 1, '#20202c');
    fill(x, y + h - 1, w, 1, '#20202c');
    fill(x, y, 1, h, '#20202c');
    fill(x + w - 1, y, 1, h, '#20202c');
    fill(x + 1, y + 1, 2, 2, '#ffffff44');                // a glint, so they read as glass
  }
  fill(left + w, y + 2, b.gap - 2, 1, '#20202c');
}

/** What their trade puts on their head. */
function headwear(fill: Fill, hat: Hat, b: Build): void {
  const { x, y, w } = b;
  switch (hat) {
    case 'straw':
      fill(x - 7, y + 1, w + 14, 4, INK);
      fill(x - 6, y + 1, w + 12, 2, '#d8b464');
      fill(x + 1, y - 7, w - 2, 9, INK);
      fill(x + 2, y - 6, w - 4, 8, '#e8c878');
      fill(x + 2, y - 2, w - 4, 2, '#c69a4c');            // the band
      break;
    case 'hood':
      fill(x - 4, y - 5, w + 8, 15, INK);
      fill(x - 3, y - 4, w + 6, 13, '#42533a');
      fill(x + 1, y + 2, w - 2, 8, '#00000000');
      fill(x - 3, y + 6, 5, 18, '#42533a');
      fill(x + w - 2, y + 6, 5, 18, '#42533a');
      break;
    case 'helm':
      fill(x - 2, y - 5, w + 4, 10, INK);
      fill(x - 1, y - 4, w + 2, 8, '#8f99ad');
      fill(x - 1, y - 4, w + 2, 2, '#b6bfd0');
      fill(x - 2, y + 3, w + 4, 2, '#5a6478');
      fill(x + Math.round(w / 2) - 1, y - 9, 3, 5, '#c8a038');
      break;
    case 'band':
      fill(x - 1, y + 2, w + 2, 4, INK);
      fill(x, y + 2, w, 3, '#ececf4');
      fill(x + Math.round(w / 2) - 4, y, 8, 7, '#ececf4');
      fill(x + Math.round(w / 2) - 2, y + 2, 4, 3, '#c04a4a');
      break;
    case 'cap':
      fill(x - 1, y - 5, w + 2, 9, INK);
      fill(x, y - 4, w, 7, '#2a4260');
      fill(x - 5, y + 2, w + 10, 3, INK);
      fill(x - 4, y + 2, w + 8, 2, '#1c2e46');
      break;
    case 'brim':
      fill(x - 6, y + 1, w + 12, 3, INK);
      fill(x - 5, y + 1, w + 10, 2, '#6a5a3a');
      fill(x + 2, y - 6, w - 4, 8, INK);
      fill(x + 3, y - 5, w - 6, 7, '#7d6c46');
      break;
    case 'scarf':
      fill(x - 1, y - 3, w + 2, 7, INK);
      fill(x, y - 2, w, 5, '#8a4a7a');
      fill(x + 3, y - 1, 3, 2, '#a9689a');
      break;
    case 'none':
    default:
      break;
  }
}

/** A stable number for a string, so an id always gives the same face. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
