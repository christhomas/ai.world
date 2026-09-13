import { baby, liveADay, streamFor, takeOffTheRegister, type TheDay } from './aday';
import { holdsFor } from './roofs';
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
    /*
     * What a day in one village is allowed to know about the rest of the world: see `aday.ts`.
     *
     * Six things, built once and handed down, and the shortness of the list is the point of the
     * cut. A day needs a settlement to change, a handful of numbers and somewhere to write down
     * what the hall took and what it paid; it never asks who is alive in the next valley. The
     * moment a seventh entry is wanted, the day has started asking a question that belongs to the
     * book rather than to a Tuesday in one place, and that is worth noticing rather than quietly
     * answering.
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
      taxed: (id, much) => { this.paid.set(id, much); },
      waged: (id, much) => { this.earned.set(id, much); },
      takeOff: (person, on, cause) => this.remove(person, on, cause),
    };
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
      /*
       * The ceiling is what the roofs hold, which is what the field has always said it means.
       *
       * It was the number of people the founding happened to generate, and the two are not the same
       * number: a village laid out with five houses holds twenty and is founded with twelve in it.
       * The gap froze villages solid. Births aim at `founded`, so they stopped at twelve; and
       * whether anybody *wants* a roof is asked of the family under it, which had sixteen beds and
       * twelve people in them — so nothing was ever wanted, no roof was ever raised, and the
       * ceiling never moved. Saltcombe on seed 7 stood at twelve souls for four hundred and fifty
       * days with five thousand gold in its hall, and Oakcross on seed 1234 did the same.
       *
       * The sanity bench had been reporting the gap as a NOTE since the day it could see it —
       * *"every village is founded holding fewer people than its own houses have beds for"* — with
       * the right diagnosis written beside it: the field describes the value it takes after the
       * first roof goes up rather than the one it starts with. It was the founding that was wrong.
       */
      people, founded: holdsFor(houses, []), houses, trades, food: people.length * 3, buried: [], purse: 0,
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
    for (let day = FOUNDED_ON + 1; day <= this.day; day++) liveADay(this.theDay, village, settlement, day);
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
    return takeOffTheRegister(this.villages.get(person.village), person, day, cause);
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
      for (const [name, village] of this.villages) changes.push(...liveADay(this.theDay, name, village, this.day));
      changes.push(...this.peopleWalkIn(this.day));
    }
    return changes;
  }

  /** Somebody walks over the hill and takes on an empty village, one a day. See `movingon.ts`. */
  private peopleWalkIn(day: number): Change[] {
    const walk = whoWalksIn(this.villages, day);
    return walk ? this.resettle(walk.to, walk.from, day) : [];
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

