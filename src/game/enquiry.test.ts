import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { Register } from '../world/register';
import { booksKeptIn, type Book, type Enquiry } from './enquiry';
import { FEES } from './records';
import { GameState } from './state';
import { dialogueFor } from './talk';

/**
 * Standing at a counter and asking to see the books.
 *
 * What is being checked is the bargain rather than the words: anybody may hear how many are
 * buried at Elderton, and only somebody who pays hears who they were. That is what stops the
 * records being a debug panel with a chapel drawn round it — and it is also why the fee has to be
 * taken exactly once, out of a purse that is actually short when it is short.
 */
describe('asking to see a village book', () => {
  /** A parish with one fresh grave in it, so the stones have something to say. */
  function parish() {
    const register = new Register(4321);
    register.settle('Elderton', 6, ['farmer', 'smith', 'baker']);
    register.advance(30);
    const somebody = register.living('Elderton')[0];
    expect(somebody, 'nobody in Elderton to bury').toBeTruthy();
    register.bury(somebody.id, 30);
    return { register, village: 'Elderton', buried: somebody.name, today: 32 };
  }

  /** The counter itself: the books behind it, and the purse in front of it. */
  function counter(state: GameState, books: Book[]): Enquiry {
    return {
      books,
      purse: () => state.inventory.gold,
      pay: (fee) => { state.inventory.gold -= fee; },
      paid: new Set(),
    };
  }

  /** The one stood at the altar, who is the only person in the game with a churchyard behind him. */
  function priest(): Entity {
    const herd = new Herd(KINDS.villager, 0, 0, 0, 0, 1);
    herd.tag = 'Elderton';
    const e = new Entity(KINDS.villager, 0, 0, herd, 'chapel', mulberry32(7));
    e.role = 'congregation';
    e.trade = 'priest';
    return e;
  }

  function apothecary(): Entity {
    const herd = new Herd(KINDS.shopkeeper, 0, 0, 0, 0, 1);
    herd.tag = 'Elderton';
    const e = new Entity(KINDS.shopkeeper, 0, 0, herd, 'shop', mulberry32(3));
    e.role = 'shopkeeper';
    e.shop = 'apothecary';
    return e;
  }

  /** Everything a conversation needs, with whatever book is behind this particular counter. */
  function talking(state: GameState, enquiry?: Enquiry) {
    return {
      state, rng: mulberry32(5), time: 0.5, quests: new Map(),
      onInventoryChange: () => {}, onQuestChange: () => {},
      enquiry,
    };
  }

  it('tells you how many are buried for nothing, and wants paying for who they were', () => {
    const { register, village, buried, today } = parish();
    const state = new GameState();
    state.inventory.gold = 100;
    const enquiry = counter(state, booksKeptIn('church', village, register, today));
    const root = dialogueFor(priest(), talking(state, enquiry));

    const ask = root.choices?.find((c) => c.label === 'Ask about the dead');
    expect(ask, 'the priest offers no way of asking about his own churchyard').toBeTruthy();

    const gist = ask!.next()!;
    expect(gist.pages.join(' '), 'the free answer does not say how many are buried').toContain('Elderton');
    expect(gist.pages.join(' '), 'the gist gives away a name that was supposed to be paid for').not.toContain(buried);
    expect(state.inventory.gold, 'charged for the gist, which is a public record').toBe(100);

    const open = gist.choices!.find((c) => c.label.includes('See the book'))!;
    expect(open.label, 'the fee is not on the row that charges it').toContain(`${FEES.STONES} gold`);
    const book = open.next()!;
    expect(state.inventory.gold).toBe(100 - FEES.STONES);
    expect(book.pages.join('\n'), 'paid for the stones and was not shown the name on one').toContain(buried);
  });

  it('says the price and both purses when the purse is too light, and takes nothing', () => {
    const { register, village, today } = parish();
    const state = new GameState();
    state.inventory.gold = 2;
    const enquiry = counter(state, booksKeptIn('church', village, register, today));
    const ctx = talking(state, enquiry);

    const gist = dialogueFor(priest(), ctx).choices!.find((c) => c.label === 'Ask about the dead')!.next()!;
    const refused = gist.choices!.find((c) => c.label.includes('See the book'))!.next()!;
    expect(refused.pages[0]).toContain(`${FEES.STONES} gold`);
    expect(refused.pages[0], 'told the price without being told what they have').toContain('2');
    expect(state.inventory.gold, 'took the fee off somebody who could not pay it').toBe(2);
    expect(refused.pages.join('\n'), 'showed the book anyway').not.toMatch(/Killed|Starved|Of age/);
  });

  it('charges once for a sitting, however many times the book is opened', () => {
    const { register, village, today } = parish();
    const state = new GameState();
    state.inventory.gold = 100;
    const enquiry = counter(state, booksKeptIn('church', village, register, today));
    const ctx = talking(state, enquiry);
    const ask = () => dialogueFor(priest(), ctx).choices!.find((c) => c.label === 'Ask about the dead')!.next()!;

    ask().choices!.find((c) => c.label.includes('See the book'))!.next();
    expect(state.inventory.gold).toBe(100 - FEES.STONES);

    // back out to the priest and ask again: the book is open, so the row changes and the fee does not
    const again = ask().choices!.find((c) => c.label === 'Read on');
    expect(again, 'a book already paid for is being sold a second time').toBeTruthy();
    again!.next();
    expect(state.inventory.gold, 'charged twice for the same sitting').toBe(100 - FEES.STONES);
  });

  it('keeps each book in the building that holds it, and gives a cottage none', () => {
    const { register, village, today } = parish();
    expect(booksKeptIn('church', village, register, today).map((b) => b.ask)).toEqual(['Ask about the dead']);
    expect(booksKeptIn('apothecary', village, register, today).map((b) => b.ask)).toEqual(['Ask about the births']);
    expect(booksKeptIn('house', village, register, today), 'somebody keeps records in their kitchen').toEqual([]);
    expect(booksKeptIn('smith', village, register, today), 'the forge keeps a parish register').toEqual([]);
  });

  it('puts the apothecary’s births on the counter beside the jars, a page at a time', () => {
    const { register, village, today } = parish();
    const state = new GameState();
    state.inventory.gold = 100;
    const enquiry = counter(state, booksKeptIn('apothecary', village, register, today));
    const root = dialogueFor(apothecary(), talking(state, enquiry));
    expect(root.choices!.map((c) => c.label)).toContain('Ask about the births');
    // and the rest of the shop is untouched: a records desk that ate the stock list would be worse
    // than no records desk
    expect(root.choices!.map((c) => c.label)).toContain('Buy');

    const gist = root.choices!.find((c) => c.label === 'Ask about the births')!.next()!;
    const book = gist.choices!.find((c) => c.label.includes('See the book'))!.next()!;
    expect(state.inventory.gold).toBe(100 - FEES.BIRTHS);
    expect(book.pages.length, 'a dozen births handed over as one wall of text').toBeGreaterThan(1);
    expect(book.pages.join('\n')).toMatch(/born day \d+/);
  });

  it('leaves everybody who is not standing where a book is kept exactly as they were', () => {
    const state = new GameState();
    // the same priest, met in the street: no room, no book, and nothing to ask him for
    expect(dialogueFor(priest(), talking(state)).choices).toBeUndefined();
    // and a shop with no records behind the counter is the shop it always was
    expect(dialogueFor(apothecary(), talking(state)).choices!.map((c) => c.label))
      .toEqual(['Buy', 'Sell', 'Chat', 'Leave']);
  });
});
