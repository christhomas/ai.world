import { describe, expect, it } from 'vitest';
import { FACE, faceFor, paint, type Sitter } from '../ui/portrait';
import { Portraits } from './portraits';

const mira: Sitter = { id: 'v-12', trade: 'baker', stage: 'adult',
  from: { mother: { id: 'v-3', trade: 'farmer', stage: 'adult' } } };

/** What the page's canvas is filled with for this face, rectangle by rectangle. */
function onCanvas(who: Sitter, talking: boolean): string[] {
  const fills: string[] = [];
  paint((x, y, w, h, colour) => fills.push(`${x},${y},${w},${h},${colour}`), { ...faceFor(who), talking });
  return fills;
}

describe('faces for an app to draw', () => {
  it('paints a face once and names it after, as a scene names a geometry it has sent', () => {
    const faces = new Portraits();
    expect(faces.name(null)).toBeNull();
    expect(faces.take()).toBeNull();
    const key = faces.name(mira);
    const sent = faces.take();
    expect(Object.keys(sent ?? {})).toEqual([key]);
    expect(faces.name(mira)).toBe(key);
    expect(faces.take(), 'a face the app has is not sent again').toBeNull();
    expect(faces.name({ ...mira, id: 'v-13' }), 'somebody else is another face').not.toBe(key);
  });

  it('is the very rectangles the page fills, with the mouth open while the words arrive', () => {
    const faces = new Portraits();
    const key = faces.name(mira)!;
    const face = faces.take()![key] as { w: number; h: number; colours: string[]; still: number[]; talking: number[] };
    expect([face.w, face.h]).toEqual([FACE.W, FACE.H]);
    const drawn = (fills: number[]): string[] => {
      const out: string[] = [];
      for (let i = 0; i < fills.length; i += 5) out.push(`${fills.slice(i, i + 4).join(',')},${face.colours[fills[i + 4]]}`);
      return out;
    };
    expect(drawn(face.still)).toEqual(onCanvas(mira, false));
    expect(drawn(face.talking)).toEqual(onCanvas(mira, true));
    expect(face.talking).not.toEqual(face.still);
  });
});
