import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { formAnOpinion, type Opinion } from './memory';
import { shortOf } from './vacancies';

/**
 * Who lives in a village, and what they are to one another.
 *
 * The founding families are grown from the seed, so two people in one world meet the same
 * villagers without a byte crossing between them — the same trick the terrain uses. What happens
 * afterwards is not derivable: somebody is born, somebody is taken by a wolf. Those go on the
 * world's log of changes, beside the opened chests and the sown fields.
 *
 * There is no register of the dead. When somebody dies they leave this list, and what remains of
 * them is a memory carried by the people who knew them — which is how you find out, by asking.
 * That is why a memory holds a *name* and not an id: a name still means something after the
 * person it belonged to is gone, and can never dangle.
 *
 * Relationships point one way for the same reason. A person knows five people by id; who knows
 * *them* is a question you ask the village, not a second list to keep in step.
 */

export const LIFE = {
  /** Days before a baby is a child, and a child an adult. */
  BABY_UNTIL: 8,
  CHILD_UNTIL: 16,
  /** A natural life, in days. Long enough to outlive somebody you knew, short enough to notice. */
  SHORTEST_LIFE: 60,
  LONGEST_LIFE: 90,
  /** Nobody keeps more than this many people in mind. */
  KNOWS: 5,
  /**
   * Nor more than this many things that happened to them, kept as the things themselves.
   *
   * It stays at two now that it is not the whole of a memory. What falls off the end is no longer
   * dropped: `memory.ts` has already folded it into an opinion of whoever it was about, so this is
   * the last couple of things somebody would raise unasked rather than everything they hold.
   */
  REMEMBERS: 2,
  /** Children per household at founding, at most. */
  CHILDREN: 2,
  /**
   * How often a grown child turns their back on the family trade and takes another.
   *
   * A farmer's child takes the farm, because that is how a trade has always been handed on and
   * because it is what makes a family mean anything: the register has drawn mothers and fathers
   * since the beginning and nothing in the world has ever read them. One in ten strikes out, which
   * is what stops a village ossifying into the same four households doing the same four jobs
   * forever — and what lets a village that has lost its only doctor ever get another.
   */
  STRIKES_OUT: 0.1,
} as const;

export type Stage = 'baby' | 'child' | 'adult';

/** Something that happened, worth carrying about. Named, so it outlives whoever it is about. */
export interface Memory {
  what: 'died' | 'born' | 'saved' | 'robbed' | 'given' | 'feared' | 'inherited';
  /**
   * The name of the person it happened to — or of the place, for the things that happen to a
   * place rather than to anybody. A mine that swallowed somebody is remembered by the mine's
   * name, which works for exactly the reason a dead person's name does: a name means something
   * after the thing it belonged to is gone, and can never dangle.
   */
  who: string;
  day: number;
}

export interface Person {
  id: string;
  name: string;
  village: string;
  /** Empty until they are grown; a trade comes with adulthood. */
  trade: string;
  /** The world day they were born. Everything about their age follows from it. */
  born: number;
  /** How many days they have, barring wolves. */
  lives: number;
  /** Parents by name rather than id: lineage is for talking about, and the dead are not kept. */
  mother: string;
  father: string;
  /** Up to five living people they know, by id. Pruned when one of them dies. */
  knows: string[];
  /** The last couple of things that happened around them, newest first. */
  memories: Memory[];
  /**
   * And what those things have added up to: a view per name, bounded and fading. See `memory.ts`
   * for why the list above cannot be the whole of a memory in a world that has to be written down.
   */
  opinions: Opinion[];
  /**
   * What they have put by, from trading in the same economy the player uses.
   *
   * On the person rather than on the entity standing in the street, because the entity is gone
   * the moment you walk away and the village was never a penny richer for anything that happened
   * in it. What this buys is a storey on their house, and after that what a village builds when
   * it has more than it needs.
   */
  purse: number;
  /**
   * Days running without a meal. Nought for anybody who ate today.
   *
   * Somebody goes without either because the village has no food or because they could not pay
   * for what there was, which is what makes a purse the difference between eating and not.
   */
  hungry: number;
}

