import { hashString, mulberry32, shuffle, type Rng } from '../core/rng';
import { derive } from '../core/salts';
import { VILLAIN } from '../entities/villain';
import { LIFE, remember, type Person } from '../world/people';
import { grownFolk } from '../world/fortunes';
import type { Register } from '../world/register';
import type { Village } from '../world/structures';
import { JAIL, type Jail } from './jail';

/**
 * Old Nettle, and the whole of what the country can do about him, which is a fortnight at a time.
 *
 * The cycle is one shape repeated. He settles on a village and starts bleeding it, a name at a
 * time, and the register is where you notice; you find him and you beat him, because he is a man
 * and a man can be beaten; and at the moment the fight is won he sets something going that will
 * drown or bury or burn people who have names, and the game stops and asks you, with a clock
 * running, which of the two you want. Go after him and he goes in a cell and the people in the
 * water do not come out of it. Go to them and they live, they remember who came, and he walks
 * away across the fields. Neither of those is the wrong answer and neither is free.
 *
 * The decision worth explaining is that he never escapes. There is no branch anywhere in here or
 * in his behaviour file that moves him out of a fight going badly, because a villain who vanishes
 * at low health is the game taking back a win it has already given you, and a player can tell the
 * difference immediately. What happens instead is that something worth more than he is turns up in
 * the same minute, and you weigh it. Nothing is ever taken from you: you put it down, or you do
 * not, and the world afterwards is exactly the world your hands made. That is why `beaten` does
 * nothing whatever except describe the choice, and why every consequence in this file is applied
 * by the method you called next.
 *
 * The other half of that bargain is that the player is told he always gets away before it ever
 * happens to them, offhand, by a villager, in the same breath they use for a death. `heardOfHim`
 * below is that line. Without it the first escape reads as a cheat; with it, it reads as the one
 * fact about the country everybody already knew.
 */

export const NEMESIS = {
  /** What villagers call him. A nickname and not a title: a country names a nuisance the way it names a weed. */
  NAME: 'Old Nettle',
  /** His own stream, sharing its number with no salt in `core/salts.ts`, so his rolls follow nobody else's. */
  STREAM: 0x4e37,
  /**
   * The earliest day a first scheme may begin. A hero who meets him in their first week has met
   * nothing else yet, and the followers he sends are supposed to be most of what you ever fight.
   */
  FIRST: 12,
  /** Days of quiet after he is loose again before he settles anywhere new. */
  BETWEEN: 9,
  /**
   * The sentence a cell gives him, in days. The fortnight the law was built around, and the one
   * number in this file he has never once served out.
   */
  HELD_DAYS: 14,
  /**
   * And the day his followers come for the roof, which is short of it on purpose. A villain who
   * serves his time and is released has been dealt with; one who is taken out three days early,
   * every time, has not.
   */
  BROKEN_AFTER: 11,
  /** Days between the people a running scheme takes out of the village it has settled on. */
  TOLL_EVERY: 2,
  /**
   * How many are in the water, under the rock, or the wrong side of the fire. Enough that the
   * names read as a village losing a piece of itself, few enough that it can survive it twice.
   */
  AT_STAKE: 4,
  /** The share of them you get to with your bare hands, when the thing it wanted is at home in a chest. */
  BAREHANDED: 0.5,
  /**
   * Real seconds the choice stands. About the time it takes to cross a village at a run, which is
   * the point: long enough to decide, far too short to do both by dithering.
   */
  CHOOSING: 90,
  /** The share of his hit points at which the fight is over. Below it he is beaten, and never dead. */
  BEATEN_AT: 0.2,
} as const;

/** Where he is up to, which is the whole state of the country as far as this file is concerned. */
export type Whereabouts = 'lull' | 'abroad' | 'choosing' | 'held';

/** What he is doing to the village he has settled on, and how the village finds out. */
export type Work = 'well' | 'nightmen' | 'fever';

/** What he sets going on his way out of a fight he is losing. */
export type Ruin = 'flood' | 'rockslide' | 'fire' | 'beasts';

/** The thing answering a ruin wants in your hands. */
export type Tool = 'boat' | 'shovel' | 'horse' | 'sword';

