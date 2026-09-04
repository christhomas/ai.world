import { Biome } from '../world/biomes';
import { remember, stageOf, type Memory, type Person } from '../world/people';
import { SEED_TO_CROP } from './farming';
import { isFur } from './furs';
import { ITEMS, type Item } from './items';
import type { GameState } from './state';

/**
 * Giving things to people.
 *
 * Everything a player carries is either used or sold, and selling means the whole economy points
 * at a shopkeeper. A gift points it at somebody who lives here instead. It buys nothing you could
 * have bought with the same goods over a counter: it buys the one thing in this country that
 * money cannot, which is being owed something by a person rather than by a shop.
 *
 * What counts is judgement rather than price. The register knows everybody's trade and the map
 * knows what their country is short of, so a gift is worth what it answers and not what it cost.
 * An apple pressed on an innkeeper is worth more than chain mail pressed on a farmer, and always
 * will be, because the farmer is standing there holding a shirt of armour he has nowhere to put.
 *
 * The decision worth explaining is that a snow village wants a wolf pelt even though no shop up
 * there will pay a copper for one. The fur trade in furs.ts prices scarcity: a place knee deep in
 * wolfskin buys yours cheaply or not at all. A gift answers need, and need is the other question.
 * What a country will pay for and what a country lives on are not the same thing, and the whole
 * point of giving is that it is not the market. Gold cannot be given at all, which is the
 * shortest way of saying the same thing.
 *
 * It is not a machine for buying goodwill, and it is stopped by two fadings rather than by a cap
 * that says no. The same thing given to the same person fades by GIFT.AGAIN every time, because
 * the second apple is not the first one. And everything given to one person on one day fades
 * against what they have already had that day, because somebody handed six presents since
 * breakfast has stopped noticing. Together they mean that a village's affection costs a week of
 * walking it with a full pack and a memory for who wanted what, which is not farming: it is the
 * long way round, and it is the only way back from having been the sort of person who kills
 * farmers.
 */

export const GIFT = {
  /** What something nobody needed is still worth. Not nothing: it was still given. */
  INAPT: 0.15,
  /** On top of that, for food, because everybody eats. */
  ANYONE: 0.35,
  /** And for the thing their work actually wants, which is the largest single reason. */
  TRADE: 1,
  /** And for what the country round them is short of, whatever they do for a living. */
  PLACE: 0.5,
  /** A child wants feeding and cares nothing for a trade, having none. */
  CHILD: 0.6,
  /** Heals this much or more, and made rather than gathered, and it is medicine. */
  PHYSIC: 3,
  /**
   * Past this many gold, spending more stops meaning more. The tenth gold piece in a gift says
   * far less than the first, and this is where it stops saying anything at all.
   */
  DEAREST: 30,
  /** What the same thing given to the same person again is worth, each time over. */
  AGAIN: 0.45,
  /** How much one person takes in on one day before the rest of it stops landing. */
  ENOUGH: 8,
  /** Warmth turned into standing on the good and evil scale. */
  CONSCIENCE: 0.15,
  /**
   * The most one gift can move that scale. Nothing in the game reaches it by accident; it is
   * here so that an item priced by somebody in a hurry cannot buy a pardon.
   */
  KINDNESS: 2,
  /** Warmth at which somebody starts giving back in their own coin. */
  RETURNED: 30,
  /** What a farmer, a hunter or a seller puts by for you, in units of it. */
  SHARE: 2,
  /** And what a soldier counts out of the armoury. */
  QUIVER: 6,
  /** What a constable's word at the gate is worth on the scale, once in a day. */
  VOUCHED: 4,
} as const;

/**
 * What a thing is, from what it does. Derived rather than declared, so an item added tomorrow
 * falls into the right hands without anybody coming back here to say so.
 */
export type Nature = 'food' | 'physic' | 'steel' | 'armour' | 'tool' | 'warmth' | 'seed' | 'treasure';

/**
 * What each trade is short of. This is the whole table: a want per job, and no pairs of item and
 * person anywhere, so judging a gift stays a question about two facts rather than a list of
 * exceptions that grows every time somebody adds a sword.
 */
