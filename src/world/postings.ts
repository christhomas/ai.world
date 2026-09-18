import { THE_HALL, isTheHall, canDo, ownedBy, ownerFromSave, type Capability, type Owner } from './holdings';
import { payAndSweep } from './purses';
import type { Settlement } from './settlement';
import { grownUp, type Person } from './people';

/**
 * Work somebody is engaged to do that is not their own, and the money that moves for it.
 *
 * Two items asked for this from opposite ends. **37** wants a builder's job registered at the hall
 * so that another builder can take over a half-built house when the first is carried off by a wolf.
 * **39** wants a farmer to pay a man to stand over his herd, now that a dragon takes cattle. They
 * read as a fee and a wage — one paid once when the thing is standing, one carried daily — and this
 * economy has had exactly one of each: the builder's deposit, and the watchman on the tower.
 *
 * They are one mechanism, and finding that out is most of what this file is.
 *
 * ## A post is not held by a person
 *
 * Both items are the same question wearing different clothes: **how does work get paid for when the
 * worker may die?** The objection that kept builders off the register for months was that "a builder
 * who can be carried off by a wolf half way through the job is a house that dangles" — and a guard
 * is the same problem, because a man standing in a field while a dragon is overhead is exactly the
 * man most likely not to be there tomorrow.
 *
 * An escrow answers it for the fee: the money sits at the hall, so a dead builder does not take it
 * with him. But an escrow is a thing to *keep*, and a thing kept about a dead man is a thing that
 * has to be cleaned up. The watchman answers it better and answers it already: **nothing is
 * remembered between days**. `whoStandsWatch` chooses a man again every morning out of who is there
 * and what the hall can pay, so a village that buries its watchman has somebody else up the tower
 * the next morning without anything having to notice that the first one is gone.
 *
 * That is the general case, and it is what is built here. A post belongs to the **holding** — a
 * farm, a yard, a job on the hall's books — and who stands it is worked out fresh each morning. A
 * builder who dies half way through a house does not leave a dangling job, because the job was never
 * his: it was the hall's, and tomorrow it is somebody else's morning's work. Nothing is stored, so
 * nothing can be orphaned, and a village re-lived from its founding arrives at the same men in the
 * same fields.
 *
 * ## So both become wages
 *
 * The resolution of the fee and the wage is that **a fee held for a dead man is a fee that dangles**,
 * and the way out is to stop holding it. What the player pays for a house is still a price and still
 * paid once; what the *village* does with it afterwards is a day of building bought each morning
 * from whoever turns up. That is the same shape as the watchman's wage and the same shape as the
 * guard's, and it has the property an escrow does not: a builder who dies on the fourth day has been
 * paid for four days of work he actually did, and his replacement is paid for the two that are left.
 *
 * ## Pure, and pointing one way
 *
 * Handed people, holdings and how hard the place is being leaned on, it says who is standing what
 * and what it costs whom. It moves no money: `livelihoods.ts` does that, because a coin leaving one
 * purse and arriving in another is one act and belongs where the other three ways money moves
 * already live. It reads `holdings.ts` and `holdings.ts` knows nothing about it, which is the
 * direction that file asks for.
 */

