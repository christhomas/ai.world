import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import type { Spec } from '../core/behaviourFile';
import { KINDS } from './animals';
import { allTrees, specNamed, treeFor } from './behaviours';
import { BEHAVIOUR, Entity, Herd, updateEntity, updateHerd, type Ctx, type TileWorld } from './entity';
import { LONG_RUN, LongRunError, catchUp, longRunOf, spreadAfter, type Away } from './unwatched';
import { dutyAt, rangeIn, ringIn } from './timetable';

/**
 * The closed forms, held to the simulation they claim to stand in for.
 *
 * A closed form is a claim, and a claim nothing checks is a guess with a comment on it. So each one
 * is run beside the thing it replaces: the same creature, the same ground, one of them stepped
 * forward a long way and the other calculated in a single call, and then the two are compared on
 * exactly what the form says it keeps. Populations, containment, the shape of a flock, which post
 * somebody is standing at — and never on the things it says it loses, because holding it to those
 * would be holding it to a coincidence.
 *
 * This is also the thing that will catch it when somebody changes a behaviour a year from now and
 * does not think about its long-run twin. Half of that is mechanical — `LONG_RUN` is held to
 * `allTrees()` in both directions, so a new tree is a failed build — and half is these comparisons,
 * which is the half that catches a changed *number* rather than a new name.
 */

/** Flat, dry, walkable and roaded everywhere: ground that never refuses anybody. */
const flat: TileWorld = {
  heightAt: () => 1,
  waterAt: () => 0.3,
  blocked: () => false,
  isRoad: () => true,
};

/** A herd of `count` of a kind, standing on its home. */
function herdOf(kindId: string, count: number, leash: number, seed: number, home = 0): Herd {
  const kind = KINDS[kindId];
  const herd = new Herd(kind, home, home, home, home, leash);
  const rng = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const e = new Entity(kind, home + (rng() - 0.5) * 2, home + (rng() - 0.5) * 2, herd, 'k', rng);
    e.y = 1;
    e.slot = i;
    herd.members.push(e);
  }
  return herd;
}

/** Nobody within a thousand tiles, nothing armed, nothing afloat: the coarse tier's whole premise. */
function nobodyAbout(rng: () => number, time = 0.5): Ctx {
  return {
    world: flat, rng, playerX: 1e6, playerZ: 1e6,
    playerArmed: false, playerAfloat: false, treeFor, time,
    onAttack: () => {},
  };
}

/** Step a herd forward the long way, exactly as `ChunkManager.tick` does: anchor first, then minds. */
function live(herd: Herd, seconds: number, seed: number, time = 0.5, dt = 0.1): void {
  const ctx = nobodyAbout(mulberry32(seed), time);
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    updateHerd(herd, dt, ctx);
    for (const e of herd.members) updateEntity(e, dt, ctx);
  }
}

const away = (seconds: number, seed: number, time = 0.5): Away => ({ seconds, time, seed, ground: flat });
const fromHome = (herd: Herd) => herd.members.map((e) => Math.hypot(e.x - herd.homeX, e.z - herd.homeZ));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * How far apart the two may be, over everything, on the mean distance from home.
 *
 * Held tightly because it is held over all four kinds at once — nearly three hundred creatures —
 * and a pooled mean of that many is worth a tight bound. It comes out at 0.96 today.
 */
const POOLED = 0.15;

/**
 * And how far apart one kind on its own may be.
 *
 * Looser, because one kind is seventy creatures and that is not many. The simulation's own spread
 * between kinds that ought to be identical is a tenth either way — sheep, ducks, lizards and deer
 * drift on the same leash by the same step and finish between 6.77 and 7.47 tiles from home — so a
 * tighter bound here would be measuring the seed. Looser than this and the fault that prompted
 * `RIM_BIAS` would slip through: an uncorrected form put wolves a third further out than the
 * simulation does, and a third is what somebody standing in the field would notice.
 */
const PER_KIND = 0.3;

