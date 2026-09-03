import { describe, expect, it } from 'vitest';
import { DTile, fullyConnected, generateDungeon } from './generate';

describe('generateDungeon', () => {
  it('is deterministic, connected, and furnished', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const a = generateDungeon(seed), b = generateDungeon(seed);
      expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
      expect(a.rooms.length).toBeGreaterThanOrEqual(6);
      expect(fullyConnected(a)).toBe(true);
      expect(a.tiles[a.entrance[1] * a.size + a.entrance[0]]).toBe(DTile.Stairs);
      expect(a.chests.filter((c) => c.big).length).toBe(1);
      expect(a.torches.length).toBeGreaterThan(8);
      // chests stand on floor, torches in rock
      for (const c of a.chests) expect(a.tiles[c.z * a.size + c.x]).toBe(DTile.Floor);
      for (const t of a.torches) expect(a.tiles[t.z * a.size + t.x]).toBe(DTile.Rock);
      // the outer ring stays solid rock
      for (let i = 0; i < a.size; i++) {
        expect(a.tiles[i]).toBe(DTile.Rock);
        expect(a.tiles[(a.size - 1) * a.size + i]).toBe(DTile.Rock);
        expect(a.tiles[i * a.size]).toBe(DTile.Rock);
        expect(a.tiles[i * a.size + a.size - 1]).toBe(DTile.Rock);
      }
    }
    expect(Array.from(generateDungeon(1).tiles)).not.toEqual(Array.from(generateDungeon(2).tiles));
  });
});
