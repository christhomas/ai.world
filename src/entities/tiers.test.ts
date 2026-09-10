import { describe, expect, it } from 'vitest';
import { chunkKey } from '../world/spatial';
import { generateWebGraph } from '../world/roadweb';
import { TerrainSampler } from '../world/terrain';
import { GroundWorld } from '../world/groundworld';
import { tilesOf, type ChunkSource } from '../world/tiles';
import { propFootprints } from './props';
import { keepBodiesApart } from './contact';
import { EntityManager } from './manager';
import { Roster } from './roster';
import { homelandsOf } from './homeland';
import { catchUp, type Away } from './unwatched';
import { ACTIVE_RANGE, WATCH_RANGE } from './spawning';
import type { Entity, Herd, TileWorld } from './entity';

/**
 * The three tiers, held to the two things they must not get wrong.
 *
 * C2 is a bargain with a player: the world may stop simulating almost all of itself, and in exchange
 * the player must not be able to tell. So there are exactly two claims worth testing and they pull
 * against each other. **Frozen has to actually cost nothing** — C1 measured the old frozen tier at
 * a discount rather than an exemption, a skipped mind but still a body in the separation sweep and
 * still a row walked past for every player, and warned that a tier which merely skips a branch is
 * not a tier. And **nothing may change for a creature somebody is looking at**, which rules out the
 * obvious cheap wins: a creature in view must go on being told about, and a herd must never be
 * caught up while anybody can see it, because the closed forms are entitled to move a herd the
 * length of its leash and that would be a flock teleporting in plain sight.
 *
 * `unwatched.test.ts` is the other half of this and the model for the third test below: it holds
 * each closed form to the simulation it stands in for. This one holds the *wiring* to the forms —
 * that the tiers hand them the right herd, the right hour and the right seed, at the one moment
 * when moving a creature cannot be seen.
 */

/** Flat, dry, walkable and roaded everywhere: ground that never refuses anybody. */
const flat: TileWorld = {
  heightAt: () => 1,
  waterAt: () => 0.3,
  blocked: () => false,
  isRoad: () => true,
};

/** A tick of the length the server runs at, which is what all of this is budgeted against. */
const STEP = 0.1;

/** Midday, so no night shift arrives half way through and respawns the country underneath a test. */
const NOON = 0.5;

const where = (list: ReadonlyArray<Entity>): string => list.map((e) => `${e.x.toFixed(3)},${e.z.toFixed(3)}`).join(' ');

/**
 * Three flocks at three distances from one standing player: live, coarse and frozen.
 *
 * Put down by hand rather than grown, because the whole question is what happens at particular
 * distances and a real chunk puts its herds where the seed says. Each is filed under the chunk it
 * stands in, which is what keeps it from being swept away as country nobody is near.
 */
function threeFlocks(): { manager: EntityManager; live: Entity[]; coarse: Entity[]; frozen: Entity[] } {
  const manager = new EntityManager(new Roster(), flat, { getTiles: () => null }, 1);
  // 10 tiles: inside ACTIVE_RANGE. 58: past it, but well inside what a player is told about.
  // 78: past WATCH_RANGE, and still inside the five chunks of country the world holds.
  const live = manager.spawnPack('sheep', 10, 0, 0, 21, chunkKey(0, 0), 6);
  const coarse = manager.spawnPack('sheep', 58, 0, 0, 22, chunkKey(3, 0), 6);
  const frozen = manager.spawnPack('sheep', 78, 0, 0, 23, chunkKey(4, 0), 6);
  return { manager, live, coarse, frozen };
}

