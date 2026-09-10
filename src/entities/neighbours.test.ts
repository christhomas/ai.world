import { describe, expect, it } from 'vitest';
import { KINDS } from './animals';
import { Entity, Herd } from './entity';
import { mulberry32 } from '../core/rng';
import { nearest, within } from './neighbours';

/**
 * Who is standing near you, and who you can talk to.
 *
 * These have to be the same crowd, and for a while they were not. The world holds the villagers
 * now — a page is handed them to draw and to walk past rather than owning them — so they are
 * *guests* of the crowd rather than members of it. `within` counted them and `nearest` did not, and
 * `nearest` is what Enter ends at: standing at arm's length from a villager and pressing it
 * answered "no one close enough to talk to". Every villager in the game, for as long as the world
 * has held them, and nothing in the suite said a word about it.
 */

function someone(id: string, x: number, z: number): Entity {
  const kind = KINDS[id];
  return new Entity(kind, x, z, new Herd(kind, x, z, x, z, 0), 'bench', mulberry32(2));
}

describe('the crowd around you', () => {
  it('answers with the world\'s people as well as this page\'s own', () => {
    const mine = someone('wolf', 6, 0);
    const theirs = someone('villager', 1, 0);
    expect(nearest([[mine]], [theirs], 0, 0, 8)?.kind.id, 'the villager the world holds was invisible').toBe('villager');
    // and the same crowd `within` reports, which is the whole of what went wrong
    expect(within([[mine]], [theirs], 0, 0, 8).map((e) => e.kind.id)).toEqual(['villager', 'wolf']);
  });

  it('is nobody at all when nobody is near, guests or not', () => {
    const far = someone('villager', 90, 90);
    expect(nearest([[]], [far], 0, 0, 8)).toBe(null);
  });

  it('leaves out anybody indoors, whoever holds them', () => {
    // a shopkeeper behind their own door is in the world and is not in the street
    const inside = someone('villager', 1, 0);
    inside.indoors = true;
    const outside = someone('villager', 3, 0);
    expect(nearest([[]], [inside, outside], 0, 0, 8)?.x, 'talked to somebody through a wall').toBe(3);
  });

  it('leaves out the dead, whoever holds them', () => {
    const fallen = someone('villager', 1, 0);
    fallen.dead = true;
    expect(nearest([[fallen]], [], 0, 0, 8), 'struck up a conversation with a corpse').toBe(null);
  });
});
