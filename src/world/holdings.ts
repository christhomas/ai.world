import { stageOf, surnameOf, type Person } from './people';
import { PROSPER } from './prosperity';

/**
 * What a person can do, and the things they work that outlive them.
 *
 * A village owned exactly two sorts of thing this morning and neither of them could change hands.
 * There was `works` — a well, a tower, a roof — which the hall paid for and which belongs to
 * everybody in the loose way a road does. And there was `herd`, a single number in the settlement,
 * which grew while there were farmers and walked off when the last of them was buried, and which
 * belonged to nobody in particular. Between those two sits the thing a working life is actually
 * built on, and the game had no word for it: a farm, a yard, a boat — something with a gate, a name
 * on the gate, somebody who paid for it and somebody who works it, still standing the morning after
 * its owner's funeral.
 *
 * ## The two ideas, and why they are not the same idea
 *
 * A **capability** is a fact about a person. `can_farm` says this one knows how to work a field. It
 * was learned from a parent, or taught by whoever hired them, or handed to them by a mayor who was
 * short of farmers — and it goes into the ground with them, because knowing how to do something is
 * not a thing anybody can leave to their daughter.
 *
 * A **holding** is the thing standing above it, and it does not go into the ground. The farm is
 * still there. The beasts are still in the paddock. What the village has lost is a pair of arms,
 * which is a different and much smaller loss than losing the farm — and *that* is the fact the rest
 * of the simulation could not state. Bury a village's doctor and the village has lost a doctor
 * outright, because a surgery is a room in somebody's house and there is no second one to inherit.
 * Bury its farmer and the village has lost a farmer and kept a farm. Two deaths, two quite
 * different mornings, and until now they were the same line in the same book.
 *
 * The two axes cross rather than line up, which is why they are two words and not one. `can_mine`
 * is a capability with no holding anywhere behind it: a seam belongs to the mountain, and no miner
 * has ever been able to leave one to anybody. `can_fish` is the opposite case — a boat is as solid
 * a holding as this world has, and nobody in the country can fish, because fishing needs a harbour
 * to be possible at all and most villages have not got one.
 *
 * ## What this file is allowed to decide, and what it is not
 *
 * It decides *who holds what, who works it, and whose the day's take therefore is* — and not one
 * coin moves anywhere in this module. The distinction is worth keeping sharp, because the third of
 * those sounds like money and is not: `shareTheTake` says whose a holding's earnings *are*, which is
 * a fact about ownership, and hands the answer back for somebody else to apply. Every function here
 * is pure in what it is handed, so a village re-lived from its founding arrives at the same farms
 * with the same names on the same gates as the village somebody has been standing in — which is the
 * bargain the whole world is built on. The register is the one place a coin is allowed to move.
 *
 * It also invents no prices. What a farm costs to found is `founding.ts`'s, because pricing a shed
 * means knowing what a crew charges for a week, and this file sits underneath everything that knows
 * that. What it prices instead is a *day* of somebody else's work on your holding, which is the one
 * number ownership cannot be stated without.
 */

/**
 * The four things a person can know how to do.
 *
 * Four rather than eleven, and the shortness is the design. A capability earns its place when
 * something in the world genuinely asks about it — whether this person may work that farm, whether
 * this village can crew a boat — and a word per trade would be `trade` spelled a second time, which
 * is two numbers for one question and the fault this codebase has paid for before.
 *
 * Two of the four are held by nobody alive today, and that is the correct answer rather than a gap.
 * Nowhere in the country is there a trade that teaches `can_fish`, because there is no fishing boat
 * and no harbour to keep one at; nowhere is there one that teaches `can_build`, because a village
 * raises its own roofs with whatever hands it has. Both are seats left deliberately empty, and the
 * work list says who fills them.
 */
export type Capability = 'can_farm' | 'can_build' | 'can_mine' | 'can_fish';

/**
 * What each trade teaches, for the few trades that teach anything on that list.
 *
 * Read off the trade rather than written onto the person, which is the same bargain `homes.ts`
 * makes about who lives in which house: nothing is stored, so nothing can drift out of step with
 * the register, and a villager who takes up a new trade knows new things the same morning.
 *
 * It is emphatically not a permission list. Anybody at all may become a farmer — everybody has to
 * eat, and farming is one of the ways eating is paid for. What decides whether somebody actually
 * becomes one is what the place supports, what they were taught and what the village is short of,
 * and none of those three is a licence. This table only says what somebody who *is* a farmer
 * therefore knows.
 *
 * `fisherman` and `builder` are in the table and in no village: see `Capability` above.
 */
