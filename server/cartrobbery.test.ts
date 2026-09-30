import { describe, expect, it } from 'vitest';
import { Register } from '../src/world/register';
import { cartLoaded, cartPosition, type CartFinished } from '../src/world/carrierbook';
import { growPatch } from '../src/world/growworld';
import { boundsOf } from '../src/world/patchwork';
import type { RoadGraph } from '../src/world/graph';
import type { GroundWorld } from '../src/world/groundworld';
import type { Village } from '../src/world/structures';
import { ownedBy } from '../src/world/holdings';
import { priceOfAMeal } from '../src/world/prices';
import { cartGuarded, robLoadedCart } from './cartrobbery';
import { walkedFoot } from './footing';
import { carrierOnRoad } from './carrieractor';

const FROM = 'Barrowgate';
const TO = 'Stonerock';
const places = [{ name: FROM, x: 0, z: 0 }, { name: TO, x: 20, z: 0 }];
const straightRoad = { nodes: places.map(({ x, z }) => ({ x, z })),
  edges: [{ a: 0, b: 1 }] } as RoadGraph;

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

function mealPrice(register: Register, village: string): number {
  return priceOfAMeal(register.larderOf(village), register.living(village));
}

function purseTotal(register: Register): number {
  return [FROM, TO].reduce((sum, village) => sum + (register.hallOf(village)?.purse ?? 0)
    + register.living(village).reduce((people, person) => people + person.purse, 0), 0);
}

function moneyAt(register: Register, village: string): number {
  return (register.hallOf(village)?.purse ?? 0)
    + register.living(village).reduce((sum, person) => sum + person.purse, 0);
}

