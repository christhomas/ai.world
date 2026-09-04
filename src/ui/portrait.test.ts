import { describe, expect, it } from 'vitest';
import { FACE, faceOf, paint, paletteFor } from './portrait';

/**
 * A face nobody can make out is worse than no face, so what is tested is legibility rather than
 * looks: every villager is drawn, every villager's hair can be told from their skin, and the same
 * person is the same face every time.
 */
const drawnBy = (id: string, trade = '', stage: 'adult' | 'child' = 'adult'): string[] => {
  const marks: string[] = [];
  paint((x, y, w, h, colour) => marks.push(`${x},${y},${w},${h},${colour}`), faceOf(id, trade, stage));
  return marks;
};

/** How bright a colour looks, the same way the module weights it. */
const brightness = (colour: string): number => {
  const n = parseInt(colour.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

describe('a drawn face', () => {
  it('is the same face for the same person, every time', () => {
    expect(drawnBy('Ashford-3', 'farmer')).toEqual(drawnBy('Ashford-3', 'farmer'));
    expect(drawnBy('Ashford-3', 'farmer')).not.toEqual(drawnBy('Ashford-4', 'farmer'));
  });

  it('keeps every mark on the canvas', () => {
    for (let i = 0; i < 200; i++) {
      for (const mark of drawnBy(`villager-${i}`)) {
        const [x, y, w, h] = mark.split(',').map(Number);
        expect(x + w, mark).toBeLessThanOrEqual(FACE.W + 8);   // hair may hang past the edge
        expect(y + h, mark).toBeLessThanOrEqual(FACE.H + 8);
      }
    }
  });

  it('never puts hair the same brightness as the skin under it', () => {
    for (let i = 0; i < 500; i++) {
      const { skin, hair } = paletteFor(faceOf(`villager-${i}`, '', 'adult'));
      const apart = Math.abs(brightness(hair) - brightness(skin));
      expect(apart, `villager-${i}: ${hair} on ${skin}`).toBeGreaterThanOrEqual(0.17);
    }
  });

  it('does not give every villager the same face', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = paletteFor(faceOf(`villager-${i}`, '', 'adult'));
      seen.add([p.skin, p.hair, p.eye, p.head, p.eyes, p.eyeH, p.spacing, p.hair2, p.fringe, p.volume, p.mood].join('|'));
    }
    expect(seen.size).toBeGreaterThan(190);
  });

  it('gives a trade its own hat, and no trade none', () => {
    const farmer = drawnBy('same-person', 'farmer').join('|');
    const plain = drawnBy('same-person', '').join('|');
    expect(farmer).not.toEqual(plain);
    expect(farmer).toContain('#e8c878');                       // straw
    expect(plain).not.toContain('#e8c878');
  });

  it('draws a child smaller than an adult', () => {
    const height = (marks: string[]): number =>
      Math.max(...marks.map((m) => { const [, y, , h] = m.split(',').map(Number); return y + h; })) -
      Math.min(...marks.map((m) => Number(m.split(',')[1])));
    expect(height(drawnBy('p', '', 'child'))).toBeLessThan(height(drawnBy('p', '', 'adult')));
  });

  it('opens the mouth when somebody is speaking', () => {
    const shut: string[] = [];
    const open: string[] = [];
    paint((x, y, w, h, c) => shut.push(`${x},${y},${w},${h},${c}`), faceOf('p', '', 'adult', false));
    paint((x, y, w, h, c) => open.push(`${x},${y},${w},${h},${c}`), faceOf('p', '', 'adult', true));
    expect(open).not.toEqual(shut);
    expect(open.join('|')).toContain('#c4676c');            // the inside of an open mouth
    expect(shut.join('|')).not.toContain('#c4676c');
  });
});
