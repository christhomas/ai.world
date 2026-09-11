import { describe, expect, it } from 'vitest';
import { Register } from '../world/register';
import { AWAY, buy, give, holds } from '../world/deeds';
import { nearestVillageTill, personTill, tradeTill, villageTill } from './tills';

/**
 * Where the hero's money goes, which until now was nowhere.
 *
 * The villagers stopped burning money the night the four livelihoods went in: what dinner costs
 * goes to whoever grew it, what a keep costs goes to whoever sold it, and `livelihoods.test.ts`
 * adds both sides up and holds them equal. The player was the one actor in the world exempt from
 * that. Every horse, ferry crossing, bed, bath house, house and hired sword was bought by
 * subtracting from `state.inventory.gold`, at fifteen sites, with nobody on the other end.
 *
 * So this is the same rule asked of the player: a village he spends money in is richer for it, by
 * exactly what he spent, and the only places a coin may appear or disappear are the ones that say
 * `AWAY` in so many words.
 */

/** A village with people and purses in it, lived far enough forward to have some money. */
function village(seed: number, on = 60) {
  const register = new Register(seed, on);
  const name = 'Testing';
  register.settle(name, 9, ['farmer', 'seller', 'innkeeper', 'soldier', 'hunter']);
  return { register, name };
}

const worth = (register: Register, name: string): number =>
  register.living(name).reduce((sum, p) => sum + p.purse, 0);

describe('a village as a place money lands', () => {
  it('is worth exactly what its people are worth between them', () => {
    const { register, name } = village(4);
    expect(villageTill(register, name).has).toBeCloseTo(worth(register, name), 6);
  });

  it('is richer by exactly what the hero spent in it', () => {
    const { register, name } = village(4);
    const hero = { gold: 500 };
    const before = worth(register, name);
    buy(holds(hero), villageTill(register, name), 120);
    expect(hero.gold).toBe(380);
    expect(worth(register, name)).toBeCloseTo(before + 120, 6);
  });

  it('spreads it rather than handing it all to one person', () => {
    const { register, name } = village(4);
    const purses = () => register.living(name).filter((p) => p.trade).map((p) => p.purse);
    const before = purses();
    villageTill(register, name).give(90);
    const moved = purses().filter((p, n) => p !== before[n]).length;
    expect(moved, 'a village where every coin from outside lands on one man').toBeGreaterThan(1);
  });

  it('pays out of the deepest purses when the village is the one paying', () => {
    const { register, name } = village(4);
    const hero = { gold: 0 };
    const before = worth(register, name);
    const paid = give(villageTill(register, name), holds(hero), 40);
    expect(paid.paid).toBeGreaterThan(0);
    expect(hero.gold).toBe(paid.paid);
    expect(worth(register, name)).toBeCloseTo(before - paid.paid, 6);
  });

  it('cannot pay what it has not got, and says so', () => {
    const { register, name } = village(4);
    const hero = { gold: 0 };
    const all = worth(register, name);
    const paid = give(villageTill(register, name), holds(hero), all + 5000);
    expect(paid.paid).toBeCloseTo(all, 6);
    expect(worth(register, name)).toBeCloseTo(0, 6);
  });
});

describe('a named person as a place money lands', () => {
  it('pays the man himself when the game knows who he is', () => {
    const { register, name } = village(4);
    const seller = register.living(name).find((p) => p.trade === 'seller');
    expect(seller, 'this seed raised no seller').toBeDefined();
    const hero = { gold: 300 };
    const before = seller!.purse;
    buy(holds(hero), personTill(register, seller!.id), 60);
    expect(seller!.purse).toBe(before + 60);
  });

  it('falls back to the village for somebody who has since been buried', () => {
    const { register, name } = village(4);
    const hero = { gold: 300 };
    const before = worth(register, name);
    buy(holds(hero), personTill(register, 'nobody-at-all', name), 60);
    expect(worth(register, name), 'the money went nowhere at all').toBeCloseTo(before + 60, 6);
  });

  it('gives up and lets it leave when there is no village to fall back to either', () => {
    const hero = { gold: 300 };
    buy(holds(hero), personTill(null, '', ''), 60);
    expect(hero.gold).toBe(240);
  });
});

