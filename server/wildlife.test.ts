import { describe, expect, it } from 'vitest';
import { generateWebGraph } from '../src/world/roadweb';
import { propFootprints } from '../src/entities/props';
import { GroundWorld } from '../src/world/groundworld';
import { TerrainSampler } from '../src/world/terrain';
import { IN_SIGHT, Wildlife, type Folk } from './wildlife';
import { peopleOf } from './people';
import { WATCH_RANGE } from '../src/entities/spawning';

/**
 * The creatures the server owns, and the two things it does with them that a player feels: a blow
 * thrown at them, and one thrown back.
 *
 * Both used to be the client's. The second stopped happening at all when the creatures moved
 * across — the client no longer steps a creature the world owns, so nothing was left to decide that
 * a wolf had bitten anybody, and the wild animals of the world were decorative for a while. That is
 * the kind of thing that is invisible until somebody stands still in front of a wolf, so it is
 * pinned here.
 */

/** A world with ground under it, grown around one spot. */
function worldAt(seed: number, x: number, z: number): { alive: Wildlife; ground: GroundWorld } {
  const ground = new GroundWorld(new TerrainSampler(generateWebGraph(seed)), propFootprints());
  ground.reach(x, z, 2);
  return { alive: new Wildlife(seed, ground, ground), ground };
}

/**
 * Noon, and not for atmosphere.
 *
 * A chunk's population is spawned by the chunk, and the manager throws the lot away and spawns it
 * again the moment the day flips to night — so a creature put down by hand survives only as long as
 * the light does not change under it. These tests want the wolf they placed, so the sun stays up.
 */
const DAY = 0.5;

/** And the other side of it, for the one test that wants a village to be filled again. */
const NIGHT = 0.95;

/** Somebody standing still, with whatever they are wearing. */
const standing = (x: number, z: number, gear: string[] = []) => ({ x, z, gear });

describe('a creature the world owns', () => {
  it('bites somebody standing in front of it, and says who and how hard', () => {
    const { alive } = worldAt(3, 0, 0);
    const wolf = alive.put('wolf', 1.2, 0, 99);
    expect(wolf, 'there is a wolf').not.toBeNull();

    const who = standing(0, 0);
    let bitten = 0;
    let hardest = 0;
    // ten seconds of standing still next to a wolf, which is nine seconds more than anybody would
    for (let step = 0; step < 200; step++) {
      for (const bite of alive.step(0.05, [who], DAY)) {
        bitten++;
        hardest = Math.max(hardest, bite.damage);
        expect(bite.who, 'and it says which of them it bit').toBe(who);
        expect(bite.id, 'by the number the creature travels under').toBeGreaterThan(0);
      }
    }
    expect(bitten, 'a wolf does what a wolf does').toBeGreaterThan(0);
    expect(hardest).toBeGreaterThan(0);
  });

  it('keeps its distance from somebody with a sword on their hip', () => {
    const { alive } = worldAt(3, 0, 0);
    alive.put('wolf', 1.2, 0, 99);
    // the same ten seconds, and the only difference is what the world can see they are wearing
    const armed = standing(0, 0, ['sword']);
    let bitten = 0;
    for (let step = 0; step < 200; step++) bitten += alive.step(0.05, [armed], DAY).length;
    expect(bitten, 'a predator that will bite an empty hand thinks again about an armed one').toBe(0);
  });

  it('takes a blow in the arc in front of somebody, and nothing outside it', () => {
    const { alive } = worldAt(3, 0, 0);
    // a herd is put down as a herd, scattered round the spot rather than standing on it, so what
    // is east and what is west is read back rather than assumed
    alive.put('deer', 4, 0, 7);
    alive.put('deer', -4, 0, 8);
    const before = new Map(alive.listNear(0, 0, 20).map((e) => [e.id, e]));
    expect(before.size, 'deer on both sides of him').toBeGreaterThan(2);

    // facing east, and swinging until whatever is over there has fallen
    const killed = new Set<number>();
    for (let blow = 0; blow < 60; blow++) {
      for (const id of alive.swung({ x: 0, z: 0, y: 0, yaw: 0, reach: 6, arc: 1.1, damage: 30, one: false })) {
        killed.add(id);
      }
    }
    expect(killed.size, 'the ones it was facing').toBeGreaterThan(0);
    for (const id of killed) expect(before.get(id)!.x, 'and every one of them in front of him').toBeGreaterThan(0);
  });

  it('will not reach further than a bow does, or hit harder than a blow may be worth', () => {
    const { alive } = worldAt(3, 0, 0);
    alive.put('deer', 40, 0, 7);
    const far = alive.listNear(40, 0, 8).map((e) => e.id);
    expect(far.length, 'there is a herd out there').toBeGreaterThan(0);
    // a client asking for a reach across the county gets a bowshot, and no further
    const killed = alive.swung({ x: 0, z: 0, y: 0, yaw: 0, reach: 1e6, arc: Math.PI, damage: 1e9, one: false });
    for (const id of far) expect(killed).not.toContain(id);
  });

  it('takes one creature with a shot, not everything in the line', () => {
    const { alive } = worldAt(3, 0, 0);
    alive.put('deer', 5, 0, 7);
    const before = alive.listNear(0, 0, 20);
    expect(before.length, 'more than one thing to hit').toBeGreaterThan(1);
    // one arrow, one creature, however many are standing in the line of it
    const hit = alive.swung({ x: 0, z: 0, y: 0, yaw: 0, reach: 12, arc: 1.0, damage: 400, one: true });
    expect(hit).toHaveLength(1);
  });
});

