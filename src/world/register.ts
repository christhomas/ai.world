import { PROSPER } from './prosperity';
import { LIVELIHOOD, aDaysDinner, aDaysTrade, type Trading } from './livelihoods';
import { fillTheGaps } from './births';
import { mayorOf, taxedForTheHall } from './hall';
import { Pressings } from './pressing';
import { rankOfVillage, whatTheVillageSpends } from './growth';
import type { Rank } from './rank';
import { doctoredBy, laidUpFor, mendThem } from './wounds';
import { walkOver, whoWalksIn } from './movingon';
import { raiseWhoIsDue } from './shrine';
import type { Burial, Change, Settlement } from './settlement';
import { STONES_KEPT } from './settlement';
import { whatTheVillageHolds, type Holding } from './holdings';
import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { handOnWhatTheyHad } from './inheritance';
import { LIFE, familyName, firstNameOf, foundVillage, givenName, outOfDays, parentsFrom, remember, sexAtBirth, stageOf, surnameOf, tradeTakenUp, type Memory, type Person, type Sex } from './people';
import { compactAll, type Opinion } from './memory';
import { recallFor, toldOf, whoKnows } from './remembering';
import { FORTUNE, canRecover, fortuneOf, grownFolk, type Fortune } from './fortunes';

/**
 * The living population of the world's villages: who is here today, and who has been born or died
 * since yesterday.
 *
 * Almost none of this needs sending between players. The founding families come from the seed, and
 * everything that happens afterwards — a life running out, a village replacing the people it has
 * lost — follows from the register's own state and the day. Two players who have replayed the same
 * changes hold the same village, in the same way that two players grow the same hills.
 *
 * The exception is a death nobody could have predicted: a wolf, a bandit, a player. Those arrive
 * as `bury`, and travel on the world's log of changes like anything else a player did.
 */
const FOUNDED_ON = 1;


