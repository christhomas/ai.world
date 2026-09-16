import { baby, liveADay, streamFor, takeOffTheRegister, type TheDay } from './aday';
import { addMeals, cellarFor, setStore, takeMeals } from './larder';
import { holdsFor } from './roofs';
import { LIVELIHOOD, aDaysDinner, aDaysTrade, type Trading } from './livelihoods';
import { fillTheGaps } from './births';
import { type Sworn } from './vacancies';
import { OathBook } from './oathbook';
import type { SwornIn } from '../../server/protocol';
import { mayorOf, taxedForTheHall } from './hall';
import { Pressings } from './pressing';
import { whatTheVillageSpends } from './growth';
import { type Rank, type TownVote } from './rank';
import { enactVote, foundingRank, type Ballot } from './votes';
import { VoteBook } from './votebook';
import { doctoredBy, laidUpFor } from './wounds';
import type { Debt } from './debts';
import { walkOver, whoWalksIn } from './movingon';
import { Arrivals, swornTrades, type Arrival } from './arrivals';
import { aCarrierWalks } from './carriers';
import { DayBook } from './daybook';
import { raiseWhoIsDue } from './shrine';
import type { Burial, Change, Hall, Settlement } from './settlement';
import { STONES_KEPT } from './settlement';
import { THE_HALL_OWNER, whatTheVillageHolds, type Holding } from './holdings';
import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { handOnWhatTheyHad } from './inheritance';
import { deedsAfter, homesOf, type Deed, type Home } from './homes';
import type { Structure } from './structures';
import { LIFE, familyName, firstNameOf, foundVillage, givenName, outOfDays, parentsFrom, remember, sexAtBirth, stageOf, surnameOf, tradeTakenUp, type Memory, type Person, type Sex } from './people';
import { compactAll, type Opinion } from './memory';
import { recallFor, toldOf, whoKnows } from './remembering';
import { FORTUNE, canRecover, fortuneOf, grownFolk, type Fortune } from './fortunes';
import type { StablePurchase, StableYard } from './farmbuilds';
import { StableBook } from './stablebook';
import type { FieldClearing } from './fieldbuilds';
/**
 * The living population of the world's villages: who is here today, and who has been born or died
 * since yesterday.
 *
 * Most of this needs no sending between players. The founding families come from the seed, and
 * ordinary births and natural deaths follow from the register's own state and the day. Two sorts
 * of fact do have to be replayed: an unpredictable burial, and a stable commission that consumed
 * timber from the player's persisted yard. Those arrive as dated events and are lived through in
 * the same order whenever this book is reopened.
 */
const FOUNDED_ON = 1;


export type { Burial, Change, Hall, Settlement } from './settlement';

export class Register {
  private readonly villages = new Map<string, Settlement>();
  /** What is standing over each village today, which is the one thing here that comes from outside. */
  private readonly pressure = new Pressings();

  /** Somebody has looked at what the bands are doing, and this is what stands over here today. */
  leanedOn(village: string, pressure: number): void {
    this.pressure.leanedOn(village, pressure, this.day);
  }

  /** How hard a village is being leaned on today. See `Pressings`. */
  pressureOn(village: string): number {
    return this.pressure.now(village, this.day);
  }

  /**
   * Who was killed, and on which day. A violent death is the one thing about a village that
   * cannot be worked out from the seed, so it is kept — and kept by day, because *when* somebody
   * died decides how many children the village had afterwards. A death that arrives late is
   * written in here and the village lived again from the beginning, which is cheap and exactly
   * right, rather than being bolted on to today and quietly disagreeing with everyone else.
   */
  private readonly killed = new Map<string, number>();
  /** Votes survive re-living, one told fact for each declaration in each place. */
  private readonly votes = new VoteBook();
  /** The days a shrine raised somebody, by village — the copy that survives a re-living. */
  private readonly magicked = new Map<string, number[]>();
  /** Farmer stable commissions, told from the kept timber yard and replayed on their morning. */
  private readonly stables = new StableBook();
  /**
   * Which household holds which roof, by village. Item 111.
   *
   * Beside the killings, the votes and the raisings, and for the same reason: a village re-lived
   * from its seed arrives at the same answer for everything *except* what has actually happened to
   * it, and a family keeping its own house across a burial is one of those. The first deeds are
   * written in exactly the order the positional rule would have housed everybody, so nothing moves
   * on the morning this starts being kept — see `deedsAfter`.
  */
  private readonly deeded = new Map<string, Deed[]>();
  /** Told oaths survive re-living because a seed cannot predict who walked in. */
  private readonly swornIn = new OathBook();
  /** The last whole day the register has caught up to. */
  /** Physical ground is supplied by the country; the register only records its deterministic answer. */
  private fieldSurvey: ((village: string, settlement: Settlement) => FieldClearing | null) | null = null;
  private day: number;

