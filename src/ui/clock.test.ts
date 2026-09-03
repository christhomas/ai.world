import { describe, expect, it } from 'vitest';
import { phaseAt } from './clock';

describe('time of day', () => {
  it('runs night, dawn, day, dusk, night as the hours pass', () => {
    expect(phaseAt(0.0)).toBe('night');    // midnight
    expect(phaseAt(0.25)).toBe('dawn');    // 06:00
    expect(phaseAt(0.5)).toBe('day');      // noon
    expect(phaseAt(0.75)).toBe('dusk');    // 18:00
    expect(phaseAt(0.95)).toBe('night');   // 22:48
    // the phases cover the whole day with no gaps
    let previous = phaseAt(0);
    const seen = new Set([previous]);
    for (let t = 0; t < 1; t += 0.005) {
      const p = phaseAt(t);
      if (p !== previous) { seen.add(p); previous = p; }
    }
    expect(seen).toEqual(new Set(['night', 'dawn', 'day', 'dusk']));
  });
});
