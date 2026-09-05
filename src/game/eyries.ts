import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import type { Massif } from '../world/mountains';

/**
 * Eagles, and the crags they wait on.
 *
 * A mountain is a wall. That is the point of it — you go round, and going round is a day you did
 * not plan for. But a wall you can only ever go round is a wall you come to resent, so there is
 * one other way over: a bird big enough to carry somebody, waiting on a crag at either side of a
 * range, which will take you across the top of it for money.
 *
 * A pair of perches per range, on opposite flanks, so a flight is always "over this mountain and
 * down the far side" rather than a fast way to cross the country. The fare is what makes it a
 * choice: early on it is a lot of money and you walk, and later it is the obvious thing to do.
 */

export const EYRIE = {
  /** How far round the massif's edge the perches sit, as a share of its reach. */
  ON_THE_SHOULDER: 0.92,
  /** How near you have to stand for the bird to take any notice of you. */
  REACH: 3.2,
  /** What a crossing costs: a base, plus this much for every ten tiles flown. */
  FARE_BASE: 18,
  FARE_PER_TEN: 4,
  /** The bird will not stir for a range smaller than this, in tiles of reach. */
  WORTH_FLYING: 26,
} as const;

/** A crag with a bird on it, and where that bird will take you. */
export interface Eyrie {
  id: string;
  name: string;
  x: number;
  z: number;
  /** The eyrie on the other side of the same range. */
  partner: string;
  /** What the crossing costs in gold. */
  fare: number;
}

const NAMES = [
  'Windcrag', 'Stormperch', 'Thornspur', 'Cloudstep', 'Ravensrest',
  'Highstoop', 'Greyfeather', 'Skyhold', 'Talonrock', 'Farsight',
];

/**
 * Where the birds wait.
 *
 * Two perches per range, opposite one another, each shifted round the shoulder until it stands on
 * ground somebody could walk to — a perch halfway up a cliff face is no use to anybody, and one
 * out at sea is worse. Ranges too small to be worth flying over are left alone: walking round a
 * hill is not a hardship, and a bird on every hummock makes the whole country trivial to cross.
 */
export function planEyries(
  seed: number,
  massifs: readonly Massif[],
  standable: (x: number, z: number) => boolean,
): Eyrie[] {
  const rng = mulberry32(derive(seed, SALT.EYRIE));
  const out: Eyrie[] = [];
  const taken = new Set<string>();

  for (const [i, massif] of massifs.entries()) {
    if (massif.radius < EYRIE.WORTH_FLYING) continue;
    const reach = massif.radius * EYRIE.ON_THE_SHOULDER;
    const facing = rng() * Math.PI * 2;

    // one perch each side, each allowed to slide round the shoulder to find footing
    const perch = (from: number): { x: number; z: number } | null => {
      for (let step = 0; step < 12; step++) {
        // alternate either way round so a perch stays as near its own side as it can
        const swing = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * (Math.PI / 10);
        const a = from + swing;
        const x = massif.x + Math.cos(a) * reach;
        const z = massif.z + Math.sin(a) * reach;
        if (standable(x, z)) return { x, z };
      }
      return null;
    };

    const near = perch(facing);
    const far = perch(facing + Math.PI);
    if (!near || !far) continue;

    const across = Math.hypot(near.x - far.x, near.z - far.z);
    const fare = Math.round(EYRIE.FARE_BASE + (across / 10) * EYRIE.FARE_PER_TEN);
    const name = (n: number): string => {
      for (const candidate of NAMES) {
        if (taken.has(candidate)) continue;
        taken.add(candidate);
        return candidate;
      }
      return `Crag ${n}`;
    };

    const a: Eyrie = { id: `eyrie:${i}:a`, name: name(i * 2), x: near.x, z: near.z, partner: `eyrie:${i}:b`, fare };
    const b: Eyrie = { id: `eyrie:${i}:b`, name: name(i * 2 + 1), x: far.x, z: far.z, partner: `eyrie:${i}:a`, fare };
    out.push(a, b);
  }
  return out;
}

/** The eyrie close enough to be spoken to, or null. */
export function eyrieAt(eyries: readonly Eyrie[], x: number, z: number): Eyrie | null {
  for (const e of eyries) {
    if (Math.hypot(e.x - x, e.z - z) <= EYRIE.REACH) return e;
  }
  return null;
}

/** What the bird says when you cannot pay it. */
export function tooDear(eyrie: Eyrie, purse: number): string {
  return `The eagle looks at you, then away. ${eyrie.fare} gold to cross, and you have ${purse}.`;
}

/**
 * The one flight that is not over a mountain.
 *
 * Somewhere out past the mainland there is an island with another island floating over it, and no
 * boat, no road and no amount of walking gets anybody onto the second one. The eagles know where
 * it is: they gather at the foot of the waterfall coming off it, which is the one place in the
 * world where somebody can ask to be taken up.
 *
 * Deliberately not one of the crags above. A perch belongs to a mountain range, and a world can be
 * grown with no range in it worth flying over — every road-tree world is, as it happens — so
 * hanging the sky islands off the eyries would have made a whole place that exists, can be seen
 * from the ground, and cannot be reached in most of the worlds anybody plays.
 *
 * Everything about the flight is asymmetric on purpose. Going up is dear, is refused when the bird
 * cannot lift what you are carrying, and is refused when you cannot pay. Coming down is free and
 * is refused by nothing, which is the whole difference between a place that is hard to reach and
 * a hole in a save file.
 */
export const SKYWARD = {
  /**
   * What the bird asks to be carried up through the cloud.
   *
   * Flat, and not by distance as a crossing is. The flight is a few hundred feet straight up and
   * the price has nothing to do with the length of it: what is being sold is the only way into the
   * only place nobody can walk to. Set against the middle of the game — a boat is a hundred and
   * twenty, chain mail a hundred and eighty — so it is a morning's work and a real decision rather
   * than either loose change or a wall.
   */
  FARE: 90,
  /**
   * What one bird will carry besides the person on its back.
   *
   * An ordinary traveller's pack is comfortably under it, because the point was never to make
   * anybody count apples. What it stops is walking to the falls straight off a timber run, or with
   * a cart in the rucksack, and expecting to be flown up with all of it.
   */
  LIFT: 30,
  /**
   * What weighs more than one of everything else does.
   *
   * Only the haulage. A sword and a loaf both weigh the same to a bird that size, and pretending
   * otherwise means a weight column in the rucksack and an afternoon of arithmetic for the player.
   */
  HEAVY: { wood: 4, cart: 40, silverore: 4, nugget: 3, bearpelt: 3, mail: 3, ironshield: 2, axe: 2 } as Record<string, number>,
} as const;

/** What a pack weighs to an eagle. Everything counts one; the haulage counts what it says. */
export function packWeight(items: Iterable<readonly [string, number]>): number {
  let total = 0;
  for (const [id, n] of items) total += (SKYWARD.HEAVY[id] ?? 1) * n;
  return total;
}

/** The thing in the pack the bird objects to most, or null when it will lift the lot. */
export function tooHeavy(items: Iterable<readonly [string, number]>): { weight: number; worst: string } | null {
  let weight = 0, worst = '', worstBy = 0;
  for (const [id, n] of items) {
    const each = (SKYWARD.HEAVY[id] ?? 1) * n;
    weight += each;
    if (each > worstBy) { worstBy = each; worst = id; }
  }
  return weight > SKYWARD.LIFT ? { weight, worst } : null;
}
