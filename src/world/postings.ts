import { THE_HALL, canDo, type Capability } from './holdings';
import { stageOf, type Person } from './people';

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
 * Every sort of post there is.
 *
 * The guard is the one that runs today. The builder is a seat left deliberately empty, in the way
 * `SORTS` left the yard and the boat empty and said so: item 37 is the hall registering a job, and
 * a job is a holding this world does not raise yet — `whatTheVillageHolds` founds a farm, a yard
 * and a boat, and the yard has no work on its books. When it has, this is the row that pays for it,
 * and nothing else here has to change.
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
  /** Whose purse it comes out of: a villager's id, or `THE_HALL`. */
  funder: string;
  /** What today costs, in gold. */
  wage: number;
}

/** The least a holding this file can post a man on has to look like. */
export interface Held {
  id: string;
  kind: string;
  owner: string;
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
  const wage = wageForAGuard(pressure);
  if (wage <= 0) return [];
  const purses = new Map(people.map((person) => [person.id, person.purse]));
  const byId = (one: Person, two: Person): number => (one.id < two.id ? -1 : 1);
  // grown, because a nine-year-old on a gate with a dragon overhead is not a thing a village does.
  // `Infinity` is "whatever they are now": a caller with no day in its hand is asking about today
  const grown = people.filter((person) => day === Infinity || stageOf(person, day) === 'adult');
  const spare = [
    ...grown.filter((person) => person.trade === 'soldier').sort(byId),
    ...grown.filter((person) => person.trade === '').sort(byId),
  ];
  const posts: Post[] = [];
  let next = 0;
  for (const holding of holdings) {
    if (holding.kind !== 'farm') continue;
    const held = purses.get(holding.owner);
    if (held === undefined || held * POST.LAYS_OUT < wage) continue;
    const man = spare[next];
    if (!man) break;                              // nobody left in the village to ask
    next++;
    posts.push({ kind: 'guard', holding: holding.id, who: man.id, funder: holding.owner, wage });
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

/** What the day's posts cost each purse that funds one, ready for the ledger to apply. */
export function wagesOwed(posts: readonly Post[]): Map<string, number> {
  const owed = new Map<string, number>();
  for (const post of posts) {
    owed.set(post.funder, Math.round(((owed.get(post.funder) ?? 0) + post.wage) * 100) / 100);
  }
  return owed;
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

/** Whether a post is the hall's to pay for rather than a villager's. See item 37. */
export function paidByTheHall(post: Post): boolean {
  return post.funder === THE_HALL;
}
