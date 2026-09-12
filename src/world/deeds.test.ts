import { describe, expect, it } from 'vitest';
import { PROSPER } from './prosperity';
import { AWAY, buy, give, holds, purseOf, sell, transfer } from './deeds';
import type { Person } from './people';

/**
 * The vocabulary both halves of the world act through, and the one rule it exists to enforce.
 *
 * The rule is that a coin leaving one holder arrives in another. The villagers were made to obey
 * it a version ago; the hero never has been, and every purchase he has ever made subtracted from
 * a number with nobody on the other side of it. So most of what is below is that rule asked of
 * each deed in turn, plus the two places money is genuinely allowed to vanish — `AWAY`, which has
 * to be written down in so many words, and nowhere else.
 */

let next = 0;
const villager = (purse: number, trade = 'seller'): Person => {
  next++;
  return {
    id: `p${next}`, name: `Person ${next}`, village: 'Testing', sex: 'woman', trade,
    born: 0, lives: 100, mother: '', father: '', knows: [], memories: [], opinions: [],
    purse, hungry: 0,
  };
};

describe('a place money is kept', () => {
  it('reads a rucksack and a purse the same way, whatever shape they are', () => {
    const rucksack = holds({ gold: 40 });
    const person = villager(40);
    expect(rucksack.has).toBe(person.purse);
    expect(purseOf(person).has).toBe(rucksack.has);
  });

  it('never takes more than is there, and says what it actually took', () => {
    const thin = holds({ gold: 3 });
    expect(thin.take(10)).toBe(3);
    expect(thin.has).toBe(0);
  });

  it('holds a villager to the ceiling a purse has, and the hero to none', () => {
    // the cap is what stops one long-lived shopkeeper in a quiet corner ending the century with
    // everything, and a deed that wrote `purse` directly would be obeying it only sometimes
    const rich = villager(PROSPER.MOST - 5);
    purseOf(rich).give(500);
    expect(rich.purse).toBe(PROSPER.MOST);

    const hero = { gold: PROSPER.MOST };
    holds(hero).give(500);
    expect(hero.gold).toBe(PROSPER.MOST + 500);
  });
});

describe('money changing hands', () => {
  it('arrives in full wherever it leaves from', () => {
    const hero = { gold: 100 };
    const ferryman = villager(10);
    const before = hero.gold + ferryman.purse;
    transfer(holds(hero), purseOf(ferryman), 12);
    expect(hero.gold).toBe(88);
    expect(ferryman.purse).toBe(22);
    expect(hero.gold + ferryman.purse).toBe(before);
  });

  it('leaves the world only where somebody wrote down that it does', () => {
    const hero = { gold: 100 };
    const gone = transfer(holds(hero), AWAY, 30);
    expect(gone.paid).toBe(30);
    expect(hero.gold).toBe(70);
  });

  it('does nothing at all for a price of nothing', () => {
    const hero = { gold: 100 };
    const seller = villager(5);
    expect(transfer(holds(hero), purseOf(seller), 0)).toEqual({ paid: 0, afforded: true });
    expect(transfer(holds(hero), purseOf(seller), -8)).toEqual({ paid: 0, afforded: true });
    expect(hero.gold).toBe(100);
  });
});

describe('buying', () => {
  it('is all or nothing, because nobody sells four fifths of a horse', () => {
    const hero = { gold: 30 };
    const stablehand = villager(50);
    const got = buy(holds(hero), purseOf(stablehand), 120);
    expect(got).toEqual({ paid: 0, afforded: false });
    expect(hero.gold, 'a buyer who could not afford it was charged anyway').toBe(30);
    expect(stablehand.purse).toBe(50);
  });

  it('pays the seller when it can be afforded', () => {
    const hero = { gold: 300 };
    const stablehand = villager(50);
    expect(buy(holds(hero), purseOf(stablehand), 120).afforded).toBe(true);
    expect(hero.gold).toBe(180);
    expect(stablehand.purse).toBe(170);
  });
});

describe('selling', () => {
  it('takes what the buyer can find, because meat does not keep', () => {
    const hunter = villager(0, 'hunter');
    const poor = villager(4);
    const got = sell(purseOf(hunter), purseOf(poor), 7);
    expect(got).toEqual({ paid: 4, afforded: false });
    expect(hunter.purse).toBe(4);
    expect(poor.purse).toBe(0);
  });

  it('will not take somebody\'s last week of dinners', () => {
    const hunter = villager(0, 'hunter');
    const buyer = villager(PROSPER.KEEPS_BACK + 2);
    expect(sell(purseOf(hunter), purseOf(buyer), 7, PROSPER.KEEPS_BACK).paid).toBe(2);
    expect(buyer.purse).toBe(PROSPER.KEEPS_BACK);
  });
});

describe('giving', () => {
  it('hands over what there is when it is less than was meant', () => {
    const hero = { gold: 5 };
    const beggar = villager(0);
    expect(give(holds(hero), purseOf(beggar), 20).paid).toBe(5);
    expect(hero.gold).toBe(0);
    expect(beggar.purse).toBe(5);
  });
});
