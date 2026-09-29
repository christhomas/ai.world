import { describe, expect, it } from 'vitest';
import { holdingIncomeFor } from './holdingincome';
import { aDaysDinner, aDaysTrade, whoFed } from './livelihoods';
import { ownedBy, type Holding } from './holdings';
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
});
