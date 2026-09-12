import { describe, expect, it } from 'vitest';
import {
  BEASTS_PER_FARM, SORTS, THE_HALL, canDo, capabilitiesOf, foundAHolding, heldBy, leavesAHolding,
  nameOfHolding, possibleHere, shareTheBeasts, sortOf, vacancies, whatTheVillageHolds,
  type Holding, type Village,
} from './holdings';
import { LIVELIHOOD } from './livelihoods';
import type { Person } from './people';
import { Register } from './register';
import type { Settlement } from './settlement';

/**
 * A capability is what somebody knows; a holding is the thing above it that outlives them.
 *
 * What these check, beyond the arithmetic, is the one claim the module makes that the rest of the
 * design leans on: bury a farmer and the village has lost a pair of arms and kept a farm, and bury a
 * doctor and it has lost the doctor outright. Everything about an owner who is not the worker
 * follows from that being true.
 */

const villager = (id: string, trade: string, over: Partial<Person> = {}): Person => ({
  id, name: `${id} Vos`, village: 'Testing', sex: 'man', trade,
  born: 0, lives: 100, mother: '', father: '', knows: [], memories: [], opinions: [],
  purse: 20, hungry: 0, ...over,
} as Person);

const hamlet = (people: Person[], works: string[] = [], holdings?: Holding[]): Village =>
  ({ people, works, holdings });

/** A village lived forward a few mornings, which is the only way holdings ever come into being. */
const lived = (village: Village, days = 1): Holding[] => {
  let held = village.holdings;
  for (let day = 0; day < days; day++) {
    held = whatTheVillageHolds('Testing', { ...village, holdings: held }, 30);
  }
  return [...(held ?? [])];
};

describe('what a trade teaches', () => {
  it('is nothing at all for most trades, which is why the list is four words and not eleven', () => {
    expect(capabilitiesOf('doctor')).toEqual([]);
    expect(capabilitiesOf('innkeeper')).toEqual([]);
    expect(capabilitiesOf('seller')).toEqual([]);
    expect(capabilitiesOf('farmer')).toEqual(['can_farm']);
  });

  it('is read off the trade rather than written onto the person, so it cannot drift', () => {
    const person = villager('one', 'seller');
    expect(canDo(person, 'can_farm')).toBe(false);
    person.trade = 'farmer';
    expect(canDo(person, 'can_farm')).toBe(true);
  });

  it('says a child knows nothing, because a trade comes with being grown', () => {
    expect(canDo(villager('kid', ''), 'can_farm')).toBe(false);
  });
});

describe('which trades leave something standing', () => {
  it('counts a farmer and not a doctor, which is the whole distinction', () => {
    expect(leavesAHolding('farmer')).toBe(true);
    expect(leavesAHolding('doctor')).toBe(false);
    expect(leavesAHolding('innkeeper')).toBe(false);
  });

  it('counts a miner as leaving nothing, because a seam belongs to the mountain', () => {
    expect(canDo(villager('pit', 'miner'), 'can_mine')).toBe(true);
    expect(leavesAHolding('miner')).toBe(false);
  });
});

describe('what a place has to have first', () => {
  it('lets a farm stand anywhere and a boat only where there is a jetty', () => {
    expect(possibleHere(sortOf('farm')!, [])).toBe(true);
    expect(possibleHere(sortOf('boat')!, [])).toBe(false);
    expect(possibleHere(sortOf('boat')!, ['well', 'jetty'])).toBe(true);
  });
});

describe('a village working out what it holds', () => {
  it('gives every farmer a farm and everybody else none', () => {
    const held = lived(hamlet([
      villager('a', 'farmer'), villager('b', 'farmer'), villager('c', 'doctor'),
    ]));
    expect(held).toHaveLength(2);
    expect(held.every((one) => one.kind === 'farm')).toBe(true);
    expect(held.map((one) => one.worker).sort()).toEqual(['a', 'b']);
  });

  it('gives each of them a name nothing else in the village has', () => {
    const held = lived(hamlet([villager('a', 'farmer'), villager('b', 'farmer')]));
    expect(new Set(held.map((one) => one.id)).size).toBe(held.length);
    expect(held[0].id).toContain('Testing-farm');
  });

  it('settles, so a village that lives a week has the farms it had on the first morning', () => {
    const village = hamlet([villager('a', 'farmer'), villager('b', 'farmer')]);
    expect(lived(village, 7)).toEqual(lived(village, 1));
  });

  it('raises no boat inland however many fishermen wash up, because a boat needs a harbour', () => {
    const crew = [villager('a', 'fisherman'), villager('b', 'fisherman')];
    expect(lived(hamlet(crew))).toHaveLength(0);
    expect(lived(hamlet(crew, ['jetty']))).toHaveLength(2);
  });
});