const WANTS: Record<string, Nature> = {
  farmer: 'seed',        // the only thing a farmer is ever genuinely short of is next year
  hunter: 'tool',        // a knife keeps a pelt whole, which is the difference between pay and none
  soldier: 'steel',      // and an edge is the only present a soldier will admit to wanting
  constable: 'armour',   // who stands in the square all day and would rather not be hurt in it
  doctor: 'physic',      // the one trade that gives away what it is short of
  innkeeper: 'food',     // the pot is never full enough on the night the coach comes in
  seller: 'treasure',    // anything strange enough to put on the front of the stall
  sailor: 'warmth',      // wet through by noon, every day of a working life
  climber: 'warmth',     // the tops do not care how well you climb
  explorer: 'tool',      // a rope, a lantern, a map: the three things that decide whether you come back
};

/**
 * And what each country is short of, which is a fact about the ground rather than about anybody
 * standing on it. Plains and forest want for nothing in particular, so they are not here.
 */
const SHORT_OF: Partial<Record<Biome, Nature>> = {
  [Biome.Snow]: 'warmth',      // where a fur is what the day is organised around
  [Biome.Mountain]: 'warmth',  // and the wind comes over the ridge whatever the season says
  [Biome.Desert]: 'food',      // nothing grows, so everything eaten was carried in
  [Biome.Swamp]: 'physic',     // the water is bad and everyone here knows somebody it took
};

/** What somebody gives back, once you are worth giving back to. */
export type Kindness =
  /** Something out of their own trade, left for you. */
  | { kind: 'goods'; item: string; count: number; words: string }
  /** A word put in for you where it counts, which moves the scale itself. */
  | { kind: 'word'; standing: number; words: string }
  /** Seen to, free, for as long as you two stand this way. */
  | { kind: 'mend'; words: string }
  | { kind: 'lodging'; words: string }
  | { kind: 'passage'; words: string };

/**
 * How each trade returns a favour: in its own coin, never in gold.
 *
 * Three of them are standing arrangements rather than presents. A doctor who has decided you are
 * not to be charged does not hand you a mending once and go back to charging, and neither does an
 * innkeeper or a ferryman, so those are simply how things are between you now. The rest are
 * things somebody put by, and are put by again tomorrow.
 */
const PAYS_BACK: Record<string, Kindness> = {
  farmer: { kind: 'goods', item: 'wheat', count: GIFT.SHARE, words: 'puts a share of the field by for you.' },
  hunter: { kind: 'goods', item: 'meat', count: GIFT.SHARE, words: 'leaves a kill where you will find it.' },
  seller: { kind: 'goods', item: 'bread', count: GIFT.SHARE, words: 'keeps something back off the stall for you.' },
  soldier: { kind: 'goods', item: 'arrow', count: GIFT.QUIVER, words: 'counts you out arrows from the armoury.' },
  climber: { kind: 'goods', item: 'rope', count: 1, words: 'presses a spare rope on you and will not hear otherwise.' },
  explorer: { kind: 'goods', item: 'map', count: 1, words: 'sits down and copies out their map for you.' },
  constable: { kind: 'word', standing: GIFT.VOUCHED, words: 'has a word about you at the gate.' },
  doctor: { kind: 'mend', words: 'will not take your coin for a mending any more.' },
  innkeeper: { kind: 'lodging', words: 'has a bed for you, and no bill to go with it.' },
  sailor: { kind: 'passage', words: 'waves your fare away at the pier.' },
};

/** The favours that are done once and done again tomorrow, rather than being how things now are. */
const ONE_OFF: ReadonlySet<Kindness['kind']> = new Set<Kindness['kind']>(['goods', 'word']);

/** What a thing is, judged only by what it does and never by its name. */
export function natureOf(item: Item): Nature {
  if (isFur(item.id)) return 'warmth';
  if (SEED_TO_CROP[item.id]) return 'seed';
  if (item.effect?.type === 'heal') {
    // gathered off the ground it is a meal however well it works; made up in a bowl it is medicine
    return item.effect.amount >= GIFT.PHYSIC && !item.loot ? 'physic' : 'food';
  }
  if (item.effect?.type === 'rest') return 'food';
  if (item.attack) return 'steel';
  if (item.defence || item.hearts) return 'armour';
  if (item.ability || item.tool) return 'tool';
  return 'treasure';
}

