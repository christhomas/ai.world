import { describe, expect, it } from 'vitest';
import { MIND, compact, opinionOf, regardFor } from './memory';
import { LIFE, foundVillage, remember, type Person } from './people';
import { Register } from './register';

const TRADES = ['farmer', 'hunter', 'seller'];

/** Somebody who lives in Ashford, founded the ordinary way, with nothing yet on his mind. */
const villager = (): Person => foundVillage(1, 'Ashford', 4, TRADES)[0];

/**
 * A village lived through however many things, put away, and written down.
 *
 * The events are packed into a few days on purpose: that is the worst case for the size of the
 * file, because nothing has had time to fade out of anybody before the place is written.
 */
const villageWrittenAfter = (events: number, putAwayOn = 5): string => {
  const register = new Register(7);
  const people = register.settle('Ashford', 6, TRADES);
  for (let n = 0; n < events; n++) {
    remember(people[n % people.length], {
      what: n % 3 === 0 ? 'feared' : 'given',
      who: `soul ${n % 400}`,                     // four hundred names to have a view about
      day: 1 + Math.floor((n * 5) / Math.max(1, events)),
    });
  }
  register.compact(putAwayOn);
  return JSON.stringify(register.save());
};

/**
 * What a villager holds has to be bounded, because a province's saved leavings are everything
 * anybody ever did there and a list that only grows is a world that cannot be kept. The bound is
 * the easy half. The hard half is that bounding it must not mean forgetting: dropping the oldest is
 * how a villager loses a grudge he obviously still has, so what is tested hardest here is that the
 * sense of what happened survives the detail of it going.
 */
describe('what a villager keeps', () => {
  it('holds a bounded memory however much happens to him', () => {
    const person = villager();
    for (let n = 0; n < 10_000; n++) {
      remember(person, { what: 'given', who: `stranger ${n % 500}`, day: 1 + Math.floor(n / 40) });
    }

    expect(person.memories.length, 'the things themselves are the last couple and no more')
      .toBeLessThanOrEqual(LIFE.REMEMBERS);
    expect(person.opinions.length, 'five hundred people gave him something; he cannot hold five hundred views')
      .toBeLessThanOrEqual(MIND.OPINIONS);
  });

  it('turns ten slights into one opinion rather than into no opinion at all', () => {
    const bitten = villager();
    for (let day = 1; day <= 10; day++) remember(bitten, { what: 'feared', who: 'Blackrock', day });
    const once = villager();
    remember(once, { what: 'feared', who: 'Blackrock', day: 10 });

    const view = opinionOf(bitten, 'Blackrock', 10);
    expect(view, 'ten bad days down the same mine and he thinks nothing of the place').not.toBeNull();
    expect(view?.times, 'one opinion still has to be able to say how many things went into it').toBe(10);
    expect(regardFor(bitten, 'Blackrock', 10), 'and it has to be a cold one, not a filed one')
      .toBeLessThan(-MIND.FAINTEST);
    expect(regardFor(bitten, 'Blackrock', 10), 'ten of a thing must not feel the same as one of it')
      .toBeLessThan(regardFor(once, 'Blackrock', 10));
  });

  it('does not lose the first thing when the third happens, which is what the old list did', () => {
    const person = villager();
    remember(person, { what: 'given', who: 'the traveller', day: 1 });
    remember(person, { what: 'died', who: 'Greta Vos', day: 1 });
    remember(person, { what: 'died', who: 'Piet Vos', day: 1 });

    expect(person.memories.some((m) => m.who === 'the traveller'), 'two deep, so the gift is off the end of the list')
      .toBe(false);
    expect(regardFor(person, 'the traveller', 1), 'and off the end of the list is not the same as never having happened')
      .toBeGreaterThan(0);
  });

  it('keeps the one that struck hardest, whole, and lets the rest of them go', () => {
    const person = villager();
    for (let day = 1; day <= 5; day++) remember(person, { what: 'given', who: 'the traveller', day });
    remember(person, { what: 'saved', who: 'the traveller', day: 3 });
    for (let day = 6; day <= 10; day++) remember(person, { what: 'given', who: 'the traveller', day });

    const view = opinionOf(person, 'the traveller', 10);
    expect(view?.keenest?.what, 'eleven things happened and the one he would tell you about is the rescue')
      .toBe('saved');
    expect(view?.keenest?.day, 'kept whole, so he still has the day of it').toBe(3);
    expect(view?.times).toBe(11);
  });

  it('goes cold on its own, so nothing is held for ever by nobody being near it', () => {
    const person = villager();
    remember(person, { what: 'saved', who: 'the hero', day: 1 });
    const atOnce = regardFor(person, 'the hero', 1);

    expect(atOnce, 'somebody pulled him out from under an animal').toBeGreaterThan(0);
    expect(regardFor(person, 'the hero', 30)).toBeLessThan(atOnce);
    const spent = 1 + Math.ceil(atOnce / MIND.FADES_A_DAY);
    expect(regardFor(person, 'the hero', spent), 'and a season of not being seen spends it').toBe(0);
  });

  it('gets over a bad mine and does not get over a neighbour', () => {
    const person = villager();
    remember(person, { what: 'feared', who: 'Blackrock', day: 1 });
    remember(person, { what: 'died', who: 'Greta Vos', day: 1 });

    compact(person, 400);
    expect(person.opinions.map((o) => o.who), 'the mine has faded to nothing and the loss has not')
      .toEqual(['Greta Vos']);
  });

  it('drops on the way to disk only what had stopped being news', () => {
    const person = villager();
    remember(person, { what: 'died', who: 'Greta Vos', day: 20 });

    compact(person, 20 + MIND.STILL_NEWS);
    expect(person.memories.length, 'a villager would still raise this one unasked').toBe(1);

    compact(person, 20 + MIND.STILL_NEWS + 1);
    expect(person.memories, 'and past that it is worth only what it has already put into an opinion')
      .toEqual([]);
    expect(opinionOf(person, 'Greta Vos', 100), 'which is that he lost her').not.toBeNull();
  });

  it('writes a village down at a size that does not grow with how much happens in it', () => {
    const busy = villageWrittenAfter(2_000);
    const frantic = villageWrittenAfter(100_000);

    expect(frantic.length, `fifty times as much happened and the file went from ${busy.length} to ${frantic.length} bytes`)
      .toBeLessThanOrEqual(Math.ceil(busy.length * 1.1));
    for (const person of (JSON.parse(frantic) as Record<string, Person[]>)['Ashford']) {
      expect(person.opinions.length, `${person.name} holds too many views`).toBeLessThanOrEqual(MIND.OPINIONS);
      expect(person.memories.length, `${person.name} holds too much news`).toBeLessThanOrEqual(LIFE.REMEMBERS);
    }
  });

  it('writes a village nobody has been near down smaller than a village somebody has', () => {
    const justHappened = villageWrittenAfter(2_000, 5);
    const aSeasonLater = villageWrittenAfter(2_000, 200);

    expect(aSeasonLater.length, 'a village left alone for a season should have let most of it go')
      .toBeLessThan(justHappened.length / 2);
  });
});
