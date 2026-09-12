import { describe, expect, it } from 'vitest';
import { A_CREW_TAKES, A_DAY_OF_BUILDING, costOfFounding, whatTheHallFounds, whoFoundsAnother, whoIsPaidToRaiseIt } from './founding';
import { A_DAYS_HIRE, BEASTS_PER_FARM, THE_HALL, shareTheTake, sortOf, type Holding } from './holdings';
import { LIVELIHOOD } from './livelihoods';
import { PROSPER } from './prosperity';
import { STANDARD } from './roofs';
import type { Person } from './people';

/**
 * A holding that can be bought, and an owner who need not be the one in the field.
 *
 * The two halves of the same act: a farmer who has earned enough forms another farm, and a hall
 * that has money it cannot otherwise spend buys one back. What both of them turn on is the rule in
 * `shareTheTake` — what a holding earns belongs to whoever holds it, and whoever holds it pays
 * whoever works it a day's hire — so most of what is checked here is that the rule is exactly
 * nothing when the owner and the worker are the same man, which they are in every village in the
 * world that has not bought a farm.
 */

const villager = (id: string, trade: string, over: Partial<Person> = {}): Person => ({
  id, name: `${id} Vos`, village: 'Testing', sex: 'man', trade,
  born: 0, lives: 100, mother: '', father: '', knows: [], memories: [], opinions: [],
  purse: 20, hungry: 0, ...over,
} as Person);

const farm = (id: string, owner: string, worker: string): Holding =>
  ({ id, kind: 'farm', house: owner === THE_HALL ? '' : 'Vos', owner, worker, founded: 0 });

/** What a full paddock actually brings in over a day, which is what the wage has to sit under. */
const A_FARMS_DAY = BEASTS_PER_FARM * LIVELIHOOD.CALVES * LIVELIHOOD.PRICE_PER_BEAST;

describe('what a farm costs to found', () => {
  it('is the beasts in it plus the building over it, and nothing chosen', () => {
    expect(costOfFounding(sortOf('farm')!)).toBe(
      BEASTS_PER_FARM * LIVELIHOOD.PRICE_PER_BEAST + STANDARD.holds * A_CREW_TAKES * A_DAY_OF_BUILDING,
    );
  });

  it('is a shade dearer than the roof it is priced off, because it comes with something alive in it', () => {
    const roof = STANDARD.holds * A_CREW_TAKES * A_DAY_OF_BUILDING;
    const farmed = costOfFounding(sortOf('farm')!);
    expect(farmed).toBeGreaterThan(roof);
    expect(farmed - roof).toBe(BEASTS_PER_FARM * LIVELIHOOD.PRICE_PER_BEAST);
  });

  it('is reachable by a rich man and by a hall, and by nobody else', () => {
    // the whole point of a price is that somebody can pay it and most people cannot
    expect(costOfFounding(sortOf('farm')!)).toBeLessThan(PROSPER.MOST);
    expect(costOfFounding(sortOf('farm')!)).toBeGreaterThan(PROSPER.STOREY);
  });

  it('costs a boat nothing yet, because nobody has priced a hull', () => {
    const hull = costOfFounding(sortOf('boat')!);
    expect(hull).toBe(STANDARD.holds * A_CREW_TAKES * A_DAY_OF_BUILDING);
  });
});

describe('who is paid to raise it', () => {
  it('pays the builders where there are any', () => {
    const people = [villager('b', 'builder'), villager('f', 'farmer'), villager('s', 'seller')];
    const wages = whoIsPaidToRaiseIt(people, 300)!;
    expect([...wages.keys()]).toEqual(['b']);
    expect(wages.get('b')).toBe(300);
  });

  it('shares it among everybody who holds a trade where there are none', () => {
    const people = [villager('f', 'farmer'), villager('s', 'seller'), villager('k', '')];
    const wages = whoIsPaidToRaiseIt(people, 300)!;
    expect([...wages.keys()].sort()).toEqual(['f', 's']);
    expect([...wages.values()].reduce((sum, much) => sum + much, 0)).toBe(300);
  });

  it('says nobody at all where nobody holds a trade, which has to mean it cannot be built', () => {
    expect(whoIsPaidToRaiseIt([villager('k', '')], 300)).toBeNull();
  });
});

describe('what a holding earns, and whose it is', () => {
  it('moves not one coin when the owner is the man in the field', () => {
    const people = [villager('a', 'farmer'), villager('b', 'farmer')];
    const took = shareTheTake([farm('f1', 'a', 'a'), farm('f2', 'b', 'b')], 10, people);
    expect(took.toTheHall).toBe(0);
    expect(took.purses.get('a')).toBe(5);
    expect(took.purses.get('b')).toBe(5);
  });

  it('pays the hand a day and keeps the rest for the hall', () => {
    const people = [villager('hand', 'farmer')];
    const took = shareTheTake([farm('f1', THE_HALL, 'hand')], A_FARMS_DAY, people);
    expect(took.purses.get('hand')).toBe(A_DAYS_HIRE);
    expect(took.toTheHall).toBeCloseTo(A_FARMS_DAY - A_DAYS_HIRE, 6);
    expect(took.toTheHall).toBeGreaterThan(0);
  });

  it('never pays out of a paddock what the paddock did not make', () => {
    const people = [villager('hand', 'farmer')];
    const thin = shareTheTake([farm('f1', THE_HALL, 'hand')], 0.5, people);
    expect(thin.purses.get('hand')).toBe(0.5);
    expect(thin.toTheHall).toBe(0);
  });

  it('adds up to exactly what the day made, wherever it went', () => {
    const people = [villager('a', 'farmer'), villager('hand', 'farmer'), villager('rich', 'farmer')];
    const holdings = [farm('f1', 'a', 'a'), farm('f2', THE_HALL, 'hand'), farm('f3', 'rich', 'a')];
    for (const gold of [0, 1, 7.77, 13.371289]) {
      const took = shareTheTake(holdings, gold, people);
      const paid = [...took.purses.values()].reduce((sum, much) => sum + much, 0);
      expect(Math.abs(paid + took.toTheHall - gold)).toBeLessThan(0.02);
    }
  });

  it('treats an owner nobody answers to as the hall, so no coin leaves the world', () => {
    const people = [villager('hand', 'farmer')];
    const took = shareTheTake([farm('f1', 'ghost', 'hand')], 6, people);
    expect(took.purses.get('ghost')).toBeUndefined();
    expect(took.purses.get('hand')! + took.toTheHall).toBe(6);
  });
});