export const POST = {
  /**
   * What a man asks for a day of standing over somebody else's cattle, in gold, at peace.
   *
   * Never actually paid at peace — a farm with nothing overhead posts nobody — so this is the base
   * the danger multiplies rather than a wage anybody draws. Eight against the watchman's twelve,
   * and lower on purpose: the hall's watchman is on a tower all night watching a road, and this is
   * a day in a field with a stick. It has to sit above `PROSPER.A_DAY`, which is two, or standing
   * guard would pay worse than whatever the man was doing instead and nobody would take it.
   */
  GUARD: 8,
  /**
   * How much dearer a day of it gets as the danger rises, at the worst.
   *
   * Doubling, so a man asks sixteen with a dragon overhead and eight with a rumour. That is the
   * half of item 39 that makes it a decision rather than a subscription: the wage climbs exactly
   * when the thing it protects against is worst, so a farmer chooses between paying badly and
   * losing beasts at the moment both are most expensive.
   */
  DANGER: 1,
  /**
   * The share of a day's raid one man on the gate turns away.
   *
   * A third. Not all of it, because a man with a stick does not send a dragon home and pretending
   * otherwise would make one guard the answer to everything; and not a tenth, because a wage that
   * buys almost nothing is a wage nobody would ever pay and the item would be a line in a table
   * that never ran. At a third, two men on a bad week are worth their wages twice over and a farm
   * still loses beasts, which is the shape a player can feel.
   */
  SAVES: 1 / 3,
  /**
   * How much of a purse a farmer will lay out on wages in one day, as a share of what he holds.
   *
   * A fifth. Without it the first bad morning empties him — a guard is sixteen gold and a villager
   * holds tens, not hundreds — and a farmer who paid his last coin to save a cow would be a farmer
   * who starves to keep his herd, which is not a decision anybody makes. It is also what makes a
   * poor farm lose its beasts and a rich one keep them, which is the right way round and is the
   * same rule `spentOnLiving` uses about what a man will lay out on himself.
   */
  LAYS_OUT: 0.2,
  /**
   * What a builder asks for a day on somebody else's yard, in gold.
   *
   * The seat `POSTINGS` has held open for the builder since it was written, filled at last. Item 37
   * says a village pays for *a day of building bought each morning from whoever turns up* rather
   * than holding a fee in escrow, so this is a day and not a share of a price.
   *
   * Above a guard's eight, because a guard stands and a builder works, and because a village that
   * could hire a builder for what it pays a man to lean on a gate would never build anything the
   * slow way. Below what the hall pays its own crew for a roof, which is a price divided by the
   * days it takes: a yard is a business somebody runs and a roof is the village buying a thing, and
   * the second should be the better morning's work or nobody would ever raise one.
   */
  BUILDER: 12,
} as const;

/**
 * A sort of post: what is being stood, who may stand it, and whose purse it comes out of.
 *
 * A table rather than two functions, for the reason `SORTS` is one next door: the two jobs in it
 * are the same job with different words, and writing them separately is how they drift. `wants` is
 * the capability somebody needs — empty for work anybody can do, which is most of it.
 */
export interface Posting {
  kind: string;
  /** What the holding it stands on has to be. */
  on: string;
  /** What somebody must know how to do, or empty where anybody will serve. */
  wants: Capability | '';
  /** What it is called out loud, for a book or a clerk to read. */
  noun: string;
}

/**
 * The guard and the builder both run today. A crew post still stands on a yard when the village
 * owns the yard; a player commission reaches the same row as a job kept on the hall's books. In
 * both cases the work, not yesterday's worker, owns the post.
 */
export const POSTINGS: readonly Posting[] = [
  { kind: 'guard', on: 'farm', wants: '', noun: 'a man on the gate' },
  { kind: 'crew', on: 'yard', wants: 'can_build', noun: 'a day of building' },
];

/** One post, stood by one person, on one morning. */
export interface Post {
  /** Which sort: see `POSTINGS`. */
  kind: string;
  /** The holding it is on, which is what makes it outlive whoever stands it. */
  holding: string;
  /** Who is standing it this morning. */
  who: string;
  /** Whose purse it comes out of: a villager, or the hall. See `Owner`. */
  funder: Owner;
  /** What today costs, in gold. */
  wage: number;
}

/** The least a holding this file can post a man on has to look like. */
export interface Held {
  id: string;
  kind: string;
  owner: Owner;
}

/** Work on the hall's books that needs one builder this morning. */
export interface CrewWork {
  id: string;
  funder: Owner;
}

/**
 * What one day of standing guard is worth, given how hard the place is being leaned on.
 *
 * Nought where nothing is: a farm with an empty sky posts nobody, and that is not a saving to be
 * made but the absence of a reason. Everything above it climbs with the danger, so the bill and the
 * threat arrive together.
 */
export function wageForAGuard(pressure: number): number {
  if (pressure <= 0) return 0;
  const much = Math.max(0, Math.min(1, pressure));
  return Math.round(POST.GUARD * (1 + much * POST.DANGER) * 100) / 100;
}