describe('every behaviour has a long-run twin', () => {
  it('says what a week of each tree the game ships does', () => {
    const missing = Object.keys(allTrees()).filter((name) => !LONG_RUN[name]);
    expect(missing, `nothing says what a week of ${missing.join(', ')} does`).toEqual([]);
  });

  it('says nothing about a tree the game does not have', () => {
    const trees = allTrees();
    const orphans = Object.keys(LONG_RUN).filter((name) => !trees[name]);
    expect(orphans, `${orphans.join(', ')} has a long-run form and no behaviour`).toEqual([]);
  });

  it('says of every one what it keeps and what it loses', () => {
    for (const [name, form] of Object.entries(LONG_RUN)) {
      expect(form.keeps.length, `${name} does not say what a week of it keeps`).toBeGreaterThan(20);
      expect(form.loses.length, `${name} does not say what a week of it loses`).toBeGreaterThan(20);
    }
  });

  /*
   * The other way the two halves can come apart, and the quieter one. A tree keeps its name and
   * keeps its form, and somebody takes the `wander` out of it — at which point the form is still
   * filed as one that ranges and there is nothing left in the file saying how far.
   */
  it('leaves every tree that ranges with something in its file saying how far', () => {
    for (const [name, form] of Object.entries(LONG_RUN)) {
      const spec = specNamed(name)!;
      if (form === LONG_RUN.grazer) {
        expect(rangeIn(spec), `${name} drifts about its range and its tree never wanders or roams`).not.toBeNull();
      }
      if (form === LONG_RUN.flier) {
        expect(Number.isNaN(ringIn(spec)), `${name} rides a circle and its tree never patrols`).toBe(false);
      }
    }
  });

  /*
   * The failure this is really about: somebody adds a creature, writes its tree, and never comes
   * here. Without this the coarse tier would quietly leave it exactly where it was for a fortnight,
   * which reads as a bug in the world rather than a gap in the code and is found by a player long
   * before it is found by anybody who could fix it.
   */
  it('refuses a behaviour nobody has written one for, and says what to do about it', () => {
    expect(() => longRunOf('dancer')).toThrow(LongRunError);
    expect(() => longRunOf('dancer')).toThrow(/nothing says what a week of "dancer" does/);
    expect(() => longRunOf('dancer')).toThrow(/src\/entities\/unwatched\.ts/);
    // and it names the honest way out, so "this one really does nothing" is a thing you can say
    expect(() => longRunOf('dancer')).toThrow(/staysPut/);
  });
});