/**
 * Which ruin wants which tool. Four of each and no two alike, because a disaster that always
 * wants the same answer is one set piece played five times, and the second time you have already
 * packed for it.
 */
export const WANTS: Record<Ruin, Tool> = {
  flood: 'boat',
  rockslide: 'shovel',
  fire: 'horse',
  beasts: 'sword',
};

/** Everything he could be doing, in the order the roll reads them. */
const WORKS: readonly Work[] = ['well', 'nightmen', 'fever'];
const RUINS: readonly Ruin[] = ['flood', 'rockslide', 'fire', 'beasts'];

/** Where he goes next, what he does there, and what he leaves behind him. */
export interface Plan {
  village: string;
  work: Work;
  /** Rolled now rather than at the moment he needs it, so two clients agree about a flood. */
  ruin: Ruin;
}

/** A plan that has actually started. */
export interface Scheme extends Plan {
  /** Which one this is, counting from the first. Everything else follows from it and the seed. */
  number: number;
  /** The day it began, which is what the toll counts from. */
  began: number;
}

/** The question, while it is still a question. Nothing in the world has moved yet. */
export interface Choice {
  scheme: number;
  ruin: Ruin;
  village: string;
  /** What getting to them wants in your hands. */
  wants: Tool;
  /** True when you have it. Without it you reach some of them and stand watching the rest. */
  ready: boolean;
  /** Somebody who will hold him while you run, or empty when there is nobody. */
  holder: string;
  /** Real seconds left before it stops being a question. */
  left: number;
  /** The names in it, because a number of dead villagers is not a choice about anything. */
  atStake: string[];
  said: string;
}

/** What the choice came to, once it was made or once it ran out. */
export interface Outcome {
  /** True when he is behind a door at the end of it. */
  jailed: boolean;
  /** The village holding him, or empty. */
  cell: string;
  /** The day his sentence is up, which is never the day he leaves. */
  until: number;
  /** Who died, by name. */
  lost: string[];
  /** Who lived, by name, and now carries a memory of who came for them. */
  saved: string[];
  said: string;
}

/** Something he did, worth telling the player and worth putting in a log. */
export interface Word {
  kind: 'scheme' | 'taken' | 'brokenOut';
  village: string;
  /** The person it happened to, for a death, and his own name for anything else. */
  who: string;
  day: number;
  said: string;
}

/**
 * Everything the cycle reaches for. Handed in rather than held, in the way the law is: this file
 * decides what happens to people and knows nothing about how a person is drawn or saved.
 */
export interface Realm {
  register: Register;
  jail: Jail;
  villages: readonly Village[];
  /** What somebody pulled out of the water will call you afterwards. */
  hero: string;
}

/** What a save has to remember about him: where he is up to, and what he is in the middle of. */
export interface NemesisSave {
  where: Whereabouts;
  scheme: Scheme | null;
  held: { village: string; freeOn: number } | null;
  next: number;
  ran: number;
  tolled: number;
}

/** A stream of his own for one moment of one scheme, so two clients take the same person. */
function streamFor(seed: number, about: string): Rng {
  return mulberry32(derive(seed, NEMESIS.STREAM) ^ hashString(about));
}

/**
 * Where his nth scheme falls and what it is. A pure function of the seed and the number, so two
 * players who have never spoken know that the fourth time he turns up it will be at Ashmere and
 * it will be the well, without a byte crossing between them.
 *
 * The villages come from the world rather than from the register on purpose: which places exist is
 * a fact about the seed, and which of them a particular player has walked into is not.
 */
export function planFor(seed: number, villages: readonly string[], n: number): Plan {
  const rng = streamFor(seed, `scheme:${n}`);
  // he comes back to places. Twice at the same village is not a repeat, it is a village that has
  // already buried people and cannot spare the ones it is about to lose
  return {
    village: villages[Math.floor(rng() * villages.length)],
    work: WORKS[Math.floor(rng() * WORKS.length)],
    ruin: RUINS[Math.floor(rng() * RUINS.length)],
  };
}

/**
 * Has he taken enough? The caller asks this instead of letting a blow land, and calls `beaten`
 * when it is true. He has hit points because the fight has to be winnable; what he does not have
 * anywhere in the game is a death, and this is the line where that is kept.
 */