/**
 * Who is standing what in this village this morning, and what it costs whom.
 *
 * Recomputed rather than remembered, which is the whole design and is `whoStandsWatch`'s own rule:
 * a farm that buried its guard has another man on the gate tomorrow and nothing had to notice.
 *
 * Who gets the work is the village's **soldiers**, and that is item 39's own answer rather than a
 * convenience. A soldier's wage today is invented beyond the village — the polite way of saying
 * nobody pays it — and the whole point of this item is to give the one trade in a village whose
 * business is standing about with a weapon somebody who actually wants him. Failing a soldier, a
 * grown villager with no trade of their own will do; a village does not take its smith off the
 * forge to stand in a field, and it emphatically does not send a child.
 *
 * They are taken in id order so that two machines put the same man on the same gate, and each man
 * stands one post: a village with one soldier and three farms guards one farm, which is the honest
 * answer and reads from the road as what it is.
 *
 * A farmer pays out of his own purse and only so far into it — see `POST.LAYS_OUT`. A poor farm
 * therefore loses beasts where a rich one keeps them, which is the right way round and is the only
 * way this is a decision rather than a subscription.
 */
export function postsToday(
  people: readonly Person[], holdings: readonly Held[], pressure: number, day = Infinity,
): Post[] {
  const purses = new Map(people.map((person) => [ownedBy(person), person.purse]));
  const byId = (one: Person, two: Person): number => (one.id < two.id ? -1 : 1);
  // grown, because a nine-year-old on a gate with a dragon overhead is not a thing a village does.
  // `Infinity` is "whatever they are now": a caller with no day in its hand is asking about today
  const grown = people.filter((person) => day === Infinity || grownUp(person, day));
  const spare = [
    ...grown.filter((person) => person.trade === 'soldier').sort(byId),
    ...grown.filter((person) => person.trade === '').sort(byId),
  ];
  /*
   * A guard's wage is nought at peace — a farm with nothing overhead posts nobody — and this used
   * to return on that before anything else was considered. Which was right while the gate was the
   * only post there was, and stopped being right the moment a yard could hire a builder: how hard
   * something is leaning on the village has nothing to do with whether a house gets built, so a
   * village at peace employed nobody at all. Found by the first test that asked for a crew.
   */
  const wage = wageForAGuard(pressure);
  const posts: Post[] = [];
  let next = 0;
  for (const holding of wage <= 0 ? [] : holdings) {
    if (holding.kind !== 'farm') continue;
    const held = purses.get(ownerFromSave(holding.owner));
    if (held === undefined || held * POST.LAYS_OUT < wage) continue;
    const man = spare[next];
    if (!man) break;                              // nobody left in the village to ask
    next++;
    posts.push({ kind: 'guard', holding: holding.id, who: man.id, funder: holding.owner, wage });
  }
  const work: CrewWork[] = [];
  for (const holding of holdings) {
    if (holding.kind !== 'yard') continue;
    const held = purses.get(ownerFromSave(holding.owner));
    if (held === undefined || held * POST.LAYS_OUT < POST.BUILDER) continue;
    work.push({ id: holding.id, funder: holding.owner });
  }
  return [...posts, ...crewsToday(grown, work, posts)];
}

/**
 * Whether this person could stand this sort of post.
 *
 * Trivial for a guard and the whole of the question for a builder, which is why it is a function
 * rather than a condition written into the loop above: when the yard has work on its books, the man
 * who takes it is whoever `canDo(person, 'can_build')`, and this is where that is asked.
 */
export function couldStand(person: Person, posting: Posting): boolean {
  return posting.wants === '' || canDo(person, posting.wants);
}

/**
 * A day of building on every yard whose owner can pay for one.
 *
 * The seat `POSTINGS` has held open since it was written. The table declared two sorts of post and
 * only one of them ever happened: `postsToday` looked for `farm` in as many words, so the `crew`
 * row — a yard, wanting `can_build`, *a day of building* — described something no code path
 * reached. Item 37 is what was waiting on it.
 *
 * **Bought by the day rather than held in escrow**, which is that item's argument settled against
 * its own first sentence: a fee held for a dead man dangles. A builder who dies on the fourth day
 * has been paid for four days and his replacement is paid for the two that are left, where escrow
 * would hand the dead man's four to his successor.
 *
 * Nobody stands two posts in one morning, the same rule the gates run on — a village with one
 * builder and three yards builds on one of them, which is the honest answer and reads from the road
 * as what it is.
 */