export type { Burial, Change, Settlement } from './settlement';

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
  /** The days a shrine raised somebody, by village — the copy that survives a re-living. */
  private readonly magicked = new Map<string, number[]>();
  /** The last whole day the register has caught up to. */
  private day: number;

  constructor(private readonly seed: number, day = FOUNDED_ON) {
    this.day = Math.floor(day);
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

    /**
     * A village with a mine has somebody down it — exactly one somebody, and the rest of the
     * village is founded as though the mine were not there.
     *
     * Putting `miner` into the weighted list instead was the obvious move and it was wrong: adding
     * an option reshuffles every draw, so mining villages came out with systematically fewer of
     * everything else. Ashford lost its only farmer to it and Fernreach ended up with five miners
     * out of twelve adults, which is not a village with a mine, it is a mine with a village.
     */
    const mining = this.worksAMine.has(village);
    const people = foundVillage(this.seed, village, houses, trades, mining ? ['miner'] : []);
    // a village is founded with a few days in the cellar, not starving on its first morning
    const farmers = people.filter((p) => p.trade === 'farmer').length;
    const settlement: Settlement = {
      people, founded: people.length, houses, trades, food: people.length * 3, buried: [], purse: 0,
      // a harbour it already has counts as a thing it has raised: `holdings.ts` will not put a boat
      // anywhere there is nothing to tie one up at, and a seeded jetty is a jetty
      works: this.hasAHarbour.has(village) ? ['jetty'] : [],
      // no tower, so nobody on it. It fills in on the first morning the village can afford both
      watch: '',
      // and no magic has been done here. A raising is remembered across a re-living; see `shrine.ts`
      raised: this.magicked.get(village) ?? [],
      // a few head to build a herd out of, so a new village has something in its paddock on the
      // morning it is founded rather than an empty yard and a month to wait
      herd: farmers * LIVELIHOOD.FIRST_HERD,
    };
    this.villages.set(village, settlement);
    for (let day = FOUNDED_ON + 1; day <= this.day; day++) this.liveADay(village, settlement, day);
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

  /**
   * What the hall holds, which is the village's own money and nobody's purse.
   *
   * Read by whatever is deciding what the place can afford — a vote, a clerk asked what the village
   * is worth, the Domesday Book. Nought for a village that has never been settled, which is the
   * same answer as a village that has spent everything and is honest about both.
   */
  hallOf(village: string): number { return this.villages.get(village)?.purse ?? 0; }

  /**
   * What the hall took from each purse on the last day that person lived through.
   *
   * Per person rather than per village, because the books are kept per person. A village total
   * cannot be squared against a roll that has lost somebody overnight — every attempt at it turns
   * into an argument about who was still standing when the money moved — and a row that carries its
   * own tax needs no such argument. `chore test economy` is the only thing that reads it, and it is
   * the only thing that ever needed to.
   */
  private readonly paid = new Map<string, number>();
  /** And what it paid out, per person, on that same day. Cleared every morning. */
  private readonly earned = new Map<string, number>();

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
      for (const [name, village] of this.villages) changes.push(...this.liveADay(name, village, this.day));
      changes.push(...this.peopleWalkIn(this.day));
    }
    return changes;
  }

  /** Somebody walks over the hill and takes on an empty village, one a day. See `movingon.ts`. */
  private peopleWalkIn(day: number): Change[] {
    const walk = whoWalksIn(this.villages, day);
    return walk ? this.resettle(walk.to, walk.from, day) : [];
  }

  /**
   * Move money into and out of the purses of a village, by id.
   *
   * The one place a purse is written, so the cap and the floor are applied once. Both are
   * deliberately kept: a purse that could go negative would be somebody in debt, which this world
   * has no idea what to do with, and the cap is what stops one long-lived shopkeeper in a quiet
   * corner ending the century with everything.
   */
  private pay(village: Settlement, owed: ReadonlyMap<string, number>): void {
    for (const person of village.people) {
      const much = owed.get(person.id);
      if (much === undefined || much === 0) continue;
      person.purse = Math.min(PROSPER.MOST, Math.max(0, person.purse + much));
    }
  }

  /**
   * A day's work for everybody still working in a village, and what it did to the herd.
   *
   * Nobody earns while the place is being raided, which is the whole reason a village under
   * pressure stays poor and one left alone slowly does not: prosperity is a thing the player can
   * protect rather than a number that only goes up.
   *
   * What is settled here is everything that does not wait for dinner: what a trade brings in from
   * beyond the village, what the next valley paid for the meat, and everybody's keep going into
   * the purses of whoever sold it to them. What the village pays for its own dinner cannot be
   * settled until it has eaten, so `dinner` does that half.
   */
  private trade(village: Settlement, pressure: number): Trading {
    // the village as well, because what a coast eats is a fact about the place rather than about
    // anybody in it: see `harvest.ts`, where the herd and the boats sit side by side
    const trading = aDaysTrade(village.people, village.herd, pressure, village);
    village.herd = trading.herd;
    this.pay(village, trading.paid);
    // and the hall's share of what is left, which is the same act as every other coin that moves
    // here: out of the purses it came from, into the one place that is not anybody's
    const tax = taxedForTheHall(village.people);
    this.pay(village, tax.owed);
    // the hall's share of the day, and what its own farms made: a village that owns a farm takes
    // what the farm takes, which is the whole of what owning one means. See `shareTheTake`
    village.purse = Math.round((village.purse + tax.raised + trading.toTheHall) * 100) / 100;
    for (const person of village.people) this.paid.set(person.id, -(tax.owed.get(person.id) ?? 0));
    this.build(village);
    return trading;
  }

  /** What the hall took from one person on the last day they lived through. */
  taxPaidBy(id: string): number { return this.paid.get(id) ?? 0; }

  /** And what it paid them, for work the village bought. Nought on nearly every day. */
  hallPaid(id: string): number { return this.earned.get(id) ?? 0; }

  /** What this village has had built out of its own money. */
  worksOf(village: string): readonly string[] { return this.villages.get(village)?.works ?? []; }

  /** Who speaks for this village: the longest-settled trade-holder. See `mayorOf`. */
  mayorOf = (v: string): Person | null => mayorOf(this.villages.get(v)?.people ?? []);

  /** What this place has grown into, counted off what is standing rather than declared. See `rank.ts`. */
  rankOf(village: string): Rank {
    const here = this.villages.get(village);
    return here ? rankOfVillage(here.houses, here.works) : 'hamlet';
  }

  /** Who is standing on this village's tower today, or nobody. See `whoStandsWatch`. */
  watchOf(village: string): string { return this.villages.get(village)?.watch ?? ''; }

  /** How many this village has room for: what its roofs hold, which moves as it builds. */
  roomIn(village: string): number { return this.villages.get(village)?.founded ?? 0; }

  /**
   * The village spends what it has raised: a roof, a wage, or something it merely wants.
   *
   * One thing a day at most and only what it can pay for outright, because a village does not
   * borrow. The money never leaves the world — it goes back to whoever holds a trade, the shape
   * every village-wide payment here takes — and that is what stops the treasury being a hole money
   * falls into, which `chore sanity` once measured at sixty-two per cent of all the coin there is.
   * The order and the reasoning are in `growth.ts` and `hall.ts`; this only applies the answer.
   */
  private build(village: Settlement): void {
    // nought for everybody here first, and only for the people of *this* village: it cleared the
    // whole map to begin with, which quietly wiped what another village had paid out the same
    // morning. The audit caught it as twenty-six people getting nine hundred gold between them
    // with nothing in any book to explain it
    for (const person of village.people) this.earned.set(person.id, 0);
    // the house it needs, the wage on the tower and whatever it wants, in the order a village would
    // do them: see `whatTheVillageSpends`, where the argument about which comes first is written
    // down. A roof before a well, because a village houses its people before it pleases them
    const spending = whatTheVillageSpends(
      village.purse, village.works, village.houses, village.founded, village.people, village.food,
      village.holdings ?? [], village.herd, this.day);
    village.watch = spending.watch;
    // a villager founding a holding spends none of the hall's money, so what the hall spent is no
    // longer the whole test for "nothing happened here this morning"
    if (spending.spent === 0 && spending.founded.length === 0) return;
    village.purse = Math.round((village.purse - spending.spent) * 100) / 100;
    village.works.push(...spending.works);
    // a raised roof is a raised ceiling: what the village can hold is what its houses hold, and
    // this is the one line that lets a village become bigger than it was founded. See `growth.ts`
    village.founded += spending.holdsMore;
    this.pay(village, spending.wages);
    for (const [id, much] of spending.wages) this.earned.set(id, much);
    // and whatever was founded this morning, which is the one thing a village gains that it did not
    // already hold: a farm bought by a man who has earned one, or by the hall out of a good decade
    village.holdings = [...(village.holdings ?? []), ...spending.founded];
  }

  /**
   * One day in one village: the old are buried, the gaps are filled, the young grow up, and
   * whatever had teeth is accounted for last.
   *
   * Killings come last because that is when they actually happen — somebody dies during a day
   * that has already been lived — and a village re-lived from its founding has to arrive at the
   * same place as the village that watched it happen. The gap is filled the following morning.
   */

  private liveADay(name: string, village: Settlement, day: number): Change[] {
    // one pressing, read once, and handed to both the halves of the day it changes: what a village
    // earns and what it grows. Read twice out of a map, they could disagree with each other
    const pressure = this.pressure.on(name, day);
    const work = this.trade(village, pressure);
    const changes = [
      ...this.buryTheOld(village, day),
      ...this.dinner(village, day, work),
      ...this.fillTheGaps(name, village, day, pressure),
      ...this.growUp(name, village, day),
      ...this.takeTheKilled(village, day),
      ...this.mendThePeople(village),
      ...raiseWhoIsDue(name, village, day, this.streamFor(`${name}:shrine`, day)),
    ];
    // and who holds what, re-hung after the funerals and the growing-up so that the day's dead and
    // the day's new adults are both settled before a farm changes hands. See `holdings.ts`
    village.holdings = whatTheVillageHolds(name, village, day);
    // A village losing its last soul is worth saying out loud, once. It is noticed here rather
    // than counted at the top of the day because the killing that emptied it may have happened
    // hours ago, out in the world, with nobody keeping score.
    if (village.people.length === 0 && village.emptied === undefined) {
      village.emptied = day;
      changes.push({ kind: 'lost', id: name, name, village: name, day });
    }
    return changes;
  }

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
    return raiseWhoIsDue(village, here, on, this.streamFor(`${village}:shrine`, on));
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

  /** The ones something with teeth got to, on the day it got to them. */
  private takeTheKilled(village: Settlement, day: number): Change[] {
    const gone = village.people.filter((p) => this.killed.get(p.id) === day);
    return gone.map((p) => this.remove(p, day, 'violence')).filter((c): c is Change => c !== null);
  }

  /** A death nothing could have foreseen — teeth, or a blade. This one has to be told to others. */
  bury(id: string, day = this.day): Change | null {
    const person = this.find(id);
    if (!person) return null;
    this.killed.set(id, Math.floor(day));
    return this.remove(person, Math.floor(day), 'violence');
  }

  /**
   * A death that happened on somebody else's screen. If it happened today it simply happens; if it
   * happened before we got here, the village is lived again from its founding with the death in
   * its right place, so this client ends up holding the village everybody else is holding.
   */
  apply(change: Change): void {
    if (change.kind !== 'died') return;
    if (this.killed.has(change.id)) return;                  // already accounted for
    this.killed.set(change.id, change.day);

    const here = this.find(change.id);
    if (here && change.day >= this.day) { this.remove(here, change.day, 'violence'); return; }

    const village = change.village || here?.village || '';
    if (this.villages.has(village)) this.relive(village);
  }

  /** Found a village again and live it forward to today, now that we know more about its past. */
  private relive(village: string): void {
    const settlement = this.villages.get(village);
    if (!settlement) return;
    this.villages.delete(village);
    this.settle(village, settlement.houses, settlement.trades);
  }

  /** A day of mending, and the doctor's fee for the morning he set a bone. See `wounds.ts`. */
  private mendThePeople(village: Settlement): Change[] {
    this.pay(village, mendThem(village.people));
    return [];
  }

  /**
   * What a village grew and what it ate.
   *
   * The drain the whole economy needed: gold matters because bread costs money, and prosperity
   * matters because a poor village buries people. Whoever cannot pay for what there is goes
   * without, and long enough without is what kills them.
   */
  private dinner(village: Settlement, day: number, work: Trading): Change[] {
    const meal = aDaysDinner(village.people, village.food, work);
    village.food = meal.food;
    // what dinner cost goes to whoever's dinner it was: the fields, the woods and the herd
    this.pay(village, meal.paid);
    return meal.starved
      .map((p) => this.remove(p, day, 'hunger'))
      .filter((c): c is Change => c !== null);
  }

  private buryTheOld(village: Settlement, day: number): Change[] {
    const gone = village.people.filter((p) => outOfDays(p, day));
    return gone.map((p) => this.remove(p, day, 'age')).filter((c): c is Change => c !== null);
  }

    /** Who is born here this morning, which is a question about families. See `births.ts`. */
  private fillTheGaps(name: string, village: Settlement, day: number, pressure: number): Change[] {
    return fillTheGaps({ seed: this.seed, streamFor: (v, d) => this.streamFor(v, d), baby: (...a) => this.baby(...a) },
      name, village, day, pressure);
  }

  /**
   * A day of growing up: children come of age and take a trade, and anybody short of company
   * meets a neighbour.
   *
   * The meeting matters more than it looks. Without it a village slowly forgets itself — somebody
   * born after their parents have died starts life knowing nobody, and never meets a soul, so
   * there is nobody to tell you about them and nobody for them to mourn.
   */
  private growUp(name: string, village: Settlement, day: number): Change[] {
    const rng = this.streamFor(name, day);

    for (const person of village.people) {
      if (person.trade === '' && stageOf(person, day) === 'adult' && village.trades.length > 0) {
        person.trade = tradeTakenUp(person, village.trades, village, rng);
      }
      if (person.knows.length >= LIFE.KNOWS) continue;

      const strangers = village.people.filter((p) => p !== person && !person.knows.includes(p.id));
      if (strangers.length === 0) continue;
      person.knows.push(strangers[Math.floor(rng() * strangers.length)].id);
    }
    return [];                                   // growing up is nobody's news
  }

  /**
   * Take somebody off the register and leave them in the memory of the people who knew them.
   * There is no book of the dead: asking a villager is how you find out somebody is gone.
   */
  private remove(person: Person, day: number, cause: 'age' | 'violence' | 'hunger'): Change | null {
    const village = this.villages.get(person.village);
    if (!village) return null;
    const at = village.people.indexOf(person);
    if (at < 0) return null;

    village.people.splice(at, 1);
    const estate = handOnWhatTheyHad(person, village, day);
    // the parish register, written where every death already passes so it cannot disagree with
    // who is alive
    village.buried.push({
      name: person.name, trade: person.trade, born: person.born, day, cause,
      left: estate.left, to: estate.to,
    });
    if (village.buried.length > STONES_KEPT) village.buried.shift();
    for (const survivor of village.people) {
      const knew = survivor.knows.indexOf(person.id);
      if (knew < 0) continue;
      survivor.knows.splice(knew, 1);           // the id would dangle; the name in the memory will not
      remember(survivor, { what: 'died', who: person.name, day });
    }
    return { kind: 'died', id: person.id, name: person.name, village: person.village, day, cause };
  }

  private baby(id: string, name: string, village: string, day: number, sex: Sex): Person {
    const rng = this.streamFor(village, day);
    return {
      id, name, village, sex,                    // told rather than rolled: this stream restarts each birth
      trade: '',                                 // a trade comes with growing up
      born: day,
      lives: Math.round(LIFE.SHORTEST_LIFE + rng() * (LIFE.LONGEST_LIFE - LIFE.SHORTEST_LIFE)),
      mother: '', father: '', knows: [], memories: [], opinions: [],
      purse: 0, hungry: 0,                                  // a baby has nothing; a trade is what starts it
    };
  }

  /** A stream of its own for one village on one day, so villages never share rolls. */
  private streamFor(village: string, day: number): () => number {
    let hash = 0x811c9dc5 ^ day;
    for (let i = 0; i < village.length; i++) {
      hash ^= village.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return mulberry32(derive(this.seed, SALT.PEOPLE) ^ (hash >>> 0));
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

