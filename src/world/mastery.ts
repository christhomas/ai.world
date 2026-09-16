import type { Person } from './people';
import { PROSPER } from './prosperity';
import { ableToWork } from './wounds';

/**
 * A hand that learns the work it was raised to.
 *
 * A trade was a name on `Person.trade` and nothing else. A farmer of forty days put the same four
 * meals on the table as one who came of age that morning, because `FOOD.PER_FARMER` is four and a
 * trade is a string. Three things in this world were the poorer for it and all three are things a
 * player can see:
 *
 * - **`vacancies.ts` had no teeth.** A village buries its only farmer, raises the next adult into
 *   the gap the following morning, and not a number anywhere moves. A funeral was free.
 * - **A day's yield was a fact about a trade list** rather than about the people holding it, so two
 *   villages with the same jobs written against the same number of names fed themselves identically
 *   however long either of them had been standing.
 * - **And nothing a village could lose was worth protecting.** Wolves and warbands cost a village
 *   its people and never its competence.
 *
 * ## Why it is a shortfall and not a bonus
 *
 * `rank.ts` writes down the principle this had to answer to: *"Unlock buildings and trades; never
 * make numbers bigger. A town that simply earned more per head than a village would be a multiplier
 * wearing a noun."* Mastery arrives looking exactly like that multiplier, and the way it earns its
 * place is by pointing the other way.
 *
 * Nothing in this world got bigger. `FOOD.PER_FARMER` still means precisely what its own comment
 * says — what one farmer puts on the table in a day — and a farmer who knows his work puts exactly
 * that on it and never a crumb more. What changed is that a hand *new* to the work falls short of
 * the number until he has learned it. So there is no new ceiling anywhere, no number that climbs
 * with age, and every constant in `food.ts` still reads as the thing it was written as. What a
 * village can now lose is the difference between a trade being *held* and a trade being *known*.
 *
 * ## What it is a fact about
 *
 * A pair of hands, and never a holding. The paddocks hold what the paddocks hold and the boats land
 * what the boats land, whoever is standing in them — that seam is already settled in
 * `LIVELIHOOD.HERD_PER_FARMER`, which chose the farm over the farmer and said so at length. This is
 * the other side of the same line: a farm's ground and a village's hulls are capital, and capital
 * does not get better at anything. A man does.
 *
 * Which is also why the kitchen garden and the shellfish are untouched. `FOOD.PER_HEAD` is a few
 * hens behind a house and `FOOD.PER_SHORE` is already written down as the one thing in the economy
 * nobody is employed to do — *"a child with a bucket at low water brings back the same as a soldier
 * would"*. Neither is a thing to get good at, and a mastery that quietly improved them would have
 * made a master farmer better at having a garden than his neighbour.
 *
 * ## Why it needs no roll
 *
 * A village's whole life is drawn off one stream, and a draw added or removed anywhere in it
 * re-rolls every village in every world. Nothing here rolls for anything: the days are counted, and
 * what the days come to is arithmetic. A founder's days follow from the age the founding handed
 * them; everybody else's are counted one at a time as they are lived.
 */

const MASTERY = {
  /**
   * What somebody fresh to a trade manages, against what the same person will manage once they
   * have learned it.
   *
   * Three quarters. It has to be large enough that a village notices losing its only master and
   * small enough that a village which has just lost him does not starve while the next one learns —
   * a novice at half would make every funeral a famine, and the point of this is that losing a
   * master is a *story*, not a catastrophe with no answer.
   *
   * It is also the number that decides how much poorer the whole world is than it was the day
   * before this landed, and that was measured rather than guessed. Five inland villages on three
   * seeds, counted against what the same people would have grown with every hand at the trade's own
   * number: **5.9 per cent short at day a hundred and 3.4 per cent at day four hundred and fifty**,
   * with the mean hand two thirds of the way to mastery in a settled world and barely a third of the
   * way there in a young one.
   *
   * Both halves of that are the argument. The whole world is a few per cent lighter on farmed food,
   * which is small enough that no village on any seed starved for it and `sanity-report.txt` still
   * passes every question it asks. And a *young* world is nearly twice as short as a settled one,
   * which is the thing that was actually wanted: a valley full of people who have only just come of
   * age is visibly worse at feeding itself than the same valley twenty years on.
   */
  AT_FIRST: 0.75,
  /**
   * Days at the work before there is nothing further to learn.
   *
   * Forty, and it is the issue's own number: *a farmer of forty days*. What makes it the right one
   * is the shape of a life rather than the feel of it. A villager comes of age at
   * `LIFE.CHILD_UNTIL` and lives `LIFE.SHORTEST_LIFE` to `LIFE.LONGEST_LIFE`, so a working life is
   * somewhere between forty-four and seventy-four days. Forty puts mastery inside a life anybody
   * can expect to have and outside one a village can count on — most people reach it, in their last
   * third, and a bad season that buries the old is a season a village spends some years recovering
   * from.
   *
   * Shorter and a novice is a fortnight's inconvenience. Longer and nobody in the world is ever any
   * good at anything, which is the same world as the one this replaces with more arithmetic in it.
   */
  LEARNS_OVER: 40,
} as const;

/**
 * What somebody's hands are worth at the trade they hold, as a share of a practised one's.
 *
 * Between `AT_FIRST` and one, and never above one — that ceiling is the whole argument with
 * `rank.ts` and is worth being blunt about: this function cannot make anything bigger than it
 * already was.
 *
 * **Days nobody has counted and nought days are different answers**, which is the same distinction
 * `whoFed` draws at length over its nullable field map: *"an empty map from a village that has
 * fields means nobody's field yielded; `null` means nobody asked"*. Every villager in a lived
 * village has their days counted, from the morning they took the trade or from the age their
 * founding handed them. Somebody stood up out of thin air — by a test, by a tool, by a caller that
 * has a person and no history for them — has not been counted, and the honest answer for them is
 * the trade's own number, which is what `FOOD.PER_FARMER` has always meant.
 */
export function handOf(person: Person): number {
  if (person.worked === undefined) return 1;
  const learned = Math.min(1, Math.max(0, person.worked) / MASTERY.LEARNS_OVER);
  return MASTERY.AT_FIRST + (1 - MASTERY.AT_FIRST) * learned;
}

/**
 * A day at the trade, added to whoever spent one.
 *
 * Counted rather than derived, and that is the load-bearing decision in this file. Days *since* a
 * trade was taken up would be `day - born - LIFE.CHILD_UNTIL` for every villager alive and would
 * need nothing stored at all — but it would also say that a fortnight under a warband taught
 * everybody a fortnight's worth, and that a man who spent three weeks laid up with a broken arm
 * came back better at farming than he went down.
 *
 * So a day of practice is a day the work actually happened, which is exactly the two conditions
 * `aDaysTrade` already stops for: nobody works while the place is being raided, and a man who is
 * laid up does not work. That makes a warband cost a village something it cannot buy back with
 * money, which is the first thing in this economy that is true of.
 *
 * Mutating rather than returning, like `eat` and `mendThem`, because a day at the work is a fact
 * about the person and there is nobody else who needs telling. It must be called exactly once per
 * village per day and after the day's work: `aDaysIncome` forecasts the same morning out of the
 * same people, and a forecast that aged them would quote a day nobody has lived yet.
 */
export function aDaysPractice(people: readonly Person[], pressure: number): void {
  if (pressure > PROSPER.UNTROUBLED) return;
  for (const person of people) {
    if (person.trade === '' || !ableToWork(person)) continue;
    person.worked = (person.worked ?? 0) + 1;
  }
}