describe('what being near a player decides', () => {
  it('takes a frozen creature off the lists rather than off a branch inside them', () => {
    const { manager, live, coarse, frozen } = threeFlocks();
    expect(frozen.length, 'nothing was put down out in the frozen band, so nothing is being tested')
      .toBeGreaterThan(1);
    const before = where(frozen);

    for (let n = 0; n < 40; n++) manager.update(STEP, 0, 0, false, () => {}, NOON);

    const watched = new Set(manager.watched);
    for (const e of live) {
      expect(watched.has(e), `a sheep ${Math.hypot(e.x, e.z).toFixed(0)} tiles from the player is not on the list of what the player can be told about, and it is close enough to be fighting them`).toBe(true);
    }
    for (const e of coarse) {
      expect(watched.has(e), `a sheep ${Math.hypot(e.x, e.z).toFixed(0)} tiles away is off the list of what a player is told about, but a player is told about creatures out to 60 tiles — it would vanish off their screen while they were looking at it`).toBe(true);
    }
    for (const e of frozen) {
      expect(watched.has(e), `a sheep ${Math.hypot(e.x, e.z).toFixed(0)} tiles away is still on the list every player is walked past, which is past WATCH_RANGE (${WATCH_RANGE}) and is the cost C1 said freezing has to stop paying`).toBe(false);
    }

    expect(where(frozen), 'a frozen flock moved, so something is still stepping it').toBe(before);

    // and the proof that this is a list it was taken off rather than a branch it skipped: hand the
    // same flock to the sweep by hand and it has plenty to say about it
    const swept = new Set(frozen.map((e) => e.herd));
    for (let n = 0; n < 40; n++) keepBodiesApart([frozen], swept, 0, 0, ACTIVE_RANGE, STEP, flat);
    expect(where(frozen), 'the separation sweep had no opinion about this flock, so skipping it proves nothing — put the sheep closer together').not.toBe(before);
  });

  it('goes on thinking for a creature near any player, not only near the one it is following', () => {
    const manager = new EntityManager(new Roster(), flat, { getTiles: () => null }, 1);
    const flock = manager.spawnPack('sheep', 58, 0, 0, 31, chunkKey(3, 0), 6);
    const before = where(flock);
    // the manager follows somebody standing at the origin, and somebody else is standing in the field
    manager.alsoNear = [{ x: 58, z: 0 }];

    for (let n = 0; n < 40; n++) manager.update(STEP, 0, 0, false, () => {}, NOON);

    expect(new Set(manager.watched).has(flock[0]), 'a creature standing beside the second player is not on the list of what anybody is told about').toBe(true);
    expect(where(flock), 'a flock with a player standing in the middle of it was not thought for, because the tiers only looked at whoever the manager follows').not.toBe(before);
  });
});

/**
 * A world with real ground under it, so that herds are grown from the seed rather than put down by
 * hand — which is the only arrangement in which a chunk arriving is the thing that catches it up.
 *
 * One sampler and one ground for the file: a country is expensive, the two managers below must
 * agree about which tiles are standable, and sharing them is what makes the comparison exact rather
 * than approximately exact.
 */
const SEED = 3;
/**
 * Where the player is standing, and it is chosen rather than the origin.
 *
 * Real country is mostly empty: the nine chunks by nine the world holds round somebody put about ten
 * herds on the ground, and in a good deal of it none at all, because a chunk needs thirty tiles of
 * open land before anything is offered a den in it. This spot has enough of them to compare, and
 * the tests below fail loudly rather than passing quietly if that ever stops being true.
 */
const STOOD = 300;
const sampler = new TerrainSampler(generateWebGraph(SEED));
const ground = new GroundWorld(sampler, propFootprints());
/**
 * How far round the player the ground is actually made, in chunks.
 *
 * Wide enough to cover everything the manager will try to spawn into, and it has to be said out
 * loud rather than left to happen. `GroundWorld` answers `heightAt` out of the chunks it has been
 * told to make and nothing else, and `canStand` reads `heightAt`: ground that has not been made is
 * not ground, so a creature offered a spot on it cannot stand there and is quietly never born.
 *
 * That is not a hypothetical. Without this line the harness below grew nothing but *vultures* —
 * fliers, and `canStand` returns true for anything that flies without asking the ground at all —
 * and every test in this file passed on a country of birds while believing it was looking at
 * herds. It was found when the world gained hills, which moved the country under this spot from
 * desert to marsh: the frogs and the ducks that live there cannot fly, could not stand on ground
 * nobody had made, and the file failed with "no creature was checked" — which is the assertion
 * below doing its job about a hole that had been there all along.
 */
const MADE_AROUND = 5;
ground.reach(STOOD, STOOD, MADE_AROUND);

const held = new Map<string, ReturnType<typeof tilesOf>>();
const chunks: ChunkSource = {
  getTiles: (cx, cz) => {
    const key = chunkKey(cx, cz);
    let tiles = held.get(key);
    if (!tiles) { tiles = tilesOf(sampler.generateChunk(cx, cz)); held.set(key, tiles); }
    return tiles;
  },
};

/** A world's week in world-seconds, which is the stretch C1 costed at hours of processor by ticking. */
const A_WEEK = 7 * 7200;

