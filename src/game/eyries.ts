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
  /**
   * How many crossings there are in one country, or in one square of a country that has no edge.
   *
   * Item 84, and it is here because the note below turned out to describe what was actually
   * happening. A bird on every hummock makes the whole country trivial to cross — and once **83**
   * gave the peaks a size, every one of the nineteen in a 512-tile square cleared `WORTH_FLYING`
   * and got its pair. Thirty-eight crags against two villages is not a landmark, it is scenery, and
   * there are ten names in the list because nobody ever expected to need twenty.
   *
   * Two, which is what a square gets of villages in the clouds, and for the same reason: a flight
   * over a mountain should be a journey you remember taking rather than the way you always go.
   * The biggest ranges win, so the crossing is over the mountain that was worth flying.
   */
  MOST: 2,
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

/**
 * What a crag is called, built out of parts rather than taken from a list.
 *
 * Item 86. There were ten finished names and they were handed out in order, from a set of names
 * already taken that lived for one planning call — which in a country with no edge means one
 * square. So the first crag of every patch was Windcrag, the second Stormperch, and a hero walking
 * east met a second Windcrag inside ten minutes.
 *
 * A name has to be a function of the thing rather than of the order it was planned in. These are
 * drawn from the crag's own position, so the same crag is called the same thing whoever plans it,
 * in whatever order, on whichever machine — the same rule the whole endless country rests on. And
 * eighteen by fourteen is two hundred and fifty-two, which turns meeting another Windcrag from a
 * certainty into a coincidence.
 */
const HEAD = [
  'Wind', 'Storm', 'Thorn', 'Cloud', 'Raven', 'High', 'Grey', 'Sky', 'Talon',
  'Far', 'Eagle', 'Frost', 'Crow', 'Stone', 'Bright', 'Cold', 'Iron', 'Hawk',
];
const TAIL = [
  'crag', 'perch', 'spur', 'step', 'rest', 'stoop', 'feather',
  'hold', 'rock', 'sight', 'roost', 'scar', 'fell', 'reach',
];

/**
 * A stream belonging to one spot on the map, which nothing else can advance.
 *
 * The same idea the whole endless country is built on, applied one level down. A shared stream
 * makes every answer depend on how many answers came before it, and that is fine in a world planned
 * all at once and wrong in one planned a square at a time.
 */
function atThisSpot(seed: number, x: number, z: number): () => number {
  return mulberry32(derive(seed, SALT.EYRIE) ^ (Math.imul(Math.round(x), 0x9e3779b1) ^ Math.round(z)));
}

/** The name of the crag at this spot, which is the same name every time anybody asks. */
export function cragName(seed: number, x: number, z: number): string {
  const rng = atThisSpot(seed, x, z);
  return HEAD[Math.floor(rng() * HEAD.length)] + TAIL[Math.floor(rng() * TAIL.length)];
}

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
  const out: Eyrie[] = [];
  const taken = new Set<string>();

  /*
   * Biggest first, and only the first few.
   *
   * Ordered rather than taken as they come, because "which mountains are worth a bird" is a
   * question about the mountains and not about the order something happened to list them in. The
   * tie-break is the position, so two ranges of exactly the same reach are still ranked the same
   * way every time — a patch grown twice has to put its crags in the same places.
   */
  const worth = massifs
    .map((massif, at) => ({ massif, at }))
    .filter((one) => one.massif.radius >= EYRIE.WORTH_FLYING)
    .sort((a, b) => b.massif.radius - a.massif.radius || a.massif.x - b.massif.x || a.massif.z - b.massif.z)
    .slice(0, EYRIE.MOST);

  for (const { massif, at: i } of worth) {
    const reach = massif.radius * EYRIE.ON_THE_SHOULDER;
    /*
     * Which way round the range the pair sits, drawn from the mountain rather than from a stream
     * shared with every other mountain.
     *
     * Found by a test written for the *names*, which is the useful kind of accident: it asserted
     * that a crag planned alongside another comes out where it came out alone, and it did not — the
     * shared stream had been advanced by the mountain ranked before it, so the perches moved. No
     * live fault, because a massif belongs to exactly one square and a square is planned in one go
     * with a deterministic order. But it is the same fragility the name had, and the fix is the
     * same sentence: what a place is like is a fact about the place.
     */
    const facing = atThisSpot(seed, massif.x, massif.z)() * Math.PI * 2;

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
    /*
     * A crag named after where it stands, and a second name if the first is taken.
     *
     * `taken` still does a job and a smaller one: two crags of the same range could draw the same
     * name, and "fly from Frostscar to Frostscar" is nonsense wherever it comes from. Nudging the
     * spot the name is drawn from is enough, and keeps the name a function of the place.
     */
    const named = (x: number, z: number): string => {
      for (let nudge = 0; nudge < 8; nudge++) {
        const candidate = cragName(seed, x + nudge, z);
        if (taken.has(candidate)) continue;
        taken.add(candidate);
        return candidate;
      }
      return cragName(seed, x, z);
    };

    const a: Eyrie = {
      id: `eyrie:${i}:a`, name: named(near.x, near.z), x: near.x, z: near.z, partner: `eyrie:${i}:b`, fare,
    };
    const b: Eyrie = {
      id: `eyrie:${i}:b`, name: named(far.x, far.z), x: far.x, z: far.z, partner: `eyrie:${i}:a`, fare,
    };
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
  HEAVY: { wood: 4, cart: 40, silverore: 4, nugget: 3, bearpelt: 3, plate: 4, mail: 3, ironshield: 2, axe: 2 } as Record<string, number>,
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
