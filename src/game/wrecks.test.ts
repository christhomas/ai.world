import { describe, expect, it } from 'vitest';
import { KINDS } from '../entities/animals';
import { DROWNED_MONSTERS, dungeonMonsters } from '../entities/spawns';
import { DTile, DUNGEON_STYLES, asDungeonStyle, generateDungeon } from '../dungeon/generate';

/**
 * A wreck you can go down into, and what is waiting in it.
 *
 * A hull on a beach was a chest with a boat drawn round it: you pressed Enter, took the salvage,
 * and every time afterwards were told it was picked clean. It is a way in now. Below the waterline
 * she is flooded, and a flooded hold is a different place from a cave with water in it — it has a
 * roster of its own rather than a rung on the ladder of depths, because a wreck is one room deep
 * and that room is the only one there is.
 *
 * What is pinned here is the part that cannot be seen by looking at the screen: that the drowned
 * roster is made of creatures that actually exist, that a flooded floor draws from it rather than
 * from the depth table, and that the two halves of the game agree about what sort of floor it is.
 * That last one is the whole reason the style now travels over the wire — a world that grew a
 * wreck's hold as a vault while the page grew it as a flooded hold would put every creature in it
 * inside a wall, and it would look like a netcode bug rather than like a missing word.
 */

describe('what is waiting in a drowned hold', () => {
  it('is drawn from the drowned roster rather than from how deep you are', () => {
    expect(dungeonMonsters(1, 'sunken')).toBe(DROWNED_MONSTERS);
    expect(dungeonMonsters(3, 'sunken'), 'a wreck got deeper the further down the ladder it was').toBe(DROWNED_MONSTERS);
  });

  it('leaves every other kind of floor exactly as it was', () => {
    expect(dungeonMonsters(1, 'cave')).toBe(dungeonMonsters(1));
    expect(dungeonMonsters(2, 'vault')).toBe(dungeonMonsters(2));
    expect(dungeonMonsters(2)).not.toBe(dungeonMonsters(1));
  });

  it('is made of creatures the game can actually draw', () => {
    // a name in a spawn table with no body behind it is a floor that silently has nothing in it
    for (const { kind } of DROWNED_MONSTERS) {
      expect(KINDS[kind], `the drowned roster asks for "${kind}" and nothing draws one`).toBeDefined();
    }
  });

  it('is mostly fish-folk, because a fight in waist-deep water wants numbers', () => {
    const share = (id: string): number => DROWNED_MONSTERS.find((m) => m.kind === id)?.weight ?? 0;
    expect(share('fishfolk')).toBeGreaterThan(share('squid'));
    expect(share('squid')).toBeGreaterThan(share('shark'));
  });

  it('holds the two new ones to the shape every other creature has', () => {
    for (const id of ['squid', 'fishfolk']) {
      const kind = KINDS[id];
      expect(kind.hp, `${id} cannot be killed`).toBeGreaterThan(0);
      expect(kind.damage, `${id} cannot hurt anybody`).toBeGreaterThan(0);
      expect(kind.timid, `${id} runs away, in a room you cannot back out of`).toBe(false);
      expect(kind.body.hw, `${id} stands on nothing`).toBeGreaterThan(0);
    }
  });
});

describe('the word that says what a floor is made of', () => {
  it('takes a style the generator knows', () => {
    for (const style of DUNGEON_STYLES) expect(asDungeonStyle(style, 'vault')).toBe(style);
  });

  it('falls back rather than growing something nobody asked for', () => {
    // a page from before the drowned places existed says nothing at all, and must get what it
    // has always got
    expect(asDungeonStyle(undefined, 'cave')).toBe('cave');
    expect(asDungeonStyle('flooded', 'vault')).toBe('vault');
    expect(asDungeonStyle(7, 'thicket')).toBe('thicket');
  });

  it('grows the same rooms on both sides when both sides say the same word', () => {
    /*
     * The failure this guards against, stated as arithmetic: the seed alone does not decide a
     * floor. A wreck's hold and a vault off the same anchor seed are different rooms, so a world
     * that was told only the seed would disagree with the page about where the walls are.
     */
    const flooded = generateDungeon(1234, 'sunken', 1);
    const vault = generateDungeon(1234, 'vault', 1);
    expect(flooded.tiles).not.toEqual(vault.tiles);
    expect(generateDungeon(1234, 'sunken', 1).tiles).toEqual(flooded.tiles);
  });

  it('is one room deep, because a wreck has no second storey below the keel', () => {
    expect(generateDungeon(99, 'sunken', 1).descent, 'a stair down out of a shipwreck').toBeNull();
  });

  it('puts the way out where the hero comes in', () => {
    const hold = generateDungeon(77, 'sunken', 1);
    const [ex, ez] = hold.entrance;
    expect(hold.tiles[ez * hold.size + ex]).not.toBe(DTile.Rock);
  });
});