/** Which part of a life somebody is in, on a given day. */
export function stageOf(person: Person, day: number): Stage {
  const age = ageOf(person, day);
  if (age < LIFE.BABY_UNTIL) return 'baby';
  if (age < LIFE.CHILD_UNTIL) return 'child';
  return 'adult';
}

/** How old, in days. */
export function ageOf(person: Person, day: number): number {
  return Math.max(0, day - person.born);
}

/** Whether a natural life has run out. Wolves are not this function's business. */
export function outOfDays(person: Person, day: number): boolean {
  return ageOf(person, day) >= person.lives;
}

/**
 * Add a memory, keeping only the last couple as things in themselves. The newest is first.
 *
 * The line that truncates used to be the whole of the bound, and it was an eviction: the third
 * thing to happen to somebody took the first one away and left nothing behind, so ten slights
 * became no opinion at all. It is a summary now — the opinion is formed here, on the way in, so
 * whatever falls off the end has already left its mark on how this person regards whoever it was
 * about. `memory.ts` holds the argument.
 */
export function remember(person: Person, memory: Memory): void {
  person.memories.unshift(memory);
  person.memories.length = Math.min(person.memories.length, LIFE.REMEMBERS);
  formAnOpinion(person, memory);
}

/**
 * How something that happened reaches the person it happened to.
 *
 * `remember` itself in a game with no world behind it: it goes into his head, and there is nobody
 * else who needs to know because there is nobody else. Where a world is holding the villagers it
 * goes into his head here *and* is said out loud, because the man standing in the street is the
 * world's and his memory has to be the world's too — otherwise the village you are in is whichever
 * machine you happen to be sitting at.
 *
 * The default is the quiet one everywhere it is offered, so nothing that has not been wired up to a
 * world behaves any differently from the way it always did.
 */
export type Remembering = (person: Person, memory: Memory) => void;

/**
 * The families a village is founded with, grown from the world seed and the village's name.
 *
 * They are not all born on day one. Ages are spread across a life so a village starts with
 * children, parents and the old in it, rather than a cohort who all die in the same week.
 */
/**
 * Found a village.
 *
 * `must` names trades the village cannot be without, because it has the thing that demands them.
 * Offering a trade is not the same as having one: a mining village drew its people from a weighted
 * list where `miner` was one option among a dozen, so out of seventeen villages only four had
 * anybody underground at all — and mining is where every coin in the world is minted. A trade the
 * place exists around has to be filled rather than hoped for.
 */