const TAUGHT_BY: Readonly<Record<string, readonly Capability[]>> = {
  farmer: ['can_farm'],
  miner: ['can_mine'],
  fisherman: ['can_fish'],
  builder: ['can_build'],
};

/** Everything somebody of this trade knows how to do, which is nothing at all for most trades. */
export function capabilitiesOf(trade: string): readonly Capability[] {
  return TAUGHT_BY[trade] ?? [];
}

/** Whether this person knows how to do this. A child holds no trade and therefore knows nothing. */
export function canDo(person: Person, what: Capability): boolean {
  return capabilitiesOf(person.trade).includes(what);
}

/**
 * A sort of holding: what it is, who can work it, and what a village must already have to have one.
 *
 * `needs` is the half that makes a coastline mean something. A boat is impossible in a village with
 * no jetty — not expensive, impossible — so there are no fishermen inland however rich the valley
 * gets, and a harbour is therefore the first thing in this economy that creates a livelihood rather
 * than merely decorating one. Everything else needs nothing, because a field is the ground a village
 * already stands on.
 */
export interface Sort {
  /** What this sort is called, and what goes into a holding's name. */
  kind: string;
  /** What somebody has to know how to do before they can work one. */
  worked: Capability;
  /** What has to be standing here first, or empty where a place needs nothing. */
  needs: string;
  /** The word for one, as somebody living there would say it: "the Vos farm". */
  noun: string;
}

/**
 * Every sort of holding there is, in the order a village would come by them.
 *
 * A farm is the only one any village has today, which makes this list look thin — but the two below
 * it are not padding. They are the two shapes the design has already argued out and needs somewhere
 * to put: a yard, which is a builder's jobs standing on the hall's books after the builder is dead,
 * and a boat, which is the one holding a village cannot have merely by wanting it.
 */
export const SORTS: readonly Sort[] = [
  { kind: 'farm', worked: 'can_farm', needs: '', noun: 'farm' },
  { kind: 'yard', worked: 'can_build', needs: '', noun: 'yard' },
  { kind: 'boat', worked: 'can_fish', needs: 'jetty', noun: 'boat' },
];

/** The sort a holding is, or nothing for a kind this version of the world has never heard of. */
export function sortOf(kind: string): Sort | null {
  return SORTS.find((sort) => sort.kind === kind) ?? null;
}

/** Whether a village with these things standing in it could have a holding of this sort at all. */
export function possibleHere(sort: Sort, works: readonly string[]): boolean {
  return sort.needs === '' || works.includes(sort.needs);
}

/**
 * Whether a trade leaves something standing when the person holding it dies.
 *
 * The question the whole file exists to answer, and the one the rest of the design hangs off. A
 * trade that leaves a holding is a trade a village can lose a *worker* in without losing the work —
 * and it is also, for exactly the same reason, a trade that can found another of itself, because
 * there is a second farm to buy where there is no second surgery. A doctor is therefore multiplied
 * only by somebody being enrolled as one, which is why a village fills up with farmers and still
 * has precisely one doctor.
 */
export function leavesAHolding(trade: string): boolean {
  const knows = capabilitiesOf(trade);
  return SORTS.some((sort) => knows.includes(sort.worked));
}

/**
 * Whoever owns a holding that no person owns.
 *
 * A space in the middle, which is what makes it safe: a person's id is their village's letters and a
 * number with a hyphen between them, so no villager who has ever lived or ever will can collide with
 * this. It is the same value the treasury is — nobody's, and staying exactly where it is for whoever
 * is elected next — rather than the mayor's, and the difference matters here for the reason it
 * matters there.
 */
export const THE_HALL = 'the hall';

/**
 * One holding: a farm, a yard or a boat, and the two people it answers to.
 *
 * The owner and the worker are kept apart because they genuinely come apart, and that is the whole
 * point of the type. Normally they are the same man — a farmer owns his farm and works it, and
 * nothing about the ordinary case needs explaining. But the hall can hold one, and then the village
 * owns a farm and hires a pair of arms to work it; and a farm can be inherited by a daughter who has
 * a trade of her own, and then she owns it and somebody else is in the field.
 */
