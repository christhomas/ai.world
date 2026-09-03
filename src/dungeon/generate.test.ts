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

describe('depth', () => {
  it('has stairs down on every floor but the last, and a boss at the bottom', async () => {
    const { DEPTH } = await import('./generate');
    for (let floor = 1; floor <= DEPTH.FLOORS; floor++) {
      const map = generateDungeon(4242, 'vault', floor);
      expect(map.floor).toBe(floor);
      if (floor < DEPTH.FLOORS) {
        expect(map.descent).not.toBeNull();
        expect(map.boss).toBeNull();
        expect(map.tiles[map.descent![1] * map.size + map.descent![0]]).toBe(DTile.Descent);
      } else {
        expect(map.descent).toBeNull();
        expect(map.boss).not.toBeNull();
      }
    }
    // caves are a single floor with no boss
    const cave = generateDungeon(4242, 'cave', 1);
    expect(cave.descent).toBeNull();
    expect(cave.boss).toBeNull();
  });

  it('gets busier the deeper you go, and each floor is its own place', () => {
    const first = generateDungeon(77, 'vault', 1);
    const third = generateDungeon(77, 'vault', 3);
    expect(third.monsterSpots.length).toBeGreaterThan(first.monsterSpots.length);
    expect(Array.from(third.tiles)).not.toEqual(Array.from(first.tiles));
    // and the same floor is always the same place
    expect(Array.from(generateDungeon(77, 'vault', 2).tiles)).toEqual(Array.from(generateDungeon(77, 'vault', 2).tiles));
  });
});