describe('a week of wandering, run and calculated', () => {
  /*
   * The comparison the whole file exists for. Ten minutes of world is far longer than the minute a
   * herd takes to forget where it started, so both sides are at their stationary distribution and
   * the numbers below are the distribution and not the path.
   */
  const kinds = ['sheep', 'wolf', 'rabbit', 'rat'];

  it('leaves a herd about as far from home as the simulation does', () => {
    const everyRan: number[] = [], everyWorked: number[] = [];
    for (const kindId of kinds) {
      const ran: number[] = [], worked: number[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const lived = herdOf(kindId, 6, 12, seed * 977);
        live(lived, 600, seed * 977);
        ran.push(...fromHome(lived));

        const settled = herdOf(kindId, 6, 12, seed * 977);
        catchUp(settled, away(600, seed * 977));
        worked.push(...fromHome(settled));
      }
      everyRan.push(...ran); everyWorked.push(...worked);
      const ratio = mean(worked) / mean(ran);
      expect(ratio, `${kindId}: the simulation leaves them ${mean(ran).toFixed(2)} tiles from home `
        + `and the closed form ${mean(worked).toFixed(2)}`)
        .toBeGreaterThan(1 - PER_KIND);
      expect(ratio, `${kindId}: the closed form ranges further than the simulation does`)
        .toBeLessThan(1 + PER_KIND);
    }
    const pooled = mean(everyWorked) / mean(everyRan);
    expect(pooled, `over ${everyRan.length} creatures the simulation says `
      + `${mean(everyRan).toFixed(2)} tiles from home and the closed form says ${mean(everyWorked).toFixed(2)}`)
      .toBeGreaterThan(1 - POOLED);
    expect(pooled).toBeLessThan(1 + POOLED);
  });

  it('never puts anything outside the range its leash and its tree allow', () => {
    for (const kindId of kinds) {
      const radius = rangeIn(specNamed(kindId === 'rat' ? 'monster' : kindId === 'wolf' ? 'prowler' : kindId === 'rabbit' ? 'hopper' : 'grazer')!)!;
      // the leash bounds the anchor and `somewhereNear` bounds the step off it: half a tile clear,
      // then out to the tree's own radius
      const bound = 12 + 0.5 + radius;
      for (let seed = 1; seed <= 8; seed++) {
        const lived = herdOf(kindId, 4, 12, seed * 131);
        live(lived, 600, seed * 131);
        for (const far of fromHome(lived)) expect(far, `${kindId} walked out of its range`).toBeLessThan(bound);

        const settled = herdOf(kindId, 4, 12, seed * 131);
        catchUp(settled, away(600, seed * 131));
        for (const far of fromHome(settled)) expect(far, `${kindId} was put outside its range`).toBeLessThan(bound);
      }
    }
  });

  it('keeps a herd a herd: they are still standing together', () => {
    for (const kindId of kinds) {
      const settled = herdOf(kindId, 5, 12, 4242);
      catchUp(settled, away(604800, 4242));
      const anchor = { x: settled.ax, z: settled.az };
      const radius = rangeIn(specNamed(kindId === 'rat' ? 'monster' : kindId === 'wolf' ? 'prowler' : kindId === 'rabbit' ? 'hopper' : 'grazer')!)!;
      for (const e of settled.members) {
        expect(Math.hypot(e.x - anchor.x, e.z - anchor.z), `a ${kindId} wandered off on its own`)
          .toBeLessThanOrEqual(0.5 + radius);
      }
    }
  });

  it('loses nobody and invents nobody: a week later there are exactly as many', () => {
    const settled = herdOf('sheep', 6, 12, 7);
    const before = settled.members.length;
    catchUp(settled, away(604800, 7));
    expect(settled.members.length).toBe(before);
    expect(settled.members.filter((e) => e.dead)).toEqual([]);
  });

  /*
   * A week is a week however it is cut up. The exact spot is allowed to differ — it is drawn fresh
   * each time and nobody could tell — but a province caught up in two goes must not end up with its
   * herds somewhere a province caught up in one never would.
   */
  it('gives the same kind of answer whether the week is caught up in one go or two', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const once = herdOf('sheep', 4, 12, seed * 55);
      catchUp(once, away(604800, seed * 55));

      const twice = herdOf('sheep', 4, 12, seed * 55);
      catchUp(twice, away(172800, seed * 55));
      catchUp(twice, away(432000, seed * 55));

      for (const far of [...fromHome(once), ...fromHome(twice)]) expect(far).toBeLessThan(12 + 0.5 + 4);
    }
  });

  it('is the same on two machines, because it is a hash and not a die', () => {
    const one = herdOf('deer', 4, 12, 9);
    const two = herdOf('deer', 4, 12, 9);
    catchUp(one, away(604800, 12345));
    catchUp(two, away(604800, 12345));
    expect(one.members.map((e) => [e.x, e.z])).toEqual(two.members.map((e) => [e.x, e.z]));
    // and a different world is a different answer
    const other = herdOf('deer', 4, 12, 9);
    catchUp(other, away(604800, 54321));
    expect(other.members.map((e) => [e.x, e.z])).not.toEqual(one.members.map((e) => [e.x, e.z]));
  });

  it('moves nothing over a stretch too short for the simulation to have moved it either', () => {
    const settled = herdOf('sheep', 4, 12, 3);
    const before = settled.members.map((e) => [e.x, e.z]);
    catchUp(settled, away(BEHAVIOUR.HERD_DRIFT_TIME[0] - 1, 3));
    expect(settled.members.map((e) => [e.x, e.z])).toEqual(before);
  });

  it('moves nothing at all when it cannot ask the ground where a creature may stand', () => {
    const settled = herdOf('sheep', 4, 12, 3);
    const before = settled.members.map((e) => [e.x, e.z]);
    const outcome = catchUp(settled, { seconds: 604800, time: 0.5, seed: 3 });
    expect(outcome.moved).toBe(false);
    expect(settled.members.map((e) => [e.x, e.z])).toEqual(before);
  });

  it('holds a herd whose leash is shorter than one drift exactly where it was put', () => {
    // a village crowd is on a leash of two and a half tiles and a drift is five: every step it
    // could take crosses the line, so its anchor has never moved and never will
    expect(spreadAfter(herdOf('sheep', 1, 2.5, 1), 604800)).toBe(0);
    expect(spreadAfter(herdOf('sheep', 1, 12, 1), 604800)).toBeGreaterThan(0);
  });
});

