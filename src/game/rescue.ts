import { hashString, mulberry32, type Rng } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { KINDS } from '../entities/animals';
import { canRecover, grownFolk, saidOf, type Fortune } from '../world/fortunes';
import { LIFE, type Person } from '../world/people';
import { compassDir, type Structures, type Village } from '../world/structures';
import { huntersOf } from './camp';
import type { Kindness } from './gifts';
import { hauntsOf } from './haunts';
import { meansOf } from './hire';

/**
 * A village that is losing people, and the work it will pay somebody to do about it.
 *
 * The register already knows how a place is doing: it was founded at a size and it has fewer
 * people than that, and `fortune` is that subtraction read out loud. So nothing here decides
 * whether a village is in trouble. It asks, and a village that is struggling or failing has
 * something to say and something to offer for it.
 *
 * What it offers is the decision the whole file turns on. A village pays out of what it actually
 * has, the way a soldier's price comes off `meansOf` in hire.ts: a market town with a pub can
 * find real money, a one-street village cannot find any, and a village that has stopped
 * replacing its dead can barely find a fifth of what it could have found a fortnight ago. So the
 * poorest villages, which are the ones nearest to going out entirely, are the ones with least to
 * hand you. That is deliberate, and it is why what they offer instead is not a consolation: coin
 * is spent and gone, and a village that has decided you never pay for a bed here again is a
 * change to the world that outlasts the purse. The scale in standing.ts is the other half of it,
 * and it is why saving a village that can pay nothing is the largest single good in the game.
 *
 * The one genuinely non-obvious decision is that only an ogre can be a haunt's share of this.
 * A wight keeps to the ground it is buried in and no blade touches it, so it is neither what is
 * emptying a village a mile off nor something anybody could be hired to deal with. An ogre roams
 * a long way past its own ground and can be killed, which makes it a cause and an answer at once.
 *
 * Nothing here mutates the register. The trouble says who it takes, the caller buries them, and
 * a village that is filling its houses again is the register doing what it always does.
 */

export const RESCUE = {
  /** How far from its square a village will name the wood its neighbours died in, in tiles. */
  REACH: 90,
  /** Nearer than this is the village's own fields, and nobody blames those. */
  NEAREST: 12,
  /** Share of villages whose own country has turned on them, where the country holds anything that hunts. */
  PREY_ON_US: 0.4,
  /** How many of a pack have to go before a village believes the nights are its own again. */
  CULL: 3,
  /** How near the named place a kill has to be to count towards that, in tiles. */
  GROUND: 20,
  /** Nights out of ten that whatever it is comes down to the houses at all. */
  NIGHTS: 0.6,
  /**
   * What it takes when it comes, as a share of who is left rather than a flat count.
   *
   * A flat count is a death sentence with a date on it: below the line where a village stops
   * replacing its dead, three a night takes a place from thriving to empty in three weeks
   * whatever anybody does, and there is no drama in a foregone conclusion. A share falls away as
   * the village does, so the decline is steep enough to notice within a session and then flattens
   * into a remnant clinging on. That is the shape the whole task wanted: somebody can arrive too
   * late to save everybody and still not be too late.
   */
  TAKES_SHARE: 0.14,
  /** Never fewer than this when it comes at all, or a small village would be safe by being small. */
  TAKES_LEAST: 1,
  /** And never more, however big the place: a raid is a raid, not a massacre. */
  TAKES_MOST: 3,
  /** What the poorest village still standing can scrape together for the work, in gold. */
  PURSE_LEAST: 20,
  /** And what a town with a market and a pub can put up for it. */
  PURSE_MOST: 120,
  /** What a village that has stopped replacing its dead can still find, as a share of that. */
  FAILING_PAYS: 0.2,
  /** Below this the coin is an insult, and the village offers what it has instead. */
  IN_KIND_BELOW: 40,
  /** What the country makes of somebody who saved a village that paid them handsomely. */
  CONSCIENCE_LEAST: 6,
  /** And of somebody who saved one that could pay them nothing at all. */
  CONSCIENCE_MOST: 30,
  /** How much of its own a village puts by for you, where putting things by is all it has. */
  SHARE: 3,
  /** And what its word is worth on the scale, for one with nothing at all to put by. */
  WORD: 3,
} as const;