export function foundVillage(
  seed: number, village: string, houses: number, trades: string[], must: readonly string[] = [],
): Person[] {
  const rng = mulberry32(derive(seed, SALT.PEOPLE) ^ hashName(village));
  const people: Person[] = [];
  /**
   * How long somebody founded on day one has left, counted from the day they were born.
   *
   * The `already` is the whole of it, and leaving it out emptied every village in the world. A life
   * is sixty to ninety days; a founder is handed an age of up to fifty on the morning the village
   * is founded. Measured from birth, that is a village where half the adults die within a month —
   * and they die *together*, faster than the six per cent a day a village replaces itself at, so it
   * crosses the line below which `fillTheGaps` gives up and never comes back.
   *
   * Measured on seed 1 before this: thirty people on day one, twenty-one by day five, nine by day
   * twenty, seven by day sixty, with nobody hungry and nobody killed. Not a hard winter — arithmetic.
   *
   * So the roll is what they have *left*, and their age is added to it. A village founded with
   * grandparents in it still has them for a season, and its deaths arrive spread out, which is what
   * a birth rate can keep up with.
   */
  const lifeOf = (already: number): number =>
    already + Math.round(LIFE.SHORTEST_LIFE + rng() * (LIFE.LONGEST_LIFE - LIFE.SHORTEST_LIFE));

  const families: string[] = [];
  for (let house = 0; house < Math.max(1, houses); house++) {
    const family = familyName(rng, families);
    families.push(family);
    const household: string[] = [];
    const under = (person: Person): Person => { household.push(firstNameOf(person)); return person; };

    // a couple, somewhere in the middle of their lives
    const motherBorn = -Math.round(20 + rng() * 30);
    const fatherBorn = -Math.round(20 + rng() * 30);
    const mother = under(born(rng, people.length, village, trades, motherBorn, lifeOf(-motherBorn), family, household));
    const father = under(born(rng, people.length + 1, village, trades, fatherBorn, lifeOf(-fatherBorn), family, household));
    people.push(mother, father);

    for (let n = 0; n < Math.floor(rng() * (LIFE.CHILDREN + 1)); n++) {
      const childBorn = -Math.round(rng() * LIFE.CHILD_UNTIL);
      const child = under(born(rng, people.length, village, trades, childBorn, lifeOf(-childBorn), family, household));
      child.mother = mother.name;
      child.father = father.name;
      child.trade = '';                        // a trade comes with growing up
      people.push(child);
    }
  }

  // whatever the village cannot be without, somebody is doing. Taken from the last grown-up who
  // is not already doing one of these jobs, and a farmer last of all: a place can survive nobody
  // going down the mine for a week, and cannot survive nobody putting dinner on the table.
  const grown = people.filter((p) => p.trade !== '');
  for (const trade of must) {
    if (grown.some((p) => p.trade === trade)) continue;
    const spare = [...grown].reverse().find((p) => p.trade !== 'farmer' && !must.includes(p.trade))
      ?? [...grown].reverse().find((p) => !must.includes(p.trade));
    if (spare) spare.trade = trade;
  }

  // and everybody knows a handful of their neighbours
  for (const one of people) {
    const others = people.filter((p) => p !== one && p.name !== one.mother && p.name !== one.father);
    for (let n = 0; n < LIFE.KNOWS && others.length > 0; n++) {
      one.knows.push(others.splice(Math.floor(rng() * others.length), 1)[0].id);
    }
  }
  return people;
}

function born(
  rng: () => number, index: number, village: string, trades: string[], bornOn: number, lives: number,
  family: string, household: string[] = [],
): Person {
  return {
    id: `${village.replace(/[^A-Za-z]/g, '')}-${index}`,
    name: `${givenName(rng, household)} ${family}`,
    village,
    trade: trades.length > 0 ? trades[Math.floor(rng() * trades.length)] : '',
    born: bornOn,                              // negative: they were already here on day one
    lives,
    mother: '',
    father: '',
    knows: [],
    memories: [],
    opinions: [],
    purse: 0,
    hungry: 0,
  };
}

/**
 * What somebody takes up when they come of age.
 *
 * Three things decide it, in this order: what the village is short of, what their parents did, and
 * a roll. Until now it was only the roll, which made a village a bag of jobs that happened to
 * contain some people. A trade is inherited: a farmer's child takes the
 * farm, a miner's child goes down the same shaft, and a household is a thing that persists rather
 * than a surname two people happen to share.
 *
 * Both parents are looked at and one of them followed, so a farmer who marries a miner raises one
 * of each over time — and `LIFE.STRIKES_OUT` of them follow neither. That last part is not a
 * flourish: without it a village whose only doctor dies childless has no way of ever having a
 * doctor again, and every village converges on whichever trades happened to breed best.
 *
 * The dead count. A parent is usually buried by the time their child is grown, and a farm handed
 * on at a funeral is the ordinary case rather than the exception — so the churchyard is searched
 * when the living do not know the name. `Burial` keeps a trade for exactly this sort of question.
 */
