import { tradeNamed } from '../entities/trades';

/**
 * What a village is short of, which is the first thing a mayor is for.
 *
 * A trade is inherited — a farmer's child takes the farm — and inheritance on its own is drift.
 * Every funeral is a chance to lose a trade and no funeral is ever a chance to gain one back, so a
 * village left to it long enough ends up as sixteen people doing two things between them. `chore
 * sanity` measured exactly that at four hundred and fifty days: villages that could support ten
 * trades holding two, with no farmer in the fields and no seller at the market, every purse
 * balancing to the coin the whole way down.
 *
 * So somebody has to look at the place and say what it needs. That somebody is the mayor, and this
 * is the question they ask. It is deliberately not a wage and not a contract: nothing leaves the
 * treasury, nobody is paid to take a job, and the hall's money stays free for building. A village
 * that is short of a farmer simply raises the next adult as a farmer, which is what a village has
 * always done.
 *
 * ## How "short of" is decided, without a list of important jobs
 *
 * `TRADES` already says how common each trade should be against the others — `weight`, which has
 * been used to draw founding villagers since the beginning. A village's *establishment* is that
 * weighting applied to however many people work: three parts farmer, three parts seller, two parts
 * soldier, one part doctor, and so on. A vacancy is a trade whose establishment is a whole person
 * more than the number of people actually doing it.
 *
 * That threshold is what keeps this from swallowing inheritance whole. In a village of eleven
 * working people, a weight-three trade is short by a whole person only when *nobody* is doing it,
 * and a weight-one trade never reaches a whole person at all — so the mayor fills the jobs a
 * village cannot be without and leaves the rest to families. A doctor is still somebody's daughter
 * following her mother, or one villager in ten striking out.
 */

/**
 * The trade this village most needs somebody to take up, or nothing if it is fairly staffed.
 *
 * @param trades what the place can support at all, which is a fact about where it is
 * @param held what the people who work there already do, one entry per worker
 * @param joining how many more are about to start work, counted into the establishment
 */
export function shortOf(
  trades: readonly string[], held: readonly string[], joining = 1,
): string | null {
  const weights = trades.map((trade) => tradeNamed(trade)?.weight ?? 1);
  const all = weights.reduce((sum, weight) => sum + weight, 0);
  if (all <= 0) return null;

  /*
   * A village with nobody working at all takes the commonest trade there is.
   *
   * The share arithmetic below cannot answer this one: with a single pair of hands every trade's
   * establishment is a fraction of a person, so nothing is a whole person short and nothing rounds
   * to one. A village whose last worker has been buried is exactly the village that most needs the
   * next adult to do something, and what it needs first is whatever this place is most of.
   */
  if (held.length === 0) {
    let heaviest = 0;
    for (let at = 1; at < trades.length; at++) if (weights[at] > weights[heaviest]) heaviest = at;
    return trades[heaviest];
  }

  const hands = held.length + joining;
  let worst: string | null = null;
  let gap = 0;
  for (let at = 0; at < trades.length; at++) {
    const wanted = (weights[at] / all) * hands;
    const doing = held.filter((trade) => trade === trades[at]).length;
    const short = wanted - doing;
    if (!(short >= 1 || (doing === 0 && wanted >= WORTH_ONE))) continue;
    if (short <= gap) continue;
    gap = short;
    worst = trades[at];
  }
  return worst;
}

/**
 * When a trade nobody is doing counts as a vacancy.
 *
 * Half a person, which is the point at which a village's establishment *rounds* to one of them.
 * Without this clause only the three commonest trades were ever enrolled — in a village of nine
 * working people a weight-two trade comes to nine tenths of a person, which is less than the whole
 * person the first clause wants — and `chore sanity` found a mining village at four trades out of
 * the ten its ground could support. A place that ought to have a constable and has none has a
 * vacancy; a place that ought to have one and a half farmers and has one does not.
 */
const WORTH_ONE = 0.5;
