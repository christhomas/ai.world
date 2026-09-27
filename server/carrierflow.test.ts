import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Register } from '../src/world/register';
import { advanceWorldCarriers } from './carrierflow';
import { SharedWorld, worldPath } from './world';
import { FileVault } from './filevault';
import { cleanDelta, mayReport } from './protocol';

const A = 'Barrowgate', B = 'Stonerock';
const AT = ['farmer', 'seller', 'builder', 'innkeeper'];
const BT = ['builder', 'seller', 'innkeeper', 'doctor'];

function register(day = 1): Register {
  const book = new Register(7, day, () => {}, 'journaled');
  book.settle(A, 6, AT);
  book.settle(B, 6, BT);
  return book;
}

function state(book: Register) {
  return [A, B].map((village) => ({
    village, food: book.larderOf(village), hall: book.hallOf(village)?.purse,
    purses: book.living(village).map((person) => [person.id, person.purse]),
  }));
}

describe('world-authored carrier history', () => {
  it('authors distinct dated events across a clock jump and replays the saved log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiworld-cart-'));
    try {
      const path = worldPath(dir, 7);
      const world = new SharedWorld(7, path, { day: 1, time: 0 }, dir, new FileVault());
      const forward = register();
      advanceWorldCarriers(forward, 40, (fact) => { expect(cleanDelta(fact)).toEqual(fact);
        expect(mayReport(fact)).toBe(false); expect(world.apply(fact)).toBe(true); });
      const loads = world.log.filter((fact) => fact.kind === 'cart-loaded');
      const finishes = world.log.filter((fact) => fact.kind === 'cart-finished');
      expect(new Set(loads.map((load) => load.day)).size).toBeGreaterThan(1);
      expect(finishes.length).toBeGreaterThan(0);
      world.save();

      const saved = new SharedWorld(7, path, { day: 1, time: 0 }, dir, new FileVault());
      const replay = new Register(7, 40, () => {}, 'journaled');
      for (const fact of saved.log) if (fact.kind === 'cart-loaded' || fact.kind === 'cart-finished') {
        expect(replay.recordCarrier(fact)).toBe(true);
      }
      replay.settle(A, 6, AT);
      replay.settle(B, 6, BT);
      expect(state(replay)).toEqual(state(forward));
      expect(replay.carrierFacts()).toEqual(forward.carrierFacts());
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('can record a robbery before the next day delivers the in-flight cart', () => {
    const book = register();
    const facts: Array<{ kind: string; day: number }> = [];
    for (let day = 2; day <= 20 && !facts.some((fact) => fact.kind === 'cart-loaded'); day++) {
      advanceWorldCarriers(book, day, (fact) => facts.push(fact));
    }
    const load = book.carrierFacts().find((fact) => fact.kind === 'cart-loaded');
    expect(load).toBeDefined();
    const finish = book.finishCarrier(load!.day, 'robbed');
    expect(finish?.outcome).toBe('robbed');
    expect(book.recordCarrier(finish!)).toBe(true);
    advanceWorldCarriers(book, load!.day + 1, (fact) => facts.push(fact));
    expect(book.carrierFacts().find((fact) => fact.kind === 'cart-finished' && fact.loadedOn === load!.day))
      .toEqual(finish);
  });
});
