import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORKS } from './hall';
import { CIVICS, NOT_DRAWN_YET, civicFor, whereItStands, worksNobodyPlaced } from './civics';

/**
 * A village bought six things and one of them appeared.
 *
 * `raisedRoofs` turned a `works` entry into a building and filtered `isARoof`, so a hall could save
 * four thousand gold, pay for a watchtower, carry the watchman's wage from that day on, and a
 * player walking in would see a field. The economy bench reported eight bath houses and was reading
 * the books correctly — the books were right and nothing joined them to the ground.
 */
describe('what a village buys, and where it stands', () => {
  it('accounts for every single thing a hall can buy', () => {
    // the assertion that makes this stay true: a work added to WORKS is either drawn or explicitly
    // written down as not drawn, and there is no third state where somebody simply forgot
    expect(worksNobodyPlaced()).toEqual([]);
  });

  it('says why, for the ones that are not drawn', () => {
    for (const [id, why] of Object.entries(NOT_DRAWN_YET)) {
      expect(WORKS.map((w) => w.id), `${id} is not a thing a hall buys`).toContain(id);
      expect(why.length, 'a reason nobody wrote is a gap nobody meant').toBeGreaterThan(20);
    }
  });

  it('never claims to draw and not draw the same thing', () => {
    for (const civic of CIVICS) expect(NOT_DRAWN_YET[civic.id]).toBeUndefined();
  });

  const village = { x: 100, z: 200, radius: 12, board: [104, 198] as const };
  const spare = [{ tx: 110, tz: 205, rot: 0.5 }, { tx: 112, tz: 205, rot: 1 }];

  it('puts the well on the square, which is what a square is for', () => {
    const at = whereItStands(civicFor('well')!, village, spare, 0)!;
    expect(Math.hypot(at.x - 104, at.z - 198)).toBeLessThan(3);
  });

  it('puts the tower out at the rim, where it can see something that is not a roof', () => {
    const at = whereItStands(civicFor('watchtower')!, village, spare, 0)!;
    const out = Math.hypot(at.x - village.x, at.z - village.z);
    expect(out).toBeCloseTo(village.radius, 5);
  });

  it('keeps the tower where it was when the village grows', () => {
    // a landmark that walks is not a landmark
    const first = whereItStands(civicFor('watchtower')!, village, spare, 0)!;
    const later = whereItStands(civicFor('watchtower')!, village, [...spare, { tx: 9, tz: 9, rot: 0 }], 2)!;
    expect(later).toEqual(first);
  });

  it('queues an ordinary building behind the houses rather than on top of them', () => {
    const first = whereItStands(civicFor('bathhouse')!, village, spare, 0)!;
    const second = whereItStands(civicFor('bathhouse')!, village, spare, 1)!;
    expect(second).not.toEqual(first);
    expect(whereItStands(civicFor('bathhouse')!, village, spare, 2), 'no plot left, nothing built').toBeNull();
  });

  it('is actually asked by the thing that draws a village', () => {
    // the fault, not the parts: a placement rule nothing calls leaves the field exactly as it was
    expect(readFileSync('src/game/villageroofs.ts', 'utf8')).toContain('whereItStands(');
  });
});