describe('whoever is behind the counter', () => {
  it('is the named trade when the village has one', () => {
    const { register, name } = village(4);
    const keeper = register.living(name).find((p) => p.trade === 'innkeeper');
    if (!keeper) return;                                   // this seed raised none
    const hero = { gold: 100 };
    buy(holds(hero), tradeTill(register, name, 'innkeeper'), 9);
    expect(keeper.purse).toBeGreaterThan(0);
  });

  it('is somebody in the village even when the trade is not there', () => {
    const { register, name } = village(4);
    const hero = { gold: 100 };
    const before = worth(register, name);
    buy(holds(hero), tradeTill(register, name, 'astronaut'), 9);
    expect(worth(register, name)).toBeCloseTo(before + 9, 6);
  });
});

describe('somebody who is a voice rather than a person', () => {
  it('takes his money to the village he plainly lives in', () => {
    const { register, name } = village(4);
    const hero = { gold: 200 };
    const before = worth(register, name);
    const villages = [{ name, x: 0, z: 0 }];
    buy(holds(hero), nearestVillageTill(register, villages, 12, 9), 45);
    expect(worth(register, name)).toBeCloseTo(before + 45, 6);
  });

  it('lets it leave the world when there is nobody within miles', () => {
    // a pier on an empty island, a shrine on a moor. This is the one honest answer left
    const { register, name } = village(4);
    const hero = { gold: 200 };
    const before = worth(register, name);
    buy(holds(hero), nearestVillageTill(register, [{ name, x: 0, z: 0 }], 4000, 4000), 45);
    expect(hero.gold).toBe(155);
    expect(worth(register, name)).toBeCloseTo(before, 6);
  });
});

describe('the rest of the world', () => {
  it('takes money out and puts money in, and both have to be written down', () => {
    const hero = { gold: 50 };
    buy(holds(hero), AWAY, 20);
    expect(hero.gold).toBe(30);
    give(AWAY, holds(hero), 200);
    expect(hero.gold).toBe(230);
  });
});

/**
 * The last places the hero's money left the world.
 *
 * Fifteen sites were converted when the deed layer went in, and three were missed — all of them in
 * `meeting.ts` rather than in `game/interact/`, which is exactly how a site survives a sweep that
 * was aimed at a directory. A doctor's fee, a bed at an inn and a clerk's charge for looking
 * something up: each of them `state.inventory.gold -= price`, with nobody on the other end.
 *
 * There is no test here that can watch `meeting.ts` directly — it wants a whole talking context —
 * so what is pinned is the property those three now have in common, which is the one that matters:
 * paying somebody by name leaves the village exactly as much better off as the payer is worse.
 */
describe('paying somebody for a service', () => {
  it('leaves the village better off by what it cost', () => {
    const register = new Register(12, 40);
    register.settle('Testing', 9, ['doctor', 'innkeeper', 'farmer', 'soldier']);
    const doctor = register.living('Testing').find((p) => p.trade === 'doctor');
    expect(doctor, 'this seed raised no doctor').toBeDefined();

    const hero = { gold: 200 };
    const before = register.living('Testing').reduce((sum, p) => sum + p.purse, 0);
    buy(holds(hero), personTill(register, doctor!.id), 24);
    const after = register.living('Testing').reduce((sum, p) => sum + p.purse, 0);

    expect(hero.gold).toBe(176);
    expect(after - before, 'the fee went somewhere other than the man who earned it').toBeCloseTo(24, 6);
    expect(doctor!.purse, 'somebody else was paid for the doctor\'s work').toBeGreaterThan(0);
  });

  it('reaches the village when the service belongs to the place rather than a person', () => {
    // a town hall's books belong to the town; the person behind the desk is whoever is on duty
    const register = new Register(12, 40);
    register.settle('Testing', 9, ['doctor', 'innkeeper', 'farmer', 'soldier']);
    const hero = { gold: 200 };
    const before = register.living('Testing').reduce((sum, p) => sum + p.purse, 0);
    buy(holds(hero), villageTill(register, 'Testing'), 15);
    const after = register.living('Testing').reduce((sum, p) => sum + p.purse, 0);
    expect(after - before).toBeCloseTo(15, 6);
  });
});