describe('the ones with nothing to calculate', () => {
  /*
   * "This behaviour has no long-run effect" is a result and not a shrug: it is the licence for the
   * frozen tier to be genuinely frozen. Both halves are checked — that the simulation really does
   * leave them alone, and that the form agrees.
   */
  it('a shark with nobody in the water is exactly where it was an hour later', () => {
    const herd = herdOf('shark', 2, 14, 3);
    const before = herd.members.map((e) => [e.x, e.z]);
    live(herd, 3600, 3);
    expect(herd.members.map((e) => [e.x, e.z]), 'a shark went somewhere with nobody afloat').toEqual(before);
    catchUp(herd, away(604800, 3));
    expect(herd.members.map((e) => [e.x, e.z]), 'the closed form moved one anyway').toEqual(before);
  });

  it('a wight stands where it was left, by day and by night alike', () => {
    for (const time of [0.5, 0.95]) {
      const herd = herdOf('wight', 1, 14, 5);
      const before = herd.members.map((e) => [e.x, e.z]);
      live(herd, 3600, 5, time);
      expect(herd.members.map((e) => [e.x, e.z]), `a wight moved at ${time}`).toEqual(before);
      catchUp(herd, { seconds: 604800, time, seed: 5, ground: flat });
      expect(herd.members.map((e) => [e.x, e.z])).toEqual(before);
    }
  });

  it('forgets what it was part way through, since nothing in the game takes a week', () => {
    const herd = herdOf('shark', 1, 14, 3);
    const e = herd.members[0];
    e.charging = 2;
    e.winding = 0.3;
    e.attackCooldown = 4;
    catchUp(herd, away(604800, 3));
    expect(e.charging).toBe(0);
    expect(e.winding).toBe(0);
    expect(e.attackCooldown).toBe(0);
  });
});

describe('a flier rides its circle, and the circle is solved rather than stepped', () => {
  /*
   * The one form here that is exact. `patrol` is an integration and nothing else — the shared angle
   * advances by `dt * speed / radius` a tick — so the closed form is the same recurrence without the
   * loop, and an hour of ticks and one call land on the same spot to within floating point. The
   * herd is given a leash of nought so that its anchor cannot drift and the comparison is about the
   * circle rather than about the walk underneath it.
   */
  it('lands on the spot an hour of ticks lands on', () => {
    const lived = herdOf('eagle', 1, 0, 5, 10);
    const settled = herdOf('eagle', 1, 0, 5, 10);

    live(lived, 3600, 5, 0.5, 1 / 30);
    catchUp(settled, away(3600, 5));

    const a = lived.members[0], b = settled.members[0];
    expect(settled.angle).toBeCloseTo(lived.angle, 3);
    expect(Math.hypot(a.x - b.x, a.z - b.z), 'the closed circle and the stepped one parted company')
      .toBeLessThan(1e-5);
  });

  it('costs the same to work out for a week as for an hour', () => {
    const week = herdOf('eagle', 1, 0, 5, 10);
    catchUp(week, away(604800, 5));
    const on = week.members[0];
    // still on its ring, wherever round it has got to: nine tiles is the eagle's own patrol of four
    // plus the spread its slot gives it, and it is on that ring exactly
    expect(Math.hypot(on.x - week.ax, on.z - week.az)).toBeCloseTo(4, 6);
    expect(on.state).toBe('fly');
  });
});

describe("a day with hours in it is exactly where the hours say", () => {
  /** Somebody with a trade, a house and somewhere to work. */
  function worker(trade: string, seed: number): Herd {
    const herd = new Herd(KINDS.villager, 0, 0, 0, 0, 4);
    const e = new Entity(KINDS.villager, 0, 0, herd, 'k', mulberry32(seed));
    e.y = 1;
    e.trade = trade;
    e.posts = { home: [0, 0], inn: [12, 0], square: [6, 0], market: [10, 4], doctor: [4, 8], field: [16, 8], gate: [2, 12], shore: [8, 12], heights: [14, 14], woods: [18, 2], shop: [5, 5] };
    herd.members.push(e);
    return herd;
  }

  /*
   * The loudest possible way of announcing that nobody was home while you were gone would be to
   * walk into a village at three in the morning after a fortnight away and find everybody standing
   * in the street. Being indoors is preserved because being indoors is what a player sees.
   */
  it('puts everybody behind their own front door at three in the morning', () => {
    for (const trade of ['innkeeper', 'seller', 'farmer', 'hunter', 'constable', 'doctor', 'soldier', 'sailor', 'climber', 'explorer']) {
      const herd = worker(trade, 11);
      catchUp(herd, { seconds: 604800, time: 0.05, seed: 11, ground: flat });
      const e = herd.members[0];
      expect(e.indoors, `the ${trade} is out in the street at three in the morning`).toBe(true);
      expect(Math.hypot(e.x, e.z), `the ${trade} is indoors somewhere that is not home`).toBeCloseTo(0, 6);
    }
  });

  it('agrees with the simulation about where a trade spends its afternoon', () => {
    for (const [trade, post] of [['innkeeper', 'inn'], ['doctor', 'doctor'], ['sailor', 'shore'], ['climber', 'heights']] as const) {
      const lived = worker(trade, 21);
      live(lived, 300, 21, 0.5);
      const settled = worker(trade, 21);
      catchUp(settled, { seconds: 604800, time: 0.5, seed: 21, ground: flat });
      const where = settled.members[0].posts[post]!;
      const walked = lived.members[0];
      expect(Math.hypot(walked.x - where[0], walked.z - where[1]), `the ${trade} did not walk to the ${post}`).toBeLessThan(3.5);
      const put = settled.members[0];
      expect(Math.hypot(put.x - where[0], put.z - where[1]), `the ${trade} was not put at the ${post}`).toBeLessThan(3.5);
      expect(put.indoors).toBe(false);
    }
  });

  it('lets an explorer be out roaming during the hours their day leaves to them', () => {
    const herd = worker('explorer', 33);
    catchUp(herd, { seconds: 604800, time: 0.5, seed: 33, ground: flat });
    const e = herd.members[0];
    expect(e.indoors).toBe(false);
    // roaming, so out beyond the doorstep and inside the twenty-six their tree allows
    expect(Math.hypot(e.x - herd.ax, e.z - herd.az)).toBeLessThanOrEqual(26.5);
  });

  it('leaves a hired sword exactly where it was standing, whatever the hour', () => {
    const herd = worker('hired', 44);
    const e = herd.members[0];
    e.x = 3; e.z = 7;
    catchUp(herd, { seconds: 604800, time: 0.5, seed: 44, ground: flat });
    expect([e.x, e.z]).toEqual([3, 7]);
  });
});