export function tradeTakenUp(
  person: Person, trades: readonly string[], village: Village, rng: () => number,
): string {
  /*
   * What the village is short of comes first, because inheritance on its own is drift: every
   * funeral is a chance to lose a trade and no funeral is ever a chance to gain one back. The
   * threshold in `shortOf` is a whole person, which in a village of a dozen means the jobs a place
   * cannot be without — so this fills the fields and the market and leaves the doctor, the
   * innkeeper and the climber to families and to the tenth who strike out.
   */
  const vacancy = shortOf(trades, village.people.filter((p) => p.trade !== '').map((p) => p.trade));
  if (vacancy) return vacancy;

  const rolled = () => trades[Math.floor(rng() * trades.length)];
  const family = [person.mother, person.father]
    .map((name) => tradeOnceHeldBy(village, name))
    .filter((trade) => trade !== '' && trades.includes(trade));
  if (family.length === 0 || rng() < LIFE.STRIKES_OUT) return rolled();
  return family[Math.floor(rng() * family.length)];
}

/** Whoever a village can be asked about: the living, and the stones that are still legible. */
interface Village {
  people: readonly Person[];
  buried: readonly { name: string; trade: string }[];
}

/** What somebody of this name did for a living, living or buried. Empty for a stranger. */
function tradeOnceHeldBy(village: Village, name: string): string {
  if (name === '') return '';
  const living = village.people.find((p) => p.name === name);
  if (living) return living.trade;
  // newest first: a name can be reused down the years, and the recent stone is the parent
  for (let at = village.buried.length - 1; at >= 0; at--) {
    if (village.buried[at].name === name) return village.buried[at].trade;
  }
  return '';
}

/**
 * Names are a given name and a family name, and a household shares the family name — which is
 * what makes "Greta Vos died" mean something to you when you have already met Piet Vos.
 *
 * The given names are the ones villagers have always had in this game; the family names exist so
 * that a world of hundreds does not run out and start repeating.
 */
const GIVEN = [
  'Ella', 'Tomas', 'Greta', 'Piet', 'Anouk', 'Rolf', 'Maren', 'Jory', 'Hild', 'Oskar',
  'Bram', 'Neel', 'Saskia', 'Joost', 'Lieve', 'Wim', 'Fenna', 'Dirk', 'Roos', 'Kees',
];
const FAMILY = [
  'Vos', 'Bakker', 'Mulder', 'Smit', 'Rietveld', 'Haan', 'Bos', 'Kroon',
  'Waal', 'Linden', 'Meer', 'Dijk', 'Veld', 'Stroom', 'Berg', 'Hout',
  'Kamp', 'Hoorn', 'Reijn', 'Doorn', 'Elzen', 'Grave', 'Nagel', 'Ruiter',
];

/**
 * A given name, avoiding any already in use under the same roof — otherwise a village turns up
 * couples called Jory Haan and Jory Haan, and a memory about one is a memory about both.
 */
export function givenName(rng: () => number, taken: readonly string[] = []): string {
  const free = GIVEN.filter((name) => !taken.includes(name));
  const pool = free.length > 0 ? free : GIVEN;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * A family name, avoiding the ones already in the village. Two households sharing a surname is
 * how you end up with two different people called Lieve Smit, and a village where being told
 * about one of them tells you nothing.
 */
export function familyName(rng: () => number, taken: readonly string[] = []): string {
  const free = FAMILY.filter((name) => !taken.includes(name));
  const pool = free.length > 0 ? free : FAMILY;
  return pool[Math.floor(rng() * pool.length)];
}

/** The given half of somebody's name. */
export function firstNameOf(person: Person): string {
  return person.name.split(' ')[0];
}

/** The family half, which is what a household shares. */
export function surnameOf(person: Person): string {
  return person.name.split(' ').slice(1).join(' ');
}

/** A stable number for a name, so a village founds the same families every time. */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
