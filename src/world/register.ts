import { PROSPER } from './prosperity';
import { LIVELIHOOD, aDaysDinner, aDaysTrade, type Trading } from './livelihoods';
import { taxedForTheHall } from './hall';
import type { Burial, Change, Settlement } from './settlement';
import { STONES_KEPT } from './settlement';
import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { handOnWhatTheyHad } from './inheritance';
import { LIFE, familyName, firstNameOf, foundVillage, givenName, outOfDays, remember, stageOf, surnameOf, type Memory, type Person } from './people';
import { compactAll, type Opinion } from './memory';
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

/** At most this share of a village's founding size can be born in one day. */
const BIRTH_RATE = 0.06;

export type { Burial, Change, Settlement } from './settlement';

export class Register {
  private readonly villages = new Map<string, Settlement>();
  /**
   * How hard each village is being leaned on, nought to one, as roaming.ts reckons it — and the
   * day somebody said so, which is the whole of what makes it safe to keep.
   *
   * Told rather than worked out: what a warband is doing is the game's business and this only
   * keeps the register. It matters here because nobody trades while their neighbours are being
   * buried, which is what makes a village's prosperity something the player can protect.
   *
   * Dated, because nothing in this world ever says a band has *gone*. `roaming.pressings` hands
   * back the villages a band is standing over and says nothing whatever about the rest, so an
   * undated pressing is one that never lifts. `chore test economy` found what that cost: one
   * morning's band over Thornby, and the place was empty by the fiftieth day with twenty-one of
   * its twenty-seven stones reading starved — nobody had earned or farmed a thing since, because
   * the register still believed the band was standing there. Worse, `settle` relives a village
   * from its founding, so walking into a village a band happened to be near meant re-living all
   * forty of its days under today's siege: sixteen graves and nobody alive, on arrival.
   *
   * So a pressing is about one day — the day after it was told, which is the next one the
   * register will live — and has to be said again tomorrow. The game says it every frame, so a
   * band that is still there presses again in the morning and one that has moved on stops
   * mattering without anybody having to notice that it left.
   */
  private readonly pressure = new Map<string, { pressure: number; told: number }>();

  /** Somebody has looked at what the bands are doing, and this is what stands over here today. */
  leanedOn(village: string, pressure: number): void {
    this.pressure.set(village, { pressure, told: this.day });
  }

  /**
   * How hard a village is being leaned on now, for whoever is writing its books.
   *
   * "Now" is the day the register is about to live, because that is the day the answer changes
   * anything: a pressing that has already been spent on a day gone by is history, and the roll
   * would be quoting a wage nobody is going to be paid. The game re-tells this every frame, so
   * the counter always has today's news in front of it.
   */
  pressureOn(village: string): number {
    const told = this.pressure.get(village);
    return told !== undefined && told.told === this.day ? told.pressure : 0;
  }

  /** And what it comes to on one particular day, which is the only day it was ever about. */
  private pressingOn(village: string, day: number): number {
    const told = this.pressure.get(village);
    return told !== undefined && told.told + 1 === day ? told.pressure : 0;
  }

  /**
   * Who was killed, and on which day. A violent death is the one thing about a village that
   * cannot be worked out from the seed, so it is kept — and kept by day, because *when* somebody
   * died decides how many children the village had afterwards. A death that arrives late is
   * written in here and the village lived again from the beginning, which is cheap and exactly
   * right, rather than being bolted on to today and quietly disagreeing with everyone else.
   */
  private readonly killed = new Map<string, number>();
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