describe('the forms are read out of the behaviour files, not written out again here', () => {
  /*
   * The point of reading the file rather than tabulating it: there is one number, so a change to
   * `behaviours/` moves the week as well as the minute. These check the reading itself against
   * specs written here, so they say what the rule is rather than restating what the shipped files
   * happen to contain.
   */
  it('takes a range from the wander or roam the tree actually writes', () => {
    expect(rangeIn({ first: [{ ask: 'idle' }, { do: 'wander', with: { tiles: 13 } }] } as Spec)).toBe(13);
    expect(rangeIn({ do: 'roam', with: { tiles: 40 } } as Spec)).toBe(40);
    expect(rangeIn({ do: 'idle' } as Spec)).toBeNull();
    // and the shipped trees, so a changed number in the JSON shows up here
    expect(rangeIn(specNamed('prowler')!)).toBe(8);
    expect(rangeIn(specNamed('hopper')!)).toBe(2.5);
  });

  it('reads an hour off the same guard the simulation reads it off', () => {
    const day = {
      first: [
        { when: { ask: 'hourBetween', with: { from: 0.3, to: 0.6 } }, then: { do: 'goTo', with: { post: 'field' } } },
        { when: { ask: 'hourBetween', with: { from: 0.6, to: 0.9 } }, then: { do: 'roam', with: { tiles: 12 } } },
        { do: 'goTo', with: { post: 'home', enter: true } },
      ],
    } as Spec;
    expect(dutyAt(day, 0.4)).toEqual({ post: 'field', enter: false, ranges: 0 });
    // an hour spoken for by something that is not a posting is still spoken for: it must not fall
    // through to the unguarded branch at the bottom and put an explorer to bed at noon
    expect(dutyAt(day, 0.7)).toEqual({ post: null, enter: false, ranges: 12 });
    expect(dutyAt(day, 0.95)).toEqual({ post: 'home', enter: true, ranges: 0 });
  });

  it('steps over the branches that need somebody to be there', () => {
    const day = {
      first: [
        { when: { ask: 'wounded', with: { share: 0.5 } }, then: { do: 'goTo', with: { post: 'doctor' } } },
        { steps: [{ do: 'markTrouble' }, { do: 'stalk' }] },
        { do: 'forget' },
        { when: { ask: 'hourBetween', with: { from: 0.2, to: 0.8 } }, then: { do: 'goTo', with: { post: 'gate' } } },
      ],
    } as Spec;
    expect(dutyAt(day, 0.5)?.post).toBe('gate');
  });

  it('takes the branch of a selector that always fires, and the first step of a sequence', () => {
    // inside a branch the guards are about purses and wounds, which nothing here can know, so the
    // last child of a selector — the one that fires when the others do not — is the honest answer
    const evening = {
      first: [
        {
          when: { ask: 'hourBetween', with: { from: 0.7, to: 0.9 } },
          then: {
            first: [
              { when: { ask: 'purse', with: { atLeast: 40 } }, then: { steps: [{ do: 'goTo', with: { post: 'shop' } }, { do: 'spend' }] } },
              { steps: [{ do: 'goTo', with: { post: 'inn' } }, { do: 'spend' }] },
            ],
          },
        },
      ],
    } as Spec;
    expect(dutyAt(evening, 0.8)?.post).toBe('inn');
  });
});
