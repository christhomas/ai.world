import { mulberry32 } from '../core/rng';

/**
 * Where the world's money comes from.
 *
 * An economy that only circulates runs down; something has to mint. Here it is the mines, which
 * also answers a question the game had never answered: why are there tunnels under the ground at
 * all? People dug them. Some of them are still down there working, and what they bring up is the
 * gold everybody else spends.
 *
 * The interesting part is not the digging, it is the brake. A single patch of mountain holds
 * something like five thousand gold in nuggets, against a whole village's accumulated wealth of
 * around three thousand — so an unmetered mine does not feed an economy, it drowns it. Three
 * things hold it back, and all three are things the player can see and change:
 *
 * - a seam is spent when it is worked, and comes back only slowly
 * - a day underground is one day's work, however many people go down
 * - and the things living down there kill miners, or frighten them into staying home
 *
 * The last is the one that matters, because it is the one the player can do something about.
 */

export const MINING = {
  /** What a day at the face is worth, in gold, from a mine nobody has touched. */
  A_DAY: 26,
  /** How much of a mine can be taken before it is worked out. */
  DEPTH: 900,
  /** And how much of that comes back each day, so a rested mine is worth returning to. */
  RECOVERS: 4,
  /**
   * How dangerous a mine is, from nought to one, before anything is done about it.
   *
   * Not a constant in the end — it should come from what is actually living down there — but the
   * shape is the same either way: it is the share of days that go wrong.
   *
   * Set so a mine nobody ever visits degrades without dying. At twice this the world's mines all
   * end their first year abandoned, which makes an untended world get quietly poorer for ever;
   * the player should be able to improve a mine, not be the only reason any of them work.
   */
  PERIL: 0.11,
  /** Of the days that go wrong, how many end with somebody not coming back rather than running. */
  FATAL: 0.18,
  /** How much a frightened village cuts its own working days. One bad story is worth a lot. */
  DREAD_COST: 0.85,
} as const;

/** What a mine is, as far as the economy is concerned. */
export interface Mine {
  /** The anchor it belongs to, so it survives being walked away from. */
  id: string;
  /** How much has been taken out of it. Falls back towards nought as the ground recovers. */
  worked: number;
  /**
   * What the village believes about it, nought to one. Rises when somebody is frightened or
   * killed and falls slowly with quiet. It is belief rather than fact: a mine that has been made
   * safe is still feared until somebody goes back and says otherwise.
   */
  dread: number;
}

export function freshMine(id: string): Mine {
  return { id, worked: 0, dread: 0 };
}

/** What is left in a mine, as a share of what it held. */
export function leftIn(mine: Mine): number {
  return Math.max(0, 1 - mine.worked / MINING.DEPTH);
}

/** What one day's work is worth here, before anybody is frightened off. */
export function faceValue(mine: Mine): number {
  return MINING.A_DAY * leftIn(mine);
}

/** What a day at this mine actually comes to. */
export interface DayUnderground {
  /** Gold brought up and carried home. */
  gold: number;
  /** Somebody was frightened badly enough to tell people about it. */
  scared: boolean;
  /** Somebody did not come back, and what they were carrying is on the floor where they fell. */
  lost: boolean;
  /** What that person had on them when it happened, for whoever finds them. */
  dropped: number;
}

/**
 * One village's day at one mine.
 *
 * `miners` is how many of its people work it, but the mine's yield is capped whatever that number
 * is: a seam gives what it gives, and sending more people at it only means more people in danger.
 * `peril` is how bad the place currently is, which is the thing clearing it out changes.
 *
 * Pure in (seed, day, mine, miners, peril) so two machines agree about a mine neither is looking at.
 */
export function dayUnderground(
  seed: number, day: number, mine: Mine, miners: number, peril: number = MINING.PERIL,
): DayUnderground {
  const nil: DayUnderground = { gold: 0, scared: false, lost: false, dropped: 0 };
  if (miners <= 0 || leftIn(mine) <= 0) return nil;

  const roll = mulberry32((seed ^ Math.imul(day, 0x9e3779b1)) >>> 0);

  // a frightened village sends fewer people down, which is how a story becomes an economic fact
  const willing = Math.max(0, 1 - mine.dread * MINING.DREAD_COST);
  if (roll() > willing) return nil;

  const gold = Math.round(faceValue(mine) * Math.min(1, miners / 2));

  if (roll() >= peril) return { gold, scared: false, lost: false, dropped: 0 };

  // the day went wrong. Mostly that means somebody ran; sometimes it means somebody did not.
  const fatal = roll() < MINING.FATAL;
  return {
    gold: fatal ? 0 : Math.round(gold * 0.4),
    scared: true,
    lost: fatal,
    // what a dead miner had on him: the day's takings, which were minted and now lie on the floor
    dropped: fatal ? gold : 0,
  };
}

/** A mine, a day older: what was taken is a little further back, and fear fades if nothing happens. */
export function restOvernight(mine: Mine, today: DayUnderground): Mine {
  const worked = Math.max(0, mine.worked + today.gold + today.dropped - MINING.RECOVERS);
  let dread = mine.dread;
  if (today.lost) dread = Math.min(1, dread + 0.45);
  else if (today.scared) dread = Math.min(1, dread + 0.2);
  // fear fades slowly and on its own terms. Quickly and a bad week is forgotten by the next one,
  // and then clearing a mine out is worth nothing to anybody because the village was about to go
  // back down anyway.
  else dread = Math.max(0, dread - 0.022);
  return { id: mine.id, worked, dread };
}

/** How the village talks about the place. Silence when there is nothing to say. */
export function saidOfMine(mine: Mine): string {
  if (mine.dread >= 0.7) return 'Nobody will go down there now.';
  if (mine.dread >= 0.35) return 'There is something in the workings. They go down in twos.';
  if (leftIn(mine) <= 0.15) return 'The seam is all but out. They are working the last of it.';
  return '';
}