/** As much of a village as a contract depends on: where it stands, and what it has. */
export type Asking = Pick<Village, 'name' | 'x' | 'z' | 'biome' | 'houses' | 'stalls' | 'pub' | 'shops'>;

/** What a village believes is killing it, and the place on the map it comes out of. */
export interface Trouble {
  /** The village doing the believing, which is also the stream every roll about it comes from. */
  village: string;
  /** The kind, as the spawn tables and the monster table name it. */
  kind: string;
  /** And as somebody who has buried a neighbour would say it: "the wolves", "the ogre". */
  said: string;
  /** A real named place, near enough that people from here have walked to it. */
  place: string;
  x: number;
  z: number;
  /** How far and which way, so the contract can be acted on without a marker. */
  tiles: number;
  dir: string;
  /** How many have to go before the village believes it is over. One, for a thing there is one of. */
  needed: number;
}

/** The work a village in trouble is offering, and everything it will say about it. */
export interface Contract {
  village: string;
  trouble: Trouble;
  /** Coin the village can actually raise. Nought for one whose purse will not stretch to the work. */
  gold: number;
  /** What it offers instead, which is a standing arrangement and not a present. */
  welcome: Kindness | null;
  /** What the scale in standing.ts should be moved by when the cause is dealt with. */
  goodwill: number;
  intro: string[];
  reminder: string;
  done: string[];
}

/** What settling up comes to, for the caller to apply: this module hands nothing over itself. */
export interface Settled {
  /** Gold to put in the purse. */
  gold: number;
  /** The arrangement the village has made with you from now on, or null where it paid in coin. */
  welcome: Kindness | null;
  /** What to pass to `Standing.gave`. */
  goodwill: number;
  /** What the elder says as they say it, for the flash. */
  words: string;
}

/** What one village's rescue has come to. Small, because most of a contract is derivable. */
export interface Kept {
  /** The day somebody took the work on. */
  took: number;
  /** How many of it have gone. */
  struck: number;
  /** Whether the village believes it is finished. */
  over: boolean;
  /** The day the village settled up, or -1 while nobody has been back to the elder. */
  paid: number;
  /** The arrangement it made, held because it outlives the contract that earned it. */
  welcome: Kindness | null;
}

/**
 * A stream of one village's own. Named off SALT.HAUNT because what keeps a place and what preys
 * on a village are the same question asked twice; the prefix on the string is what keeps the two
 * rolls from ever being the same roll.
 */
function streamFor(seed: number, about: string): Rng {
  return mulberry32(derive(seed, SALT.RESCUE) ^ hashString(about));
}

/**
 * A creature's name as a village would say it of more than one. Enough English for the handful of
 * kinds that can be a trouble, and no table of exceptions to go quietly stale behind it.
 */
function manyOf(label: string): string {
  return label.endsWith('f') ? `${label.slice(0, -1)}ves` : `${label}s`;
}

/** Every named place a villager could walk to and point at, nearest first. */
function placesNear(village: Asking, structures: Structures): Array<{ name: string; x: number; z: number; d: number }> {
  return [...structures.pois, ...structures.caves, ...structures.wrecks]
    .map((p) => ({ name: p.name, x: p.x, z: p.z, d: Math.hypot(p.x - village.x, p.z - village.z) }))
    .filter((p) => p.d > RESCUE.NEAREST && p.d < RESCUE.REACH)
    .sort((a, b) => a.d - b.d);
}

/** One place turned into the half of a Trouble that is about the map rather than the creature. */
function whereFrom(village: Asking, place: { name: string; x: number; z: number; d: number }) {
  return {
    place: place.name,
    x: place.x,
    z: place.z,
    tiles: Math.round(place.d),
    dir: compassDir(place.x - village.x, place.z - village.z),
  };
}

/**
 * The keeper of a place near enough to be the reason, where it is one that could be. See the note
 * at the top about why a wight never is.
 */
