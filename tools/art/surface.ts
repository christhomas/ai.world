import { drawText, textWidth } from './font';
import { encodePng } from './png';

/**
 * A block of pixels you can draw rectangles onto.
 *
 * Its `fill` has exactly the shape the game's own drawing functions expect, so a face is painted
 * into a picture here by the same code that paints it into a canvas in the browser. That is the
 * point of the whole arrangement: what you approve on the terminal is what the game will draw,
 * because it is not a second implementation of anything.
 */
export class Surface {
  readonly rgba: Uint8Array;

  constructor(readonly width: number, readonly height: number, background = '#00000000') {
    this.rgba = new Uint8Array(width * height * 4);
    this.fill(0, 0, width, height, background);
  }

  /** Paint a rectangle. Colours are #rgb, #rrggbb or #rrggbbaa, and alpha is blended. */
  fill = (x: number, y: number, w: number, h: number, colour: string): void => {
    const [r, g, b, a] = parseColour(colour);
    if (a === 0) return;
    const left = Math.max(0, Math.round(x));
    const top = Math.max(0, Math.round(y));
    const right = Math.min(this.width, Math.round(x + w));
    const bottom = Math.min(this.height, Math.round(y + h));

    for (let py = top; py < bottom; py++) {
      for (let px = left; px < right; px++) {
        const at = (py * this.width + px) * 4;
        if (a === 255) {
          this.rgba[at] = r; this.rgba[at + 1] = g; this.rgba[at + 2] = b; this.rgba[at + 3] = 255;
          continue;
        }
        const k = a / 255;
        this.rgba[at] = Math.round(this.rgba[at] * (1 - k) + r * k);
        this.rgba[at + 1] = Math.round(this.rgba[at + 1] * (1 - k) + g * k);
        this.rgba[at + 2] = Math.round(this.rgba[at + 2] * (1 - k) + b * k);
        this.rgba[at + 3] = Math.max(this.rgba[at + 3], a);
      }
    }
  };

  /** Copy another surface in, scaled up by whole pixels so the art stays square-edged. */
  blit(from: Surface, x: number, y: number, scale = 1): void {
    for (let sy = 0; sy < from.height; sy++) {
      for (let sx = 0; sx < from.width; sx++) {
        const at = (sy * from.width + sx) * 4;
        if (from.rgba[at + 3] === 0) continue;
        const colour = `#${[from.rgba[at], from.rgba[at + 1], from.rgba[at + 2], from.rgba[at + 3]]
          .map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        this.fill(x + sx * scale, y + sy * scale, scale, scale, colour);
      }
    }
  }

  text(line: string, x: number, y: number, colour: string, scale = 1): void {
    drawText(this.fill, line, x, y, colour, scale);
  }

  /** Text centred on a point, which is what captions under pictures want. */
  centredText(line: string, cx: number, y: number, colour: string, scale = 1): void {
    this.text(line, Math.round(cx - textWidth(line, scale) / 2), y, colour, scale);
  }

  png(): Buffer {
    return encodePng(this.width, this.height, this.rgba);
  }
}

function parseColour(colour: string): [number, number, number, number] {
  const hex = colour.replace('#', '');
  if (hex.length === 3) {
    const [r, g, b] = [...hex].map((c) => parseInt(c + c, 16));
    return [r, g, b, 255];
  }
  const n = parseInt(hex.slice(0, 6), 16);
  const alpha = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}
