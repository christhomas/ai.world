import type { Rng } from '../core/rng';
import { Biome } from '../world/biomes';
import { ITEMS, SELL_SHARE } from './items';

/**
 * Furs: the one trade in this world worth a long walk.
 *
 * Everything else a shop buys is worth the same wherever you carry it, so selling is only a
 * matter of finding a counter. A pelt is not. The snow country is knee deep in wolfskin and
 * nobody up there wants yours, while a desert village has never seen one and its nights are
 * colder than its days are hot. The price is a fact about the country rather than something the
 * world has to agree on, so two players work it out separately and arrive at the same number.
 *
 * The decision worth explaining is that the hide is no longer in the loot. A kill used to hand
 * over its pelt at the moment it fell, on a coin flip. Now the body lies where it dropped and the
 * fur comes off it with a knife, certainly, or with your hands, rarely: which is what makes the
 * knife worth its space, and why a fur is earned by walking back to the body rather than by luck.
 */

export const FUR = {
  /** Share of hides that survive being pulled off a body bare-handed. A torn pelt is worth nothing. */
  TORN: 0.2,
  /** How long a body is worth going back for, in seconds. After that the crows have had it. */
  LASTS: 420,
  /** How close you must stand to work on one. */
  REACH: 2.2,
  /** Bodies one sitting keeps track of; the oldest is forgotten first. */
  KEPT: 12,
  /** The most a country that never sees a fur will pay, as a multiple of the shop price. */
  DEAREST: 1.8,
  /** The least a country up to its knees in them will pay. */
  CHEAPEST: 0.6,
} as const;

/**
 * What comes off each kind under a knife. Only the two that are worth the trouble: a wolf gives
 * the pelt every trapper means when they say pelt, and a bear gives something you could sleep
 * under. Nothing else in the country is both killable and worth skinning.
 */
const HIDES: Record<string, string> = {
  wolf: 'pelt',
  bear: 'bearpelt',
  fox: 'foxfur',
  // the game a beginner can actually take: nothing here fights back, and a hide is the first
  // thing most people ever sell
  deer: 'hide',
  elk: 'hide',
  goat: 'hide',
  hare: 'hide',
  rabbit: 'hide',
};

/** The ids the fur trade deals in, which is what makes their price local rather than fixed. */
const FURS: ReadonlySet<string> = new Set(Object.values(HIDES));

/**
 * How thick the furs already are on the ground in each country. This is supply and nothing else:
 * a village prices a pelt by how many are already hanging in its own back rooms.
 */
const PLENTY: Record<Biome, number> = {
  [Biome.Snow]: 1.8,       // every second cellar has a wolfskin in it, and the trappers live here
  [Biome.Mountain]: 1.4,   // wolves on the tops, and a road down to somebody who will buy them
  [Biome.Forest]: 1.15,    // bear country, though a wood mostly keeps what it grows
  [Biome.Plains]: 1,       // the price on the shop list, and the yardstick for everywhere else
  [Biome.Swamp]: 0.85,     // nothing worth skinning lives in a marsh, so what arrives is welcome
  [Biome.Desert]: 0.5,     // no fur within a hundred miles, and a cold night every night
};

/** What a knife would take off this kind, or null for a creature nobody skins. */
export function hideOf(kind: string): string | null {
  return HIDES[kind] ?? null;
}

/** Is this something the fur trade deals in, and so worth carrying somewhere particular? */
export function isFur(id: string): boolean {
  return FURS.has(id);
}

/**
 * What comes off a body, which is the whole rule: a knife takes the hide whole every time, and
 * bare hands mostly ruin it. Pure in (kind, knife, roll), so a body seeded from where it fell
 * gives the same answer to whoever reaches it first.
 */
export function skin(kind: string, knife: boolean, roll: Rng): string | null {
  const hide = hideOf(kind);
  if (!hide) return null;
  // a knife is not luck: taking a fur off whole is the only thing it is for
  if (knife) return hide;
  return roll() < FUR.TORN ? hide : null;
}

/**
 * What a fur is worth in a village of this country. Scarcity is the whole of the price: the
 * further a hide is carried from where it grew, the more somebody will give you for it. Anything
 * that is not fur is worth what the shop list says, wherever you happen to be standing.
 */
export function priceOf(id: string, biome: Biome): number {
  const base = ITEMS[id]?.price ?? 0;
  if (!isFur(id)) return base;
  const scarcity = Math.min(FUR.DEAREST, Math.max(FUR.CHEAPEST, 1 / PLENTY[biome]));
  return Math.max(1, Math.round(base * scarcity));
}

/** What a trader in that country actually hands over for one, which is a share of what it is worth. */
export function paidFor(id: string, biome: Biome): number {
  return Math.max(1, Math.floor(priceOf(id, biome) * SELL_SHARE));
}

/** A body lying where it fell, with its hide still on it. */
export interface Carcass {
  /** Which kind fell, which is what decides the hide. */
  kind: string;
  x: number;
  z: number;
  /** Seconds left before it is no longer worth a knife. */
  left: number;
}

/**
 * The bodies still worth going back for. Kept for a sitting and thrown away with it, for the same
 * reason dug holes are: what a carcass gives up follows from the kind and the knife, so there is
 * nothing here worth saving, and a long winter of hunting would otherwise grow without end.
 */
export class Carcasses {
  private readonly bodies: Carcass[] = [];

  /** Everything still lying about, for drawing and for kneeling over. */
  get all(): readonly Carcass[] { return this.bodies; }

  /** Something has fallen. Returns the body when there is a hide on it, and null when there is not. */
  fell(kind: string, x: number, z: number): Carcass | null {
    if (!hideOf(kind)) return null;
    const body: Carcass = { kind, x, z, left: FUR.LASTS };
    this.bodies.push(body);
    if (this.bodies.length > FUR.KEPT) this.bodies.shift();
    return body;
  }

  /** The body within reach, if you are standing over one. */
  nearest(x: number, z: number, reach: number = FUR.REACH): Carcass | null {
    let best: Carcass | null = null;
    let bestAway: number = reach;
    for (const body of this.bodies) {
      const away = Math.hypot(body.x - x, body.z - z);
      if (away < bestAway) { bestAway = away; best = body; }
    }
    return best;
  }

  /**
   * Work on it. Returns the hide, or null when it came away in pieces. The body is spent either
   * way, because a hide you have already torn does not go back on.
   */
  take(body: Carcass, knife: boolean, roll: Rng): string | null {
    const at = this.bodies.indexOf(body);
    if (at >= 0) this.bodies.splice(at, 1);
    return skin(body.kind, knife, roll);
  }

  /** Let the ones nobody came back for go. */
  age(dt: number): void {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      this.bodies[i].left -= dt;
      if (this.bodies[i].left <= 0) this.bodies.splice(i, 1);
    }
  }
}
