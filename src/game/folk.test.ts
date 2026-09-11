import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateWebGraph } from '../world/roadweb';
import { TerrainSampler } from '../world/terrain';
import { GroundWorld } from '../world/groundworld';
import { Register } from '../world/register';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import { Roster } from '../entities/roster';
import { propFootprints } from '../entities/props';
import { postsOf } from '../entities/villagers';
import { tradesFor } from '../entities/trades';
import { Wildlife } from './wildlife';
import { bookOf, tellingTheWorld } from './folk';
import type { Village } from '../world/structures';
import type { CreatureSnap } from '../../server/protocol';

/**
 * A page putting a villager back together out of what it was told.
 *
 * The receiving end of C5, and the thing it has to get right is not the drawing — a villager is
 * drawn like any other creature and always was — but the *man*. He arrives as an id, and everything
 * that makes him worth talking to has to be waiting on this side already: his family, his
 * neighbours, the stones in his churchyard, the purse he has put by. That works because both halves
 * grow the same book from the same seed, and this is the test that says so.
 *
 * The one part that cannot be grown is what he holds about you, because that happened on somebody's
 * screen. It travels with him, and it has to land where a conversation will look for it — which is
 * the register, not the body standing in the street: the body is thrown away every time you walk out
 * of the village, and a memory kept on it would last exactly that long.
 */

/** The world's half: a village founded as a world would found it, with a man in it. */
function aVillageSomewhere(seed: number) {
  const sampler = new TerrainSampler(generateWebGraph(seed));
  const ground = new GroundWorld(sampler, propFootprints());
  const village = sampler.structures.villages[0];
  ground.reach(village.x, village.z, 3);
  const trades = tradesFor(postsOf(village, ground)).map((t) => t.id);
  const world = new Register(seed, 1);
  world.settle(village.name, village.houses.length, trades);
  const man = world.living(village.name).find((p) => p.trade !== '')!;
  return { sampler, ground, village, trades, world, man };
}

/** What the world would put on the wire about him. */
function snapOf(seed: number): { snap: CreatureSnap; where: ReturnType<typeof aVillageSomewhere> } {
  const where = aVillageSomewhere(seed);
  const { village, trades, man } = where;
  return {
    where,
    snap: {
      id: 1, kind: 'villager', x: village.x, z: village.z, y: 0, yaw: 0, walk: 0,
      state: 'idle', hp: 3,
      who: {
        person: man.id, name: man.name, trade: man.trade, role: 'villager',
        village: village.name, trades, doing: '',
        mind: { memories: man.memories, opinions: man.opinions },
      },
    },
  };
}

/** This page's half: a renderer, a crowd to file guests under, and an empty book. */
function aPage(seed: number, ground: GroundWorld, villages: readonly Village[]) {
  const renderer = new EntityRenderer(new THREE.Scene());
  const manager = new EntityManager(new Roster(), ground, ground, seed);
  const here = new Register(seed, 1);
  return { wildlife: new Wildlife(renderer, manager, bookOf(here, villages)), here, manager };
}

describe('a villager arriving from the world', () => {
  it('is drawn as the man the world means, with his village behind him', () => {
    const { snap, where } = snapOf(3);
    const { wildlife, here } = aPage(3, where.ground, where.sampler.structures.villages);
    wildlife.apply([snap], []);

    const body = wildlife.find(1);
    expect(body, 'the world named somebody and nothing was drawn').not.toBeNull();
    expect(body!.person).toBe(where.man.id);
    expect(body!.name).toBe(where.man.name);
    expect(body!.herd.tag, 'a villager with no village on him has nothing to say about where he is').toBe(where.village.name);

    // and the book opened itself around him: nothing on this page puts villagers in a street any
    // more, so if the arrival does not found the village then nobody has a family at all
    const known = here.find(where.man.id);
    expect(known, 'the village was never founded on this side, so the man is a body with no family').toBeDefined();
    expect(known!.name, 'the same seed and the same trades founded two different villages').toBe(where.man.name);
  });

  it('brings what he holds, and it lands where a conversation will look for it', () => {
    const { snap, where } = snapOf(3);
    // something that happened on somebody's screen, which is the one thing about him nothing here
    // could have worked out
    where.world.recall(where.man.id, 'saved', 'Rowan', 1);
    snap.who!.mind = { memories: where.man.memories, opinions: where.man.opinions };

    const { wildlife, here } = aPage(3, where.ground, where.sampler.structures.villages);
    wildlife.apply([snap], []);

    const known = here.find(where.man.id)!;
    expect(known.memories[0]?.what, 'what the world said he remembers never reached the book on this page').toBe('saved');
    expect(known.opinions[0]?.who, 'and nor did what he came to think of whoever did it').toBe('Rowan');
    expect(known.opinions[0]?.regard, 'being pulled out of trouble left him feeling nothing about it').toBeGreaterThan(0);
  });
});

describe('a memory made on this page', () => {
  it('goes into his head here and is said out loud, in that order', () => {
    const { where } = snapOf(3);
    const said: Array<[string, string, string]> = [];
    const recall = tellingTheWorld((who, what, about) => said.push([who, what, about]));

    recall(where.man, { what: 'given', who: 'Rowan', day: 1 });
    expect(where.man.memories[0]?.what, 'a villager handed something did not notice until the world said so').toBe('given');
    expect(said, 'the world was never told, so the man is a different man on every other screen')
      .toEqual([[where.man.id, 'given', 'Rowan']]);
  });

  it('is the whole of it when there is nobody to say it to, which is playing alone', () => {
    const { where } = snapOf(3);
    // the silence a page with no world behind it sends
    const recall = tellingTheWorld(() => {});
    recall(where.man, { what: 'given', who: 'Rowan', day: 1 });
    expect(where.man.memories[0]?.what).toBe('given');
  });
});

/**
 * What a villager is doing, arriving from the world that decides it.
 *
 * The one field on a villager's snapshot a page could not work out for itself. A villager's
 * behaviour tree runs on the world — the page holds him as a guest — so before this was sent, a
 * page could say what its own hired men were up to and nothing about anybody else in the country.
 */
describe('what the world says a villager is doing', () => {
  it('reaches the body standing in the street', () => {
    const { snap, where } = snapOf(5);
    snap.who!.doing = 'with the cattle';
    const { wildlife } = aPage(5, where.ground, where.sampler.structures.villages);
    wildlife.apply([snap], []);
    const body = wildlife.find(1);
    expect(body, 'the world sent a villager and the page stood nobody up').not.toBeNull();
    expect(body!.doing).toBe('with the cattle');
  });

  it('is blank rather than stale when the world stops saying', () => {
    /*
     * A page must not keep the last thing it heard. `doing` is what a man is doing *now*, and a
     * roster that held the last known answer would show somebody at a market they left an hour ago
     * — which is worse than a blank, because a blank is honest and a stale sentence is not.
     */
    const { snap, where } = snapOf(5);
    snap.who!.doing = 'at the market';
    const { wildlife } = aPage(5, where.ground, where.sampler.structures.villages);
    wildlife.apply([snap], []);
    expect(wildlife.find(1)!.doing).toBe('at the market');

    snap.who!.doing = '';
    wildlife.apply([snap], []);
    expect(wildlife.find(1)!.doing, 'the page kept a sentence the world had withdrawn').toBe('');
  });
});