  constructor(
    private readonly seed: number,
    day = FOUNDED_ON,
    private readonly onDeparted: (change: Change) => void = () => {},
  ) {
    this.day = Math.floor(day);
    /*
     * What a day in one village is allowed to know about the rest of the world: see `aday.ts`.
     *
     * A small boundary, built once and handed down. A day needs a settlement to change, a handful
     * of numbers and somewhere to write down what the hall took and paid; it never asks who is
     * alive in the next valley. Every new entry must remain a dated fact about this one place,
     * rather than quietly letting a Tuesday reach into the whole book.
     *
     * `today` is a getter rather than a copy, and that is load-bearing: a village re-lived from
     * its founding lives day two while the register stands on day four hundred, and what a village
     * may build is asked against the latter. A number copied in here would have frozen it at the
     * day the register was made.
     */
    const book = this;
    this.theDay = {
      seed: this.seed,
      get today() { return book.day; },
      pressureOn: (village, on) => this.pressure.on(village, on),
      killedOn: (id) => this.killed.get(id),
      taxed: (id, much) => { this.book.tax(id, much); },
      waged: (id, much) => { this.book.wage(id, much); },
      stableBought: (village, on) => this.stables.on(village, on),
      takeOff: (person, on, cause) => this.remove(person, on, cause),
      fieldToClear: (village, settlement) => this.fieldSurvey?.(village, settlement) ?? null,
    };
  }

  /** Restore purchases before catching the register up, so works and payments replay in order. */
  rememberStablePurchases(purchases: readonly StablePurchase[]): void {
    this.stables.remember(purchases);
  }

  /**
   * Ask one village to commission at most one rung, for the first morning not yet lived.
   *
   * `day + 1` rather than today, because `advance` lives every day *after* the one it is standing
   * on — so a purchase dated today is one no advance will ever reach. `stablebook.ts` has the whole
   * of why, and the fault it was found by.
   */
  commissionStable(village: string, yard: StableYard): StablePurchase | null {
    return this.stables.commission(village, this.villages.get(village), this.day + 1, yard);
  }

  /**
   * Villages with a mine on their doorstep, which is what lets them raise miners.
   *
   * The trade needs high ground to be offered at all, and villages are put where people would
   * live rather than where the rock is — so out of seventeen villages, eight had a claimed mine
   * and only four of those had anybody to work it. Four miners in the whole world, which made the
   * one thing that mints money nearly invisible.
   *
   * A cave full of gold within a morning's walk is the reason to be a miner, and it is a better
   * reason than the shape of the ground behind the village. Told to the register from outside
   * because who works which hole is the game's business, not the register's.
   */
  private worksAMine = new Set<string>();
  /** And which have a harbour, however it got there: grown from the seed, or paid for by somebody. */
  private hasAHarbour = new Set<string>();

  /** Which villages have a mine. Must be said before anybody settles, or the founding misses it. */
  minesAt(villages: Iterable<string>): void {
    this.worksAMine = new Set(villages);
  }

  /** And which have a jetty, which is what lets a village keep boats. Same rule: say it first. */
  harboursAt(villages: Iterable<string>): void {
    this.hasAHarbour = new Set(villages);
  }

