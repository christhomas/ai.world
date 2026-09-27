import { describe, expect, it } from 'vitest';
import { cartFinished, cartLoaded, CarrierBook, type CarrierFact, type CartLoaded, type CartFinished } from './carrierbook';
import { Register } from './register';
import { ownedBy } from './holdings';
import type { Settlement } from './settlement';

const FROM = 'Barrowgate';
const TO = 'Stonerock';
const FROM_TRADES = ['farmer', 'seller', 'builder', 'innkeeper'];
const TO_TRADES = ['builder', 'seller', 'innkeeper', 'doctor'];

function villages(day = 1): Register {
  const register = new Register(7, day, () => {}, 'journaled');
  register.settle(FROM, 6, FROM_TRADES);
  register.settle(TO, 6, TO_TRADES);
  return register;
}

function loadFor(register: Register) {
  const seller = register.living(FROM)[0];
  const buyer = [...register.living(TO)].sort((a, b) => b.purse - a.purse)[0];
  expect(seller).toBeDefined();
  expect(buyer).toBeDefined();
  expect(register.larderOf(FROM)).toBeGreaterThan(1);
  expect(buyer.purse).toBeGreaterThan(0.01);
  return cartLoaded(3, {
    from: FROM, to: TO, meals: 1, price: 0.01,
    paying: new Map([[ownedBy(buyer), -0.01]]),
    paid: new Map([[ownedBy(seller), 0.01]]),
  });
}

function finishFor(load: CartLoaded, outcome: 'delivered' | 'robbed', day = 4): CartFinished {
  return { kind: 'cart-finished', day, loadedOn: load.day, outcome,
    receiving: outcome === 'delivered' ? load.paid : load.paying.map(([id, amount]) => [id, -amount]) };
}

function state(register: Register, village: string) {
  return {
    food: register.larderOf(village),
    purses: register.living(village).map((person) => [person.id, person.purse]),
    hall: register.hallOf(village)?.purse,
  };
}

describe('dated carrier facts', () => {
  it('keeps a loaded cart in flight and records robbery without buyer payment or goods', () => {
    const robbed = villages();
    robbed.advance(2);
    const load = loadFor(robbed);
    expect(robbed.recordCarrier(load)).toBe(true);
    robbed.advance(3);
    const before = state(robbed, TO);
    expect(robbed.carriedBy(load.paying[0][0])).toBeCloseTo(-0.01);
    expect(robbed.recordCarrier(finishFor(load, 'robbed'))).toBe(true);
    robbed.advance(4);

    const stillLoaded = villages();
    stillLoaded.advance(2);
    stillLoaded.recordCarrier(load);
    stillLoaded.advance(4);
    expect(state(robbed, FROM)).toEqual(state(stillLoaded, FROM));
    expect(robbed.larderOf(TO)).toEqual(stillLoaded.larderOf(TO));
    const buyer = load.paying[0][0];
    expect(robbed.living(TO).find((person) => person.id === buyer)!.purse)
      .toBeCloseTo(stillLoaded.living(TO).find((person) => person.id === buyer)!.purse + 0.01);
    expect(robbed.carriedBy(load.paying[0][0])).toBeCloseTo(0.01);
    expect(before.food).toBeGreaterThanOrEqual(0);
  });

  it('replays exact payer and payee maps after save, including late village reliving', () => {
    const forward = villages();
    forward.advance(2);
    const load = loadFor(forward);
    const finish = finishFor(load, 'delivered');
    expect(forward.recordCarrier(load)).toBe(true);
    forward.advance(3);
    expect(forward.carriedBy(load.paid[0][0])).toBe(0);
    expect(forward.recordCarrier(finish)).toBe(true);
    forward.advance(4);
    expect(forward.carriedBy(load.paid[0][0])).toBeCloseTo(0.01);
    expect(forward.carriedBy(load.paying[0][0])).toBe(0);

    const saved = JSON.parse(JSON.stringify(forward.carrierFacts())) as CarrierFact[];
    const replay = new Register(7, 4, () => {}, 'journaled');
    for (const fact of saved) expect(replay.recordCarrier(fact)).toBe(true);
    replay.settle(FROM, 6, FROM_TRADES);
    replay.settle(TO, 6, TO_TRADES);
    expect(state(replay, FROM)).toEqual(state(forward, FROM));
    expect(state(replay, TO)).toEqual(state(forward, TO));

    const late = villages();
    late.advance(2);
    expect(late.recordCarrier(load)).toBe(true);
    late.advance(4);
    expect(late.recordCarrier(finish)).toBe(true);
    expect(state(late, FROM)).toEqual(state(forward, FROM));
    expect(state(late, TO)).toEqual(state(forward, TO));

    const outOfOrder = villages(4);
    expect(outOfOrder.recordCarrier(finish)).toBe(true);
    expect(outOfOrder.recordCarrier(load)).toBe(true);
    expect(state(outOfOrder, FROM)).toEqual(state(forward, FROM));
    expect(state(outOfOrder, TO)).toEqual(state(forward, TO));

    forward.foundOn(FROM, 6, ['builder']);
    forward.foundOn(FROM, 6, FROM_TRADES);
    forward.foundOn(TO, 6, ['builder']);
    forward.foundOn(TO, 6, TO_TRADES);
    expect(state(forward, FROM)).toEqual(state(replay, FROM));
    expect(state(forward, TO)).toEqual(state(replay, TO));
    expect(forward.carrierFacts()).toEqual(saved);
  });

  it('refuses duplicate or unbalanced records before they can change a purse', () => {
    const register = villages();
    register.advance(2);
    const load = loadFor(register);
    const book = new CarrierBook();
    expect(book.record({ ...load, paid: [[load.paid[0][0], 0.02]] })).toBe(false);
    expect(book.record(load)).toBe(true);
    expect(book.record(load)).toBe(false);
    expect(book.record(finishFor(load, 'robbed'))).toBe(true);
    expect(book.record(finishFor(load, 'delivered'))).toBe(false);
  });

  it('refunds a dead buyer through its hall and replays the same escrow after reliving', () => {
    const forward = villages();
    forward.advance(2);
    const load = loadFor(forward);
    forward.recordCarrier(load);
    forward.advance(4);
    const payer = load.paying[0][0];
    expect(forward.apply({ kind: 'died', id: payer, name: '', village: TO, day: 4, cause: 'violence' }))
      .toBe(true);
    const finish = cartFinished(5, load, 'robbed', new Map([[TO, forward.madeOf(TO) as Settlement]]));
    expect(finish.receiving).toEqual([[forward.hallOf(TO)!.id, 0.01]]);
    forward.recordCarrier(finish);
    forward.advance(5);

    const replay = new Register(7, 5, () => {}, 'journaled');
    replay.apply({ kind: 'died', id: payer, name: '', village: TO, day: 4, cause: 'violence' });
    replay.recordCarrier(load);
    replay.recordCarrier(finish);
    replay.settle(FROM, 6, FROM_TRADES);
    replay.settle(TO, 6, TO_TRADES);
    expect(state(replay, FROM)).toEqual(state(forward, FROM));
    expect(state(replay, TO)).toEqual(state(forward, TO));
    expect(replay.hallOf(TO)!.purse).toBeGreaterThan(0);
  });
});
