import { describe, expect, it } from 'vitest';
import { theVillageSpends, type TheDay } from './aday';
import { FIELD_CLEARING_COST, type FieldClearing } from './fieldbuilds';
import { costOfFounding } from './founding';
import {
  THE_HALL_OWNER, ownerFromSave, sortOf, type Holding, type Owner,
} from './holdings';
import type { Person } from './people';
import { PROSPER } from './prosperity';
import type { Settlement } from './settlement';

const person = (id: string, trade: string, purse: number): Person => ({
  id, name: `${id} Vos`, village: 'Testing', sex: 'man', trade,
  born: 0, lives: 100, mother: '', father: '', knows: [], memories: [], opinions: [],
  purse, hungry: 0,
});

const farm = (id: string, owner: string): Holding => ({
  id, kind: 'farm', house: 'Vos', owner: ownerFromSave(owner), worker: owner, founded: 0,
});

const villageOf = (people: Person[], holdings: Holding[]): Settlement => ({
  people, holdings, rank: 'village', raised: [], sworn: [], deeds: [], watch: '',
  hall: { id: THE_HALL_OWNER, body: 'mayor-house', purse: 0 },
  food: 1_000, herd: 0, founded: 8, houses: 4, trades: [], buried: [], works: [],
});

const clearing = (payer: Owner, holding: string): FieldClearing => ({
  payer, holding, costs: FIELD_CLEARING_COST,
  wages: new Map([[ownerFromSave('builder'), FIELD_CLEARING_COST]]),
  x: 1, z: 2, work: `field:${holding}:1,2`,
});

const morning = (offered: FieldClearing): TheDay => ({
  seed: 1,
  today: 1,
  pressureOn: () => 0,
  killedOn: () => undefined,
  taxed: () => undefined,
  waged: () => undefined,
  stableBought: () => null,
  takeOff: () => null,
  fieldToClear: () => offered,
});

describe('a field clearing beside a newly founded holding', () => {
  it('lets independent farmers make both purchases on the same morning', () => {
    const founder = person('founder', 'farmer', 2_000);
    const clearer = person('clearer', 'farmer', 1_000);
    const builder = person('builder', 'builder', 20);
    const village = villageOf(
      [founder, clearer, builder],
      [farm('Testing-farm-1', founder.id), farm('Testing-farm-2', clearer.id)],
    );
    const offered = clearing(ownerFromSave(clearer.id), 'Testing-farm-2');

    expect(founder.purse - costOfFounding(sortOf('farm')!)).toBeGreaterThanOrEqual(PROSPER.KEEPS_BACK);
    expect(clearer.purse - offered.costs).toBeGreaterThanOrEqual(PROSPER.KEEPS_BACK);
    theVillageSpends(morning(offered), 'Testing', village, 1);

    expect(village.holdings).toHaveLength(3);
    expect(village.holdings?.[2].owner).toBe(ownerFromSave(founder.id));
    expect(village.works).toContain(offered.work);
  });

  it('does not overdraw one farmer for two purchases', () => {
    const foundingCost = costOfFounding(sortOf('farm')!);
    const farmer = person('farmer', 'farmer', foundingCost + PROSPER.KEEPS_BACK);
    const builder = person('builder', 'builder', 20);
    const village = villageOf([farmer, builder], [farm('Testing-farm-1', farmer.id)]);
    const offered = clearing(ownerFromSave(farmer.id), 'Testing-farm-1');

    expect(farmer.purse - foundingCost).toBe(PROSPER.KEEPS_BACK);
    expect(farmer.purse - offered.costs).toBeGreaterThan(PROSPER.KEEPS_BACK);
    expect(farmer.purse - foundingCost - offered.costs).toBeLessThan(PROSPER.KEEPS_BACK);
    theVillageSpends(morning(offered), 'Testing', village, 1);

    expect(village.holdings).toHaveLength(2);
    expect(village.works).not.toContain(offered.work);
    expect(farmer.purse).toBeGreaterThanOrEqual(PROSPER.KEEPS_BACK);
  });
});
