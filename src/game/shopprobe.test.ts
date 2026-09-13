import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The shop probe can be pointed at a village.
 *
 * Found by walking the hunting loop in a browser (issue #2): `__enterShop('store')` took the first
 * village in the world that had one, every time, so a walk that needed *this* village's shop could
 * not be written. The fur premium bug the same walk uncovered was a price that differs by country —
 * snow quoted 15g and desert 23g — and the probe could only ever stand in one of them.
 *
 * A tool that can only reach one example is a tool that cannot test the thing the example varies.
 *
 * Read as source rather than driven, because standing a probe up needs a browser, a scene and a
 * grown world. What is checked is the shape of the door: that it takes a village and says which one
 * it used. The walking is done by `chore playtest`, which is where a real one belongs.
 */
describe('reaching a shop from a test harness', () => {
  const source = readFileSync('src/game/probes.ts', 'utf8');
  // from where the probe is *assigned*, not where its name first appears — the name is also in a
  // type declaration four hundred lines earlier, and slicing from there took nothing at all
  const from = source.indexOf('.__enterShop =');
  const probe = source.slice(from, source.indexOf('debug.__standAtCounter', from));

  it('can be told which village, rather than always taking the first', () => {
    expect(probe, 'the probe should accept a village name').toMatch(/village\??:\s*string/);
  });

  it('still works when nobody says which, so old walks keep running', () => {
    expect(probe).toMatch(/village\?:/);
  });

  it('says which village it actually entered, so a walk can assert on it', () => {
    expect(probe).toMatch(/\$\{village\.name\}/);
  });
});