  /**
   * Introduce a village. The first call founds its families from the seed; later calls just hand
   * back who lives there now, so it is safe to call every time the player walks into the place.
   *
   * A village is always founded as it was on day one and then lived forward to today, however
   * late you arrive. Anything else would mean a place you find in your second week is full of
   * people who have never aged, and two players who arrived on different days would disagree
   * about who lives there.
   */
  settle(village: string, houses: number, trades: string[]): readonly Person[] {
    const known = this.villages.get(village);
    if (known) return known.people;

    // Add exactly one miner without perturbing the weighted founding rolls for every other trade.
    const mining = this.worksAMine.has(village);
    const people = foundVillage(this.seed, village, houses, trades, mining ? ['miner'] : []);
    // a village is founded with a few days in the cellar, not starving on its first morning
    const farmers = people.filter((p) => p.trade === 'farmer').length;
    const settlement: Settlement = {
      // Capacity is what the roofs hold, not the smaller population the founding roll produced.
      people, rank: foundingRank(houses), founded: holdsFor(houses, []), houses, trades, food: people.length * 3, buried: [],
      hall: { id: THE_HALL_OWNER, body: 'mayor-house', purse: 0 },
      // a harbour it already has counts as a thing it has raised: `holdings.ts` will not put a boat
      // anywhere there is nothing to tie one up at, and a seeded jetty is a jetty
      works: this.hasAHarbour.has(village) ? ['jetty'] : [],
      // no tower, so nobody on it. It fills in on the first morning the village can afford both
      watch: '',
      // and no magic has been done here. A raising is remembered across a re-living; see `shrine.ts`
      raised: this.magicked.get(village) ?? [],
      deeds: [...(this.deeded.get(village) ?? [])],
      // nor has anybody walked in off the road and taken work here. An oath survives a re-founding
      // the way a raising does, and the day reads this copy; see `swearIn`
      sworn: this.swornIn.of(village),
      // a few head to build a herd out of, so a new village has something in its paddock on the
      // morning it is founded rather than an empty yard and a month to wait
      herd: farmers * LIVELIHOOD.FIRST_HERD,
    };
    this.villages.set(village, settlement);
    for (let day = FOUNDED_ON + 1; day <= this.day; day++) {
      liveADay(this.theDay, village, settlement, day);
      this.votes.applyOn(village, settlement, day);
    }
    return settlement.people;
  }

  /**
   * Found a village again — on somebody else's list of trades, or on today's rules.
   *
   * The world's word about a village, arriving after this page has already had a go at the same
   * question. Which trades a place can support is read off the land around it — a shore only where
   * there is water, heights only where the ground climbs — so the answer depends on how much of the
   * country the reader has grown, and the founding *rolls off that list*: a village founded on nine
   * trades and the same village founded on six are the same names doing different jobs.
   *
   * Not hypothetical: a page opens its own book the moment it puts anybody in a street, holding a
   * hundred and twenty-one chunks of country where a world holds seven. In Stonemere the page
   * founded it on six trades and the world on ten, and the same twenty-five people came out with
   * different jobs on the two sides of the wire.
   *
   * Re-founding rather than patching, because the trades are an input to the founding and not a
   * field on it. What survives is everything that was told rather than derived, replayed forward by
   * the same machinery a client uses when it learns late about a killing.
   */
  foundOn(village: string, houses: number, trades: string[]): void {
    const known = this.villages.get(village);
    if (known && known.trades.length === trades.length && known.trades.every((t, at) => t === trades[at])) return;
    if (known) this.villages.delete(village);
    this.settle(village, houses, trades);
  }

  /** The day the register has caught up to. */
  get today(): number { return this.day; }

  /**
   * What a day in one village is allowed to know about the rest of the world: see `aday.ts`.
   *
   * Six things, built once and handed down, and the shortness of the list is the point of the cut.
   * A day needs a settlement to change, a handful of numbers and somewhere to write down what the
   * hall took and what it paid; it never asks who is alive in the next valley. The moment a seventh
   * entry is wanted, the day has started asking a question that belongs to the book rather than to
   * a Tuesday in one place, and that is worth noticing rather than quietly answering.
   *
   * `today` is read through a getter rather than copied, because a replay lives day two while the
   * register stands on day four hundred, and what a village may build is asked against the latter.
   */
  private readonly theDay: TheDay;

  /** Somebody is off the register: `aday.ts` writes every book, this finds the village. */
  private remove(person: Person, day: number, cause: 'age' | 'violence' | 'hunger'): Change | null {
    const departed = takeOffTheRegister(this.villages.get(person.village), person, day, cause);
    if (departed) this.onDeparted(departed);
    return departed;
  }

  /**
   * Everybody alive in a village, or an empty list for a village nobody has settled.
   *
   * Readonly on purpose, and not merely as a manner of speaking: this is the register's own list,
   * and burying people while walking it will skip half of them. Take a copy before you change
   * anything about who is alive.
   */
  living(village: string): readonly Person[] {
    return this.villages.get(village)?.people ?? [];
  }