/**
 * How well a thing suits a person in the place they live: one for a gift that answers nothing,
 * upwards from there for every reason they had to want it.
 *
 * Pure, and it takes the three things it is about and no more. Give the same pelt to the same
 * climber in the plains and in the snow and you get two different numbers, which is the point.
 */
export function fitness(item: Item, person: Person, biome: Biome, day: number): number {
  const nature = natureOf(item);
  let want = GIFT.INAPT;
  if (nature === 'food') want += GIFT.ANYONE;
  if (WANTS[person.trade] === nature) want += GIFT.TRADE;
  if (SHORT_OF[biome] === nature) want += GIFT.PLACE;
  if (nature === 'food' && stageOf(person, day) !== 'adult') want += GIFT.CHILD;
  return want;
}

/**
 * What a gift would come to before anybody remembers being given anything.
 *
 * Price is under a square root and stopped at GIFT.DEAREST, so money is worth something and never
 * worth much: the whole spread from an apple to a war axe is less than the spread between a thing
 * somebody needed and a thing they did not.
 */
export function worthOf(item: Item, person: Person, biome: Biome, day: number): number {
  return fitness(item, person, biome, day) * Math.sqrt(Math.min(item.price, GIFT.DEAREST));
}

/** How somebody takes it, which is the only report the player gets of how well they judged it. */
function takenAs(fit: number): string {
  if (fit >= GIFT.INAPT + GIFT.TRADE + GIFT.PLACE) return 'turns it over twice, and then puts it somewhere safe. That was needed here.';
  if (fit >= GIFT.INAPT + GIFT.TRADE) return 'takes it, and means the thanks.';
  if (fit >= GIFT.INAPT + GIFT.ANYONE) return 'thanks you, and eats some of it there and then.';
  return 'thanks you politely, and has no earthly use for it.';
}

/**
 * The scale of a friendship in words, nearest first. Never a number, for the same reason standing
 * is never a number: nobody knows what 30 means, and everybody knows what a nod in the street is.
 */
const BONDS: ReadonlyArray<{ from: number; words: string }> = [
  { from: GIFT.RETURNED * 2, words: 'as good as family here' },
  { from: GIFT.RETURNED, words: 'somebody they look out for' },
  { from: GIFT.RETURNED / 3, words: 'a face they are glad to see' },
  { from: Number.MIN_VALUE, words: 'somebody who once gave them something' },
  { from: 0, words: 'a stranger to them' },
];

/** How you and somebody stand, said the way they would say it. */
export function bondWords(warmth: number): string {
  for (const band of BONDS) if (warmth >= band.from) return band.words;
  return BONDS[BONDS.length - 1].words;
}

/** What one person is holding on to about you. */
export interface Bond {
  /** Everything you have ever given them, worn down by every repeat. */
  warmth: number;
  /** How many of each thing, so a second apple is worth less than the first. */
  given: Record<string, number>;
  /** The day `today` belongs to, and how much of it has already landed. */
  day: number;
  today: number;
  /** The last day they had something put by for you, so a kill is a kill and not an orchard. */
  claimed: number;
}

/** What came of handing something over. */
export interface Given {
  /** What it landed for, after everything that dulls a repeat. */
  warmth: number;
  /** And where that leaves the two of you. */
  bond: number;
  /** How the country should think of you for it. Never more than GIFT.KINDNESS. */
  standing: number;
  /** What they did with it, for the flash. */
  words: string;
  /** What they will carry about it, for the caller to write on to the register. */
  memory: { what: 'given'; who: string; day: number };
  /** True when this was the one that tipped them into giving back. */
  turned: boolean;
}

/**
 * Who you have been good to, and what they have decided about you for it.
 *
 * Kept apart from the register on purpose. The register is what a village knows about itself and
 * is the same for everybody in the world; this is what a village makes of *you*, which is nobody
 * else's business and travels with the save rather than with the world.
 */
export class Gifts {
  private readonly bonds = new Map<string, Bond>();

  /** @param saved what the save had, or nothing for somebody who has never given anything away */
  constructor(saved: Record<string, Bond> = {}) {
    for (const [id, bond] of Object.entries(saved)) this.bonds.set(id, bond);
  }