/*
 * The world measures the blows, so the world has to know what a wall is. A client that draws an
 * arrow stopping against a cottage while the server quietly kills what stands behind it is worse
 * than either behaviour on its own — and until this, that is what happened: `swung` was a distance
 * and an angle, and the ground between the two of them was never asked about.
 */
describe('a wall between the blow and the beast', () => {
  /** The same ground, with one solid slab standing across x = 3. */
  function walledAt(seed: number): { alive: Wildlife; ground: GroundWorld } {
    const ground = new GroundWorld(new TerrainSampler(generateWebGraph(seed)), propFootprints());
    ground.reach(0, 0, 2);
    const walled: GroundWorld = Object.create(ground);
    walled.crosses = (x0: number, _z0: number, x1: number): boolean =>
      Math.min(x0, x1) <= 3.5 && Math.max(x0, x1) >= 3;
    return { alive: new Wildlife(seed, walled, ground), ground };
  }

  it('takes the blow away', () => {
    const { alive } = walledAt(3);
    alive.put('deer', 5, 0, 7);                     // the far side of the wall
    const there = alive.listNear(5, 0, 3).map((e) => e.id);
    expect(there.length, 'nothing was put on the far side').toBeGreaterThan(0);
    const killed = alive.swung({ x: 0, z: 0, y: 0, yaw: 0, reach: 12, arc: 1.1, damage: 400, one: false });
    for (const id of there) expect(killed, 'killed through a wall').not.toContain(id);
  });

  it('and leaves an open line alone', () => {
    const { alive } = worldAt(3, 0, 0);
    alive.put('deer', 5, 0, 7);
    const there = alive.listNear(5, 0, 3).map((e) => e.id);
    const killed = alive.swung({ x: 0, z: 0, y: 0, yaw: 0, reach: 12, arc: 1.1, damage: 400, one: false });
    expect(there.some((id) => killed.includes(id)), 'the same blow with nothing in the way').toBe(true);
  });
});

/**
 * What a player is told about, and what the world stops looking at.
 *
 * The two numbers are set in different files for good reasons — how far somebody can see is the
 * server's business and how far a creature stays on the world's lists is the simulation's — and
 * they have one relationship between them that nothing else enforces.
 */
describe('the sight a player is allowed and the lists a creature is kept on', () => {
  it('never lets a creature drop off the lists while somebody can still see it', () => {
    expect(IN_SIGHT, `a player is told about creatures ${IN_SIGHT} tiles off, and the simulation stops holding one at ${WATCH_RANGE} — so between the two there is country a player is looking at and the world is not describing, and a deer would wink out in front of them. Raise WATCH_RANGE in properties/spawning.json, not this test.`)
      .toBeLessThan(WATCH_RANGE);
    // and comfortably, because the two are measured a fraction of a tick apart: the lists are sorted
    // at the top of a step and a player is told at the bottom of it, with the creatures having moved
    // in between. A tile or two of margin would be a race; this is a dozen.
    expect(WATCH_RANGE - IN_SIGHT, 'the margin between the two is thinner than a fast creature covers between being sorted and being described')
      .toBeGreaterThanOrEqual(8);
  });

  it('describes what is in sight out of the watched list, so nothing beyond it is walked past', () => {
    const { alive } = worldAt(3, 0, 0);
    alive.put('deer', 4, 0, 5);
    // nobody has stood in this world yet, so nothing has been sorted into a tier and the list is bare
    expect(alive.inSightOf(0, 0).length, 'a world nobody has stepped yet described creatures anyway, which means the description is not coming from the tiers at all').toBe(0);
    alive.step(0.05, [standing(0, 0)], DAY);
    expect(alive.inSightOf(0, 0).some((c) => c.kind === 'deer'), 'the deer standing four tiles from the player is not described once the world has been stepped').toBe(true);
  });
});

/**
 * The people of a village, which the world holds now.
 *
 * They were the client's for a long time and the argument for it was a good one: who lives in a
 * village follows from the seed and a short list of deaths, so every machine already agrees about
 * them without a byte crossing. It stopped being true the day a villager was given something of his
 * own to remember — what he thinks of *you* follows from what you did, and what you did happened on
 * your screen — and then it was two men of the same name in two different moods, and the village you
 * were standing in was whichever machine you were sitting at.
 *
 * So the wire carries him: who he is, what he is doing there, and what he holds. This is that.
 */