export interface Holding {
  /**
   * What this holding is, for as long as it stands.
   *
   * Minted once and never reissued, even if the holding it belonged to were somehow to go: a name
   * that can be handed out twice is a name that means one thing in the hall's books and another in
   * the paddock, which is the whole reason a holding has an identity rather than a position in a
   * list.
   */
  id: string;
  /** Which sort it is: see `SORTS`. */
  kind: string;
  /**
   * The family whose name is on the gate, or empty for the village's own.
   *
   * A holding belongs to a household rather than to a person, which is what lets it pass down
   * without anybody having to be told that somebody has died — the same rule `homes.ts` uses to
   * decide who lives where, and the same one `handOnWhatTheyHad` uses to decide where a purse goes.
   * When it goes to the hall the gate is repainted: an empty name here is not a missing fact but a
   * positive one, and it is what stops a hall's farm quietly returning to a family that died out.
   */
  house: string;
  /** Who holds it today: a villager's id, or `THE_HALL`. */
  owner: string;
  /** Who works it today, or nobody at all, which is a vacancy for a mayor to fill. */
  worker: string;
  /** The day it was founded, which is the only history a holding keeps. */
  founded: number;
}

/**
 * A holding as a day's work needs to see it, which is less than a holding.
 *
 * Everything but what sort of thing it is may be missing, and that is not laxity — it is the honest
 * description of the callers there are. Something counting the hulls a village keeps needs only the
 * kind; a test standing a coast up to see what it lands has no business inventing owners for boats
 * it will never ask about. What a missing field *means* is settled once here rather than at each
 * site that reads one: no worker named is nobody standing in it, and no owner named is the hall's,
 * which are the two right answers and are also what a village's books would say.
 */
export type Standing = { kind: string } & Partial<Omit<Holding, 'kind'>>;

/** Whatever a village can be asked about here, which is deliberately less than a settlement. */
export interface Village {
  people: readonly Person[];
  /** What the village has had built, which is what decides whether a sort is possible here. */
  works: readonly string[];
  /** What it held last night. Absent on the morning a village is founded, and that is not an error. */
  holdings?: readonly Holding[];
}

/** The number on the end of a holding's name, or nought for anything that is not one of ours. */
function ordinalOf(id: string): number {
  const tail = Number(id.slice(id.lastIndexOf('-') + 1));
  return Number.isFinite(tail) ? tail : 0;
}

/**
 * Raise a holding, and give it a name nothing else in the village has ever had.
 *
 * Handed the owner rather than choosing one, because the two callers that matter want different
 * answers and both are right: a farmer who has saved enough founds one belonging to himself and his
 * house, and a hall that has voted to buy a farm back founds one belonging to the village — pass
 * nothing, and the gate has no family name on it and there is nobody in the field yet. The next
 * morning's reconciliation puts somebody in it.
 *
 * It costs nothing, and today that is not a simplification but the truth: every farm in the country
 * exists because a farmer walked out into a field that was already there. What a *second* farm costs
 * is the thing the work list is about, and the money for it moves where all the other money moves.
 */
export function foundAHolding(
  village: string, sort: Sort, owner: Person | null, standing: readonly Holding[], day: number,
): Holding {
  const highest = standing.reduce((most, one) => Math.max(most, ordinalOf(one.id)), 0);
  return {
    id: `${village.replace(/[^A-Za-z]/g, '')}-${sort.kind}-${highest + 1}`,
    kind: sort.kind,
    house: owner ? surnameOf(owner) : '',
    owner: owner ? owner.id : THE_HALL,
    worker: owner ? owner.id : '',
    founded: day,
  };
}

/**
 * Where a holding goes when the person who held it is no longer on the roll.
 *
 * Down the family first, by exactly the rule a purse goes down it: a grown one of the name before a
 * child of the name, because a household is what actually inherits and a farm handed to a
 * seven-year-old is a farm nobody is working. The two rules are the same on purpose — a village
 * where the money went one way at a funeral and the land went another would be a village with two
 * different ideas about what a family is.
 *
 * Where it is the same at the end is where it differs, and the difference is the interesting part. A
 * purse with no heir is shared out among everybody still living there, because money divides. A farm
 * does not divide: thirty people cannot each own a thirtieth of a paddock and send a thirtieth of a
 * cow to market. So a holding with nobody of the name left falls to the hall, which is the only
 * thing in a village that can hold a whole farm on behalf of everybody — and the village then has a
 * farm and a vacancy, which is a far better morning than the one it used to have, where the beasts
 * simply walked off.
 *
 * The hall's own holdings never change hands at all. That is the point of the hall owning one: a
 * treasury outlives everybody, so the worker dies and the farm does not move, and the mayor enrols
 * the next pair of arms into it.
 *
 * It asks whether somebody is on the roll rather than whether they are in the churchyard, so a
 * farmer who walks over the hill to a village that still has a larder loses his farm the same
 * morning as one who is buried. That is the right answer and not an oversight: he left it, and a
 * field two valleys away is not a thing anybody can work from where he now is.
 */
