/**
 * Drawing curves out of squares.
 *
 * Everything here paints by the row or the column rather than by the rectangle, which is the
 * whole difference between hair and a coloured box: a shape whose edge steps in and out looks
 * grown, and a shape whose edge is ruled looks stuck on.
 *
 * It knows nothing about faces. Anything in the game that wants a rounded silhouette out of whole
 * pixels can use it.
 */

/** How a pixel gets put down. Everything here draws through one of these and nothing else. */
export type Fill = (x: number, y: number, w: number, h: number, colour: string) => void;

/** Fill a shape a row at a time, `half` giving its half-width at each row from the middle. */
export function rows(fill: Fill, cx: number, top: number, h: number, half: (t: number) => number, colour: string): void {
  for (let i = 0; i < h; i++) {
    const w = Math.max(0, Math.round(half(i / Math.max(1, h - 1))));
    if (w > 0) fill(cx - w, top + i, w * 2, 1, colour);
  }
}

/** Fill a shape a column at a time, `reach` giving how far down it hangs at each column. */
export function columns(fill: Fill, left: number, top: number, w: number, reach: (t: number) => number, colour: string): void {
  for (let i = 0; i < w; i++) {
    const h = Math.max(0, Math.round(reach(i / Math.max(1, w - 1))));
    if (h > 0) fill(left + i, top, 1, h, colour);
  }
}

/** The curve of a skull, and of most things that sit on one. */
export const dome = (t: number): number => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));

/** How bright a colour looks, 0 to 1, weighted the way an eye weights it. */
export function brightness(colour: string): number {
  const n = parseInt(colour.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/**
 * A colour carried part of the way towards another, `by` 0 leaving it alone and 1 replacing it.
 *
 * Different from `shade`, which scales a colour towards black or white and so keeps it as saturated
 * as it was. Mixing towards a light drains the colour as it lightens, which is what a wintry sun
 * actually does to everything under it.
 */
export function wash(colour: string, towards: string, by: number): string {
  const from = parseInt(colour.slice(1), 16);
  const to = parseInt(towards.slice(1), 16);
  const mix = (at: number): number =>
    Math.round((((from >> at) & 255) * (1 - by)) + (((to >> at) & 255) * by));
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0')}`;
}

/** A colour, lightened or darkened. A shadow and a highlight are the same colour, twice. */
export function shade(colour: string, by: number): string {
  const n = parseInt(colour.slice(1), 16);
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v * by)));
  const r = clamp((n >> 16) & 255), g = clamp((n >> 8) & 255), b = clamp(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

