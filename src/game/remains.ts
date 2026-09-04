import { mulberry32 } from '../core/rng';

/**
 * What is left where somebody fell.
 *
 * A wolf that takes a farmer leaves a pack in the grass: what they had earned that day, what they
 * were carrying to market, and the tool of their trade. It is the other half of the food chain —
 * without it a village being hunted is only sad, and with it the country is dangerous in a way
 * that pays.
 *
 * Remains are of the moment rather than of the world: they sit where they fell for a while and
 * are then gone, like everything else nobody came back for. They are not saved, because a village
 * regrows its people from the seed and a permanent record of every wolf's supper would grow
 * without end.
 */

export const REMAINS = {
  /** How long a pack sits in the grass before the crows have had it, in seconds. */
  LASTS: 900,
  /** How close you must be to go through it. */
  REACH: 2.2,
  /** No more than this many at once; the oldest goes first. */
  KEPT: 24,
} as const;

export interface Pack {
  x: number;
  z: number;
  /** Whose it was, for the line that tells you what you have found. */
  who: string;
  /** What they did, which decides what is in it. */
  trade: string;
  gold: number;
  items: string[];
  /** Seconds left before it is gone. */
  left: number;
}

/**
 * The tool of a trade, which is the thing worth finding. A hunter's kit is a hunter's kit whether
 * or not the hunter is still using it.
 */
const KIT: Record<string, string[]> = {
  hunter: ['fang', 'pelt', 'rod'],
  soldier: ['helm', 'fang'],
  constable: ['helm', 'rope'],
  doctor: ['herbs', 'potion', 'antidote'],
  sailor: ['rope', 'map'],
  climber: ['rope', 'lantern'],
  explorer: ['map', 'lantern', 'gem'],
  farmer: ['wheatseed', 'turnipseed', 'bread'],
  seller: ['bread', 'ale', 'gem'],
  innkeeper: ['ale', 'stew'],
};

export class Remains {
  private readonly packs: Pack[] = [];

  /** Everything currently lying about, for drawing and for looking through. */
  get all(): readonly Pack[] { return this.packs; }

  /**
   * Somebody has fallen. What they leave is their purse, whatever they were carrying, and — often
   * enough to be worth checking — the tool of their trade.
   *
   * @param seed rolled from where they fell, so two players in one world find the same pack
   */
  leave(who: string, trade: string, x: number, z: number, gold: number, carrying: string | null, seed: number): Pack {
    const roll = mulberry32(seed);
    const items = carrying ? [carrying] : [];
    const kit = KIT[trade] ?? [];
    if (kit.length && roll() < 0.6) items.push(kit[Math.floor(roll() * kit.length)]);

    const pack: Pack = { x, z, who, trade, gold, items, left: REMAINS.LASTS };
    this.packs.push(pack);
    if (this.packs.length > REMAINS.KEPT) this.packs.shift();
    return pack;
  }

  /** The pack within reach, if you are standing over one. */
  nearest(x: number, z: number, reach: number = REMAINS.REACH): Pack | null {
    let best: Pack | null = null;
    let bestAway: number = reach;
    for (const pack of this.packs) {
      const away = Math.hypot(pack.x - x, pack.z - z);
      if (away < bestAway) { bestAway = away; best = pack; }
    }
    return best;
  }

  /** Take it. Whatever was in it is yours, and it is no longer lying there. */
  take(pack: Pack): { gold: number; items: string[] } {
    const at = this.packs.indexOf(pack);
    if (at >= 0) this.packs.splice(at, 1);
    return { gold: pack.gold, items: pack.items };
  }

  /** Let the ones nobody came back for go. */
  age(dt: number): void {
    for (let i = this.packs.length - 1; i >= 0; i--) {
      this.packs[i].left -= dt;
      if (this.packs[i].left <= 0) this.packs.splice(i, 1);
    }
  }
}
