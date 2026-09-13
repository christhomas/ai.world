import { Claims } from './claims';

/**
 * Which acts the page may do before the world agrees, and which must wait.
 *
 * Item 73's division is the good part and it holds: **predict what the hand feels, and let the
 * ledger take its time.** A swing that waits for a round trip is a game being played through a
 * letterbox; a trade that resolves optimistically and is then contradicted is a game that lied
 * about your money. `claims.ts` is the machinery for the first kind and says so — what it never
 * had was a list, so each new act on the wire was decided by whoever wrote it, from precedent.
 *
 * This is the list. It is not a mechanism: `Claims` is the mechanism. It is the *rule*, written
 * down once so that the sixth thing added to the wire has something to be judged against.
 *
 * ## The question that decides it
 *
 * Not "is it important" and not "is it slow". **Who sees it if the prediction turns out wrong.**
 *
 * A swing nobody else sees can be put back quietly — the creature was never hit, the page catches
 * up, and the only person who could have noticed is the one who threw it. A hire cannot: another
 * player may have hired the same man in the same second, and whichever page predicted it has to
 * take somebody off their payroll in front of them. That is not a rollback, it is a broken promise.
 *
 * ## And the honest cost of getting it wrong in each direction
 *
 * Predicting something that should have waited is a game that lies and corrects itself, which is
 * worse than a game that is slow. Waiting on something that should have been predicted is a game
 * that feels dead in the hand, which players do not report as lag — they report it as the game
 * being bad. Both are real; they are not symmetrical, and neither is a tie-breaker for the other.
 */

/** What an act on the wire is allowed to do before the world has answered. */
export type Side =
  /** The page acts now and keeps what it gave itself, ready to put back. See `Claims`. */
  | 'hand'
  /** The page asks and waits. Nothing changes until the answer arrives. */
  | 'ledger';

export interface Act {
  id: string;
  side: Side;
  /** Why it falls that way, in the terms above: who sees it if the prediction is wrong. */
  because: string;
}

export const ACTS: readonly Act[] = [
  {
    id: 'swing',
    side: 'hand',
    because: 'the one thing a player judges the game by, and a miss nobody else saw can be put'
      + ' back without anybody being told a thing that was not true',
  },
  {
    id: 'door',
    side: 'hand',
    because: 'walking into a room that turns out to be somewhere else is jarring and recoverable,'
      + ' and a door that waits makes every building in the country feel stuck',
  },
  {
    id: 'chest',
    side: 'hand',
    because: 'already predicted, and rightly: what is in it is the world\'s to say, but opening it'
      + ' is a hand on a lid. `opening.ts` keeps the claim',
  },
  {
    id: 'crop',
    side: 'hand',
    because: 'sowing and lifting are both hands in soil, and `farming.ts` keeps both claims — a'
      + ' seed comes back out of the ground as readily as it went in',
  },
  {
    id: 'trade',
    side: 'ledger',
    because: 'money that appears and is taken back is worse than money that takes a moment, and a'
      + ' price is the one number a player will check twice',
  },
  {
    id: 'hire',
    side: 'ledger',
    because: 'somebody else may have hired the same man in the same second, so a wrong prediction'
      + ' takes him off a payroll in front of the player who hired him. Not a rollback, a broken'
      + ' promise',
  },
  {
    id: 'build',
    side: 'ledger',
    because: 'a commission is a thing you come back to, so nothing is lost by waiting — and a'
      + ' building that appeared and then did not would be the most visible lie in the game',
  },
];

/** Which side an act falls on, or nothing for one nobody has decided about yet. */
export function sideOf(act: string): Side | null {
  return ACTS.find((a) => a.id === act)?.side ?? null;
}

/** Every act that may be done before the world answers. */
export function inTheHand(): string[] {
  return ACTS.filter((a) => a.side === 'hand').map((a) => a.id);
}

/**
 * A reminder that the machinery and the rule are different things.
 *
 * Exported so that a file which reaches for `Claims` has somewhere to say which act it is claiming
 * for, and so the test below can find the two disagreeing.
 */
export function claimsFor<T>(act: string): Claims<T> {
  if (sideOf(act) !== 'hand') {
    throw new Error(`${act} is the ledger's — see predicted.ts. Predicting it would be a promise`
      + ' the world has not made yet.');
  }
  return new Claims<T>();
}
