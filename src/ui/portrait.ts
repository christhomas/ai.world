import { mulberry32 } from '../core/rng';

/**
 * A face, drawn as pixel art from whoever it belongs to.
 *
 * The game grows its terrain, its villages and its people from a seed, and its faces are no
 * different: everything here is decided by a number derived from a person's id, so Greta Vos has
 * the same face every time you meet her, on every machine, without a single image being shipped.
 *
 * The grid is deliberately small. At 48x56 a face has room for eyes, a fringe and a collar and
 * nothing else, which is what gives pixel art its character — every decision is forced and the
 * viewer's eye finishes the job. Two rules do most of the work at this size: everything gets a
 * dark outline so it reads against any background, and hair is never allowed to be as dark as the
 * skin it sits on, because a face with no contrast is a smudge.
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
const INK = '#1a1420';

/** Skin, light to dark. Paired with a hair colour chosen to sit against it. */
const SKIN = ['#ffdfc0', '#f4cba4', '#e0ab7d', '#c08a5c', '#96603a', '#6d4326'];
/** Hair, light to dark. Which of these a face may use depends on its skin. */
const HAIR = ['#f0e0b0', '#d9b26a', '#b5763a', '#8f3423', '#6b4423', '#46566f', '#3d2a1a', '#241a14', '#b8bcc8'];
const EYES = ['#3a6ea5', '#43713e', '#6b4a24', '#7d3f5c', '#33333f', '#2f6b6b'];

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

/** Where everything sits on the grid. An adult fills the frame; a child sits lower and smaller. */
interface Build {
  headX: number; headY: number; headW: number; headH: number;
  eyeY: number; eyeW: number; eyeH: number; gap: number;
  neckY: number; shoulderY: number;
}

function buildFor(young: boolean, wider: number): Build {
  // a little variation in the width of a head goes a long way; the eyes stay put and the face
  // grows around them, which is why one villager looks broad and the next narrow
  if (young) {
    const w = 24 + wider;
    return { headX: Math.round((FACE.W - w) / 2), headY: 10, headW: w, headH: 28, eyeY: 24, eyeW: 7, eyeH: 8, gap: 4, neckY: 38, shoulderY: 44 };
  }
  const w = 27 + wider;
  return { headX: Math.round((FACE.W - w) / 2), headY: 5, headW: w, headH: 33, eyeY: 21, eyeW: 8, eyeH: 9, gap: 4, neckY: 38, shoulderY: 44 };
}