describe('a player robbing an in-flight cart', () => {
  it('uses only a current server-walked surface position on foot', () => {
    const ground = { heightAt: () => 2 };
    const player = {
      standingIn: 'surface', presence: { riding: 'foot' }, hero: { x: 10, z: 0 },
      serverFootAt: { x: 10, z: 0 },
    };
    expect(walkedFoot(player, ground)).toEqual({ x: 10, z: 0 });
    expect(walkedFoot({ ...player, serverFootAt: null }, ground)).toBeNull();
    expect(walkedFoot({ ...player, presence: { riding: 'horse' } }, ground)).toBeNull();
    expect(walkedFoot({ ...player, hero: { x: 20, z: 0 } }, ground)).toBeNull();
    expect(walkedFoot(player, { heightAt: () => null })).toBeNull();
  });

  it('is stopped by another escort only while that escort stays beside this cart', () => {
    const robber = { escortingCart: null, standingIn: 'surface', hero: { x: 10, z: 0 } };
    const guard = { escortingCart: 3, standingIn: 'surface', hero: { x: 11, z: 0 } };
    expect(cartGuarded([robber, guard], robber, 3, { x: 10, z: 0 })).toBe(true);
    guard.hero.x = 20;
    expect(cartGuarded([robber, guard], robber, 3, { x: 10, z: 0 })).toBe(false);
    guard.hero.x = 11;
    guard.escortingCart = 2;
    expect(cartGuarded([robber, guard], robber, 3, { x: 10, z: 0 })).toBe(false);
    expect(cartGuarded([robber], robber, 3, { x: 10, z: 0 })).toBe(false);
  });
  it('records one replayable robbery and settles both villages without creating money', () => {
    const forward = world();
    const before = world();
    const loaded = load(forward);
    expect(forward.recordCarrier(loaded)).toBe(true);
    forward.advance(3);
    before.advance(3);
    const written: CartFinished[] = [];
    const robbed = robLoadedCart(forward, 3, 0.5, { x: 10, z: 0 }, places, loaded.day,
      (fact) => { written.push(fact); return true; }, straightRoad, 'Rowan',
      '11111111-1111-4111-8111-111111111111');
    expect(robbed?.outcome).toBe('robbed');
    expect(robbed?.robber).toBe('Rowan');
    expect(robbed?.robberId).toBe('11111111-1111-4111-8111-111111111111');
    expect(written).toEqual([robbed]);
    expect(forward.larderOf(FROM)).toBeCloseTo(before.larderOf(FROM) - loaded.meals);
    expect(state(forward, TO)).toEqual(state(before, TO));
    expect({ ...state(forward, FROM), food: state(before, FROM).food }).toEqual(state(before, FROM));
    expect(mealPrice(forward, FROM)).toBeGreaterThanOrEqual(mealPrice(before, FROM));
    expect(mealPrice(forward, TO)).toBeCloseTo(mealPrice(before, TO));
    expect(purseTotal(forward)).toBeCloseTo(purseTotal(before));
    expect(forward.carrierFacts()).toEqual([loaded, robbed]);

    const replay = world();
    for (const fact of JSON.parse(JSON.stringify(forward.carrierFacts()))) {
      expect(replay.recordCarrier(fact)).toBe(true);
    }
    expect(replay.carrierFacts()).toEqual(forward.carrierFacts());
    replay.advance(3);
    expect(state(replay, FROM)).toEqual(state(forward, FROM));
    expect(state(replay, TO)).toEqual(state(forward, TO));
  });

  it('checks interception against the road route rather than a straight line between villages', () => {
    const register = world();
    const loaded = load(register);
    register.recordCarrier(loaded);
    register.advance(3);
    const nodes = [[0, 0], [0, 10], [20, 10], [20, 0]].map(([x, z]) => ({ x, z }));
    const graph = { nodes, edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }] } as RoadGraph;
    expect(robLoadedCart(register, 3, 0.5, { x: 10, z: 0 }, places, 3, () => true, graph)).toBeNull();
    expect(robLoadedCart(register, 3, 0.5, { x: 10, z: 10 }, places, 3, () => true, graph)?.outcome)
      .toBe('robbed');
  });

  it('shows the loaded meals on a named carrier and removes him after robbery', () => {
    const register = world();
    const loaded = load(register);
    register.recordCarrier(loaded);
    register.advance(3);
    const ground = { roadGraphAt: () => straightRoad, heightAt: () => 2 } as unknown as GroundWorld;
    const villages = places as Village[];
    const seen = carrierOnRoad(register, villages, ground, 3, 0.5);
    expect(seen).toMatchObject({ kind: 'villager', x: 10, z: 0,
      who: { name: `Carrier to ${TO}`, doing: `carrying ${loaded.meals} meals` } });
    robLoadedCart(register, 3, 0.5, { x: 10, z: 0 }, places, 3, () => true, straightRoad);
    expect(carrierOnRoad(register, villages, ground, 3, 0.5)).toBeNull();
  });

  it('refuses distant, stale, repeated, or unpersisted robbery requests', () => {
    const register = world();
    const loaded = load(register);
    register.recordCarrier(loaded);
    register.advance(3);
    const write = () => true;
    expect(robLoadedCart(register, 3, 0.5, { x: 18, z: 0 }, places, 3, write, straightRoad)).toBeNull();
    expect(robLoadedCart(register, 4, 0.5, { x: 10, z: 0 }, places, 3, write, straightRoad)).toBeNull();
    expect(robLoadedCart(register, 3, 0.5, { x: 10, z: 0 }, places, 3, () => false, straightRoad)).toBeNull();
    expect(register.carrierFacts()).toEqual([loaded]);
    expect(robLoadedCart(register, 3, 0.5, { x: 10, z: 0 }, places, 3, write, straightRoad)).not.toBeNull();
    expect(robLoadedCart(register, 3, 0.5, { x: 10, z: 0 }, places, 3, write, straightRoad)).toBeNull();
  });

  it('keeps a cross-patch carrying virtual without a road route and still settles its trade', () => {
    const west = growPatch(3, boundsOf('0,0'));
    const east = growPatch(3, boundsOf('1,0'));
    const from = west.structures.villages.find((v) => v.name === 'Stoneham')!;
    const to = east.structures.villages.find((v) => v.name === 'Whitewick')!;
    const register = new Register(3, 3, () => {}, 'journaled');
    register.theyStandAt([from, to]);
    register.settle(from.name, 8, ['farmer', 'seller', 'builder', 'innkeeper']);
    register.settle(to.name, 8, ['builder', 'seller', 'innkeeper', 'doctor']);
    register.setLarder(from.name, 100);
    register.setLarder(to.name, 0);
    for (const person of register.living(to.name)) person.purse = 200;
    const load = register.prepareCarrier();
    expect(load).toMatchObject({ from: 'Stoneham', to: 'Whitewick', meals: 20 });
    const senderFood = register.larderOf(from.name), receiverFood = register.larderOf(to.name);
    const senderMoney = moneyAt(register, from.name), receiverMoney = moneyAt(register, to.name);
    expect(register.recordCarrier(load!)).toBe(true);
    expect(register.larderOf(from.name)).toBeCloseTo(senderFood - load!.meals);
    expect(register.larderOf(to.name)).toBe(receiverFood);
    expect(moneyAt(register, from.name)).toBeCloseTo(senderMoney);
    expect(moneyAt(register, to.name)).toBeCloseTo(receiverMoney - load!.meals * load!.price);
    const midpoint = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
    expect(west.probe(midpoint.x, midpoint.z).roadDist).toBeGreaterThan(30);
    expect(cartPosition(load!, 0.5, [from, to], west.graph)).toBeNull();
    const ground = { roadGraphAt: () => west.graph, heightAt: () => 2 } as unknown as GroundWorld;
    expect(carrierOnRoad(register, [from, to], ground, 3, 0.5)).toBeNull();
    expect(robLoadedCart(register, 3, 0.5, midpoint, [from, to], 3, () => true, west.graph)).toBeNull();
    expect(register.carrierFacts()).toEqual([load]);
    register.advance(4);
    const beforeDelivery = {
      senderFood: register.larderOf(from.name), receiverFood: register.larderOf(to.name),
      senderMoney: moneyAt(register, from.name), receiverMoney: moneyAt(register, to.name),
    };
    const delivered = register.finishCarrier(3, 'delivered');
    expect(delivered?.outcome).toBe('delivered');
    expect(register.recordCarrier(delivered!)).toBe(true);
    expect(register.larderOf(from.name)).toBeCloseTo(beforeDelivery.senderFood);
    expect(register.larderOf(to.name)).toBeCloseTo(beforeDelivery.receiverFood + load!.meals);
    expect(moneyAt(register, from.name)).toBeCloseTo(beforeDelivery.senderMoney + load!.meals * load!.price);
    expect(moneyAt(register, to.name)).toBeCloseTo(beforeDelivery.receiverMoney);
    expect(register.carrierFacts()).toEqual([load, delivered]);
  });
});