export function crewsToday(
  grown: readonly Person[], work: readonly CrewWork[], already: readonly Post[] = [],
): Post[] {
  const taken = new Set(already.map((post) => post.who));
  /*
   * Whoever can actually do it, which is the capability rather than the trade name: a wright, a
   * mason or anybody else with the hands.
   *
   * Asked through `couldStand` off the `POSTINGS` row rather than by naming `can_build` here.
   * `couldStand`'s own comment has always claimed to be *"where that is asked"*, and it was not —
   * the capability was written out again in this line, so the table declared what a crew wants and
   * a second copy decided it. The day a third post is added, the table is what somebody edits.
   */
  const crew = POSTINGS.find((posting) => posting.kind === 'crew');
  const hands = grown.filter((person) =>
    crew !== undefined && couldStand(person, crew) && !taken.has(person.id))
    .sort((one, two) => (one.id < two.id ? -1 : 1));
  const posts: Post[] = [];
  let next = 0;
  for (const job of work) {
    const hand = hands[next];
    if (!hand) break;
    next++;
    posts.push({ kind: 'crew', holding: job.id, who: hand.id, funder: job.funder, wage: POST.BUILDER });
  }
  return posts;
}

/**
 * How many beasts the men on the gates turned away today.
 *
 * A share each of what would otherwise have gone, and never more than all of it: three guards do
 * not send back four cows out of three. Rounded down to the beast on the way out, because half a
 * cow saved is a cow that was taken.
 */
export function turnedAway(posts: readonly Post[], cattle: number): number {
  if (cattle <= 0) return 0;
  const guards = posts.filter((post) => post.kind === 'guard').length;
  return Math.min(cattle, Math.floor(cattle * Math.min(1, guards * POST.SAVES)));
}

/** Whether a post is the hall's to pay for rather than a villager's. See item 37. */
export function paidByTheHall(post: Post): boolean {
  return isTheHall(post.funder);
}


/**
 * Every village's posts for one morning, stood and paid, in the village's own day.
 *
 * This used to happen in `tidings.ts` — on the page, once a frame's worth of day, and *inside* the
 * loop over the warbands. Two things followed from that and both were wrong. A village with nothing
 * leaning on it was never asked at all, which #355 fixed one file up; and the paying happened
 * because a frame was drawn, so a man's holding earned him nothing on any day he was not looking at
 * it. A hero who closed the tab employed nobody until he opened it again.
 *
 * Here instead, beside `aCarrierWalks` and for the same reason: the register's forward clock is the
 * thing that runs while nobody is watching. *"A day away pays what a day present would have paid"*
 * is #264's third line, and this is the whole of it — a day lived is a day paid, whoever was
 * looking.
 *
 * Nothing is rolled and nothing is stored. Who stands what is worked out fresh from who is alive
 * this morning, which is `postings.ts`'s oldest rule: *a post belongs to the holding, not to the
 * person*, so a village re-lived from its founding arrives at the same men in the same fields.
 *
 * ## What is deliberately not changed with it
 *
 * A post whose funder is not a person on the roll is not paid, exactly as it was not before. In
 * practice that is a hall-owned holding, and `payAndSweep` would happily take the wage out of the
 * hall's purse now that the paying goes through it — which would be a change to *what* happens
 * rather than to *where*, on the same morning as a change to where. It is left alone; whether the
 * hall should pay for a man on its own farm is a question for its own issue.
 *
 * A post somebody stands on their own holding moves no money and is skipped, which is what the
 * two-purse hand-over did before by arriving at the same purse twice.
 */
export function theDaysPosts(
  villages: ReadonlyMap<string, Settlement>,
  pressureOn: (village: string) => number,
  day: number,
  book: { post: (id: string, much: number) => void },
): Map<string, readonly Post[]> {
  const standing = new Map<string, readonly Post[]>();
  for (const [name, village] of villages) {
    const posts = postsToday(village.people, (village.holdings ?? []) as readonly Held[], pressureOn(name), day);
    standing.set(name, posts);
    if (posts.length === 0) continue;
    const onTheRoll = new Set(village.people.map((person) => ownedBy(person)));
    const owed = new Map<Owner, number>();
    for (const post of posts) {
      const man = ownerFromSave(post.who);
      if (post.funder === man || !onTheRoll.has(post.funder) || !onTheRoll.has(man)) continue;
      owed.set(post.funder, (owed.get(post.funder) ?? 0) - post.wage);
      owed.set(man, (owed.get(man) ?? 0) + post.wage);
    }
    if (owed.size === 0) continue;
    payAndSweep(village, owed);
    for (const [id, much] of owed) book.post(id, much);
  }
  return standing;
}