  /**
   * What a village keeps in its paddock and in its cellar.
   *
   * Asked of the register rather than worked out, because both have been lived forward day by day
   * since the place was founded and neither can be reconstructed from anything on the map. The
   * roll wants them: what a farmer earns is what his beasts and his fields fetched, and whether
   * the larder ran out decides whether he was paid at all.
   */
  herdOf(village: string): number { return this.villages.get(village)?.herd ?? 0; }

  /** The houses it was laid out with, which is what founding it again wants. */
  livedIn = (v: string): number => this.villages.get(v)?.houses ?? 0;

  /**
   * What this village is *made of*, for whoever has to work out what a day of it comes to.
   *
   * Typed with the whole holding rather than with the one field the catch happens to read: a
   * settlement carries them entire, and narrowing the type here only forced a cast at the far end
   * where somebody wanted the rest of one.
   */
  madeOf = (v: string): { trades?: readonly string[]; holdings?: readonly Holding[] } =>
    this.villages.get(v) ?? {};

  /**
   * Something carried beasts off, and the paddock is that much emptier.
   *
   * Told rather than worked out, exactly as a violent death is. What it costs is not the cattle but
   * the meat the next valley was going to buy, which is one of three ways money reaches a village
   * at all. See `cattleTaken`. Returns how many it got, never more than were standing there.
   */
  cattleLost(village: string, many: number): number {
    const here = this.villages.get(village);
    if (!here || many <= 0) return 0;
    const taken = Math.min(here.herd, Math.floor(many));
    here.herd -= taken;
    return taken;
  }

  larderOf(village: string): number { return this.villages.get(village)?.food ?? 0; }

  /** What this village's cellar holds when it is full, which is what its people need for a while. */
  cellarOf(village: string): number { return cellarFor(this.villages.get(village)); }

  /** Set the store directly. Tests and the console; nothing in a played day calls it. See `larder.ts`. */
  setLarder(village: string, food: number): void { setStore(this.villages.get(village), food); }

  /** Take meals off a village's shelf, and hand back how many there actually were. See `larder.ts`. */
  takeFromLarder(village: string, meals: number): number { return takeMeals(this.villages.get(village), meals); }

  /** Put meals back on it, and hand back how many it had room for. See `larder.ts`. */
  addToLarder(village: string, meals: number): number { return addMeals(this.villages.get(village), meals); }

  /**
   * What the people of a village owe one another this morning. See `debts.ts`.
   *
   * A read rather than a door. Nothing tells the register about a debt — a claim falls out of a
   * wound and a purse, both of which a re-lived village reproduces for itself — so this exists for
   * the books, which have to forecast a morning that settles some of it.
   */
  owedIn(village: string): readonly Debt[] { return this.villages.get(village)?.debts ?? []; }

  /**
   * What the hall holds, which is the village's own money and nobody's purse.
   *
   * Read by whatever is deciding what the place can afford — a vote, a clerk asked what the village
   * is worth, the Domesday Book. Nought for a village that has never been settled, which is the
   * same answer as a village that has spent everything and is honest about both.
   */
  hallOf(village: string): Hall | null { return this.villages.get(village)?.hall ?? null; }

  /**
   * What moved in and out of each purse on the last day that person lived through: the hall's tax,
   * the hall's wages, and whatever a carrier paid or was paid. Cleared every morning. `daybook.ts`.
   */
  private readonly book = new DayBook();

  /** What the next valley paid this person today, or what they paid it. Nought on most days. */
  carriedBy(id: string): number { return this.book.carriedBy(id); }

  /** How a village is doing, which is a subtraction rather than a system. */
  fortune(village: string): Fortune {
    const here = this.villages.get(village);
    if (!here) return 'well';
    return fortuneOf(here.people.length, here.founded);
  }

  /**
   * Who this village has buried, oldest first.
   *
   * Kept rather than worked out because a death is the one thing about a village that cannot be
   * derived from the seed — and re-living a village from its founding rebuilds this along with
   * everything else, so a client that learns late about a killing ends up with the same stones as
   * everybody who watched it happen.
   */
  churchyard(village: string): readonly Burial[] {
    return this.villages.get(village)?.buried ?? [];
  }

  /** The day a village emptied, or null for one that still has somebody in it. */
  emptiedOn(village: string): number | null {
    return this.villages.get(village)?.emptied ?? null;
  }

  /** Every village this register has been told about, whatever state it is in. */
  settled(): string[] {
    return [...this.villages.keys()];
  }

