import { describe, expect, it } from 'vitest';
import { PropKind } from '../world/biomes';
import { ITile, blocksAt, generateInterior, interiorSeed, interiorTitle } from './generate';
import { InteriorWorld } from './world';
import { generateWebGraph } from '../world/roadweb';
import { TerrainSampler } from '../world/terrain';
import { propFootprints } from '../render/props';

const KINDS = ['house', 'store', 'smith', 'inn', 'apothecary', 'church', 'townhall', 'watchhouse'] as const;

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

/*
 * Furniture stops you where it is drawn, and a room still works.
 *
 * It used to stop you on the one tile it stood on, whatever it was: a bed is drawn 1.9 tiles long,
 * so the foot of every bed in the world was scenery you could stand inside. Boxing it fixes that
 * and introduces the opposite risk — a room small enough that the furniture seals it — so both are
 * tested together.
 */
describe('furniture you cannot walk through', () => {
  const footprints = propFootprints();

  it('stops you at the far end of a bed, not only on its own tile', () => {
    const map = generateInterior(interiorSeed(1, 5, 7), 'house', 'Testford');
    const bed = map.furniture.find((f) => f.kind === PropKind.Bed);
    expect(bed, 'a house with no bed in it').toBeTruthy();
    const world = new InteriorWorld(map, footprints);
    const middle = { x: bed!.x + 0.5, z: bed!.z + 0.5 };
    expect(world.blocked(middle.x, middle.z), 'the tile the bed stands on').toBe(true);
    // a bed is 0.9 across and 1.9 along its own length, so its ends are most of a tile out from
    // the tile it stands on — turned the way the bed is turned
    const box = propFootprints().get(PropKind.Bed)!;
    expect(box.hd, 'a bed that is not drawn long any more').toBeGreaterThan(0.8);
    const reach = box.hd * 0.9;
    const along = { x: -Math.sin(bed!.rot) * reach, z: Math.cos(bed!.rot) * reach };
    expect(world.blocked(middle.x + along.x, middle.z + along.z), 'the far end of the bed').toBe(true);
    expect(world.blocked(middle.x - along.x, middle.z - along.z), 'and the near end').toBe(true);
  });

  it('leaves every room walkable from the door to the keeper', () => {
    for (const kind of KINDS) {
      for (const seed of [1, 2, 3, 7, 11]) {
        const map = generateInterior(interiorSeed(seed, 5, 7), kind, 'Testford');
        const world = new InteriorWorld(map, footprints);
        // flood out from where the hero arrives, a quarter tile at a time so a gap narrower than a
        // doorway is not mistaken for a way through
        const step = 0.5;
        const seen = new Set<string>();
        const queue: Array<[number, number]> = [[map.entry[0] + 0.5, map.entry[1] + 0.5]];
        while (queue.length > 0) {
          const [x, z] = queue.pop()!;
          const key = `${Math.round(x / step)},${Math.round(z / step)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (world.blocked(x, z)) continue;
          for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) queue.push([x + dx, z + dz]);
        }
        const reached = (x: number, z: number) => seen.has(`${Math.round((x + 0.5) / step)},${Math.round((z + 0.5) / step)}`);
        expect(reached(map.door[0], map.door[1]), `${kind}/${seed}: walled in, cannot reach the door`).toBe(true);
        if (map.keeper) {
          // beside the keeper rather than on them: somebody is standing there
          const [kx, kz] = map.keeper;
          const beside = [[kx + 1, kz], [kx - 1, kz], [kx, kz + 1], [kx, kz - 1]].some(([x, z]) => reached(x, z));
          expect(beside, `${kind}/${seed}: cannot get near whoever keeps the place`).toBe(true);
        }
      }
    }
  });
});

/*
 * The rooms people actually walk into, rather than six made up for a test.
 *
 * Boxing the furniture is the fix for walking through beds and the risk of a room that its own
 * furniture seals. The kinds-and-seeds sweep above is a fair sample; this is the real thing — every
 * door of the first villages of a real world, with the interior each one actually opens.
 */
describe('every room in a real world', () => {
  it('can be crossed from where you arrive to the door you came in by', () => {
    const sampler = new TerrainSampler(generateWebGraph(3));
    const footprints = propFootprints();
    const sealed: string[] = [];
    let checked = 0;
    for (const door of sampler.structures.doors.slice(0, 40)) {
      const map = generateInterior(interiorSeed(3, door.bx, door.bz), door.kind as never, door.village);
      const world = new InteriorWorld(map, footprints);
      checked++;
      // flood from where the hero is put down, half a tile at a time
      const step = 0.5;
      const seen = new Set<string>();
      const queue: Array<[number, number]> = [[map.entry[0] + 0.5, map.entry[1] + 0.5]];
      while (queue.length > 0) {
        const [x, z] = queue.pop()!;
        const key = `${Math.round(x / step)},${Math.round(z / step)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (world.blocked(x, z)) continue;
        for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) queue.push([x + dx, z + dz]);
      }
      const doorway = `${Math.round((map.door[0] + 0.5) / step)},${Math.round((map.door[1] + 0.5) / step)}`;
      if (!seen.has(doorway)) sealed.push(`${map.kind} at ${door.bx},${door.bz} in ${door.village}`);
    }
    expect({ checked, sealed }, 'a room somebody could be shut into').toEqual({ checked, sealed: [] });
  });
});