function ogreNear(seed: number, village: Asking, structures: Structures): Trouble | null {
  const kept = hauntsOf(seed, structures)
    .filter((h) => h.kind === 'ogre')
    .map((h) => ({ ...h, d: Math.hypot(h.x - village.x, h.z - village.z) }))
    .filter((h) => h.d > RESCUE.NEAREST && h.d < RESCUE.REACH)
    .sort((a, b) => a.d - b.d)[0];
  if (!kept) return null;
  return {
    village: village.name,
    kind: kept.kind,
    said: `the ${KINDS[kept.kind].label.toLowerCase()}`,
    ...whereFrom(village, kept),
    needed: 1,                                   // there is one of it, and everyone knows there is
  };
}

/**
 * The country's own hunters, where they have learned that people are easier than deer. Read off
 * the same spawn table the ground is populated from, so a biome that gains a predator gains this
 * with it and nobody has to remember to write the danger down twice.
 */
function packNear(seed: number, village: Asking, structures: Structures): Trouble | null {
  const hunting = huntersOf(village.biome);
  if (hunting.length === 0) return null;
  if (streamFor(seed, `pack:${village.name}`)() >= RESCUE.PREY_ON_US) return null;

  // the worst of what lives here: a wood with bears in it does not blame the foxes
  const worst = hunting.reduce((a, b) => ((KINDS[b.kind]?.dangerous ?? 0) > (KINDS[a.kind]?.dangerous ?? 0) ? b : a));
  const place = placesNear(village, structures)[0];
  if (!place) return null;                       // nowhere to send anybody is nowhere to blame

  return {
    village: village.name,
    kind: worst.kind,
    said: `the ${manyOf(KINDS[worst.kind].label.toLowerCase())}`,
    ...whereFrom(village, place),
    needed: RESCUE.CULL,
  };
}

/**
 * What is killing this village, or null for one with nothing worse than weather near it. A fact
 * about the world rather than about the contract: it is true of a village nobody has visited, and
 * true before anybody is short enough of neighbours to mention it.
 */
export function troubleNear(seed: number, village: Asking, structures: Structures): Trouble | null {
  return ogreNear(seed, village, structures) ?? packNear(seed, village, structures);
}

/**
 * What a village can raise for the work. `meansOf` prices what it has because what a place has is
 * what it earns, and the fortune on top of that is the same fact read again: a village that has
 * stopped replacing its dead has stopped bringing anything in either.
 */
export function purseOf(village: Asking, fortune: Fortune): number {
  const going = RESCUE.PURSE_LEAST + meansOf(village) * (RESCUE.PURSE_MOST - RESCUE.PURSE_LEAST);
  return Math.round(going * (fortune === 'failing' ? RESCUE.FAILING_PAYS : 1));
}

/**
 * What the country should make of it, which runs the other way from the pay. Somebody who took a
 * market town's hundred gold did a job; somebody who cleared a hamlet's wood for nothing did the
 * largest good the game has, and the scale is the only place that can say so.
 */
export function goodwillFor(gold: number): number {
  const paid = Math.max(0, Math.min(1, gold / RESCUE.PURSE_MOST));
  return Math.round(RESCUE.CONSCIENCE_LEAST + (1 - paid) * (RESCUE.CONSCIENCE_MOST - RESCUE.CONSCIENCE_LEAST));
}

/**
 * The standing arrangement a village makes when it cannot find the coin: shaped after
 * `favourFrom` in gifts.ts, and offered out of what the place actually has, which is the same
 * question the purse was. A village with nothing at all still has its word, and its word is worth
 * something on the scale.
 */
function welcomeFrom(village: Asking): Kindness {
  const has = new Set(village.shops.map((s) => s.type));
  if (has.has('inn')) return { kind: 'lodging', words: 'keeps a bed and a bowl for you here, and there will never be a bill.' };
  if (has.has('apothecary')) return { kind: 'mend', words: 'will not take your coin for a mending in this village again.' };
  if (has.has('store')) return { kind: 'goods', item: 'bread', count: RESCUE.SHARE, words: 'puts food by for you off the shelf, whenever you come.' };
  return { kind: 'word', standing: RESCUE.WORD, words: 'will say your name well in every village it can reach.' };
}

/**
 * How a village talks about what is out there. A pack and a single thing take different verbs,
 * and getting that wrong is the fastest way to make a line read as generated.
 */