describe('a villager the world owns', () => {
  /** A world with a village in it, and the country round that village grown. */
  function villageAt(seed: number): { alive: Wildlife; folk: Folk; at: { x: number; z: number } } {
    const sampler = new TerrainSampler(generateWebGraph(seed));
    const ground = new GroundWorld(sampler, propFootprints());
    const folk = peopleOf(seed, sampler, 1, { onFallen: () => {}, onArrest: () => {} });
    const village = folk.villages[0];
    ground.reach(village.x, village.z, 3);
    return { alive: new Wildlife(seed, ground, ground, folk), folk, at: { x: village.x, z: village.z } };
  }

  /** Stand in the square long enough for the chunks round it to have been walked over once. */
  function stand(alive: Wildlife, at: { x: number; z: number }, steps = 20): void {
    for (let n = 0; n < steps; n++) alive.step(0.05, [standing(at.x, at.z)], DAY);
  }

  it('is put in the street by the world, and arrives as somebody rather than as a body', () => {
    const { alive, folk, at } = villageAt(3);
    stand(alive, at);
    const people = alive.inSightOf(at.x, at.z).filter((c) => c.who?.person);
    expect(people.length, 'the world put nobody in the village square at all').toBeGreaterThan(0);

    const who = people[0].who!;
    expect(who.village, 'a villager arrived with no village on him, so nothing can tell where he is from').toBe(folk.villages[0].name);
    expect(who.name, 'a villager arrived with no name').not.toBe('');
    expect(folk.register.find(who.person), 'the world sent an id that is not on its own register').toBeDefined();
    expect(who.trades.length, 'the trades the village was founded on did not travel, so a client founding it again founds a different village').toBeGreaterThan(0);
  });

  it('carries what he holds, so what happened on one screen is what everybody meets', () => {
    const { alive, folk, at } = villageAt(3);
    stand(alive, at);
    const before = alive.inSightOf(at.x, at.z).find((c) => c.who?.person);
    expect(before, 'nobody to tell anything to').toBeDefined();
    const id = before!.who!.person;
    expect(before!.who!.mind.memories, 'a villager nothing has happened to is carrying memories').toHaveLength(0);

    // the one thing about a villager no machine could work out for itself: a kindness done to him
    expect(folk.register.recall(id, 'given', 'Traveller', 4), 'the world would not take the memory').toBe(true);

    const after = alive.inSightOf(at.x, at.z).find((c) => c.who?.person === id);
    expect(after?.who?.mind.memories[0]?.what, 'what the villager was told to remember never reached the wire').toBe('given');
    expect(after?.who?.mind.opinions[0]?.who, 'and nor did the view he formed of whoever did it').toBe('Traveller');
  });

  it('goes indoors and stops being described, because a man in a wall is worse than no man', () => {
    const { alive, at } = villageAt(3);
    stand(alive, at);
    const out = alive.inSightOf(at.x, at.z).filter((c) => c.who?.person);
    expect(out.length).toBeGreaterThan(0);
    for (const e of alive.all()) e.indoors = true;
    expect(alive.inSightOf(at.x, at.z).filter((c) => c.who?.person), 'a villager who has gone inside is still being sent out to be drawn in the street')
      .toHaveLength(0);
  });

  it('turns a constable out when the world is told the law wants somebody', () => {
    const wanted = { alive: villageAt(3).alive, at: villageAt(3).at };
    // guilt is the one thing about a hero the world cannot see: it lives in his own save, and a
    // village needs exactly this much of it to decide whether to put a man in a helmet in the street
    for (let n = 0; n < 40; n++) {
      wanted.alive.step(0.05, [{ ...standing(wanted.at.x, wanted.at.z), guilt: 0.8 }], DAY);
    }
    const law = wanted.alive.inSightOf(wanted.at.x, wanted.at.z).filter((c) => c.who?.trade === 'constable');
    expect(law.length, 'the law never came out, so a world-owned village has no police force at all')
      .toBeGreaterThan(0);
  });

  it('leaves the village altogether when somebody pays him to walk with them', () => {
    const { alive, at } = villageAt(3);
    stand(alive, at);
    const hired = alive.inSightOf(at.x, at.z).find((c) => c.who?.person)!.who!.person;

    alive.retain(hired, true);
    stand(alive, at, 40);
    expect(alive.inSightOf(at.x, at.z).some((c) => c.who?.person === hired), 'a man in somebody else\'s pay is still standing about in his village square')
      .toBe(false);

    // and the village can have him back once the bargain ends. Not on the spot: a street is filled
    // when its chunk is spawned and holds the same faces until something re-rolls it, which is what
    // the sun going down does — so what is pinned here is that he is free again rather than gone.
    alive.retain(hired, false);
    for (let n = 0; n < 40; n++) alive.step(0.05, [standing(at.x, at.z)], NIGHT);
    for (let n = 0; n < 40; n++) alive.step(0.05, [standing(at.x, at.z)], DAY);
    expect(alive.inSightOf(at.x, at.z).some((c) => c.who?.person === hired), 'the village never took its man back after he was released')
      .toBe(true);
  });
});