  /**
   * The trades a village was founded on, or nothing for one nobody has settled.
   *
   * Read back because the founding rolls off this list: a village founded off a different one is
   * the same people doing different jobs. How much land a reader can see decides the list, so it
   * has to be handed to anybody founding the place again.
   */
  tradesOf(village: string): string[] {
    return this.villages.get(village)?.trades ?? [];
  }

  /**
   * Move spare grown people from one village into an empty one.
   *
   * A ruin does not repopulate itself: somebody has to walk there. The rule about who and how many
   * is in `movingon.ts` with the rest of the reasons people move; this is the register applying it,
   * and the reason it is a public door is that the world can ask for a resettling of its own.
   */
  resettle(lost: string, from: string, day: number): Change[] {
    const ruin = this.villages.get(lost);
    const neighbour = this.villages.get(from);
    return ruin && neighbour ? walkOver(lost, ruin, neighbour, day) : [];
  }

  /** Everybody alive anywhere. See `living` about holding on to it. */
  everybody(): readonly Person[] {
    return [...this.villages.values()].flatMap((v) => v.people);
  }

  find(id: string): Person | undefined {
    for (const village of this.villages.values()) {
      const found = village.people.find((p) => p.id === id);
      if (found) return found;
    }
    return undefined;
  }

  /** The three doors into a villager's memory, the one thing nobody can derive. See `remembering.ts`. */
  recall(id: string, what: Memory['what'], about: string, day = this.day): boolean {
    return recallFor(this.find(id), what, about, day);
  }

  told(id: string, mind: { memories: Memory[]; opinions: Opinion[] }): void {
    toldOf(this.find(id), mind);
  }

  /** Who counts this person as somebody they know. Derived rather than stored, so nothing outlives its owner. */
  knownTo(id: string): Person[] {
    const person = this.find(id);
    return person ? whoKnows(this.living(person.village), id) : [];
  }

  /**
   * Catch the world up to a day. Lives run out, and villages that have lost people make up the
   * difference. Both follow from the register's own state, so every client arrives at the same
   * answer without a word passing between them.
   */
  advance(today: number): Change[] {
    const changes: Change[] = [];
    const end = Math.floor(today);

    while (this.day < end) {
      this.day++;
      this.book.clear();
      for (const [name, village] of this.villages) {
        changes.push(...liveADay(this.theDay, name, village, this.day));
        this.votes.applyOn(name, village, this.day);
      }
      // and one cart goes over the hill, now that every village has worked and eaten. Why it is
      // the evening and not the morning is the whole of `carriers.ts`'s seam; see it there
      aCarrierWalks(this.villages, (v) => this.standing.get(v), (v) => this.pressureOn(v), this.book.cartsToday);
      changes.push(...this.peopleWalkIn(this.day));
    }
    return changes;
  }

  /**
   * Where each village stands, for whoever has told it.
   *
   * The register has never known its own geography — it keeps books, and a book does not say where
   * the building is. That was fine until somebody had to *walk*: `movingon.ts` could send the
   * least-prosperous village in the world to an empty one on the far side of it, because nothing
   * measured the walk and so there was no walk.
   *
   * Told rather than worked out, because the ground is `structures.ts`'s and nothing in here may go
   * looking for it. Never told, and every decision that takes a distance behaves exactly as it did
   * before there was one — which is the honest answer for a bench that has no map.
   */
  private standing = new Map<string, { x: number; z: number }>();

  /** Where the villages are, as the world lays them out. Called once the country is grown. */
  theyStandAt(where: Iterable<{ name: string; x: number; z: number }>): void {
    for (const village of where) this.standing.set(village.name, { x: village.x, z: village.z });
  }

  /** Give each replay the same physical answer about which nearby tree a farm can clear. */
  fieldsAreSurveyedBy(
    survey: (village: string, settlement: Settlement) => FieldClearing | null,
  ): void {
    this.fieldSurvey = survey;
  }

  /** Somebody walks over the hill and takes on an empty village, one a day. See `movingon.ts`. */
  private peopleWalkIn(day: number): Change[] {
    const walk = whoWalksIn(this.villages, day, (village) => this.standing.get(village));
    return walk ? this.resettle(walk.to, walk.from, day) : [];
  }

  /** What the hall took from, and paid to, one person on their last day. See `daybook.ts`. */
  taxPaidBy(id: string): number { return this.book.taxPaidBy(id); }
  hallPaid(id: string): number { return this.book.hallPaid(id); }