function passedOn(holding: Holding, people: readonly Person[], day: number): Holding {
  if (holding.owner === THE_HALL) return holding;
  if (people.some((person) => person.id === holding.owner)) return holding;
  const family = holding.house === ''
    ? [] : people.filter((person) => surnameOf(person) === holding.house);
  const heir = family.find((person) => stageOf(person, day) === 'adult') ?? family[0] ?? null;
  if (heir) return { ...holding, owner: heir.id };
  return { ...holding, owner: THE_HALL, house: '' };
}

/**
 * Everything a village holds this morning, worked out again from who is alive in it.
 *
 * The same shape and the same reasoning as `whatTheVillageSpends`: handed what a village has, it
 * says what the village now is, and the register applies the answer in one line. Nothing is mutated
 * and nothing is remembered between calls beyond the holdings themselves, so a hundred days lived
 * twice come out with the same farms both times.
 *
 * Three things happen, and the order they happen in is the argument:
 *
 * **The dead hand theirs on.** Done first, because everything after it wants to know who owns what,
 * and an estate that settled after the hiring would have the village hire somebody into a farm whose
 * owner was about to change.
 *
 * **Vacancies are filled before new ones are raised.** A man who could raise a farm of his own takes
 * on a standing one first if there is a standing one going begging, which is both the sensible thing
 * for him — the beasts are already in the paddock — and the thing that makes a hall-owned farm
 * actually get worked instead of sitting empty beside a brand new one. An owner who can do the work
 * gets his own holding back before anybody else is offered it, because that is what owning it means.
 *
 * **What is left over founds something.** Anybody who knows how to work a sort of holding and is not
 * working one raises one, and it costs nothing: a farmer has always simply had his fields. This is
 * the line that makes a village's farms equal its farmers today, which is exactly the herd cap the
 * economy has always used — so nothing about a village's beef changes on the morning this arrives,
 * and everything about who owns it does.
 */
export function whatTheVillageHolds(name: string, village: Village, day: number): Holding[] {
  const living = new Map(village.people.map((person) => [person.id, person]));
  const holdings = (village.holdings ?? []).map((one) => passedOn(one, village.people, day));

  /*
   * Whoever is already at work stays at work: a farm does not change hands every morning, and a
   * village that reshuffled its fields daily would be a village nobody could follow.
   *
   * Alive *and* still able, both, and the second half is not belt and braces. Somebody who has taken
   * up another trade since yesterday can no longer work the farm he was in, so he is not counted as
   * busy — otherwise he would be turned out of the field and barred from doing anything else on the
   * same morning, which is a day of a man's life lost to a bookkeeping order.
   */
  const stillAt = (holding: Holding): boolean => {
    const hand = living.get(holding.worker);
    const sort = sortOf(holding.kind);
    return hand !== undefined && (sort === null || canDo(hand, sort.worked));
  };
  const busy = new Set(holdings.filter(stillAt).map((one) => one.worker));
  const spare = (want: Capability): Person | undefined =>
    village.people.find((person) => !busy.has(person.id) && canDo(person, want));

  const settled = holdings.map((holding) => {
    const sort = sortOf(holding.kind);
    if (!sort || stillAt(holding)) return holding;
    const owner = living.get(holding.owner);
    const taking = owner && !busy.has(owner.id) && canDo(owner, sort.worked)
      ? owner : spare(sort.worked);
    if (taking) busy.add(taking.id);
    return { ...holding, worker: taking?.id ?? '' };
  });

  for (const person of village.people) {
    if (busy.has(person.id)) continue;
    const sort = SORTS.find(
      (one) => canDo(person, one.worked) && possibleHere(one, village.works),
    );
    if (!sort) continue;
    busy.add(person.id);
    settled.push(foundAHolding(name, sort, person, settled, day));
  }
  return settled;
}

/** Every holding of a village that has nobody working it: what a mayor's enrolment is for. */
export function vacancies(holdings: readonly Holding[]): Holding[] {
  return holdings.filter((holding) => holding.worker === '');
}

/** Whatever this person holds, which is usually one thing and often nothing. */
export function heldBy(holdings: readonly Holding[], who: string): Holding[] {
  return holdings.filter((holding) => holding.owner === who);
}

