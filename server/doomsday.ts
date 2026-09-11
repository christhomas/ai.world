import { FOOD, heartsLeft, lookingForFood } from '../src/world/food';
import { aDaysIncome, pitchFor } from '../src/world/livelihoods';
import { spentOnLiving } from '../src/world/prosperity';
import { ageOf } from '../src/world/people';
import type { Register } from '../src/world/register';
import type { EntityManager } from '../src/entities/manager';
import type { Village } from '../src/world/structures';

/**
 * The Domesday Book: everybody the world is holding, and what each of them is doing about it.
 *
 * Named by the person who asked for it, and the name is the right one — a survey of every soul in
 * the country, taken by the thing that owns them. It is the roster the game already has (`ui/roster.ts`)
 * asked of the *world* rather than of one page, and that difference is the whole reason it exists.
 *
 * ## Why it has to be here and not on a client
 *
 * A page holds villagers as guests. The world simulates them: their trees run here, their purses
 * move here, their register lives here. So there are things only this side knows, and the most
 * interesting of them is `doing` — the branch of a behaviour tree that claimed the last tick, which
 * is as close to "what is this person up to right now" as this game gets. It is not on the wire, so
 * a page cannot show it for anybody but its own hired men. Here it is simply a field on an entity
 * standing in a street.
 *
 * The same goes for the whole country at once. A page knows about the chunks near its player; the
 * world knows about every village in the seed, including the ones nobody has ever walked into. A
 * survey worth the name has to be taken by something that can see all of it.
 *
 * ## What it deliberately is not
 *
 * Not a way to change anything. `POST /operate` is the door that changes a world and it is guarded
 * by its own token; this is a window, and a window that only opens outward. Everything below is a
 * read of state that already exists — nothing is computed here that the game does not compute for
 * itself, and nothing is stored.
 *
 * Not a stream, yet. It answers "what is true now", and a caller that wants to watch the world
 * change asks again. Births and deaths *are* a stream — `Register.advance` hands back exactly that
 * list — and putting it here properly means keeping a log the register does not keep, which is a
 * decision about memory and is written up on the work list rather than guessed at.
 */

/** One soul, as the book has them. */
export interface Soul {
  id: string;
  name: string;
  village: string;
  trade: string;
  /** Years, as the clerk would read it out. */
  age: number;
  born: number;
  /** What they have put by. */
  purse: number;
  /** Days since they last ate, and what that has cost them. */
  hungry: number;
  hearts: number;
  /** Whether they have noticed and would do something about it. */
  starving: boolean;
  /** What the day is expected to pay them, and what it costs. */
  earns: number;
  spends: number;
  mother: string;
  father: string;
  /** What they are doing right now, when the world happens to have a body for them. */
  doing: string;
  /** And where that body is standing. Absent for anybody not presently drawn anywhere. */
  at?: { x: number; z: number };
}

/** One village, and how it is getting on. */
export interface Parish {
  name: string;
  x: number;
  z: number;
  houses: number;
  /** How many live here, and how many of those are children. */
  souls: number;
  children: number;
  /** What the place is worth between them. */
  worth: number;
  /** Meals in the store, and head of cattle in the paddock. */
  larder: number;
  herd: number;
  /** How hard something is leaning on it, nought to one. */
  pressure: number;
  fortune: string;
  /** Everybody on the roll. */
  people: Soul[];
}

/** The whole survey. */
export interface Doomsday {
  seed: number;
  day: number;
  /** How many souls the world is holding, across every village in it. */
  souls: number;
  /** And how many of them are on their feet somewhere, which is far fewer. */
  standing: number;
  parishes: Parish[];
}

/** As much of the world as a survey needs. Named as a shape so a test can stand one up. */
export interface Surveyed {
  seed: number;
  day: number;
  villages: readonly Village[];
  register: Register;
  /** The crowd the world is presently thinking for, or nothing where it is holding none. */
  crowd?: Pick<EntityManager, 'within'> | null;
}

/**
 * Take the survey.
 *
 * Pure in what it is handed, and it changes nothing: every number here is read off the register or
 * off a body standing in a street. A village nobody has ever visited is still surveyed — the
 * register founds it on being asked — which is the point of doing this from the world rather than
 * from a page.
 */
export function doomsdayOf(world: Surveyed): Doomsday {
  const day = Math.floor(world.day);
  /*
   * Whoever is on their feet, taken once for the whole country rather than per village.
   *
   * `within` is a walk of the crowd, so asking it per village would be one walk per village per
   * survey. A world with thirty villages in it and a survey on a timer is exactly where that stops
   * being free, and there is nothing about a village that narrows the search anyway — a man is
   * filed by where he is standing, not by where he is from.
   */
  const bodies = new Map<string, { doing: string; x: number; z: number }>();
  for (const e of world.crowd?.within(0, 0, Number.MAX_SAFE_INTEGER) ?? []) {
    if (e.person === '') continue;
    bodies.set(e.person, { doing: e.doing, x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10 });
  }

  const parishes: Parish[] = [];
  let souls = 0;
  for (const village of world.villages) {
    const living = world.register.living(village.name);
    if (living.length === 0 && world.register.emptiedOn(village.name) === null) continue;
    const pressure = world.register.pressureOn(village.name);
    const herd = world.register.herdOf(village.name);
    const income = aDaysIncome(living, herd, pressure, world.register.larderOf(village.name));

    const people: Soul[] = living.map((p) => {
      const body = bodies.get(p.id);
      return {
        id: p.id, name: p.name, village: p.village, trade: p.trade,
        age: ageOf(p, day), born: p.born,
        purse: Math.round(p.purse * 100) / 100,
        hungry: p.hungry ?? 0,
        hearts: heartsLeft(p),
        starving: lookingForFood(p),
        earns: Math.round((income.get(p.id) ?? 0) * 100) / 100,
        spends: Math.round((spentOnLiving(p) + pitchFor(p) + (p.trade ? FOOD.MEAL : 0)) * 100) / 100,
        mother: p.mother, father: p.father,
        doing: body?.doing ?? '',
        ...(body ? { at: { x: body.x, z: body.z } } : {}),
      };
    });

    souls += people.length;
    parishes.push({
      name: village.name, x: Math.round(village.x), z: Math.round(village.z),
      houses: village.houses.length,
      souls: people.length,
      children: people.filter((p) => p.trade === '').length,
      worth: Math.round(people.reduce((sum, p) => sum + p.purse, 0)),
      larder: Math.round(world.register.larderOf(village.name)),
      herd: Math.round(herd * 10) / 10,
      pressure: Math.round(pressure * 100) / 100,
      fortune: world.register.fortune(village.name),
      people,
    });
  }

  parishes.sort((a, b) => b.souls - a.souls || a.name.localeCompare(b.name));
  return {
    seed: world.seed,
    day,
    souls,
    standing: [...bodies.keys()].length,
    parishes,
  };
}