describe('what a funeral does to a farm', () => {
  it('leaves it standing and hands it down the family, the way a purse goes down it', () => {
    const father = villager('dad', 'farmer', { name: 'Piet Vos' });
    const son = villager('son', 'farmer', { name: 'Jan Vos' });
    const before = lived(hamlet([father, son]));
    const farm = before.find((one) => one.owner === 'dad')!;

    const after = whatTheVillageHolds('Testing', hamlet([son], [], before), 40);
    const same = after.find((one) => one.id === farm.id)!;
    expect(same).toBeDefined();
    expect(same.owner).toBe('son');
    expect(same.house).toBe('Vos');
  });

  it('prefers a grown one of the name to a child of it', () => {
    const dead = villager('dad', 'farmer', { name: 'Piet Vos' });
    const child = villager('kid', '', { name: 'Anouk Vos', born: 38 });
    const aunt = villager('aunt', 'seller', { name: 'Greta Vos' });
    const before = lived(hamlet([dead, child, aunt]));
    const after = whatTheVillageHolds('Testing', hamlet([child, aunt], [], before), 40);
    expect(after[0].owner).toBe('aunt');
  });

  it('falls to the hall when the name has died out, because a farm does not divide', () => {
    const last = villager('last', 'farmer', { name: 'Piet Vos' });
    const stranger = villager('other', 'seller', { name: 'Greta Hoorn' });
    const before = lived(hamlet([last, stranger]));
    const after = whatTheVillageHolds('Testing', hamlet([stranger], [], before), 40);
    expect(after).toHaveLength(1);
    expect(after[0].owner).toBe(THE_HALL);
    expect(after[0].house).toBe('');
    expect(after[0].worker).toBe('');
  });

  it('leaves the hall holding a vacancy rather than a farm that walked off', () => {
    const before = lived(hamlet([villager('a', 'farmer', { name: 'Piet Vos' })]));
    const empty = whatTheVillageHolds('Testing', hamlet([], [], before), 40);
    expect(vacancies(empty)).toHaveLength(1);
  });

  it('never moves the hall\'s own, because a treasury outlives everybody', () => {
    const hand = villager('hand', 'farmer', { name: 'Piet Vos' });
    const hall: Holding = {
      id: 'Testing-farm-9', kind: 'farm', house: '', owner: THE_HALL, worker: 'hand', founded: 0,
    };
    const after = whatTheVillageHolds('Testing', hamlet([], [], [hall]), 40);
    expect(after[0].owner).toBe(THE_HALL);
    expect(after[0].worker).toBe('');
    expect(hand.trade).toBe('farmer');
  });

  it('takes nothing from a doctor, so losing one costs a village differently', () => {
    const held = lived(hamlet([villager('doc', 'doctor')]));
    expect(held).toHaveLength(0);
    expect(whatTheVillageHolds('Testing', hamlet([], [], held), 40)).toHaveLength(0);
  });
});

describe('an owner who is not the worker', () => {
  it('puts a spare pair of arms into a standing farm before raising a new one', () => {
    const hall: Holding = {
      id: 'Testing-farm-1', kind: 'farm', house: '', owner: THE_HALL, worker: '', founded: 0,
    };
    const held = whatTheVillageHolds('Testing', hamlet([villager('a', 'farmer')], [], [hall]), 30);
    expect(held).toHaveLength(1);
    expect(held[0].owner).toBe(THE_HALL);
    expect(held[0].worker).toBe('a');
  });

  it('leaves the owner owning it while somebody else works it', () => {
    const owner = villager('owner', 'seller', { name: 'Greta Vos' });
    const hired = villager('hired', 'farmer', { name: 'Jan Hoorn' });
    const theirs: Holding = {
      id: 'Testing-farm-1', kind: 'farm', house: 'Vos', owner: 'owner', worker: '', founded: 0,
    };
    const held = whatTheVillageHolds('Testing', hamlet([owner, hired], [], [theirs]), 30);
    expect(held).toHaveLength(1);
    expect(heldBy(held, 'owner')).toHaveLength(1);
    expect(held[0].worker).toBe('hired');
  });

  it('gives an owner who can do the work his own back before anybody else is offered it', () => {
    const owner = villager('owner', 'farmer', { name: 'Greta Vos' });
    const other = villager('other', 'farmer', { name: 'Jan Hoorn' });
    const theirs: Holding = {
      id: 'Testing-farm-1', kind: 'farm', house: 'Vos', owner: 'owner', worker: '', founded: 0,
    };
    const held = whatTheVillageHolds('Testing', hamlet([owner, other], [], [theirs]), 30);
    expect(held.find((one) => one.id === 'Testing-farm-1')!.worker).toBe('owner');
  });

  it('is named for whoever holds it, or for the village when the hall does', () => {
    const theirs: Holding = {
      id: 'x', kind: 'farm', house: 'Vos', owner: 'owner', worker: 'owner', founded: 0,
    };
    expect(nameOfHolding(theirs)).toBe('the Vos farm');
    expect(nameOfHolding({ ...theirs, house: '', owner: THE_HALL })).toBe('the village farm');
  });

  it('can be founded by the hall with nobody in it yet', () => {
    const bought = foundAHolding('Testing', sortOf('farm')!, null, [], 12);
    expect(bought.owner).toBe(THE_HALL);
    expect(bought.worker).toBe('');
    expect(bought.house).toBe('');
    expect(bought.founded).toBe(12);
  });

  it('mints a name no earlier holding of the village has had', () => {
    const first = foundAHolding('Testing', sortOf('farm')!, null, [], 0);
    const second = foundAHolding('Testing', sortOf('boat')!, null, [first], 0);
    const third = foundAHolding('Testing', sortOf('farm')!, null, [first, second], 0);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });
});

