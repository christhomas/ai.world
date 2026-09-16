import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { eat } from './food';
import { deathless, type Person } from './people';

/**
 * The hero gets a row in the register, which is the keystone of everything else he could do here.
 *
 * He was not a `Person`. `Owner` comes from `ownedBy(person)` or `THE_HALL`, and the oath a player
 * swears at a hall stored a *name*. So a sworn trade paid him nothing, because `livelihoods.ts`
 * computes over register people and he was not one; he could hold no farm, yard or boat, because
 * owners are people and all three sorts already exist; and he could post no work, because posts
 * hang off holdings he could not hold.
 *
 * Everything a player would want was already built — for `Person`s. The missing edge was that the
 * player had no economic identity in the world he was standing in.
 *
 * ## The three exceptions, and why none of them is a rules dodge
 *
 * **He does not run out of days.** `deathless` is what `outOfDays` and the day's ageing both ask,
 * and it is a fact about a person rather than a branch at each caller. Immortal means he does not
 * die at sixty to ninety days; it does not mean he is safe — `health.ts` still kills him.
 *
 * **He is not in the village's dinner queue.** `eat` sorts richest first and its own comment says
 * *"a village's poor die first"*, so a hero on the roll would eat before every villager in every
 * place he walked into, out of a capped cellar. He never pays `FOOD.MEAL` there and never appears
 * in a village's dinner spend. He is not out of the food economy for it: he buys off the shelf,
 * which #231 made the village's own store, so what he eats a village is short.
 *
 * **He is raised again when he dies.** That is not an exception at all: `shrine.ts` already raises
 * villagers for `SHRINE_FEE`. The difference is that a villager is raised once, rarely, paid for by
 * the village, and comes back a blank stranger — and the hero is raised repeatedly, bills himself,
 * and keeps everything he knows. Different in the books, and therefore sayable in the world.
 */

/**
 * A village with more trades written against it than it has people to hold them, so there is work
 * standing vacant for somebody to swear to. A place where every trade is already held has nothing
 * an oath could be about.
 */
const village = (): Register => {
  const book = new Register(11, 1);
  book.settle('Ashford', 4, ['farmer', 'seller', 'doctor', 'smith', 'miner', 'sailor']);
  return book;
};

describe('a hero the register knows', () => {
  it('stands on the roll of the village he is in', () => {
    const book = village();
    const hero = book.arrive('Ashford', 'Rowan', 'man', 40);
    expect(hero).not.toBeNull();
    expect(book.living('Ashford').map((p) => p.name)).toContain('Rowan');
  });

  it('has one purse, which is the register\'s', () => {
    const book = village();
    const hero = book.arrive('Ashford', 'Rowan', 'man', 40)!;
    expect(hero.purse).toBe(40);
    expect(book.living('Ashford').find((p) => p.name === 'Rowan')!.purse).toBe(40);
  });

  it('can swear an oath the register counts, which is what a trade is', () => {
    const book = village();
    book.arrive('Ashford', 'Rowan', 'man', 40);
    const free = book.directoryOf('Ashford').nobodyDoing[0];
    expect(free, 'no vacancy to swear to').toBeTruthy();
    expect(book.swearIn('Ashford', free, 'Rowan')).not.toBeNull();
  });

  it('is somebody a villager can hold an opinion of, because he has a name on a row', () => {
    const book = village();
    const hero = book.arrive('Ashford', 'Rowan', 'man', 40)!;
    expect(hero.knows).toEqual([]);
    expect(hero.memories).toEqual([]);
    expect(hero.opinions).toEqual([]);
  });
});

describe('what a deathless person is exempt from', () => {
  const soul = (over: Partial<Person> = {}): Person => ({
    id: 'p1', name: 'Rowan', village: 'Ashford', sex: 'man', trade: 'farmer',
    born: 0, lives: 70, mother: '', father: '', knows: [], memories: [], opinions: [],
    purse: 40, hungry: 0, ...over,
  });

  it('says so about a hero and not about anybody else', () => {
    expect(deathless(soul({ deathless: true }))).toBe(true);
    expect(deathless(soul())).toBe(false);
  });

  it('is left out of the dinner queue even when he is the richest man there', () => {
    const villagers = [soul({ id: 'a', name: 'Ann', purse: 5 }), soul({ id: 'b', name: 'Bram', purse: 5 })];
    const hero = soul({ id: 'h', name: 'Rowan', purse: 4000, deathless: true });
    // one meal in the cellar, and a hero who would sort to the front of a queue ordered by purse
    const meal = eat([hero, ...villagers], 1);
    expect(meal.fed, 'a villager ate, not the hero').toBe(1);
    expect(hero.purse, 'a hero never pays for a village dinner').toBe(4000);
    expect(villagers.some((v) => v.hungry === 0), 'the meal went to somebody who lives there').toBe(true);
  });

  it('does not go hungry in a village that has nothing, because he is not eating out of it', () => {
    const hero = soul({ deathless: true, hungry: 0 });
    eat([hero], 0);
    expect(hero.hungry).toBe(0);
  });

  it('does not starve out of an empty cellar however long it is empty', () => {
    const hero = soul({ deathless: true });
    for (let day = 0; day < 40; day++) eat([hero], 0);
    expect(hero.hungry).toBe(0);
  });
});

/*
 * And the part that is not arithmetic: a hero is a *told* fact, like an oath or a raising. A seed
 * cannot imply that somebody walked into a village, so re-living has to be told about him.
 */
describe('a hero across a re-living', () => {
  it('is still standing there after the village is lived again', () => {
    const book = village();
    book.arrive('Ashford', 'Rowan', 'man', 40);
    for (let day = 2; day <= 20; day++) book.advance(day);
    // a death told about a morning already past is what makes the register re-live a village: it
    // founds the place again from the seed and lives it forward without that person. That is the
    // real path, and the one a hero has to survive — he is not in the seed, so if nothing put him
    // back he would simply stop existing
    const villager = book.living('Ashford').find((p) => p.name !== 'Rowan')!;
    expect(book.apply({ kind: 'died', id: villager.id, day: 12 } as never)).toBe(true);
    expect(book.living('Ashford').map((p) => p.name)).toContain('Rowan');
  });

  it('does not age out of the world while the village lives on', () => {
    const book = village();
    book.arrive('Ashford', 'Rowan', 'man', 40);
    for (let day = 2; day <= 200; day++) book.advance(day);
    expect(book.living('Ashford').map((p) => p.name), 'two hundred days is three lifetimes')
      .toContain('Rowan');
  });
});
