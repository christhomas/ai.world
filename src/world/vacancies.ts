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
 */
export function shortOf(
  trades: readonly string[], held: readonly string[],
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

  const hands = held.length + 1;
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

/**
 * Who does what in a village, and which of its trades nobody is doing.
 *
 * The other half of item 24a. Enrolment already works — a grown child takes the trade the village
 * is short of rather than a coin toss — but nothing anywhere could *say* what a village holds or
 * lacks, so the part of that item about the hall being a directory (where the doctor is, where the
 * builder drinks) and about vacancies being something a player can read had nothing to read from.
 *
 * Derived and never stored, like everything else in this corner: a village that buries its doctor
 * is short of one the next morning without anything having to notice, and a village re-lived from
 * its founding arrives at the same list as the one somebody has been standing in.
 *
 * **Deliberately not dialogue.** What a village has is a fact about the village; who says it, and
 * in what words, is the game's business. Putting both here would make the sentence untestable and
 * the fact unreusable — a signpost, the compass and a quest all want this same answer, and only one
 * of them is a conversation.
 *
 * `nobodyDoing` is bounded by the trades the *ground* supports, which is what `trades` is: a village
 * with no shore is not short of a fisherman, it is a village with no shore. That is the same rule
 * `shortOf` reads the establishment by, one question further on.
 */
export function directoryOf(
  trades: readonly string[], people: readonly { id: string; trade: string }[],
  sworn: readonly Sworn[] = [],
): { holding: Map<string, string[]>; nobodyDoing: string[]; sworn: Sworn[] } {
  const supported = new Set(trades);
  const holding = new Map<string, string[]>();
  for (const person of people) {
    // a child and the very old hold no trade, and an empty string is not one
    if (person.trade === '' || !supported.has(person.trade)) continue;
    const already = holding.get(person.trade);
    if (already) already.push(person.id); else holding.set(person.trade, [person.id]);
  }
  /*
   * A traveller who swore to work this ground is bounded by it exactly as a villager is: a village
   * with no shore has no fisherman whoever offers, and an oath to a trade the ground never
   * supported is an oath about somewhere else.
   *
   * And an oath lapses when the village comes to have its own.
   *
   * A village is re-founded from its seed whenever somebody walks over the hill and takes on an
   * emptied one, and that founding rolls every trade afresh — so a place can end up with a smith of
   * its own months after a traveller swore to be one. Taking the sworn trades out of that roll would
   * mean an oath re-rolled the whole population, which is a far stranger thing than the one it
   * fixes: a traveller taking a job must not change who lives there.
   *
   * So the villager wins and the oath is spent. It is also the truthful reading — the post the
   * traveller took is not vacant any more, and a village with its own smith is not short of one.
   * What the oath still buys is the thing item 24a asks for: while it stands, nobody is *raised*
   * into that work. See `tradeTakenUp`.
   */
  const took = sworn.filter((one) => supported.has(one.trade) && !holding.has(one.trade));
  const taken = new Set(took.map((one) => one.trade));
  return {
    holding,
    nobodyDoing: trades.filter((trade) => !holding.has(trade) && !taken.has(trade)),
    sworn: took,
  };
}

/**
 * A traveller who has taken a village's vacant work, by trade and by the name they gave.
 *
 * Not a villager: the register is who lives here, and somebody who walks in off the road does not.
 * Kept by name rather than by id for that reason — there is no `Person` to point at, and the hall's
 * book is written in the name whoever stood in front of it gave.
 */
export interface Sworn {
  trade: string;
  who: string;
  /** The world day the oath was taken, which is the only thing that dates it. */
  day: number;
}

/**
 * Take an oath into the book a village keeps, or say it was already there.
 *
 * The bookkeeping half of `Register.apply`'s `sworn` case, out here because it is about vacancies
 * rather than about registers and because `register.ts` is at the size the architecture test
 * allows. What it does not do is decide *when* — whether a late oath re-lives the village is the
 * register's business, since only the register knows which day it is standing on.
 *
 * Keyed by trade and day: the same telling arriving twice, which is the ordinary case once an oath
 * travels on the wire and in a save, writes one oath.
 */
export function takeTheOath(
  held: readonly Sworn[], trade: string, who: string, day: number,
): Sworn | null {
  const on = Math.floor(day);
  if (!Number.isFinite(on)) return null;
  if (held.some((one) => one.trade === trade && one.day === on)) return null;
  return { trade, who, day: on };
}