function agrees(trouble: Trouble): { is: string; comes: string } {
  return trouble.needed > 1 ? { is: 'are', comes: 'They come' } : { is: 'is', comes: 'It comes' };
}

/** How the offer reads in a line, which is the only form of it anybody is shown. */
export function wordsFor(contract: Pick<Contract, 'gold' | 'welcome'>): string {
  if (contract.gold > 0) return `${contract.gold} gold, which is the whole of what we have`;
  return `no money at all: what we have is that this village ${contract.welcome?.words ?? 'will not forget you'}`;
}

/**
 * What the elder says will happen next. The struggling line is a promise the register keeps by
 * itself: a village below its founding size fills the gap it is carrying, so somebody who walks
 * back in a few days walks into children. The failing line is not a promise, because past that
 * point the register stops filling gaps and no amount of coming back will change it.
 */
export function recoveryWords(fortune: Fortune, village: string): string {
  if (fortune === 'failing') {
    return `We are too few to fill the houses again, and I will not pretend otherwise. But we will bury our own from now on, and ${village} will still be here to be buried in.`;
  }
  return `There will be children in ${village} inside the week. There have not been children here in a while.`;
}

/**
 * The work a village is offering, or null for one that is doing well enough, one that is already
 * empty, or one with nothing worse than weather near it.
 *
 * The fortune comes in rather than the register, because that is the whole of what this needs to
 * know about who is left: the caller reads `register.fortune(name)` and hands over the answer.
 */
export function contractFor(seed: number, village: Asking, structures: Structures, fortune: Fortune): Contract | null {
  if (fortune !== 'struggling' && fortune !== 'failing') return null;
  const trouble = troubleNear(seed, village, structures);
  if (!trouble) return null;

  const raised = purseOf(village, fortune);
  const gold = raised >= RESCUE.IN_KIND_BELOW ? raised : 0;
  const welcome = gold > 0 ? null : welcomeFrom(village);
  const offer = wordsFor({ gold, welcome });
  const { is, comes } = agrees(trouble);

  return {
    village: village.name,
    trouble,
    gold,
    welcome,
    goodwill: goodwillFor(gold),
    intro: [
      saidOf(fortune, village.name),
      `It is ${trouble.said}. ${comes} out of ${trouble.place}, ${trouble.dir} of here, some ${trouble.tiles} tiles. Everyone we have lost, we lost that way.`,
      `Go out there and finish it, and you shall have ${offer}.`,
    ],
    reminder: `${trouble.said.charAt(0).toUpperCase()}${trouble.said.slice(1)} ${is} still out at ${trouble.place}, ${trouble.dir} of here. We have not stopped burying.`,
    done: [
      'You went out there. You went out there, and you came back.',
      recoveryWords(fortune, village.name),
      `Take ${offer}.`,
    ],
  };
}

/**
 * Whether a kill counts towards a contract: the right thing, on the ground the village named.
 * A wolf shot forty tiles the other side of the village is a wolf, and is not this wolf.
 */
export function counts(trouble: Trouble, kind: string, x: number, z: number): boolean {
  return kind === trouble.kind && Math.hypot(trouble.x - x, trouble.z - z) <= RESCUE.GROUND;
}

/**
 * Who the trouble takes tonight: nobody most nights, and more than a village can replace when it
 * comes. Pure in seed, village and day, the way a night in the open is in camp.ts, so two people
 * watching the same village lose the same neighbours without a word passing between them.
 *
 * It takes the grown, who are the ones out at the fold and the wood pile. Where a village has run
 * down to children there is nobody else left to take, and it takes them.
 */
