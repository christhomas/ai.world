import { mulberry32 } from '../core/rng';
import { columns, dome, rows, shade, type Fill } from './pixels';
import { INK, type Build, type Palette } from './portrait';

/**
 * Hair.
 *
 * It gets a module to itself because it does more work than the face does. Skin, eyes and a mouth
 * tell two villagers apart when you are looking at them; hair tells them apart from across the
 * square, and it is the thing you actually remember somebody by. So it varies most: how high it
 * piles, whether it stands up in spikes, how far it falls, whether it is gathered into tails or a
 * bun, and what it does across the forehead.
 */

/**
 * Everything the hair does behind the head. This is the silhouette, and the silhouette is what
 * you recognise somebody by, so it carries most of the variation in the whole file.
 */
export function behindHair(fill: Fill, p: Palette, b: Build, young: boolean): void {
  const { x, y, w } = b;
  const hair = p.hair;
  const dark = shade(hair, 0.78);
  const cx = x + Math.round(w / 2);
  const half = w / 2 + 2;
  const top = y - p.volume;
  const deep = p.volume + 7;

  // the mass over the skull: a dome, so it sits on the head rather than on top of a box
  rows(fill, cx, top - 1, deep + 2, (t) => half * (t < 0.5 ? dome(t / 0.5) : 1) + 1, INK);
  rows(fill, cx, top, deep, (t) => half * (t < 0.5 ? dome(t / 0.5) : 1), hair);

  if (p.spiky) spikes(fill, p, b, top);

  // hair down the sides, narrowing as it falls, because a lock of hair is not a plank
  const lock = (drop: number, from = y + 5): void => {
    for (const [at, side] of [[x - 2, -1], [x + w - 1, 1]] as const) {
      columns(fill, at, from, 3, (t) => drop * (1 - t * 0.25), INK);
      columns(fill, at + (side < 0 ? 1 : 0), from, 2, (t) => drop * (1 - t * 0.3) - 1, hair);
    }
  };

  switch (p.hair2) {
    case 'crop':
      lock(young ? 7 : 9);
      break;
    case 'bob': {
      const drop = young ? 14 : 19;
      lock(drop);
      // the blunt line it is cut to, with the ends turning in
      rows(fill, cx, y + drop + 2, 4, (t) => half * (1 - t * 0.25), INK);
      rows(fill, cx, y + drop + 2, 3, (t) => half * (1 - t * 0.3), dark);
      break;
    }
    case 'long': {
      const drop = young ? 20 : 27;
      lock(drop);
      for (const at of [x - 3, x + w - 1]) {
        columns(fill, at, y + drop, 4, (t) => 12 * (1 - Math.abs(t - 0.4)), INK);
        columns(fill, at + 1, y + drop, 3, (t) => 11 * (1 - Math.abs(t - 0.4)), dark);
      }
      break;
    }
    case 'twin': {                                        // gathered at each side and hanging
      lock(young ? 8 : 10);
      for (const at of [x - 5, x + w - 1]) {
        fill(at + 1, y + 7, 5, 3, INK);                   // the tie
        fill(at + 2, y + 8, 3, 2, dark);
        columns(fill, at, y + 10, 7, (t) => 20 * dome(1 - Math.abs(t - 0.5) * 1.6), INK);
        columns(fill, at + 1, y + 10, 5, (t) => 19 * dome(1 - Math.abs(t - 0.5) * 1.5), hair);
      }
      break;
    }
    case 'side': {                                        // all of it over one shoulder
      lock(young ? 8 : 10);
      columns(fill, x + w - 2, y + 9, 8, (t) => 26 * dome(1 - t * 0.7), INK);
      columns(fill, x + w - 1, y + 9, 6, (t) => 25 * dome(1 - t * 0.7), hair);
      columns(fill, x + w - 1, y + 30, 6, (t) => 5 * dome(1 - t * 0.7), dark);
      break;
    }
    case 'bun': {                                         // tied up, which leaves the neck bare
      lock(young ? 6 : 8);
      rows(fill, cx, top - 8, 11, (t) => 7 * Math.sin(Math.PI * (0.15 + t * 0.85)), INK);
      rows(fill, cx, top - 7, 9, (t) => 6 * Math.sin(Math.PI * (0.15 + t * 0.85)), hair);
      fill(cx - 3, top - 6, 4, 2, shade(hair, 1.2));      // the light on top of it
      break;
    }
  }
}