export function knocked(hp: number, full = VILLAIN.HP): boolean {
  return hp <= full * NEMESIS.BEATEN_AT;
}

/** A handful of names as somebody would say them out loud. */
function namesSaid(names: readonly string[]): string {
  if (names.length === 0) return 'Nobody anybody knows';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What a village has noticed, which is never him: it is the thing he is doing to them. */
export function saidOfWork(work: Work, village: string): string {
  switch (work) {
    case 'well': return `Something has been put down the well at ${village}. They are drinking it and they do not know yet.`;
    case 'nightmen': return `There are men nobody knows on the road into ${village} after dark, and people who take that road are not arriving.`;
    case 'fever': return `A fever has come to ${village} that the doctor cannot put a name to. It takes the strong first, which is not how a fever behaves.`;
  }
}

/** What he set going as the fight turned, said the way somebody shouting it up the street would. */
export function saidOfRuin(ruin: Ruin, village: string, atStake: readonly string[]): string {
  const who = namesSaid(atStake);
  switch (ruin) {
    case 'flood': return `He has opened the river above ${village}. ${who} are on the rooftops and the water is still coming up.`;
    case 'rockslide': return `He has brought the hillside down across the ${village} road. ${who} are under it, and you can hear them from here.`;
    case 'fire': return `The far end of ${village} is alight with the wind behind it. ${who} are on the wrong side of the flames.`;
    case 'beasts': return `He has turned his creatures loose in ${village}. ${who} are between them and the square, and the square is a long way.`;
  }
}

/** What answering it wants, and whether you have it. The half of the choice that preparation decides. */
export function saidOfWant(tool: Tool, ready: boolean): string {
  switch (tool) {
    case 'boat': return ready ? 'Your boat is at its mooring.' : 'You have no boat, and there is not one to borrow.';
    case 'shovel': return ready ? 'You have a shovel on your back.' : 'You have nothing to dig with but your hands.';
    case 'horse': return ready ? 'Your horse is saddled.' : 'You have no horse, and it is the length of the village.';
    case 'sword': return ready ? 'You have a blade on you.' : 'You have nothing on you worth swinging at them.';
  }
}

/**
 * What a villager says about him in passing, before you have ever laid eyes on him.
 *
 * This is the most important string in the file. Every one of these lines says the same fact in a
 * different mouth: they have had him, they could not keep him, and somebody paid for the letting
 * go. Said once, offhand, months before it happens to you, it turns the first escape from a game
 * cheating into the country being exactly as consistent as it said it was.
 *
 * It is lore rather than history on purpose. It has to be sayable on the first day of a new world,
 * when nothing has happened yet, so it is rolled from the seed and the teller and asks the cycle
 * nothing at all.
 */
export function heardOfHim(seed: number, teller: string, villages: readonly string[]): string {
  const rng = streamFor(seed, `word:${teller}`);
  const where = villages.length > 0 ? villages[Math.floor(rng() * villages.length)] : 'the coast';
  const said = [
    `They had Old Nettle in the cell at ${where} once. Held him the best part of a fortnight. Then his lot came through the roof in the night, and it was the constable they buried.`,
    `You will meet Old Nettle sooner or later, everybody does. He has been put away twice in my lifetime and he has never yet stayed put.`,
    `Old Nettle? Locked up at ${where}, when I was a girl. He walked out of it over a dead man, the way he always does. They will have him again, and it will finish the same way.`,
    `There is no killing Old Nettle. I have watched better than you try it. The most anybody has ever managed is a door, and a fortnight behind it.`,
  ];
  return said[Math.floor(rng() * said.length)];
}

/**
 * Where he is, what he is doing, and what it has cost so far.
 *
 * The state is owned here rather than spread across the world because none of it is derivable. A
 * scheme's *plan* comes from the seed and agrees everywhere; whether anybody has beaten him yet,
 * and what they chose when they did, is a thing that happened, and things that happened travel on
 * the world's log with the deaths they caused.
 */
export class Nemesis {
  private where: Whereabouts = 'lull';
  private plan: Scheme | null = null;
  private heldAt: { village: string; freeOn: number } | null = null;
  private standing: Choice | null = null;
  /** Ids of the people in the water, kept apart from their names so a choice cannot bury a stranger. */
  private stakes: string[] = [];
  /** The earliest day the next scheme may begin. */
  private next = NEMESIS.FIRST;
  /** How many schemes have started, which is what the seed rolls the next one from. */
  private ran = 0;
  /** The day the last toll was taken, so a client arriving late takes exactly the ones it missed. */
  private tolled = 0;

  constructor(private readonly seed: number) {}

  /** What the save had, or a world in which nothing of his has happened yet. */
  static from(seed: number, saved: NemesisSave | null | undefined): Nemesis {
    const him = new Nemesis(seed);
    if (!saved) return him;
    him.where = saved.where;
    him.plan = saved.scheme;
    him.heldAt = saved.held;
    him.next = saved.next;
    him.ran = saved.ran;
    him.tolled = saved.tolled;
    return him;
  }

  /** His name, so nothing else has to write it out. */
  get name(): string { return NEMESIS.NAME; }

  /** Where he is up to. */
  get whereabouts(): Whereabouts { return this.where; }

  /** The scheme he is in the middle of, or null while the country has him or has lost him. */
  get scheme(): Scheme | null { return this.plan; }

  /** The choice standing in front of the player, or null. */
  get choice(): Choice | null { return this.standing; }

  /** The village holding him, or empty. */
  get cell(): string { return this.heldAt?.village ?? ''; }

  /**
   * True while nothing of his is happening anywhere: he is behind a door, or he is walking, and
   * either way no village is losing anybody to him this week. What the rest of the game is for.
   */
  get quiet(): boolean { return this.where === 'held' || this.where === 'lull'; }

  /**
   * He is alive. There is no other answer and there is no method here that could change it: a
   * beaten man goes in a cell or over a hill, and this is the promise the whole design rests on
   * written down where a test can read it.
   */
  get alive(): boolean { return true; }

  /**
   * Catch the country up to a day: a scheme begins, a scheme takes somebody, or a roof comes off a
   * station. The choice is not on this clock, because a choice is measured in the seconds a person
   * has to make it and not in the days a world takes to pass.
   */
  advance(now: number, realm: Realm): Word[] {
    const day = Math.floor(now);
    const words: Word[] = [];
    if (this.where === 'choosing') return words;
    if (this.where === 'held') words.push(...this.breakOut(day, realm));
    if (this.where === 'lull' && day >= this.next) words.push(...this.begin(day, realm));
    if (this.where === 'abroad') words.push(...this.takeTheToll(day, realm));
    return words;
  }

  /**
   * The fight is won. This offers the choice and does absolutely nothing else: nobody is buried,
   * nobody is jailed, and nothing has been decided on the player's behalf. Null when he is not
   * out there to be beaten in the first place.
   */
  beaten(realm: Realm, now: number, kit: readonly Tool[], holder = ''): Choice | null {
    if (this.where !== 'abroad' || !this.plan) return null;
    const day = Math.floor(now);
    const scheme = this.plan;
    const folk = this.folkOf(realm.register, scheme.village, day, `stake:${scheme.number}`).slice(0, NEMESIS.AT_STAKE);
    const wants = WANTS[scheme.ruin];

    this.stakes = folk.map((p) => p.id);
    this.standing = {
      scheme: scheme.number,
      ruin: scheme.ruin,
      village: scheme.village,
      wants,
      ready: kit.includes(wants),
      holder,
      left: NEMESIS.CHOOSING,
      atStake: folk.map((p) => p.name),
      said: saidOfRuin(scheme.ruin, scheme.village, folk.map((p) => p.name)),
    };
    this.where = 'choosing';
    return this.standing;
  }

  /**
   * Run the clock down. Null while it still stands, and an outcome the moment it does not: the
   * ones in the water drown and he is over the hill by morning.
   *
   * That is not this file deciding for you. Nobody decided, and the water was never going to wait
   * for somebody to finish weighing it up.
   */
  tick(seconds: number, realm: Realm, now: number): Outcome | null {
    const choice = this.standing;
    if (!choice) return null;
    choice.left -= seconds;
    if (choice.left > 0) return null;

    const day = Math.floor(now);
    const lost = this.buryStakes(realm, day);
    this.close(day, '');
    return {
      jailed: false, cell: '', until: 0, lost, saved: [],
      said: `Nobody came, either way. ${namesSaid(lost)} went, and so did he.`,
    };
  }

  /**
   * Go after him. He goes in the nearest cell that will take him, for a sentence he will not
   * serve, and the people he left in the water are on nobody's list by morning.
   */
  chase(realm: Realm, now: number): Outcome | null {
    const choice = this.standing;
    if (!choice) return null;
    const day = Math.floor(now);
    const cell = this.lockUp(realm, now);
    const lost = this.buryStakes(realm, day);
    this.close(day, cell);

    const said = cell === ''
      ? `You run him down and there is not a standing cell in a day's walk to put him in. He goes, and so did ${namesSaid(lost)}.`
      : `He is behind a door at ${cell}, and will be for a fortnight. ${namesSaid(lost)} were not got out.`;
    return { jailed: cell !== '', cell, until: cell === '' ? 0 : day + NEMESIS.HELD_DAYS, lost, saved: [], said };
  }

  /**
   * Go to them instead. They live, and they remember who came, which is the only kind of record
   * this game keeps of anything.
   *
   * If somebody was left holding him you get both, and that is the point of having hired them:
   * the dilemma has an answer for the player who thought a week ahead, or it is a corridor with a
   * choice painted on the wall. Without the thing the ruin wanted you still go, and you still get
   * some of them out, and you count the rest afterwards.
   */
  help(realm: Realm, now: number): Outcome | null {
    const choice = this.standing;
    if (!choice) return null;
    const day = Math.floor(now);
    const reach = choice.ready ? this.stakes.length : Math.floor(this.stakes.length * NEMESIS.BAREHANDED);
    const pulled = this.stakes.slice(0, reach);
    const drowned = this.stakes.slice(reach);

    const saved: string[] = [];
    for (const id of pulled) {
      const person = realm.register.find(id);
      if (!person) continue;
      remember(person, { what: 'saved', who: realm.hero, day });
      saved.push(person.name);
    }
    const lost = this.buryThese(realm, drowned, day);
    const cell = choice.holder === '' ? '' : this.lockUp(realm, now);
    this.close(day, cell);

    const also = cell === ''
      ? 'He was over the ridge before the water was down.'
      : `${choice.holder} had hold of him the whole time, and he is at ${cell} now.`;
    const missed = lost.length > 0 ? ` ${namesSaid(lost)} you could not reach.` : '';
    return { jailed: cell !== '', cell, until: cell === '' ? 0 : day + NEMESIS.HELD_DAYS, lost, saved, said: `${namesSaid(saved)} are out.${missed} ${also}` };
  }

  /** For the save. A choice is not written down: see the comment inside. */
  toJSON(): NemesisSave {
    return {
      // a countdown does not survive being put down. Saving one would mean loading into seconds
      // that ran while nobody was at the keyboard, so a game saved mid choice comes back with him
      // still abroad and the fight still there to be won
      where: this.where === 'choosing' ? 'abroad' : this.where,
      scheme: this.plan,
      held: this.heldAt,
      next: this.next,
      ran: this.ran,
      tolled: this.tolled,
    };
  }

  /** He settles somewhere and starts work. */
  private begin(day: number, realm: Realm): Word[] {
    const names = realm.villages.map((v) => v.name);
    if (names.length === 0) return [];

    const plan = planFor(this.seed, names, this.ran);
    this.plan = { ...plan, number: this.ran, began: day };
    this.ran++;
    this.where = 'abroad';
    this.tolled = day;
    return [{ kind: 'scheme', village: plan.village, who: NEMESIS.NAME, day, said: saidOfWork(plan.work, plan.village) }];
  }

  /**
   * What a running scheme costs, counted off in whole steps from the day it started rather than
   * from today, so a client that has been away a week buries exactly the people it missed and on
   * the days it missed them.
   *
   * A village nobody has walked into yet has nobody in it to take, and the toll simply passes. A
   * killing is the one thing about a village that cannot be worked out from the seed anyway, so it
   * travels on the world's log from whoever was standing there, exactly like a wolf's.
   */
  private takeTheToll(day: number, realm: Realm): Word[] {
    const scheme = this.plan;
    if (!scheme) return [];
    const words: Word[] = [];

    while (day - this.tolled >= NEMESIS.TOLL_EVERY) {
      this.tolled += NEMESIS.TOLL_EVERY;
      const took = this.folkOf(realm.register, scheme.village, this.tolled, `toll:${scheme.number}:${this.tolled}`)[0];
      if (!took) continue;
      realm.register.bury(took.id, this.tolled);
      words.push({
        kind: 'taken', village: scheme.village, who: took.name, day: this.tolled,
        said: `${took.name} of ${scheme.village} did not come home. Nobody in the square will say out loud what is doing it.`,
      });
    }
    return words;
  }

  /**
   * His followers take the roof off the station, and the constable who was holding him is buried
   * like anybody else on the register. The village is left without law for as long as it takes to
   * put the timber back up, which the cell itself already knows how to arrange.
   */
  private breakOut(day: number, realm: Realm): Word[] {
    const held = this.heldAt;
    if (!held || day < held.freeOn) return [];

    const keeper = this.folkOf(realm.register, held.village, day, `roof:${held.village}:${day}`, 'constable')[0];
    realm.jail.brokenOpen(held.village, day);
    if (keeper) realm.register.bury(keeper.id, day);

    this.heldAt = null;
    this.where = 'lull';
    this.next = day + NEMESIS.BETWEEN;
    const who = keeper?.name ?? 'The constable';
    return [{
      kind: 'brokenOut', village: held.village, who, day,
      said: `They came through the roof of the station at ${held.village} in the night. ${who} is dead, the cell is empty, and there is sky where the ceiling was.`,
    }];
  }

  /** Put him behind a door, and hand back the village that took him, or empty for a country with no room. */
  private lockUp(realm: Realm, now: number): string {
    const choice = this.standing;
    const home = realm.villages.find((v) => v.name === choice?.village);
    if (!home) return '';

    const day = Math.floor(now);
    const at = realm.jail.nearest([...realm.villages], home.x, home.z, now, day);
    if (!at) return '';
    const held = realm.jail.commit(at, NEMESIS.NAME, NEMESIS.HELD_DAYS * JAIL.HOURS_A_DAY, now, day);
    if (!held) return '';

    this.heldAt = { village: at.name, freeOn: day + NEMESIS.BROKEN_AFTER };
    return at.name;
  }

  /** Everybody the ruin had, gone. */
  private buryStakes(realm: Realm, day: number): string[] {
    return this.buryThese(realm, this.stakes, day);
  }

  private buryThese(realm: Realm, ids: readonly string[], day: number): string[] {
    const gone: string[] = [];
    for (const id of ids) {
      const change = realm.register.bury(id, day);
      if (change) gone.push(change.name);
    }
    return gone;
  }

  /** The end of a scheme, however it ended: he is held, or he is walking, and either way he is coming back. */
  private close(day: number, cell: string): void {
    this.standing = null;
    this.stakes = [];
    this.plan = null;
    if (cell !== '') { this.where = 'held'; return; }
    this.where = 'lull';
    this.next = day + NEMESIS.BETWEEN;
  }

  /**
   * People from a village, in an order two clients agree on. Grown folk first wherever there are
   * any: a scheme takes the ones who would have stood in its way, and a game that opens with a
   * dead child has said something it cannot take back.
   *
   * `trade` puts one job at the front, which is how the man with the keys is the man who dies.
   */
  private folkOf(register: Register, village: string, day: number, about: string, trade = ''): Person[] {
    const living = [...register.living(village)];
    const grown = grownFolk(living, day, LIFE.CHILD_UNTIL);
    const pool = shuffle(streamFor(this.seed, about), grown.length > 0 ? grown : living);
    if (trade === '') return pool;
    return [...pool.filter((p) => p.trade === trade), ...pool.filter((p) => p.trade !== trade)];
  }
}