export function takenTonight(
  seed: number, trouble: Trouble, living: readonly Person[], day: number, fortune: Fortune = 'well',
): string[] {
  if (living.length === 0) return [];
  // A village already past saving is not raided further. What is left of it is barricaded in the
  // middle with nothing on the outskirts worth coming down for, and more to the point: a place
  // that is quietly finished off by a background number is a place nobody was ever given the
  // chance to save. It should sit there failing, and wait for somebody.
  if (!canRecover(fortune)) return [];
  const roll = streamFor(seed, `raid:${trouble.village}:${day}`);
  if (roll() >= RESCUE.NIGHTS) return [];

  const grown = grownFolk(living, day, LIFE.CHILD_UNTIL);
  const out = grown.length > 0 ? grown : [...living];
  const wanted = Math.max(
    RESCUE.TAKES_LEAST,
    Math.min(RESCUE.TAKES_MOST, Math.round(living.length * RESCUE.TAKES_SHARE)),
  );
  const taken: string[] = [];
  for (let n = 0; n < wanted && out.length > 0; n++) {
    taken.push(out.splice(Math.floor(roll() * out.length), 1)[0].id);
  }
  return taken;
}

/**
 * Which villages somebody agreed to help, how far they got, and what each village decided about
 * them for it.
 *
 * Kept apart from the register for the reason gifts are: the register is what a village is, which
 * is the same for everybody in the world, and this is what a village owes *you*, which travels
 * with the save. Whether a trouble still stands is the one thing here the world does need, and it
 * is the one thing the multiplayer log has to carry.
 */
export class Rescues {
  private readonly kept = new Map<string, Kept>();

  /** @param saved what the save had, or nothing for somebody who has helped nobody */
  constructor(saved: Record<string, Kept> = {}) {
    for (const [village, record] of Object.entries(saved)) this.kept.set(village, record);
  }

  /** Has somebody taken this village's work on? */
  taken(village: string): boolean {
    return (this.kept.get(village)?.took ?? -1) >= 0;
  }

  /**
   * Is the cause still out there? True of every village nobody has finished with, including the
   * ones nobody has spoken to: a trouble is a fact about the world and does not wait to be agreed.
   */
  stands(village: string): boolean {
    return !this.kept.get(village)?.over;
  }

  /** How many of it are left to deal with before the village will believe it is over. */
  left(trouble: Trouble): number {
    return Math.max(0, trouble.needed - (this.kept.get(trouble.village)?.struck ?? 0));
  }

  /** Has the work been done, with the village not yet paid up? */
  owed(village: string): boolean {
    const record = this.kept.get(village);
    return record !== undefined && record.over && record.paid < 0;
  }

  /** The arrangement a village made with you, or null: only a village you actually saved has one. */
  welcomeIn(village: string): Kindness | null {
    const record = this.kept.get(village);
    return record && record.paid >= 0 ? record.welcome : null;
  }

  /** Take the work on. False for a village whose work is already somebody's, or already done. */
  take(contract: Contract, day: number): boolean {
    if (this.taken(contract.village) || !this.stands(contract.village)) return false;
    this.record(contract.village).took = day;
    return true;
  }

  /**
   * One of it has gone. Returns how many are left, so a caller can say "two more" without asking
   * a second question. Kills only count against work somebody agreed to do: clearing a wood you
   * were never asked about is a wood cleared, and the village finds out the ordinary way.
   */
  strike(trouble: Trouble): number {
    if (!this.taken(trouble.village) || !this.stands(trouble.village)) return this.left(trouble);
    const record = this.record(trouble.village);
    record.struck++;
    record.over = record.struck >= trouble.needed;
    return this.left(trouble);
  }

  /**
   * Settle up. Null when there is nothing owed, and nothing whatever changes: what is handed over
   * is handed over by the caller, and a settlement that was refused is not a settlement.
   */
  settle(contract: Contract, day: number): Settled | null {
    if (!this.owed(contract.village)) return null;
    const record = this.record(contract.village);
    record.paid = day;
    record.welcome = contract.welcome;
    return {
      gold: contract.gold,
      welcome: contract.welcome,
      goodwill: contract.goodwill,
      words: contract.done[contract.done.length - 1],
    };
  }

  /** What to hold on disk: one short record per village anybody agreed to help. */
  save(): Record<string, Kept> {
    return Object.fromEntries(this.kept);
  }

  /** This village's record, opened if this is the first anybody has heard of it. */
  private record(village: string): Kept {
    let record = this.kept.get(village);
    if (!record) {
      record = { took: -1, struck: 0, over: false, paid: -1, welcome: null };
      this.kept.set(village, record);
    }
    return record;
  }
}