  /**
   * Who does what here, and which of this ground's trades nobody is doing.
   *
   * The register answers because the register is who is alive. Item 24a. See `oathbook.ts`.
   */
  directoryOf(village: string): { holding: Map<string, string[]>; nobodyDoing: string[]; sworn: Sworn[] } {
    const here = this.villages.get(village);
    return this.swornIn.directory(here?.trades ?? [], here?.people ?? [], village);
  }

  /** Who walked into a village rather than being born in it. See `arrivals.ts`. */
  private readonly arrived = new Arrivals();

  /**
   * Somebody walks into a village and stands on its roll: the hero, and for now nobody else.
   *
   * The keystone of a player having any place in this economy. An `Owner` is a person or the hall,
   * `livelihoods.ts` pays over register people, and holdings hang off owners — so until there was a
   * row there was no trade that could pay him, no farm to hold and no work to post. See
   * `arrivals.ts`, which owns the rest of it.
   */
  arrive(village: string, name: string, sex: Person['sex'], purse: number, day = this.day): Person | null {
    const here = this.villages.get(village);
    return here ? this.arrived.walkIn(village, here, { name, sex, purse }, day) : null;
  }

  /** Everybody who walked in, as told facts, for a save to write down. */
  arrivals(): Array<Arrival & { village: string }> { return this.arrived.all(); }

  /** Take currently vacant work; return the told fact so `apply` remains the single write path. */
  swearIn(village: string, trade: string, who: string, day = this.day): SwornIn | null {
    if (!this.villages.get(village) || who === '') return null;
    if (!this.directoryOf(village).nobodyDoing.includes(trade)) return null;
    const told: SwornIn = { kind: 'sworn', village, trade, who, day: Math.floor(day) };
    return this.apply(told) ? told : null;
  }

  /** Every oath this register holds, as told facts, for a save to write down. See `apply`. */
  oaths(): SwornIn[] { return this.swornIn.all(); }

  /**
   * Who lives in which house here, deeds and all. Item 111.
   *
   * The one place the game should ask, rather than pairing houses against people itself: the
   * pairing is positional until a deed says otherwise, and a caller that does its own arithmetic is
   * a caller that puts a family back in the house they were moved out of.
   *
   * The roofs are handed in because the register has never held any geometry — it knows how many
   * houses a village has, which is all a deed needs, and where the buildings actually stand is the
   * world's business.
   */
  deedsOf(village: string): readonly Deed[] { return this.villages.get(village)?.deeds ?? []; }

  homesOf(village: string, houses: readonly Structure[]): Home[] {
    const here = this.villages.get(village);
    return here ? homesOf(houses, here.people, here.deeds) : [];
  }

  /** What this village has had built out of its own money. */
  worksOf(village: string): readonly string[] { return this.villages.get(village)?.works ?? []; }

  /** Who speaks for this village: the longest-settled trade-holder. See `mayorOf`. */
  mayorOf = (v: string): Person | null => mayorOf(this.villages.get(v)?.people ?? []);

  /** What this place has declared itself to be. Roofs permit town and city; only a vote grants them. */
  rankOf(village: string): Rank { return this.villages.get(village)?.rank ?? 'hamlet'; }

  /** The next motion that can be called here, and who may cast it. See `votebook.ts`. */
  ballotOf(village: string): Ballot | null { return this.votes.ballot(this.villages.get(village)); }

  /** Call the local vote. The caller supplies the player's aye by choosing it in the hall. */
  vote(village: string, day = this.day): TownVote | null {
    return this.votes.call(village, this.villages.get(village), day);
  }

  /** Who is standing on this village's tower today, or nobody. See `whoStandsWatch`. */
  watchOf(village: string): string { return this.villages.get(village)?.watch ?? ''; }

  /** How many this village has room for: what its roofs hold, which moves as it builds. */
  roomIn(village: string): number { return this.villages.get(village)?.founded ?? 0; }

  /**
   * Pay a shrine to raise somebody, and send them to a village. See `shrine.ts` for the price and
   * the argument. Whoever calls this takes the fee: a register has never known what is in a purse.
   */
  raiseAtShrine(village: string, day = this.day): Change[] {
    const here = this.villages.get(village);
    if (!here) return [];
    const on = Math.floor(day);
    const already = this.magicked.get(village) ?? [];
    if (already.includes(on)) return [];
    this.magicked.set(village, [...already, on]);
    here.raised.push(on);
    return raiseWhoIsDue(village, here, on, streamFor(this.seed, `${village}:shrine`, on));
  }

