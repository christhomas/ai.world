import { describe, expect, it } from 'vitest';
import { holdingIncomeFor } from './holdingincome';
import { aDaysDinner, aDaysTrade, whoFed } from './livelihoods';
import { THE_HALL_OWNER, ownedBy, type Holding } from './holdings';
import { broughtIn } from './food';
import { LIVELIHOOD } from './livelihoods';
import type { Person } from './people';

const farmer = (id: string): Person => ({ id, name: id, village: 'Ashford', sex: 'man',
  trade: 'farmer', born: 0, lives: 100, mother: '', father: '', knows: [], memories: [],
  opinions: [], purse: 100, hungry: 0 });

describe('attributing money already paid to a farm', () => {
  it('uses the cattle split and the actual dinner pool for two holdings of one owner', () => {
    const owner = farmer('owner');
    const hand = farmer('hand');
    const people = [owner, hand];
    const holdings: Holding[] = [
      { id: 'first', kind: 'farm', house: '', owner: ownedBy(owner), worker: owner.id, founded: 1 },
      { id: 'second', kind: 'farm', house: '', owner: ownedBy(owner), worker: hand.id, founded: 1 },
    ];
    const work = aDaysTrade(people, 2 * LIVELIHOOD.HERD_PER_FARMER, 0, { holdings });
    const meal = aDaysDinner(people, 0, work);
    const rows = holdingIncomeFor(5, people, work, meal.paid);
    expect(rows.map((row) => row.holding)).toEqual(['first', 'second']);
    expect(rows.every((row) => row.cattle > 0 && row.crop > 0)).toBe(true);
    const actualCattle = work.holdingIncome.cattle.reduce((sum, row) => sum + row.take, 0);
    expect(rows.reduce((sum, row) => sum + row.cattle, 0)).toBeCloseTo(actualCattle, 10);
    const ownerPaid = meal.paid.get(ownedBy(owner)) ?? 0;
    const ownerContributed = whoFed(people, work.meat, work.shore, work.fish, work.fields)
      .get(ownedBy(owner)) ?? 0;
    const fieldMeals = work.holdingIncome.fields.reduce((sum, row) => sum + row.meals, 0);
    expect(ownerPaid).toBeGreaterThan(0);
    expect(rows.reduce((sum, row) => sum + row.crop, 0))
      .toBeCloseTo(ownerPaid * fieldMeals / ownerContributed, 10);
  });

  /*
   * A hall that owns a farm keeps what the farm makes after its hand's wage: `postings.ts` says so
   * and `shareTheTake` does it for the cattle. The field crop used to go wholly to the hand,
   * because the hall is not a person and `fieldCrop` paid only people. #486.
   */
  it('gives a hall-owned farm\'s field crop to the hall, as it keeps the cattle take', () => {
    const hand = farmer('hand');
    const neighbour = { ...farmer('neighbour'), trade: 'soldier' };
    const people = [hand, neighbour];
    const holdings: Holding[] = [
      { id: 'hall-farm', kind: 'farm', house: '', owner: THE_HALL_OWNER, worker: hand.id, founded: 1 },
    ];
    const work = aDaysTrade(people, LIVELIHOOD.HERD_PER_FARMER, 0, { holdings });
    const field = work.holdingIncome.fields.find((row) => row.holding === 'hall-farm');
    expect(field?.meals, 'the hall farm grew nothing, so there is no crop to follow').toBeGreaterThan(0);
    expect(work.holdingIncome.cattle.find((row) => row.holding === 'hall-farm')?.owner).toBe(THE_HALL_OWNER);

    expect(field!.owner, 'the crop was addressed to the hand').toBe(THE_HALL_OWNER);
    const fed = whoFed(people, work.meat, work.shore, work.fish, work.fields);
    expect(fed.get(THE_HALL_OWNER)).toBeCloseTo(field!.meals, 10);
    const meat = work.meat;   // the herd's meat is the farmers' trade, not the farm's
    expect(fed.get(ownedBy(hand))).toBeCloseTo(broughtIn(hand, work.shore, 0) + meat, 10);

    const meal = aDaysDinner(people, 0, work);
    expect(meal.paid.get(THE_HALL_OWNER), 'the hall was paid nothing for its field').toBeGreaterThan(0);
    // and the dinner money is the same money, only addressed differently: the same village with
    // the farm in the hand's own name pays out exactly as much between them
    const own = aDaysTrade(people, LIVELIHOOD.HERD_PER_FARMER, 0,
      { holdings: [{ ...holdings[0], owner: ownedBy(hand) }] });
    const sum = (paid: ReadonlyMap<string, number>) => [...paid.values()].reduce((all, much) => all + much, 0);
    expect(sum(meal.paid)).toBeCloseTo(sum(aDaysDinner(people, 0, own).paid), 10);

    const row = holdingIncomeFor(5, people, work, meal.paid).find((one) => one.holding === 'hall-farm');
    expect(row?.owner).toBe(THE_HALL_OWNER);
    expect(row!.crop).toBeCloseTo(meal.paid.get(THE_HALL_OWNER)!, 10);
  });
});