describe('the herd, divided across the farms that keep it', () => {
  it('adds back up to the herd exactly, so no beast is invented or lost', () => {
    const farms = lived(hamlet([
      villager('a', 'farmer'), villager('b', 'farmer'), villager('c', 'farmer'),
    ]));
    // the long fractions are the point: a herd is what a rate of calving left, not a countable pile,
    // and a share rounded to the hundredth is where this was wrong for an afternoon
    for (const herd of [0, 1, 7, 13.371289143, 17.999999, 0.004]) {
      const share = shareTheBeasts(farms, herd);
      const total = [...share.values()].reduce((sum, much) => sum + much, 0);
      expect(Math.abs(total - herd)).toBeLessThan(1e-9);
    }
  });

  it('gives a village with no farms nothing to divide', () => {
    expect(shareTheBeasts([], 12).size).toBe(0);
  });

  it('agrees with the cap the economy has always used', () => {
    expect(LIVELIHOOD.HERD_PER_FARMER).toBe(BEASTS_PER_FARM);
    const farms = lived(hamlet([villager('a', 'farmer'), villager('b', 'farmer')]));
    const share = shareTheBeasts(farms, farms.length * BEASTS_PER_FARM);
    for (const beasts of share.values()) expect(beasts).toBeLessThanOrEqual(BEASTS_PER_FARM);
  });
});

describe('the one line the register has to add', () => {
  /**
   * A settlement is a village, structurally, and this is where that is proved.
   *
   * `holdings.ts` declares the least it needs rather than importing the register, which is what
   * keeps the two from asking each other questions — the mistake `rank.ts` and `growth.ts` paid an
   * hour for. The cost of declaring it separately is that nothing checks the two shapes still agree,
   * so this does: if `Settlement` ever stops satisfying `Village`, this stops compiling.
   */
  const settlementOf = (register: Register, name: string): Settlement => ({
    people: [...register.living(name)],
    raised: [], watch: '', purse: 0, food: 40, herd: register.herdOf(name),
    founded: 8, houses: 4, trades: register.tradesOf(name), buried: [], works: [],
  });

  it('hands a real village real farms, with the farmers it actually has in them', () => {
    const register = new Register(4242);
    register.settle('Oakhollow', 4, ['farmer', 'seller', 'doctor', 'miner']);
    const village = settlementOf(register, 'Oakhollow');
    village.holdings = whatTheVillageHolds('Oakhollow', village, register.today);

    const farmers = village.people.filter((person) => person.trade === 'farmer');
    expect(village.holdings).toHaveLength(farmers.length);
    expect(village.holdings.map((one) => one.worker).sort())
      .toEqual(farmers.map((person) => person.id).sort());
    expect(vacancies(village.holdings)).toHaveLength(0);
  });

  it('divides the herd that village actually has, to the beast', () => {
    const register = new Register(77);
    register.settle('Stonebeck', 5, ['farmer', 'hunter', 'innkeeper']);
    const village = settlementOf(register, 'Stonebeck');
    const held = whatTheVillageHolds('Stonebeck', village, register.today);
    const share = shareTheBeasts(held, village.herd);
    const total = [...share.values()].reduce((sum, much) => sum + much, 0);
    expect(Math.abs(total - village.herd)).toBeLessThan(1e-9);
  });
});

describe('the sorts of holding there are', () => {
  it('are worked by one capability each, so a spare pair of arms can only raise one thing', () => {
    const worked = SORTS.map((sort) => sort.worked);
    expect(new Set(worked).size).toBe(worked.length);
  });

  it('all have a word somebody standing at the gate would use', () => {
    for (const sort of SORTS) expect(sort.noun).not.toBe('');
  });

  it('leave a farmer with a farm and a miner with nothing, which is the two axes crossing', () => {
    expect(SORTS.some((sort) => canDo(villager('x', 'farmer'), sort.worked))).toBe(true);
    expect(SORTS.some((sort) => canDo(villager('x', 'miner'), sort.worked))).toBe(false);
  });
});