/** Hair that will not lie flat, at irregular heights — evenly spaced spikes read as a comb. */
function spikes(fill: Fill, p: Palette, b: Build, top: number): void {
  const jitter = mulberry32(p.volume * 2654435761 + b.w);
  for (let i = 0; i < b.w;) {
    const tall = 3 + Math.floor(jitter() * 4);
    const wide = 2 + Math.floor(jitter() * 2);
    const lean = Math.round((i / b.w - 0.5) * 3);
    columns(fill, b.x + i - 1, top - tall, wide + 2, (t) => (tall + 3) * dome(1 - Math.abs(t - 0.5) * 1.7), INK);
    columns(fill, b.x + i + lean, top - tall + 1, wide, (t) => (tall + 1) * dome(1 - Math.abs(t - 0.5) * 1.5), p.hair);
    i += wide + 1 + Math.floor(jitter() * 3);
  }
}

/**
 * The fringe: what the hair does in front, and the thing that decides how much of the face you
 * can see at all. One of these covers an eye, which no amount of colour ever does as much for.
 */
export function fringe(fill: Fill, p: Palette, b: Build): void {
  const { x, y, w } = b;
  const hair = p.hair;
  const brow = b.eyeY - 3;
  // a fringe is measured against the forehead it has to cover, so a small head gets a small one
  const deep = Math.max(4, Math.round((brow - y) * 0.55) + (p.volume % 3));
  // a ragged tip, so the bottom edge of a fringe looks cut rather than ruled
  const strands = mulberry32(p.volume * 40503 + w);
  const ragged = (base: number) => (t: number): number =>
    base + Math.sin(t * Math.PI * (3 + p.volume % 3)) * 1.6 + strands() * 1.2;

  fill(x + 1, y - 1, w - 2, 2, hair);                     // the hairline everybody has

  /** Two or three darker lines through it: without them a pale fringe is just a shape. */
  const parting = (from: number, across: number, depth: number): void => {
    const shadow = shade(hair, 0.82);
    for (let i = 1; i < 4; i++) {
      const at = from + Math.round((across * i) / 4);
      fill(at, y, 1, Math.max(2, Math.round(depth * (0.5 + (i % 2) * 0.3))), shadow);
    }
  };

  switch (p.fringe) {
    case 'straight':                                      // cut level, right across
      columns(fill, x + 1, y, w - 2, ragged(deep + 1), hair);
      parting(x + 2, w - 4, deep);
      break;
    case 'parted': {                                      // heavier on one side of a parting
      const part = Math.round(w * 0.38);
      columns(fill, x + 1, y, part, ragged(deep + 4), hair);
      columns(fill, x + part + 2, y, w - part - 3, ragged(deep), hair);
      fill(x + part, y, 1, deep + 2, shade(hair, 0.7));    // the parting itself
      parting(x + part + 3, w - part - 5, deep);
      break;
    }
    case 'curtain':                                       // down each side, forehead open between
      columns(fill, x, y, 6, (t) => (brow - y) * (1 - t * 0.55) + 2, hair);
      columns(fill, x + w - 6, y, 6, (t) => (brow - y) * (0.45 + t * 0.55) + 2, hair);
      columns(fill, x + 6, y, w - 12, () => 2, hair);
      break;
    case 'swept':                                         // pushed across, thinning as it goes
      columns(fill, x + 1, y, w - 2, (t) => (deep + 6) * (1 - t) + 2, hair);
      parting(x + 2, w - 6, deep + 3);
      break;
    case 'oneEye': {
      // a long sweep that reaches an eye and stops, thinning across the face rather than
      // sitting on it as a slab — it should read as hair fallen forward, not as a mask
      const reach = b.eyeY - y + Math.round(b.eyeH * 0.35);
      const across = Math.round(w * 0.46);
      columns(fill, x + 1, y, across, (t) => reach * (1 - t ** 2.2), hair);
      columns(fill, x + across + 1, y, w - across - 2, (t) => 3 - t, hair);
      parting(x + 2, across - 2, reach * 0.8);
      break;
    }
    case 'bare':                                          // pushed right back, forehead showing
      columns(fill, x + 1, y - 3, w - 2, () => 3, hair);
      break;
  }
}

/** One hair that will not lie down. */
export function ahoge(fill: Fill, hair: string, b: Build): void {
  const middle = b.x + Math.round(b.w / 2);
  const top = b.y - 2;
  fill(middle - 1, top - 7, 3, 8, INK);
  fill(middle, top - 6, 1, 7, hair);
  fill(middle + 1, top - 7, 2, 3, INK);
  fill(middle + 1, top - 6, 1, 2, hair);
}