describe('a farmer forming another of his own', () => {
  const rich = (): Person => villager('rich', 'farmer', { purse: 2000 });

  it('is nobody at all in an ordinary village', () => {
    const people = [villager('a', 'farmer'), villager('b', 'seller')];
    expect(whoFoundsAnother('Testing', people, [farm('f1', 'a', 'a')], [], 30)).toBeNull();
  });

  it('is the richest man who already works one, and he pays for it', () => {
    const people = [rich(), villager('poor', 'farmer', { purse: 2000 })];
    const holdings = [farm('f1', 'rich', 'rich'), farm('f2', 'poor', 'poor')];
    const found = whoFoundsAnother('Testing', people, holdings, [], 30)!;
    expect(found.payer).toBe('poor');    // ties on purse go to the earlier id
    expect(found.costs).toBe(costOfFounding(sortOf('farm')!));
    expect([...found.wages.values()].reduce((sum, much) => sum + much, 0)).toBe(found.costs);
  });

  it('leaves it empty, because a man cannot be in two fields at once', () => {
    const people = [rich()];
    const found = whoFoundsAnother('Testing', people, [farm('f1', 'rich', 'rich')], [], 30)!;
    expect(found.holding.owner).toBe('rich');
    expect(found.holding.worker).toBe('');
    expect(found.holding.house).toBe('Vos');
    expect(found.holding.founded).toBe(30);
  });

  it('never leaves a man with nothing to eat on', () => {
    const barely = villager('rich', 'farmer', { purse: costOfFounding(sortOf('farm')!) + PROSPER.KEEPS_BACK });
    const short = villager('rich', 'farmer', { purse: costOfFounding(sortOf('farm')!) + PROSPER.KEEPS_BACK - 0.5 });
    expect(whoFoundsAnother('Testing', [barely], [farm('f1', 'rich', 'rich')], [], 30)).not.toBeNull();
    expect(whoFoundsAnother('Testing', [short], [farm('f1', 'rich', 'rich')], [], 30)).toBeNull();
  });

  it('never comes from somebody who works no holding, however rich: a doctor has no second surgery', () => {
    const doctor = villager('doc', 'doctor', { purse: 3900 });
    expect(whoFoundsAnother('Testing', [doctor], [], [], 30)).toBeNull();
  });

  it('waits while one of that sort already stands empty', () => {
    const people = [rich()];
    const standing = [farm('f1', 'rich', 'rich'), farm('f2', 'rich', '')];
    expect(whoFoundsAnother('Testing', people, standing, [], 30)).toBeNull();
  });
});

describe('the hall buying a farm back', () => {
  const townsfolk = (): Person[] => [villager('a', 'seller'), villager('b', 'hunter')];

  it('buys one for a village that has lost every farm it had', () => {
    const found = whatTheHallFounds('Testing', 4000, 0, townsfolk(), [], [], 0, 12)!;
    expect(found.payer).toBe(THE_HALL);
    expect(found.holding.owner).toBe(THE_HALL);
    expect(found.holding.house).toBe('');
    expect(found.holding.worker).toBe('');
    expect([...found.wages.values()].reduce((sum, much) => sum + much, 0)).toBe(found.costs);
  });

  it('buys exactly one, and then waits for somebody to stand in it', () => {
    const standing = [whatTheHallFounds('Testing', 4000, 0, townsfolk(), [], [], 0, 12)!.holding];
    expect(whatTheHallFounds('Testing', 4000, 0, townsfolk(), standing, [], 0, 13)).toBeNull();
  });

  it('will not buy while the paddocks it has are still filling', () => {
    const people = [...townsfolk(), villager('f', 'farmer')];
    const standing = [farm('f1', 'f', 'f')];
    expect(whatTheHallFounds('Testing', 4000, 0, people, standing, [], BEASTS_PER_FARM - 1, 12)).toBeNull();
    expect(whatTheHallFounds('Testing', 4000, 0, people, standing, [], BEASTS_PER_FARM, 12)).not.toBeNull();
  });

  it('never spends what the village is still saving for', () => {
    const cost = costOfFounding(sortOf('farm')!);
    expect(whatTheHallFounds('Testing', cost + 900, 900, townsfolk(), [], [], 0, 12)).toBeNull();
    expect(whatTheHallFounds('Testing', cost + 900 + 20, 900, townsfolk(), [], [], 0, 12)).not.toBeNull();
  });

  it('raises nothing in a village of children, however much is in the hall', () => {
    expect(whatTheHallFounds('Testing', 4000, 0, [villager('kid', '')], [], [], 0, 12)).toBeNull();
  });
});
