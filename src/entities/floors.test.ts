import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../dungeon/generate';
import { DungeonWorld } from '../dungeon/world';
import { EntityManager } from './manager';
import { Roster } from './roster';

/**
 * A dungeon floor keeps the monsters put into it.
 *
 * Which sounds like nothing worth a test until it is not true. The manager forgets the country
 * behind the hero by walking its spawned chunks and dropping the ones too far off, and a floor's
 * monsters are filed under `dungeon` — which read as a chunk, at a position that came out as
 * nowhere, and nowhere is never near enough to keep. So every monster on the floor was dropped on
 * the first step taken on it, which is the first frame, because the sweep runs whenever the focus
 * moves and it starts at nowhere as well.
 *
 * Nothing about that is visible from outside: the rooms are there, the doors are there, the chests
 * are there, the torches are lit, and the place is simply empty. It is exactly the shape of bug a
 * test is for.
 */

describe('the monsters on a floor', () => {
  const floorOf = (seed: number) => {
    const map = generateDungeon(seed, 'vault', 1);
    const world = new DungeonWorld(map, `Barrow:${seed}`, 'vault');
    const monsters = new EntityManager(new Roster(), world, { getTiles: () => null }, seed);
    monsters.spawnMonsters(map.monsterSpots, seed, 1);
    return { map, world, monsters };
  };

  it('are still there after the floor has been walked about on', () => {
    const { map, monsters } = floorOf(1234);
    const put = monsters.count;
    expect(put, 'a floor has something in it').toBeGreaterThan(0);

    // a minute of somebody standing at the entrance, which is where they come in
    const [ex, ez] = map.entrance;
    for (let step = 0; step < 600; step++) monsters.update(0.1, ex + 0.5, ez + 0.5, false, () => {}, 0.5);
    expect(monsters.count, 'and it still has it').toBe(put);
  });

  it('are still there after walking from one end of it to the other', () => {
    const { map, monsters } = floorOf(77);
    const put = monsters.count;
    // right across the floor, which is what moves the focus from one chunk to another
    for (let step = 0; step <= map.size; step++) {
      monsters.update(0.05, step + 0.5, step + 0.5, false, () => {}, 0.5);
    }
    expect(monsters.count).toBe(put);
  });
});
