import { PROSPER, earnedInADay } from './prosperity';
import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { LIFE, familyName, firstNameOf, foundVillage, givenName, outOfDays, remember, stageOf, surnameOf, type Person } from './people';
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

/** Something that happened to the population, worth telling the player and worth logging. */
export interface Change {
  kind: 'born' | 'died' | 'lost' | 'resettled';
  id: string;
  name: string;
  village: string;
  day: number;
  /** How they went, for a death: their years, or something with teeth. */
  cause?: 'age' | 'violence';
}

/** A village the register has been told about, so it knows how big to keep it. */
interface Settlement {
  people: Person[];
  /** The day the last of them died, for a place that has been emptied. */
  emptied?: number;
  /** The size it was founded at. Births aim to hold it near this. */
  founded: number;
  houses: number;
  trades: string[];
}

/** The day every village is founded on, whenever the player happens to arrive. */
const FOUNDED_ON = 1;

/** At most this share of a village's founding size can be born in one day. */
const BIRTH_RATE = 0.06;

export class Register {
  private readonly villages = new Map<string, Settlement>();
  /**
   * How hard each village is being leaned on today, nought to one, as roaming.ts reckons it.
   *
   * Told rather than worked out: what a warband is doing is the game's business and this only
   * keeps the register. It matters here because nobody trades while their neighbours are being
   * buried, which is what makes a village's prosperity something the player can protect.
   */
  private readonly pressure = new Map<string, number>();

  /** Somebody has looked at what the bands are doing today. */
  leanedOn(village: string, pressure: number): void {
    this.pressure.set(village, pressure);
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

    const people = foundVillage(this.seed, village, houses, trades);
    const settlement: Settlement = { people, founded: people.length, houses, trades };
    this.villages.set(village, settlement);
    for (let day = FOUNDED_ON + 1; day <= this.day; day++) this.liveADay(village, settlement, day);
    return settlement.people;
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

  /** How a village is doing, which is a subtraction rather than a system. */
  fortune(village: string): Fortune {
    const here = this.villages.get(village);
    if (!here) return 'well';
    return fortuneOf(here.people.length, here.founded);
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
   * One day in one village: the old are buried, the gaps are filled, the young grow up, and
   * whatever had teeth is accounted for last.
   *
   * Killings come last because that is when they actually happen — somebody dies during a day
   * that has already been lived — and a village re-lived from its founding has to arrive at the
   * same place as the village that watched it happen. The gap is filled the following morning.
   */
  /**
   * A day's earnings for everybody still working in a village.
   *
   * Nobody earns while the place is being raided, which is the whole reason a village under
   * pressure stays poor and one left alone slowly does not: prosperity is a thing the player can
   * protect rather than a number that only goes up.
   */
  private trade(village: Settlement, pressure: number): void {
    for (const person of village.people) {
      person.purse = Math.min(PROSPER.MOST, person.purse + earnedInADay(person, pressure));
    }
  }

  private liveADay(name: string, village: Settlement, day: number): Change[] {
    this.trade(village, this.pressure.get(name) ?? 0);
    const changes = [
      ...this.buryTheOld(village, day),
      ...this.fillTheGaps(name, village, day),
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

  private buryTheOld(village: Settlement, day: number): Change[] {
    const gone = village.people.filter((p) => outOfDays(p, day));
    return gone.map((p) => this.remove(p, day, 'age')).filter((c): c is Change => c !== null);
  }

  /**
   * A village replaces what it has lost, at a pace. A hard winter of wolf attacks means a run of
   * births rather than a slow slide into an empty place, and a village at full size has none.
   */
  private fillTheGaps(name: string, village: Settlement, day: number): Change[] {
    const missing = village.founded - village.people.length;
    if (missing <= 0) return [];
    // a village past saving does not save itself. That is what makes arriving in time matter:
    // below the line there are not enough hands to keep the place going, and no amount of waiting
    // will change it, only somebody dealing with whatever is doing the killing
    if (!canRecover(fortuneOf(village.people.length, village.founded))) return [];

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
  private remove(person: Person, day: number, cause: 'age' | 'violence'): Change | null {
    const village = this.villages.get(person.village);
    if (!village) return null;
    const at = village.people.indexOf(person);
    if (at < 0) return null;

    village.people.splice(at, 1);
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
      mother: '', father: '', knows: [], memories: [],
      purse: 0,                                  // a baby has nothing; a trade is what starts it
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

  /** What to hold on disk: only the living, which is what keeps this small forever. */
  save(): Record<string, Person[]> {
    const out: Record<string, Person[]> = {};
    for (const [name, village] of this.villages) out[name] = village.people;
    return out;
  }
}