/** And whatever they actually work, which is a different question in a village with a hall farm. */
export function workedBy(holdings: readonly Holding[], who: string): Holding[] {
  return holdings.filter((holding) => holding.worker === who);
}

/**
 * What to call a holding out loud: "the Vos farm", or "the village farm" when the hall has it.
 *
 * Said as a place rather than as a fact about the deeds, which is how anybody standing at the gate
 * would say it — the same choice `nameOfHome` makes about walking into a house.
 */
export function nameOfHolding(holding: Holding): string {
  const noun = sortOf(holding.kind)?.noun ?? holding.kind;
  return holding.house === '' ? `the village ${noun}` : `the ${holding.house} ${noun}`;
}

/**
 * How many beasts one farm's paddocks hold.
 *
 * The cap rather than the herd: a herd grows up to this and then stops, because a farmer with six
 * cows has a farmer's day and a farmer with six hundred has a ranch and a different game. Six is
 * what a seven-tile yard and the field behind it read as from the road, and it is what `paddock.ts`
 * can actually stand up inside its rails without the beasts walking through one another.
 *
 * It lives here rather than in `livelihoods.ts`, where it was written, because it is a fact about a
 * *farm* and not about farming — and because the two files must point one way. A livelihood is what
 * a holding earns, so earning may ask about holdings and holdings must never ask about earning. That
 * is not fastidiousness: `rank.ts` and `growth.ts` asked each other exactly this sort of question
 * once and the answer at module-init time was `NaN`, which every village in the world then paid its
 * builders.
 */
export const BEASTS_PER_FARM = 6;

/**
 * What an owner pays somebody else to work a holding for a day.
 *
 * `PROSPER.A_DAY` — "what a day is worth to somebody the player never watched", which is the floor
 * under every wage in this world and is exactly what a hired hand's day is. He is not a tradesman
 * selling a skill to the people around him; he is a pair of arms in somebody else's field, and this
 * world already has a number for that and has had since before there was a village to stand it in.
 *
 * Two against the two pounds and a sixth a full paddock brings in — `BEASTS_PER_FARM` head calving
 * at `CALVES` and sold at `PRICE_PER_BEAST` — so an owner who is not working it clears a few
 * hundredths a day and no more. That thinness is the point rather than a disappointment. A farm
 * worked by somebody else should be barely worth having, because the man doing the work is the man
 * who should be eating; what the second farm is actually *for* is that the village has another
 * paddock and therefore more beasts, which is a gain to the place rather than to the owner.
 */
export const A_DAYS_HIRE = PROSPER.A_DAY;

/**
 * Whose a holding's day is, when the owner and the worker are not the same person.
 *
 * This is the whole of what an owner *is* in this world, and it is one rule rather than two:
 *
 *   **what a holding earns belongs to whoever holds it, and whoever holds it pays whoever works it
 *   a day's hire.**
 *
 * Everything the work list wanted from both halves of this falls out of that sentence. A hall that
 * has bought a farm takes what the farm makes and pays its hand — so a treasury can do a thing no
 * purse in the village can, and the wage it carries is drawn out of what the farm brought in rather
 * than out of the taxes, which is money moving inside the valley for work somebody needed. And a
 * farmer who has formed a second farm is in precisely the same position with precisely the same
 * arithmetic: he owns it, somebody else stands in it, and he pays that somebody a day.
 *
 * **When the two are the same man, not a coin of it moves**, and that matters more than it reads. It
 * is the ordinary case; it is every farm in every village until tonight; and it means this rule can
 * go in underneath a working economy without moving a single number in it. The wage is paid by the
 * owner to the worker, and a man does not pay himself.
 *
 * **The wage is capped by the day's take**, which is the clause that makes "out of what the farm
 * earns" literal instead of a rate. An owner cannot pay out of a paddock what the paddock did not
 * make, so a bad week costs the hand his wage and never costs the hall money it has not got. Without
 * it a village that bought three farms and had a thin month would be a treasury paying wages on
 * beasts that were not there, which is the shape of a subsidy rather than of an employer.
 *
 * An owner who is no longer on the roll is treated as the hall. That is a guard rather than a rule —
 * `passedOn` settles every estate before the morning — but money handed to a name nobody answers to
 * is money that leaves the world, and the one thing this economy is audited for is that it does not.
 */
