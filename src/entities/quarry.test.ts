import { describe, expect, it } from 'vitest';
import { KINDS } from './animals';
import { PEOPLE, nearestPerson, nearestQuarry } from './quarry';
import { Entity, Herd } from './entity';
import { mulberry32 } from '../core/rng';
import { bodyForTrade } from './trades';

/**
 * Who is a person, which is one question with three answers hanging off it.
 *
 * `PEOPLE` decides what a wolf would rather have than a rabbit, what a constable comes running
 * about, and what it is murder rather than hunting to kill. It was a hand-written set of four
 * names, and it went wrong the night the trades were given bodies of their own: seven new sorts of
 * person arrived in `properties/people.json` and none of them in that set. A hunter looking for
 * something to shoot asks for anything with hit points that is not a person and is not damage,
 * so a priest standing in a field was quarry.
 *
 * It is read off the file now, and this holds it there — a list of names beside a directory of
 * names is a list that falls out of step, and this one managed it within a day.
 */

const put = (id: string, x: number, z: number): Entity => {
  const kind = KINDS[id];
  const herd = new Herd(kind, x, z, x, z, 20);
  return new Entity(kind, x, z, herd, 'chunk', mulberry32(1));
};

describe('who counts as a person', () => {
  it('is everybody a trade can be drawn as, without anybody having to add them here', () => {
    for (const trade of ['miner', 'farmer', 'doctor', 'constable', 'priest', 'mayor', 'seller', 'hunter']) {
      const body = bodyForTrade(trade);
      expect(PEOPLE.has(body), `a ${trade} is drawn as a ${body}, which nothing in this game counts as a person`).toBe(true);
    }
    // and the one a village hands out rather than the register
    expect(PEOPLE.has('cowboy'), 'the man who keeps the horses is not a person').toBe(true);
  });

  it('is nothing that walks on four legs', () => {
    for (const beast of ['wolf', 'deer', 'sheep', 'bear', 'rabbit']) {
      expect(PEOPLE.has(beast), `a ${beast} is being counted as a person`).toBe(false);
    }
  });
});

describe('what a hunter may shoot', () => {
  it('is not a man doing his job', () => {
    const hunter = put('villager', 0, 0);
    for (const id of ['miner', 'priest', 'doctor', 'constable', 'mayor', 'farmer', 'cowboy']) {
      const person = put(id, 2, 0);
      expect(nearestQuarry(hunter, [person]), `a hunter took aim at a ${id}`).toBeNull();
    }
  });

  it('is the deer standing behind him', () => {
    const hunter = put('villager', 0, 0);
    const priest = put('priest', 2, 0);
    const deer = put('deer', 6, 0);
    expect(nearestQuarry(hunter, [priest, deer])).toBe(deer);
  });
});

describe('what a wolf would rather have', () => {
  it('is any of them, and the nearest of them', () => {
    const wolf = put('wolf', 0, 0);
    const miner = put('miner', 3, 0);
    const rabbit = put('rabbit', 1, 0);
    expect(nearestPerson(wolf, [rabbit, miner])).toBe(miner);
  });
});