  /** Somebody has been hurt: the middle condition a villager never had. Told, like a death. `wounds.ts`. */
  hurt(id: string, severity: number): number {
    const person = this.find(id);
    if (!person) return 0;
    const here = this.villages.get(person.village);
    const days = laidUpFor(severity, here ? doctoredBy(here.people) : null);
    if (days > (person.hurt ?? 0)) person.hurt = days;
    return person.hurt ?? 0;
  }

  /** A death nothing could have foreseen — teeth, or a blade. This one has to be told to others. */
  bury(id: string, day = this.day): Change | null {
    const person = this.find(id);
    if (!person) return null;
    this.killed.set(id, Math.floor(day));
    return this.remove(person, Math.floor(day), 'violence');
  }

  /** Apply a told death or vote, preserving facts that cannot be reconstructed by re-living. */
  apply(change: Change | TownVote | SwornIn): boolean {
    // Oaths are dated and keyed so the ordinary wire-plus-save duplicate writes only once.
    if (change.kind === 'sworn') {
      if (Math.floor(change.day) > this.day) return false;
      const oath = this.swornIn.take(change.village, change.trade, change.who, change.day);
      if (!oath) return false;
      const here = this.villages.get(change.village);
      if (!here) return true;              // nobody has settled it; kept for the morning they do
      // A late oath changes later apprenticeships, so replay rather than patching today's village.
      if (oath.day === this.day) { here.sworn.push(oath); swornTrades(here, here.sworn); return true; }
      this.relive(change.village);
      return true;
    }
    if (change.kind === 'voted') {
      const voted = { ...change, day: Math.floor(change.day) };
      if (this.votes.has(voted) || !Number.isFinite(voted.day) || voted.day > this.day) return false;
      const here = this.villages.get(voted.village);
      if (here && voted.day === this.day) {
        if (!enactVote(here, voted)) return false;
        this.votes.keep(voted);
        return true;
      }
      this.votes.keep(voted);
      if (!here) return true;
      this.relive(voted.village);
      if (this.villages.get(voted.village)?.rank === voted.rank) return true;
      // An invalid historical vote is not allowed to reserve its key. Re-live once more without it.
      this.votes.drop(voted);
      this.relive(voted.village);
      return false;
    }
    if (change.kind !== 'died' || this.killed.has(change.id)) return false;
    this.killed.set(change.id, change.day);

    const here = this.find(change.id);
    if (here && change.day >= this.day) { this.remove(here, change.day, 'violence'); return true; }

    const village = change.village || here?.village || '';
    if (this.villages.has(village)) this.relive(village);
    return true;
  }

  /** Found a village again without erasing wounds, memories or opinions learned from players. */
  private relive(village: string): void {
    const settlement = this.villages.get(village);
    if (!settlement) return;
    const remembered = new Map(settlement.people.map((person) => [person.id, {
      memories: person.memories,
      opinions: person.opinions,
      hurt: person.hurt,
    }]));
    this.villages.delete(village);
    const people = this.settle(village, settlement.houses, settlement.trades);
    // and whoever walked in, who is not implied by the seed and would otherwise simply be gone
    const now = this.villages.get(village);
    if (now) { this.arrived.putBack(village, now, this.day); swornTrades(now, now.sworn); }
    for (const person of people) {
      const held = remembered.get(person.id);
      if (!held) continue;
      person.memories = held.memories;
      person.opinions = held.opinions;
      if (held.hurt === undefined) delete person.hurt; else person.hurt = held.hurt;
    }
  }

  /**
   * Settle everybody's memory down to what is worth writing, on the day it is being written.
   *
   * What stops "only the living" being a smaller claim than it sounds: a village of twenty is
   * bounded, and twenty people each carrying a history of everything that ever happened near them
   * is not. Ten slights become one opinion here, at the moment the place stops being anybody's
   * business — which is what a province's file would otherwise fill up with.
   *
   * @param day the world day it is being put away on, where every fading starts from next
   */
  compact(day = this.day): void {
    for (const village of this.villages.values()) compactAll(village.people, Math.floor(day));
  }

  /** What to hold on disk: only the living, which is what keeps this small forever. */
  save(): Record<string, Person[]> {
    const out: Record<string, Person[]> = {};
    for (const [name, village] of this.villages) out[name] = village.people;
    return out;
  }
}
