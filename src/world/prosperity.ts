import type { Person } from './people';

/**
 * What a village is worth, and what it does about it.
 *
 * Villagers already buy and sell in the same economy the player does and already carry a purse,
 * but the purse belonged to the entity standing in the street — so it emptied the moment you
 * walked away and the village was never a penny richer for anything. Money went in and nothing
 * came of it, which makes the economy a thing that happens to the player and to nobody else.
 *
 * So earnings live on the person in the register, who outlives being drawn, and they accumulate.
 * A village that is left alone gets slowly better off; one under pressure from a warband does
 * not, because people who are being buried are not trading. What the money then buys is a house
 * with another storey on it, and after that the things people build when they have more than they
 * need — which is the point: the economy should change the world and not only your pocket.
 */

export const PROSPER = {
  /**
   * What a day is worth to somebody the player never watched.
   *
   * A small floor rather than a wage. Villagers earn properly now — a sale credits the seller the
   * true market value of what they sold — but only the handful of them standing near the player
   * are ever simulated closely enough to make one. This keeps the rest of the world ticking over
   * at a subsistence rate instead of a village quietly starving because nobody visited it, and it
   * is deliberately far below what an afternoon of real trade brings in.
   */
  A_DAY: 1.5,
  /** A shopkeeper or an innkeeper does better; the trades that serve everybody else. */
  TRADED: 3,
  /** Nobody earns while the place is being raided; below this pressure, business as usual. */
  UNTROUBLED: 0.25,
  /** What a second storey costs its owner. */
  STOREY: 340,
  /**
   * What a village's luxuries cost — reckoned against everything the village has between it, not
   * against one purse. Nobody here lives more than ninety days and a good trade earns seven a day,
   * so no individual could ever afford one; a village of two dozen, left alone, can.
   */
  LUXURY: 3400,
  /** Nobody's purse grows past this: a village of millionaires is not a village. */
  MOST: 4000,
} as const;

/** The trades whose whole business is other people's money. */
const TRADERS = new Set(['shopkeeper', 'innkeeper', 'smith', 'apothecary', 'merchant']);

/** What one person earns on one ordinary day. */
export function earnedInADay(person: Person, pressure: number): number {
  if (pressure > PROSPER.UNTROUBLED) return 0;
  if (!person.trade) return 0;                       // children and the very old keep no purse
  return TRADERS.has(person.trade) ? PROSPER.TRADED : PROSPER.A_DAY;
}

/** How many storeys the owner of this purse has put on their house. One, or two if they can. */
export function storeysFor(purse: number): number {
  return purse >= PROSPER.STOREY ? 2 : 1;
}

/** What a village has managed to build for itself, out of everything it has between it. */
export type Luxury = 'none' | 'sauna' | 'pool';

export function luxuryFor(villageTotal: number, seed: number): Luxury {
  if (villageTotal < PROSPER.LUXURY) return 'none';
  return (seed & 1) === 0 ? 'sauna' : 'pool';
}

/** What using it costs a visitor. A tenth of what it cost to build, rounded to something sayable. */
export function feeFor(luxury: Luxury): number {
  return luxury === 'none' ? 0 : 12;
}

/** How well off a village is, in words, which is the only form of it anybody is shown. */
export function saidOfWealth(total: number, people: number): string {
  const each = people > 0 ? total / people : 0;
  if (each >= PROSPER.STOREY * 1.6) return 'It is doing very well for itself.';
  if (each >= PROSPER.STOREY * 0.8) return 'There is money here.';
  if (each >= PROSPER.STOREY * 0.4) return 'It gets by.';
  return 'It is a poor place.';
}