  /** Which villages have a mine. Must be said before anybody settles, or the founding misses it. */
  minesAt(villages: Iterable<string>): void {
    this.worksAMine = new Set(villages);
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
      // a few head to build a herd out of, so a new village has something in its paddock on the
      // morning it is founded rather than an empty yard and a month to wait
      herd: farmers * LIVELIHOOD.FIRST_HERD,
    };
    this.villages.set(village, settlement);
    for (let day = FOUNDED_ON + 1; day <= this.day; day++) this.liveADay(village, settlement, day);
    return settlement.people;
  }

  /**
   * Found a village on somebody else's list of trades, replacing one founded on a different list.
   *
   * The world's word about a village, arriving after this page has already had a go at the same
   * question. Which trades a place can support is read off the land around it — a shore only where
   * there is water, heights only where the ground climbs — so the answer depends on how much of the
   * country the reader has grown, and the founding *rolls off that list*: a village founded on nine
   * trades and the same village founded on six are the same names doing different jobs.
   *
   * That is not hypothetical and it is not rare. A page opens its own book the moment it puts
   * anybody in a street, which it does for the second or so before a world has said anything at all
   * — and it does it holding a hundred and twenty-one chunks of country where the world holds seven.
   * Measured in Stonemere: the page founded it on six trades and the world on ten, and the same
   * twenty-five people came out with different jobs on the two sides of the wire.
   *
   * Re-founding rather than patching, because the trades are an input to the founding and not a
   * field on it. What survives is everything that was told rather than derived: the deaths are
   * replayed from `killed` on the way forward, which is the same machinery a client uses when it
   * learns late about a killing.
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
   * Read back because the founding rolls off this list and a village founded off a different one is
   * a different village — different names on the same people. The list is worked out from the land
   * round the place, and how much land a reader can see depends on how much of it they have grown,
   * so the answer has to be handed from whoever founded it to anybody who has to found it again.
   */
  tradesOf(village: string): string[] {
    return this.villages.get(village)?.trades ?? [];
  }

  /**
   * Move spare grown people from one village into an empty one.
   *
   * A ruin does not repopulate itself: somebody has to walk there. So this is the only way a lost
   * village comes back, and it costs the neighbour the people it sends, which is what stops a
   * region quietly healing everything at once while the player is elsewhere.
   */
  resettle(lost: string, from: string, day: number): Change[] {
    const ruin = this.villages.get(lost);
    const neighbour = this.villages.get(from);
    if (!ruin || !neighbour || ruin.people.length > 0) return [];
    if (day - (ruin.emptied ?? day) < FORTUNE.RESETTLE_AFTER) return [];

    const grown = grownFolk(neighbour.people, day, LIFE.CHILD_UNTIL);
    const spare = Math.floor(neighbour.people.length - neighbour.founded * FORTUNE.SPARE_ABOVE);
    const sending = Math.min(spare, Math.max(0, grown.length - 2), Math.ceil(ruin.founded / 3));
    if (sending <= 0) return [];

    const changes: Change[] = [];
    for (const settler of grown.slice(0, sending)) {
      neighbour.people.splice(neighbour.people.indexOf(settler), 1);
      // they keep their name and their memories: this is the same person, in a new place
      settler.village = lost;
      settler.knows = [];
      ruin.people.push(settler);
      changes.push({ kind: 'resettled', id: settler.id, name: settler.name, village: lost, day });
    }
    ruin.emptied = undefined;
    return changes;
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

  /**
   * Something happened that one of these people will not forget.
   *
   * The one door into a villager's memory from outside the register, and it exists because a memory
   * is the one thing about a villager that no client can work out for itself. Who lives here, what
   * they do and when they die all follow from the seed and a short list of deaths; what a man thinks
   * of *you* follows from what you did, and what you did happened on your screen.
   *
   * So the world that owns the villagers owns this, and everybody else is told. A client with no
   * world behind it calls it on its own register and is the world, which is what playing alone is.
   *
   * @returns whether there was anybody of that name still alive to remember it
   */
  recall(id: string, what: Memory['what'], about: string, day = this.day): boolean {
    const person = this.find(id);
    if (!person) return false;
    remember(person, { what, who: about, day: Math.floor(day) });
    return true;
  }

  /**
   * What the world says one of these people holds, put back where a conversation will find it.
   *
   * The receiving end of the above. A client derives the same villager the world did — same seed,
   * same deaths, same days lived — so everything about him already agrees except the part that was
   * never derivable, and this is that part arriving. It replaces rather than merges, because the
   * world's copy is the whole of what he holds by definition: anything this client thought he
   * remembered and the world does not is a thing this client made up.
   */
  told(id: string, mind: { memories: Memory[]; opinions: Opinion[] }): void {
    const person = this.find(id);
    if (!person) return;
    person.memories = mind.memories;
    person.opinions = mind.opinions;
  }

  /**
   * Who counts this person as somebody they know. Derived rather than stored: keeping both
   * directions in step is work, and a link nobody prunes is a name that outlives its owner.
   */
  knownTo(id: string): Person[] {
    const person = this.find(id);
    if (!person) return [];
    return this.living(person.village).filter((p) => p.knows.includes(id));
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
    }
    return changes;
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
    const trading = aDaysTrade(village.people, village.herd, pressure);
    village.herd = trading.herd;
    this.pay(village, trading.paid);
    // and the hall's share of what is left, which is the same act as every other coin that moves
    // here: out of the purses it came from, into the one place that is not anybody's
    const tax = taxedForTheHall(village.people);
    this.pay(village, tax.owed);
    village.purse = Math.round((village.purse + tax.raised) * 100) / 100;
    for (const person of village.people) this.paid.set(person.id, -(tax.owed.get(person.id) ?? 0));
    return trading;
  }

  /** What the hall took from one person on the last day they lived through. */
  taxPaidBy(id: string): number { return this.paid.get(id) ?? 0; }

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
    const pressure = this.pressingOn(name, day);
    const work = this.trade(village, pressure);
    const changes = [
      ...this.buryTheOld(village, day),
      ...this.dinner(village, day, work),
      ...this.fillTheGaps(name, village, day, pressure),
      ...this.growUp(name, village, day),
      ...this.takeTheKilled(village, day),
    ];
    // A village losing its last soul is worth saying out loud, once. It is noticed here rather
    // than counted at the top of the day because the killing that emptied it may have happened
    // hours ago, out in the world, with nobody keeping score.
    if (village.people.length === 0 && village.emptied === undefined) {
      village.emptied = day;
      changes.push({ kind: 'lost', id: name, name, village: name, day });
    }
    return changes;
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

  /** A village replaces what it has lost, at a pace: a hard winter means a run of births. */
  private fillTheGaps(name: string, village: Settlement, day: number, pressure: number): Change[] {
    const missing = village.founded - village.people.length;
    if (missing <= 0) return [];
    /*
     * No births while it is being raided, and births again the moment it is not.
     *
     * This used to test how far the village had fallen: below a line, none ever again — so a place
     * stayed barren after the thing killing it was dealt with, and every troubled village drained
     * away. Seed 1's Crossroads Town: thirty people, seven by day sixty, none by day one hundred
     * and twenty. Pressure is the honest test, and it makes a rescue worth making up to the last
     * family.
     */
    if (pressure > PROSPER.UNTROUBLED) return [];
    // and a place with nobody left in it is a ruin rather than a village: somebody has to be there
    // for anybody to be born
    if (village.people.length === 0) return [];

    const rng = this.streamFor(name, day);
    const wanted = Math.min(missing, Math.max(1, Math.round(village.founded * BIRTH_RATE)));
    const changes: Change[] = [];

    for (let n = 0; n < wanted; n++) {
      const parents = village.people.filter((p) => stageOf(p, day) === 'adult');
      if (parents.length < 2) break;            // a village of children does not repopulate itself

      const mother = parents[Math.floor(rng() * parents.length)];
      const father = parents[Math.floor(rng() * parents.length)];
      const id = `${name.replace(/[^A-Za-z]/g, '')}-${day}-${n}`;
      // a child takes their mother's family name, so a village keeps its families legible
      const surname = surnameOf(mother) || familyName(rng);
      const household = village.people.filter((p) => surnameOf(p) === surname).map(firstNameOf);
      const child = this.baby(id, `${givenName(rng, household)} ${surname}`, name, day);
      child.mother = mother.name;
      child.father = father !== mother ? father.name : '';
      child.lives = Math.round(LIFE.SHORTEST_LIFE + rng() * (LIFE.LONGEST_LIFE - LIFE.SHORTEST_LIFE));
      child.knows = [mother.id, father.id].filter((known, at, all) => all.indexOf(known) === at);
      village.people.push(child);

      for (const parent of [mother, father]) {
        remember(parent, { what: 'born', who: child.name, day: day });
      }
      changes.push({ kind: 'born', id: child.id, name: child.name, village: name, day: day });
    }
    return changes;
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
        person.trade = village.trades[Math.floor(rng() * village.trades.length)];
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

  private baby(id: string, name: string, village: string, day: number): Person {
    const rng = this.streamFor(village, day);
    return {
      id, name, village,
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
   * This is what stops "only the living" from being a smaller claim than it sounds. A village of
   * twenty is bounded; twenty people each carrying a history of everything that ever happened near
   * them is not, and that history is exactly what a province's file would fill up with once
   * villagers are the server's (C5). Ten slights become one opinion here, at the moment the place
   * stops being anybody's business.
   *
   * The natural caller is a province being written out with nobody in it — `writeProvince` and
   * `keepNear` in `server/world.ts`. Nothing there holds a register yet, so this is also callable
   * from wherever a client puts a village down.
   *
   * @param day the world day it is being put away on, which is where every fading starts from next
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