/** A manager that has just had the country round the origin handed to it, having slept this long. */
function arrived(slept: number): EntityManager {
  const manager = new EntityManager(new Roster(), ground, chunks, SEED, []);
  manager.sleptFor = () => slept;
  manager.update(STEP, STOOD, STOOD, false, () => {}, NOON);
  return manager;
}

/** Every herd the ground grew, gathered the way a province would gather it. */
function grown(manager: EntityManager): Herd[] {
  return [...homelandsOf(manager.filed).values()].flat();
}

/** How far a creature is from the player. */
const fromPlayer = (e: Entity) => Math.hypot(e.x - STOOD, e.z - STOOD);

describe('a province that was nobody’s business for a week', () => {
  it('hands its herds back where the week would have left them, and agrees with the closed forms', () => {
    const asleep = arrived(A_WEEK);
    const awake = arrived(0);

    const sleepy = grown(asleep), fresh = grown(awake);
    expect(fresh.length, 'the country round the player grew no herds at all, so there is nothing to catch up').toBeGreaterThan(5);
    expect(sleepy.length, 'the two worlds grew different numbers of herds, so they cannot be compared creature for creature').toBe(fresh.length);

    // Only the herds neither world could have thought for. A creature the closed form happened to
    // put down inside thinking distance was then thought for, and comparing that would be comparing
    // a tick rather than a form.
    const untouched = (h: Herd) => h.members.every((e) => fromPlayer(e) > ACTIVE_RANGE + 12);
    const pairs = fresh.map((h, i) => [h, sleepy[i]] as const).filter(([a, b]) => untouched(a) && untouched(b));
    expect(pairs.length, 'every herd the country grew was close enough to the player to be thought for, so none of them says anything about a week nobody was watching').toBeGreaterThan(3);

    const week: Omit<Away, 'seconds'> = { time: NOON, seed: SEED, ground };
    let moved = 0;
    for (const [before, after] of pairs) {
      const stood = where(before.members);
      catchUp(before, { ...week, seconds: A_WEEK });
      if (where(before.members) !== stood) moved++;
      expect(before.members.length, 'a caught-up herd lost or gained a member, and a week of grazing is not supposed to be able to do either').toBe(after.members.length);
      expect(where(after.members), `the ${after.kind.id} herd the tiers caught up is not where calling catchUp on it puts it — the tier is handing the closed form a different hour, seed or ground than the one it ought to`).toBe(where(before.members));
    }
    expect(moved, 'catching a week up moved nothing at all, so the comparison above is comparing two flocks that both stood still').toBeGreaterThan(0);
  });

  it('leaves every creature inside the leash its herd is on, however long the week was', () => {
    const asleep = arrived(A_WEEK);
    let checked = 0;
    for (const herd of grown(asleep)) {
      for (const e of herd.members) {
        const out = Math.hypot(e.x - herd.homeX, e.z - herd.homeZ);
        // the leash, plus the half tile `somewhereNear` clears the anchor by, plus the range a
        // member wanders about the anchor. `unwatched.test.ts` holds the forms to the same bound.
        expect(out, `a ${e.kind.id} was put ${out.toFixed(1)} tiles from home on a leash of ${herd.leash}: a week of being unwatched has carried it out of the province that is answerable for it`)
          .toBeLessThanOrEqual(herd.leash + 0.5 + 12);
        checked++;
      }
    }
    expect(checked, 'no creature was checked, so this test passed by having nothing to look at').toBeGreaterThan(8);
  });

  it('asks about the province a herd’s home is in, and never about anything else', () => {
    const asked: Herd[] = [];
    const manager = new EntityManager(new Roster(), ground, chunks, SEED, []);
    manager.sleptFor = (herd) => { asked.push(herd); return 0; };
    manager.update(STEP, STOOD, STOOD, false, () => {}, NOON);

    const filed = new Set(grown(manager));
    expect(asked.length, 'nothing was asked how long its ground had slept, so the tier is not wired to the province at all').toBeGreaterThan(5);
    expect(new Set(asked).size, 'the same herd was asked about twice, which would catch a week up twice').toBe(asked.length);
    for (const herd of asked) {
      expect(filed.has(herd), `a herd was asked how long its province slept but ${herd.kind.id} is not one of the herds a province is answerable for — only what the ground grows has a province, and a dungeon floor or a sea pack has no absence to account for`).toBe(true);
    }
    expect(asked.length, 'a herd the ground grew was never asked about, so part of the country would be handed back a week stale').toBe(filed.size);
  });
});
