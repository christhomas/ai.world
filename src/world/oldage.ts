import { stageOf, type Person } from './people';
import { doctoredBy, laidUpFor } from './wounds';

/**
 * What it costs a village to have old people in it.
 *
 * `LIFE` ran baby, child, adult, and then a funeral somewhere between day sixty and day ninety.
 * There was no old age in it at all: no frailty, no call on anybody, and nothing whatever that made
 * the last fifteen days of a life different from the first fifteen of adulthood. A man of
 * eighty-eight went down the mine on the morning he died, and what a village took in was a head
 * count — twenty souls earned twenty souls' worth whether they were twenty apprentices or twenty
 * grandfathers. Item #245.
 *
 * So an old body gives out now and then. Some mornings it does not go out at all, and the village
 * is a pair of hands short that day. That is the first time in this economy that *who* a village's
 * people are decides what it takes in rather than merely how many of them there are, which is the
 * whole point of the stage existing.
 *
 * ## Why it is written as a wound
 *
 * `wounds.ts` already owns the exact fact this needs — laid up, not working, mending a day at a
 * time, and got back on his feet faster where somebody can set a bone. A villager used to have two
 * conditions, alive and buried, and that file put a third between them; being old is the same third
 * condition arriving for a different reason. Inventing a second one would have meant a second field
 * on a `Person`, a second thing for the register to hold across a re-living, a second predicate for
 * the economy to remember to ask, and two numbers that could disagree about whether a man went to
 * work this morning.
 *
 * It follows that a doctor is what an elder is worth to. A village with one has its old people back
 * out in three days rather than six, so it keeps roughly twice as much work out of them over a
 * season — and that is the second reason this world has ever had to keep a doctor. The first was
 * something with teeth coming through the valley, which in a quiet village never happens at all, so
 * half the doctors in this country stood about for four hundred days with nothing to do. Old age
 * happens everywhere, every season, whether or not anything is hunting there.
 *
 * ## What an elder does not lose
 *
 * His trade. The note that asked for this left it open — whether an elder still holds a trade or
 * hands it on, which is `vacancies.ts` and `inheritance.ts` both — and the answer here is that he
 * keeps it, because a trade in this game is what somebody *is* and the vacancy machinery fills
 * posts that nobody holds. Taking the smithy off an old man would have the mayor enrolling a child
 * into a job that is not actually free, and would put the village's only doctor out of work on the
 * morning his neighbours most need him. What mastery does when the hands go is #236's question and
 * wants a place for mastery to exist first.
 *
 * Nor his standing. Everywhere the village asked whether somebody was grown, it now asks `grownUp`,
 * so an elder still inherits, still stands a post, still counts as a parent under a roof and still
 * has a grown face drawn on him. Old age is information the village has about a man, not a list of
 * things he is abruptly forbidden.
 */

/**
 * How often an old body gives out, on any morning it is well.
 *
 * Once a fortnight or so. Against a spell of six days in bed — three where there is a doctor — that
 * leaves an elder laid up about a third of his old age in a village with nobody to set a bone and
 * about a fifth in one that has somebody, so a place with a doctor visibly gets more out of its old
 * people without either figure reading as a retirement. Bigger than this and an elder stops working
 * altogether, which is a different design and a poorer one: what is wanted is a man who still goes
 * out most mornings and cannot be relied on.
 *
 * Not exported. It is the shape of the behaviour that matters and the tests say it in those terms;
 * a constant whose only reader outside this file is a test asserting the constant is a test that
 * cannot fail.
 */
const A_BAD_TURN = 0.08;

/**
 * Whoever the years caught this morning, put to bed for a few days.
 *
 * Called at the end of a day rather than the start of one, and that is load-bearing. The hall's
 * roll is a forecast — it says what tomorrow will pay every name on it, and `chore test economy`
 * holds tomorrow's purses to tonight's row to the coin. A villager who was well when the roll was
 * written and could not work when the morning came would be a wage the books promised and the
 * purse never saw, which the audit reads as coin vanishing with nothing to explain it. Written
 * tonight, the roll sees him in bed and quotes him at nothing, and the morning agrees.
 *
 * The stream is handed in and it is a stream of the village's own, the way the shrine's is: one
 * village on one day under its own name, so that a valley with old people in it cannot shift the
 * luck of a valley without any. A village's whole life is drawn off a single roll, and a draw added
 * to that roll would have re-founded every village in every world — different names, different
 * trades, different people down the mine — to add a stage to a life.
 *
 * A draw is spent on every elder whether or not it can be used, for the same reason `parentsFrom`
 * spends its second one: two machines that disagree about how many rolls a morning costs are two
 * machines holding different villages by the afternoon.
 */
export function restWhoIsFailing(people: readonly Person[], day: number, rng: () => number): void {
  const doctor = doctoredBy(people);
  for (const person of people) {
    if (stageOf(person, day) !== 'elder') continue;
    const failing = rng() < A_BAD_TURN;
    // and nothing whatever happens to a man who is already in bed: a wolf and a bad chest do not
    // add up, and the days he has left to lie there are the days he already had
    if (!failing || (person.hurt ?? 0) > 0) continue;
    /*
     * The worst kind of spell, rather than a scratch, and it is the severity that makes the doctor
     * matter. `mendThem` pays him for the morning he was called out — its test is that the days
     * standing against a man are the days this village's doctor would have left him — so a lighter
     * bout would be one the doctor mends and is never paid for, which is the opposite of the point.
     */
    person.hurt = laidUpFor(1, doctor);
  }
}