  /** How warmly one person thinks of you. Nought for anybody you have never given anything. */
  warmthWith(id: string): number {
    return this.bonds.get(id)?.warmth ?? 0;
  }

  /** And in words, which is the only form of it the player is shown. */
  wordsFor(id: string): string {
    return bondWords(this.warmthWith(id));
  }

  /** Whether somebody has reached the point of giving back. */
  favoured(id: string): boolean {
    return this.warmthWith(id) >= GIFT.RETURNED;
  }

  /**
   * Hand something over. Returns what came of it, or null when you are not carrying the thing,
   * which is the only way this can fail: everybody takes a present.
   */
  give(state: GameState, person: Person, biome: Biome, itemId: string, day: number, from: string): Given | null {
    const item = ITEMS[itemId];
    if (!item || !state.has(itemId)) return null;
    state.take(itemId, 1);

    const bond = this.bondWith(person.id, day);
    const before = bond.warmth;
    const fit = fitness(item, person, biome, day);
    const had = bond.given[itemId] ?? 0;
    // both fadings at once: how often they have had this thing, and how much of today they have
    // already been given. Neither refuses a gift; they only stop it counting for what it did.
    const dulled = GIFT.AGAIN ** had / (1 + bond.today / GIFT.ENOUGH);
    const warmth = fit * Math.sqrt(Math.min(item.price, GIFT.DEAREST)) * dulled;

    bond.warmth += warmth;
    bond.today += warmth;
    bond.given[itemId] = had + 1;
    remember(person, this.memoryOf(from, day));

    return {
      warmth,
      bond: bond.warmth,
      standing: Math.min(GIFT.KINDNESS, warmth * GIFT.CONSCIENCE),
      words: takenAs(fit),
      memory: { what: 'given', who: from, day },
      turned: before < GIFT.RETURNED && bond.warmth >= GIFT.RETURNED,
    };
  }

  /**
   * What this person does for you now, or nothing while the bond is not there yet. A trade with
   * nothing to give back, and anybody too young to have one, returns nothing however well you two
   * stand: a child cannot heal you and would not know where to start.
   */
  favourFrom(person: Person): Kindness | null {
    if (!this.favoured(person.id)) return null;
    return PAYS_BACK[person.trade] ?? null;
  }

  /**
   * Whatever they have put by for you today, without taking it. Standing arrangements never
   * appear here: a doctor who has stopped charging you is answered by `favourFrom` and by nothing
   * else, because there is nothing to collect and nothing to run out.
   */
  spareToday(person: Person, day: number): Kindness | null {
    const favour = this.favourFrom(person);
    if (!favour || !ONE_OFF.has(favour.kind)) return null;
    return (this.bonds.get(person.id)?.claimed ?? -1) >= day ? null : favour;
  }

  /** Take it. Asking twice in a day gets nothing, so a hunter's kill is a kill and not an orchard. */
  claim(person: Person, day: number): Kindness | null {
    const favour = this.spareToday(person, day);
    if (!favour) return null;
    this.bondWith(person.id, day).claimed = day;
    return favour;
  }

  /** What to hold on disk: one small record per person you have ever given anything to. */
  save(): Record<string, Bond> {
    return Object.fromEntries(this.bonds);
  }

  /** Their record, opened if it is new and wound on if the day has turned over since. */
  private bondWith(id: string, day: number): Bond {
    let bond = this.bonds.get(id);
    if (!bond) {
      bond = { warmth: 0, given: {}, day, today: 0, claimed: -1 };
      this.bonds.set(id, bond);
    }
    if (bond.day !== day) { bond.day = day; bond.today = 0; }
    return bond;
  }

  /**
   * What they are left carrying about it, which is how anybody else finds out you were generous:
   * you tell nobody, and they tell everybody. See gossip.ts for what it sounds like out loud.
   *
   * The cast goes the moment 'given' joins Memory.what in src/world/people.ts. It is here, once,
   * rather than at the call site, so that there is one line to delete.
   */
  private memoryOf(from: string, day: number): Memory {
    return { what: 'given', who: from, day } as unknown as Memory;
  }
}
