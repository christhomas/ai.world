import { describe, expect, it } from 'vitest';
import { Register } from '../src/world/register';
import { cartLoaded, type CartFinished } from '../src/world/carrierbook';
import { ownedBy } from '../src/world/holdings';
import { robLoadedCart } from './cartrobbery';

const FROM = 'Barrowgate';
const TO = 'Stonerock';
const places = [{ name: FROM, x: 0, z: 0 }, { name: TO, x: 20, z: 0 }];

function world() {
  const register = new Register(7, 1, () => {}, 'journaled');
  register.settle(FROM, 6, ['farmer', 'seller', 'builder', 'innkeeper']);
  register.settle(TO, 6, ['builder', 'seller', 'innkeeper', 'doctor']);
  register.advance(2);
  return register;
}

function load(register: Register) {
  const seller = register.living(FROM)[0];
  const buyer = [...register.living(TO)].sort((a, b) => b.purse - a.purse)[0];
  expect(register.larderOf(FROM)).toBeGreaterThan(1);
  expect(buyer.purse).toBeGreaterThan(0.01);
  return cartLoaded(3, { from: FROM, to: TO, meals: 1, price: 0.01,
    paying: new Map([[ownedBy(buyer), -0.01]]),
    paid: new Map([[ownedBy(seller), 0.01]]) });
}

function state(register: Register, village: string) {
  return { food: register.larderOf(village),
    purses: register.living(village).map((person) => [person.id, person.purse]),
    hall: register.hallOf(village)?.purse };
}

describe('a player robbing an in-flight cart', () => {
  it('records one replayable robbery and settles both villages without creating money', () => {
    const forward = world();
    const before = world();
    const loaded = load(forward);
    expect(forward.recordCarrier(loaded)).toBe(true);
    forward.advance(3);
    before.advance(3);
    const written: CartFinished[] = [];
    const robbed = robLoadedCart(forward, 3, 0.5, { x: 10, z: 0 }, places, loaded.day,
      (fact) => { written.push(fact); return true; });
    expect(robbed?.outcome).toBe('robbed');
    expect(written).toEqual([robbed]);
    expect(forward.larderOf(FROM)).toBeCloseTo(before.larderOf(FROM) - loaded.meals);
    expect(state(forward, TO)).toEqual(state(before, TO));
    expect(forward.living(FROM).map((p) => p.purse)).toEqual(before.living(FROM).map((p) => p.purse));
    expect(forward.carrierFacts()).toEqual([loaded, robbed]);

    const replay = world();
    for (const fact of JSON.parse(JSON.stringify(forward.carrierFacts()))) {
      expect(replay.recordCarrier(fact)).toBe(true);
    }
    replay.advance(3);
    expect(state(replay, FROM)).toEqual(state(forward, FROM));
    expect(state(replay, TO)).toEqual(state(forward, TO));
  });

  it('refuses distant, stale, repeated, or unpersisted robbery requests', () => {
    const register = world();
    const loaded = load(register);
    register.recordCarrier(loaded);
    register.advance(3);
    const write = () => true;
    expect(robLoadedCart(register, 3, 0.5, { x: 18, z: 0 }, places, 3, write)).toBeNull();
    expect(robLoadedCart(register, 4, 0.5, { x: 10, z: 0 }, places, 3, write)).toBeNull();
    expect(robLoadedCart(register, 3, 0.5, { x: 10, z: 0 }, places, 3, () => false)).toBeNull();
    expect(register.carrierFacts()).toEqual([loaded]);
    expect(robLoadedCart(register, 3, 0.5, { x: 10, z: 0 }, places, 3, write)).not.toBeNull();
    expect(robLoadedCart(register, 3, 0.5, { x: 10, z: 0 }, places, 3, write)).toBeNull();
  });
});