/** A face for somebody, from anything that identifies them. */
export function faceOf(id: string, trade: string, stage: Stage, talking = false): Face {
  return { seed: hash(id), stage, trade, talking };
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

/** The colours and shapes a face turned out to have. Rolled once, so drawing it twice matches. */
export interface Palette {
  skin: string; hair: string; eye: string; wear: string;
  fringe: number; length: number; brow: number; wider: number;
}

/** What this face is made of. Exported so the choices can be checked without a canvas. */
export function paletteFor(face: Face): Palette {
  const rng = mulberry32(face.seed);
  const skin = SKIN[Math.floor(rng() * SKIN.length)];
  const hair = hairFor(skin, rng);
  const eye = EYES[Math.floor(rng() * EYES.length)];
  const fringe = Math.floor(rng() * 4);
  const length = Math.floor(rng() * 4);
  const brow = Math.floor(rng() * 3);
  const wider = Math.floor(rng() * 4);
  return { skin, hair, eye, wear: (DRESS[face.trade] ?? PLAIN).wear, fringe, length, brow, wider };
}

/** The drawing itself, kept apart from the canvas so it can be tested and drawn anywhere. */
export function paint(fill: Fill, face: Face): void {
  const { skin, hair, eye, fringe, length, brow, wider } = paletteFor(face);
  const dress = DRESS[face.trade] ?? PLAIN;
  const young = face.stage === 'child';
  const b = buildFor(young, wider);

  shoulders(fill, dress.wear, b);
  neck(fill, skin, b);
  hairBehind(fill, hair, b, young, length);
  head(fill, skin, b);
  ears(fill, skin, b);
  eyes(fill, eye, skin, b);
  brows(fill, hair, brow, b);
  noseAndMouth(fill, skin, face.talking === true, b);
  fringeOf(fill, hair, fringe, b);
  headwear(fill, dress.hat, b);
}

/**
 * Hair that can actually be seen against this skin.
 *
 * Dark hair on dark skin at this size is a silhouette with nothing inside it, so a colour is only
 * allowed if it is far enough from the skin in brightness. Measuring that rather than guessing at
 * it is what keeps every face in the game legible instead of most of them.
 */
const CONTRAST = 0.17;

function hairFor(skin: string, rng: () => number): string {
  const light = brightness(skin);
  const usable = HAIR.filter((colour) => Math.abs(brightness(colour) - light) >= CONTRAST);
  const pool = usable.length > 0 ? usable : HAIR;
  return pool[Math.floor(rng() * pool.length)];
}

/** How bright a colour looks, 0 to 1, weighted the way an eye weights it. */
function brightness(colour: string): number {
  const n = parseInt(colour.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** The bust: shoulders, and the collar of whatever they work in. */
function shoulders(fill: Fill, wear: string, b: Build): void {
  const y = b.shoulderY;
  fill(5, y + 1, 38, FACE.H - y, INK);
  fill(6, y + 2, 36, FACE.H - y, wear);
  fill(3, y + 5, 42, FACE.H - y - 5, INK);
  fill(4, y + 6, 40, FACE.H - y - 6, wear);
  fill(19, y + 2, 10, 3, shade(wear, 1.3));         // light on the collar
}

function neck(fill: Fill, skin: string, b: Build): void {
  fill(19, b.neckY, 10, 8, INK);
  fill(20, b.neckY, 8, 7, shade(skin, 0.8));
}

/** The head: a box with its corners taken off, which at this size reads as a face. */
function head(fill: Fill, skin: string, b: Build): void {
  const { headX: x, headY: y, headW: w, headH: h } = b;
  fill(x - 1, y + 1, w + 2, h, INK);
  fill(x + 1, y - 1, w - 2, h + 2, INK);
  fill(x, y + 2, w, h - 4, skin);
  fill(x + 2, y, w - 4, h - 1, skin);
  fill(x + 1, y + 1, w - 2, h - 2, skin);
  fill(x + 3, y + h - 3, w - 6, 2, shade(skin, 0.88));   // the chin, in its own shadow
  // the corners of the jaw taken off, so a head is not a brick
  fill(x, y + h - 4, 2, 3, INK);
  fill(x + w - 2, y + h - 4, 2, 3, INK);
  fill(x + 1, y + h - 5, 1, 1, shade(skin, 0.85));
  fill(x + w - 2, y + h - 5, 1, 1, shade(skin, 0.85));
}

/**
 * Hair behind the head — the silhouette, and the single thing that most decides whether two
 * villagers look like different people. Length is rolled apart from the fringe, so a long-haired
 * villager with a side parting and a short-haired one with the same parting are plainly two
 * people rather than the same drawing twice.
 */
function hairBehind(fill: Fill, hair: string, b: Build, young: boolean, length: number): void {
  const { headX: x, headY: y, headW: w } = b;
  const dark = shade(hair, 0.78);

  fill(x - 3, y - 2, w + 6, 14, INK);                    // the cap of hair everybody has
  fill(x - 2, y - 1, w + 4, 13, hair);

  const sides = (drop: number): void => {
    fill(x - 3, y + 8, 4, drop, INK);
    fill(x + w - 1, y + 8, 4, drop, INK);
    fill(x - 2, y + 8, 3, drop - 1, hair);
    fill(x + w - 1, y + 8, 3, drop - 1, hair);
  };

  if (length === 0) {                                    // cropped, ears clear
    sides(young ? 10 : 13);
  } else if (length === 1) {                             // to the jaw
    sides(young ? 16 : 22);
  } else if (length === 2) {                             // past the shoulders
    sides(young ? 22 : 30);
    fill(x - 4, y + 26, 5, 12, INK);
    fill(x + w - 1, y + 26, 5, 12, INK);
    fill(x - 3, y + 26, 4, 11, dark);
    fill(x + w - 1, y + 26, 4, 11, dark);
  } else {                                               // tied up, which leaves the neck bare
    sides(young ? 9 : 11);
    const middle = x + Math.round(w / 2);
    fill(middle - 6, y - 8, 12, 9, INK);
    fill(middle - 5, y - 7, 10, 8, hair);
    fill(middle - 3, y - 6, 5, 3, shade(hair, 1.2));     // the light on top of it
  }
}

function ears(fill: Fill, skin: string, b: Build): void {
  const y = b.eyeY + 2;
  fill(b.headX - 2, y, 3, 6, INK);
  fill(b.headX + b.headW - 1, y, 3, 6, INK);
  fill(b.headX - 1, y + 1, 2, 4, shade(skin, 0.9));
  fill(b.headX + b.headW - 1, y + 1, 2, 4, shade(skin, 0.9));
}

/**
 * The eyes, which are the whole face at this size.
 *
 * Three bands of white, a block of colour, a black pupil, and one white pixel high in the corner.
 * That single highlight is the difference between a face that is looking at you and a face with
 * two holes in it.
 */
function eyes(fill: Fill, eye: string, skin: string, b: Build): void {
  const span = b.eyeW * 2 + b.gap;
  const left = b.headX + Math.round((b.headW - span) / 2);
  const right = left + b.eyeW + b.gap;
  const { eyeY: y, eyeW: w, eyeH: h } = b;

  for (const [at, x] of [left, right].entries()) {
    const outer = at === 0 ? x : x + w - 1;              // the corner away from the nose

    fill(x, y, w, 2, INK);                               // the lash line, which is the heavy part
    fill(x, y + 2, w, h - 4, '#ffffff');
    fill(x, y + 2, w, 1, shade(skin, 0.55));             // the lid's own shadow on the white
    fill(x + 1, y + 2, w - 2, h - 5, eye);               // the iris fills most of the eye
    fill(x + 1, y + h - 4, w - 2, 1, shade(eye, 0.6));
    fill(x + Math.round(w / 2) - 1, y + 3, 2, h - 7, '#100c16');   // a tall pupil, not a square
    fill(x + 1, y + 3, 2, 2, '#ffffff');                 // the light in it
    fill(x + w - 3, y + h - 5, 1, 1, '#ffffff');         // and a smaller one opposite
    fill(outer, y + 2, 1, h - 4, INK);                   // only the outer corner is drawn in
    fill(x, y + h - 2, w, 1, shade(skin, 0.75));         // the lower lid, barely there
  }
}

/** Brows say more about a face than anything except the eyes. */
function brows(fill: Fill, hair: string, style: number, b: Build): void {
  const span = b.eyeW * 2 + b.gap;
  const left = b.headX + Math.round((b.headW - span) / 2);
  const right = left + b.eyeW + b.gap;
  const y = b.eyeY - 5;
  const colour = shade(hair, 0.8);

  if (style === 0) {                                     // level
    fill(left, y, b.eyeW, 2, colour);
    fill(right, y, b.eyeW, 2, colour);
  } else if (style === 1) {                              // raised at the outer edge
    fill(left, y + 1, b.eyeW - 2, 2, colour);
    fill(left - 1, y, 3, 2, colour);
    fill(right + 2, y + 1, b.eyeW - 2, 2, colour);
    fill(right + b.eyeW - 2, y, 3, 2, colour);
  } else {                                               // drawn together, which reads as serious
    fill(left + 1, y + 1, b.eyeW, 2, colour);
    fill(right - 1, y + 1, b.eyeW, 2, colour);
  }
}

function noseAndMouth(fill: Fill, skin: string, talking: boolean, b: Build): void {
  const middle = b.headX + Math.round(b.headW / 2);
  const noseY = b.eyeY + b.eyeH + 2;
  fill(middle - 1, noseY, 2, 2, shade(skin, 0.78));

  const y = noseY + 4;
  if (talking) {
    fill(middle - 4, y - 1, 8, 6, INK);
    fill(middle - 3, y, 6, 4, '#8c3d44');
    fill(middle - 2, y + 1, 4, 2, '#c4676c');
    return;
  }
  fill(middle - 3, y, 6, 2, INK);
  fill(middle - 2, y, 4, 1, '#b06868');
  fill(middle - 3, y + 1, 6, 1, shade(skin, 0.82));      // the shadow under a closed mouth
}

/** The fringe, which is what makes one villager not look like the next. */
function fringeOf(fill: Fill, hair: string, style: number, b: Build): void {
  const { headX: x, headY: y, headW: w } = b;
  fill(x, y - 1, w, 5, hair);                            // everybody has a hairline

  if (style === 0) {                                     // straight across
    fill(x + 1, y + 3, w - 2, 3, hair);
  } else if (style === 1) {                              // parted to one side
    fill(x + 1, y + 3, 11, 6, hair);
    fill(x + 12, y + 3, w - 13, 2, hair);
  } else if (style === 2) {                              // swept back off the forehead
    fill(x + 1, y + 3, 6, 7, hair);
    fill(x + w - 8, y + 3, 7, 4, hair);
  } else {                                               // long at the sides, short in front
    fill(x, y + 3, 5, 14, hair);
    fill(x + w - 5, y + 3, 5, 14, hair);
    fill(x + 5, y + 3, w - 10, 2, hair);
  }
}

/** What their trade puts on their head. */
function headwear(fill: Fill, hat: Hat, b: Build): void {
  const { headX: x, headY: y, headW: w } = b;
  switch (hat) {
    case 'straw':
      fill(x - 7, y + 1, w + 14, 4, INK);
      fill(x - 6, y + 1, w + 12, 2, '#d8b464');
      fill(x + 1, y - 7, w - 2, 9, INK);
      fill(x + 2, y - 6, w - 4, 8, '#e8c878');
      fill(x + 2, y - 2, w - 4, 2, '#c69a4c');           // the band
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

export type Fill = (x: number, y: number, w: number, h: number, colour: string) => void;

/** A colour, lightened or darkened. A shadow and a highlight are the same colour, twice. */
function shade(colour: string, by: number): string {
  const n = parseInt(colour.slice(1), 16);
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v * by)));
  const r = clamp((n >> 16) & 255), g = clamp((n >> 8) & 255), b = clamp(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
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