export function shareTheTake(
  holdings: readonly Standing[], gold: number, people: readonly Person[],
): { purses: Map<string, number>; toTheHall: number } {
  const purses = new Map<string, number>();
  const add = (who: string, much: number): void => {
    purses.set(who, Math.round(((purses.get(who) ?? 0) + much) * 100) / 100);
  };
  const living = new Set(people.map((person) => person.id));
  let toTheHall = 0;
  // to the coin and by the same rule every other pool here is shared by, so what the holdings
  // between them take is exactly what the day made
  for (let at = 0; at < holdings.length; at++) {
    const holding = holdings[at];
    const took = shareOf(gold, holdings.length, at);
    const worker = holding.worker ?? '';
    const owner = living.has(holding.owner ?? '') ? holding.owner! : THE_HALL;
    if (owner === worker) { add(worker, took); continue; }
    const wage = Math.min(A_DAYS_HIRE, took);
    add(worker, wage);
    if (owner === THE_HALL) toTheHall = Math.round((toTheHall + took - wage) * 100) / 100;
    else add(owner, took - wage);
  }
  return { purses, toTheHall };
}

/** One holding's share of a pool, to the coin, with the remainder on the last of them. */
function shareOf(pool: number, among: number, at: number): number {
  if (among <= 0 || pool <= 0) return 0;
  const each = Math.floor((pool / among) * 100) / 100;
  return at === among - 1 ? Math.round((pool - each * (among - 1)) * 100) / 100 : each;
}

/**
 * The farms of a village that somebody is actually standing in this morning.
 *
 * The answer to a question that had two names and one meaning until tonight: `HERD_PER_FARMER` was a
 * cap per *farmer* and `BEASTS_PER_FARM` a cap per *farm*, identical in every village that has ever
 * existed because a farmer had exactly one farm and a farm had exactly one farmer. The day a man can
 * own two, they come apart, and this says which of the two the paddocks meant — **the farm**. Six
 * head is what a farm's rails hold. A man who owns two farms and works one of them has twelve head
 * of room and one pair of hands, and the beasts do not care whose name is on the gate.
 *
 * *Manned* is the other half of it, and it is the half that keeps a village honest: a shed with
 * nobody in it feeds nothing, so a farm whose worker is dead, gone or laid up counts for nought this
 * morning. That is exactly the rule the herd has always run on — `aDaysTrade` has counted only the
 * farmers who could work since `wounds.ts` went in — said about farms instead of about men.
 *
 * Nothing at all for a caller that says nothing about holdings, which has to mean "then ask the
 * question the old way" rather than "then the village has no farms": every test in this economy and
 * every caller with only a list of people in its hand wants the answer it has always had.
 */
export function mannedFarms(
  holdings: readonly Standing[] | undefined, working: readonly Person[],
): Standing[] | null {
  if (holdings === undefined) return null;
  const able = new Set(working.map((person) => person.id));
  return holdings.filter((holding) => holding.kind === 'farm' && able.has(holding.worker ?? ''));
}

/**
 * The village's herd, divided across the farms that keep it.
 *
 * The herd stays one number in the settlement and this shares it out; it is not stored on the farms.
 * Two numbers for one question is how a village ends up with a paddock that disagrees with its own
 * books, and the rule everywhere else in this world is that the derived thing is derived — a
 * village's rank is counted off its roofs, a household's house is counted off the roll, and a farm's
 * beasts are counted off the herd.
 *
 * Divided exactly, with whatever the arithmetic leaves over landing on the oldest farm — and the
 * word is *exactly* rather than "to the hundredth", which is where this was wrong for an afternoon.
 * `shareOut` divides money to the coin because money comes in coins, and copying its rule here was
 * the obvious thing and the wrong one: a herd is not a countable pile. It is a fractional number
 * because a calving is a rate rather than an event, so a village keeps something like 13.371 beasts,
 * and rounding each share to two places left three villages in a two-hundred-and-fifty-day run
 * holding a herd their own paddocks did not add up to. Beasts are counted when the paddock stands
 * them up, which is the paddock's business and nobody else's.
 */
export function shareTheBeasts(holdings: readonly Holding[], herd: number): Map<string, number> {
  const out = new Map<string, number>();
  const farms = holdings.filter((holding) => holding.kind === 'farm');
  if (farms.length === 0 || herd <= 0) return out;
  const each = herd / farms.length;
  let over = herd;
  for (const farm of farms) {
    out.set(farm.id, each);
    over -= each;
  }
  // the last subtraction leaves floating-point dust rather than a real remainder, and the oldest
  // farm carries it for the same reason the last share in `shareOut` does: dust is a beast the
  // world would otherwise have invented or buried
  out.set(farms[0].id, each + over);
  return out;
}
