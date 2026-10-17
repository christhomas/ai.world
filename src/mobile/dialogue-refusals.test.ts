import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dialogueFor } from '../game/talk';
import { ITEMS, SHOP_DEFS, sellPrice } from '../game/shops';
import { Forge } from '../game/forge';
import { Register } from '../world/register';
import type { ShopType } from '../world/structures';
import { DialoguePair, PhoneDialogue, possessions } from './dialogue-parity.test.fixture';
import { errand, person, records, talkContext, VILLAGE } from './dialogue-targets.test.fixture';

let phone: PhoneDialogue;
beforeAll(() => {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('document', undefined);
  phone = new PhoneDialogue();
});
afterAll(() => { phone?.dispose(); vi.unstubAllGlobals(); });

describe('the web counter refuses the same way through the phone ABI (#574)', () => {
  it.each(Object.keys(SHOP_DEFS) as ShopType[])('%s cannot take gold the hero has not got', (shop) => {
    const pair = new DialoguePair(phone);
    const item = ITEMS[SHOP_DEFS[shop].items[0]];
    expect(item.price).toBeGreaterThan(0);
    pair.open((state) => {
      state.inventory.gold = 0;
      return dialogueFor(person('', 'shopkeeper', shop), talkContext(state));
    });
    const before = possessions(pair.webState);
    pair.choose('Buy');
    pair.choose(new RegExp(item.name));
    expect(pair.read()).toEqual([`That's ${item.price} gold, friend. You've only got 0.`]);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it('does not sell the same province twice, even with an empty purse', () => {
    const pair = new DialoguePair(phone);
    pair.open((state) => {
      state.inventory.gold = 0;
      state.chart(0, 0);
      expect(state.hasChart(0, 0)).toBe(true);
      return dialogueFor(person('', 'shopkeeper', 'store'), talkContext(state));
    });
    const before = possessions(pair.webState);
    pair.choose('Buy');
    pair.choose(/Province Map.*✓/);
    expect(pair.read()).toEqual([
      'You have that one already: Testford and the country round it. I only draw it the once.',
    ]);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it.each([0, 1])('returns a refused loaf to a cellar holding %i meals', (meals) => {
    const pair = new DialoguePair(phone);
    const shelves: Register[] = [];
    pair.open((state) => {
      state.inventory.gold = 1000;
      const register = new Register(1, 1);
      register.settle(VILLAGE, 8, ['farmer', 'seller']);
      register.setLarder(VILLAGE, meals);
      expect(register.larderOf(VILLAGE)).toBe(meals);
      shelves.push(register);
      return dialogueFor(person('', 'shopkeeper', 'store'), { ...talkContext(state), register });
    });
    const before = possessions(pair.webState);
    pair.choose('Buy');
    pair.choose(/Bread —/);
    expect(pair.read()).toEqual(["We're out of that, friend. Testford has none to spare today."]);
    expect(possessions(pair.webState)).toEqual(before);
    expect(shelves.map((register) => register.larderOf(VILLAGE))).toEqual([meals, meals]);
  });

  it('leaves both the smith shelf and the purse alone when the last sword has gone', () => {
    const pair = new DialoguePair(phone);
    const forges: Forge[] = [];
    expect(Forge.makes('sword')).toBe(true);
    pair.open((state) => {
      state.inventory.gold = 1000;
      const forge = new Forge();
      expect(forge.at(VILLAGE, 'sword')).toBe(0);
      forges.push(forge);
      return dialogueFor(person('', 'shopkeeper', 'smith'), { ...talkContext(state), forge });
    });
    const before = possessions(pair.webState);
    pair.choose('Buy');
    pair.choose(/Iron Sword —/);
    expect(pair.read()).toEqual(["We're out of that, friend. Testford has none to spare today."]);
    expect(possessions(pair.webState)).toEqual(before);
    expect(forges.map((forge) => forge.at(VILLAGE, 'sword'))).toEqual([0, 0]);
  });

  it.each(['smith', 'inn', 'apothecary'] as const)('%s refuses goods it does not buy', (shop) => {
    const pair = new DialoguePair(phone);
    pair.open((state) => {
      state.give('mortar', 4);
      expect(SHOP_DEFS[shop].buys(ITEMS.mortar)).toBe(false);
      return dialogueFor(person('', 'shopkeeper', shop), talkContext(state));
    });
    const before = possessions(pair.webState);
    pair.choose('Sell');
    expect(pair.read()).toEqual([shop === 'inn'
      ? 'Nothing in that pack I can use. Fish and food, mind.' : 'Nothing in that pack I can use.']);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it('an empty general-store trestle is a refusal, not a sale for zero gold', () => {
    const pair = new DialoguePair(phone);
    pair.open((state) => dialogueFor(person('', 'shopkeeper', 'store'), talkContext(state)));
    const before = possessions(pair.webState);
    pair.choose('Sell');
    expect(pair.read()).toEqual(['Nothing in that pack I can use.']);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it.each(Object.keys(SHOP_DEFS) as ShopType[])('%s closes its shop at night', (shop) => {
    const pair = new DialoguePair(phone);
    pair.open((state) => {
      state.time = 0.95;
      return dialogueFor(person('', 'shopkeeper', shop), talkContext(state));
    });
    const before = possessions(pair.webState);
    expect(pair.read()).toEqual([`The ${SHOP_DEFS[shop].name.toLowerCase()} is shut for the night. Come back after dawn.`]);
    expect(phone.talk!.choices).toEqual([]);
    pair.advance();
    expect(possessions(pair.webState)).toEqual(before);
  });

  it.each([0.5, 0.95])('an inn still refuses an unaffordable bed at time %s', (time) => {
    const pair = new DialoguePair(phone);
    const take = vi.fn(() => 'Slept.');
    pair.open((state) => {
      state.time = time;
      state.inventory.gold = 1;
      return dialogueFor(person('', 'shopkeeper', 'inn'), {
        ...talkContext(state), room: { price: 12, shared: false, take, leave: () => {} },
      });
    });
    const before = possessions(pair.webState);
    pair.choose('Take a room (12g)');
    expect(pair.read()).toEqual(['A room is 12 gold, and you have 1.']);
    expect(take).not.toHaveBeenCalled();
    expect(possessions(pair.webState)).toEqual(before);
  });

  it('declining sleep does not take the room fee or call the room service', () => {
    const pair = new DialoguePair(phone);
    const take = vi.fn(() => 'Slept.');
    pair.open((state) => dialogueFor(person('', 'shopkeeper', 'inn'), {
      ...talkContext(state), room: { price: 12, shared: false, take, leave: () => {} },
    }));
    const before = possessions(pair.webState);
    pair.choose('Take a room (12g)');
    pair.choose('Not tonight');
    expect(take).not.toHaveBeenCalled();
    expect(possessions(pair.webState)).toEqual(before);
  });

  it.each(['no goods', 'no recipients'] as const)('the post refuses a parcel with %s', (missing) => {
    const pair = new DialoguePair(phone);
    const send = vi.fn();
    pair.open((state) => {
      if (missing === 'no recipients') state.give('bread', 1);
      return dialogueFor(person('', 'shopkeeper', 'inn'), {
        ...talkContext(state), post: { folk: missing === 'no recipients' ? [] : ['Rowan'], send, collect: () => {} },
      });
    });
    const before = possessions(pair.webState);
    pair.choose('The post shelf');
    pair.choose('Leave a parcel');
    expect(pair.read()).toEqual([missing === 'no goods'
      ? 'You have nothing to send.' : 'No one else has passed through this world yet.']);
    expect(send).not.toHaveBeenCalled();
    expect(possessions(pair.webState)).toEqual(before);
  });

  it.each([
    ['church', 'priest', 'congregation'], ['apothecary', 'apothecary', 'shopkeeper'],
    ['townhall', 'clerk', 'keeper'], ['watchhouse', 'sergeant', 'keeper'],
  ] as const)('%s will read the gist but cannot charge a fee the hero lacks', (room, trade, role) => {
    const pair = new DialoguePair(phone);
    const sittings: Array<ReturnType<typeof records>> = [];
    pair.open((state) => {
      state.inventory.gold = 0;
      const enquiry = records(state, room);
      sittings.push(enquiry);
      return dialogueFor(person(trade, role, room === 'apothecary' ? 'apothecary' : undefined), {
        ...talkContext(state), enquiry,
      });
    });
    const before = possessions(pair.webState);
    const book = sittings[0].books[0];
    const ledger = book.open();
    expect(ledger.fee).toBeGreaterThan(0);
    pair.choose(book.ask);
    pair.choose(`See the book itself (${ledger.fee} gold)`);
    expect(pair.read()).toEqual([`${ledger.title} is ${ledger.fee} gold to read, and you have 0.`]);
    expect(sittings.map((enquiry) => [...enquiry.paid])).toEqual([[], []]);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it.each(['fetch', 'visit'] as const)('an unfinished %s errand offers no reward and changes nothing', (kind) => {
    const pair = new DialoguePair(phone);
    const quest = errand(kind);
    pair.open((state) => {
      state.quests.set(quest.id, 'active');
      if (kind === 'fetch') state.give(quest.target, quest.count - 1);
      expect(kind === 'fetch' ? state.count(quest.target) < quest.count : !state.discovered.has(quest.target)).toBe(true);
      return dialogueFor(person('', 'elder'), { ...talkContext(state), quests: new Map([[VILLAGE, quest]]) });
    });
    const before = possessions(pair.webState);
    expect(pair.read()).toEqual([quest.reminder]);
    expect(phone.talk!.choices).toEqual([]);
    pair.advance();
    expect(possessions(pair.webState)).toEqual(before);
  });

  it.each(['fetch', 'visit'] as const)('declining a %s errand leaves it unaccepted', (kind) => {
    const pair = new DialoguePair(phone);
    const quest = errand(kind);
    pair.open((state) => dialogueFor(person('', 'elder'), { ...talkContext(state), quests: new Map([[VILLAGE, quest]]) }));
    const before = possessions(pair.webState);
    pair.choose('Not now');
    expect(pair.read()).toEqual(['Think on it. I am not going anywhere.']);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it('refuses a second reward after a completed fetch quest', () => {
    const pair = new DialoguePair(phone);
    const quest = errand('fetch');
    const build = (state: typeof pair.webState) => dialogueFor(person('', 'elder'), {
      ...talkContext(state), quests: new Map([[VILLAGE, quest]]),
    });
    pair.open((state) => { state.give('bread', 2); state.quests.set(quest.id, 'active'); return build(state); });
    pair.choose('Take 50 gold');
    expect(pair.webState.inventory.gold).toBe(150);
    expect(pair.webState.count('bread')).toBe(0);
    expect(pair.webState.quests.get(quest.id)).toBe('done');
    const before = possessions(pair.webState);
    pair.open(build);
    pair.read();
    expect(phone.talk!.choices).toEqual([]);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it('a stale sale of goods no longer carried pays nothing', () => {
    const pair = new DialoguePair(phone);
    pair.open((state) => { state.give('wood', 6); return dialogueFor(person('', 'shopkeeper', 'store'), talkContext(state)); });
    pair.choose('Sell');
    pair.nudge(/Wood —/, -1);
    for (const state of [pair.webState, pair.phoneState]) state.take('wood', 6);
    const before = possessions(pair.webState);
    pair.choose(/Wood —/);
    expect(pair.read()).toEqual(['Nothing in that pack I can use.']);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it('a stale quantity sells only the goods still carried, at the web price', () => {
    const pair = new DialoguePair(phone);
    pair.open((state) => { state.give('wood', 6); return dialogueFor(person('', 'shopkeeper', 'store'), talkContext(state)); });
    pair.choose('Sell');
    pair.nudge(/Wood —/, -1);
    for (const state of [pair.webState, pair.phoneState]) state.take('wood', 4);
    pair.choose(/Wood —/);
    const paid = 2 * sellPrice(ITEMS.wood);
    expect(pair.read()).toEqual([`2 × ${ITEMS.wood.name} for ${paid} gold. Done.`]);
    expect(pair.webState.inventory.gold).toBe(100 + paid);
    expect(pair.webState.count('wood')).toBe(0);
  });

  it('out-of-range rows cannot commit a different choice', () => {
    const pair = new DialoguePair(phone);
    pair.open((state) => dialogueFor(person('', 'shopkeeper', 'store'), talkContext(state)));
    pair.read();
    const before = possessions(pair.webState);
    for (const row of [-1, 200]) {
      pair.web.choose(row);
      phone.act('choose', String(row));
      pair.same();
    }
    expect(possessions(pair.webState)).toEqual(before);
  });
});
