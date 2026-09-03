import { describe, expect, it } from 'vitest';
import { PropKind } from '../world/biomes';
import { ITile, blocksAt, generateInterior, interiorSeed, interiorTitle } from './generate';
import { InteriorWorld } from './world';

const KINDS = ['house', 'store', 'smith', 'inn', 'apothecary', 'church'] as const;

describe('interiors', () => {
  it('every kind is a walled room with a door you can reach', () => {
    for (const kind of KINDS) {
      const map = generateInterior(interiorSeed(1, 5, 7), kind, 'Testford');
      const at = (x: number, z: number) => map.tiles[z * map.w + x] as ITile;
      // the shell is solid apart from the doorway
      for (let x = 0; x < map.w; x++) {
        expect(at(x, 0)).toBe(ITile.Wall);
        expect(at(x, map.h - 1) === ITile.Wall || at(x, map.h - 1) === ITile.Door).toBe(true);
      }
      for (let z = 0; z < map.h; z++) {
        expect(at(0, z)).toBe(ITile.Wall);
        expect(at(map.w - 1, z)).toBe(ITile.Wall);
      }
      expect(at(map.door[0], map.door[1])).toBe(ITile.Door);
      // you arrive standing on clear floor, right by the way out
      const world = new InteriorWorld(map);
      expect(world.heightAt(map.entry[0] + 0.5, map.entry[1] + 0.5)).not.toBeNull();
      expect(blocksAt(map, map.entry[0], map.entry[1])).toBe(false);
      expect(world.atDoor(map.entry[0] + 0.5, map.entry[1] + 0.5)).toBe(true);
      // furniture stays inside the walls
      for (const f of map.furniture) {
        expect(f.x).toBeGreaterThan(0);
        expect(f.z).toBeGreaterThan(0);
        expect(f.x).toBeLessThan(map.w - 1);
        expect(f.z).toBeLessThan(map.h - 1);
      }
    }
  });

  it('shops and the chapel have someone behind the counter, houses do not', () => {
    for (const kind of KINDS) {
      const map = generateInterior(interiorSeed(2, 1, 1), kind, 'Testford');
      if (kind === 'house') {
        expect(map.keeper).toBeNull();
      } else {
        expect(map.keeper).not.toBeNull();
        const world = new InteriorWorld(map);
        expect(world.nearKeeper(map.keeper![0] + 0.5, map.keeper![1] + 0.5)).toBe(true);
        expect(world.nearKeeper(map.entry[0] + 0.5, map.entry[1] + 0.5)).toBe(false);
      }
    }
    // each trade has its own furniture
    const smith = generateInterior(3, 'smith', 'T').furniture.map((f) => f.kind);
    const chapel = generateInterior(3, 'church', 'T').furniture.map((f) => f.kind);
    expect(smith).toContain(PropKind.Anvil);
    expect(smith).toContain(PropKind.Forge);
    expect(chapel).toContain(PropKind.Altar);
    expect(chapel.filter((k) => k === PropKind.Pew).length).toBeGreaterThan(2);
    expect(chapel).not.toContain(PropKind.Anvil);
  });

  it('a building always has the same inside, and different buildings differ', () => {
    const a = generateInterior(interiorSeed(9, 4, 4), 'house', 'T');
    const b = generateInterior(interiorSeed(9, 4, 4), 'house', 'T');
    const c = generateInterior(interiorSeed(9, 5, 4), 'house', 'T');
    expect(a.furniture).toEqual(b.furniture);
    expect(interiorSeed(9, 4, 4)).not.toBe(interiorSeed(9, 5, 4));
    expect(interiorSeed(9, 4, 4)).not.toBe(interiorSeed(10, 4, 4));
    expect(c.furniture.length).toBeGreaterThan(0);
    expect(interiorTitle('smith', 'Oakmere')).toBe('Forge, Oakmere');
    expect(interiorTitle('house', 'Oakmere')).toContain('Oakmere');
  });

  it('counters and furniture block the way, floor and rugs do not', () => {
    const map = generateInterior(5, 'store', 'T');
    const world = new InteriorWorld(map);
    const counter = map.tiles.findIndex((t) => t === ITile.Counter);
    expect(counter).toBeGreaterThan(-1);
    const cx = counter % map.w, cz = Math.floor(counter / map.w);
    expect(world.heightAt(cx + 0.5, cz + 0.5)).toBeNull();
    const shelf = map.furniture.find((f) => f.kind === PropKind.Shelf)!;
    expect(world.blocked(shelf.x + 0.5, shelf.z + 0.5)).toBe(true);
    expect(world.blocked(map.entry[0] + 0.5, map.entry[1] + 0.5)).toBe(false);
    expect(world.heightAt(-1, 3)).toBeNull();
  });
});
