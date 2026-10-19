import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameState } from '../game/state';
import { ITEMS, SLOTS, sellPrice, type EquipSlot } from '../game/items';
import { packView, type PackView } from '../game/pack';
import { Rucksack } from '../ui/rucksack';
import { PhoneDialogue, reset } from './dialogue-parity.test.fixture';

/**
 * The pack, worked through the same taps on the page and on the app (#562).
 *
 * The page's half is the real `Rucksack` (`ui/rucksack.ts`) over a hero of its own: its click
 * handler, reached only through a row it has drawn, and the word it hands to `onChange`, which the
 * game points at the HUD. A stand-in `#rucksack` element holds what it drew, and nothing else of
 * the page is here. The app's half is the real ABI: `create().request` with `inventory`, `take` and
 * `stow` as the app's pack page sends them, the host's own rucksack, and the HUD's toasts and the
 * `pack` and `hero` models as the replies carry them.
 *
 * The pack offers a player four things: open it, wear or eat or look at what is carried, stow what
 * is worn, and close it. There is no drop on either side, and nothing is picked up through the pack:
 * a chest, a counter or a fish puts things in it, which is how the sequence below picks things up.
 */

/** The page's rucksack, drawn into an element that only keeps what it was given. */
class PagePack {
  readonly state = new GameState();
  readonly said: string[] = [];
  readonly rucksack: Rucksack;
  private readonly el = { innerHTML: '', classList: { toggle() {}, remove() {} },
    addEventListener: (_type: string, handler: (e: unknown) => void) => { this.click = handler; } };
  private click: (e: unknown) => void = () => { throw new Error('the rucksack never listened for clicks'); };

  constructor() {
    vi.stubGlobal('document', { getElementById: (id: string) => (id === 'rucksack' ? this.el : null) });
    try { this.rucksack = new Rucksack(this.state); } finally { vi.stubGlobal('document', undefined); }
    this.rucksack.onChange = (message) => this.said.push(message);
  }

  /** The carried rows and the worn cells the rucksack last drew, by what a click on each sends. */
  get rows(): { items: string[]; slots: string[] } {
    const all = (pattern: RegExp) => [...this.el.innerHTML.matchAll(pattern)].map((match) => match[1]);
    return { items: all(/data-item="([^"]+)"/g), slots: all(/data-slot="([^"]+)"/g) };
  }

  /** A click on a row the rucksack has drawn; there is no clicking one it has not. */
  tap(row: { item: string } | { slot: EquipSlot }): void {
    const drawn = this.rows;
    if ('item' in row) expect(drawn.items, `the page shows a row for ${row.item}`).toContain(row.item);
    else expect(drawn.slots, `the page shows something worn on the ${row.slot}`).toContain(row.slot);
    const dataset = 'item' in row ? { item: row.item } : { slot: row.slot };
    this.click({ target: { closest: () => ({ dataset }) } });
  }
}

/** Everything about the hero a tap on the pack can change. */
const hero = (state: GameState) => ({
  gold: state.inventory.gold, carried: [...state.inventory.items].sort(), worn: SLOTS.map((slot) => state.equipped[slot] ?? null),
  hp: state.hp, maxHp: state.maxHpTotal, attack: state.attack, defence: state.defence,
  day: state.day, time: state.time, version: state.version,
});

/** The same kit on both heroes: a stick and a tunic worn, and something of every kind carried. */
function kit(state: GameState): void {
  reset(state);
  for (const id of ['stick', 'tunic']) { state.give(id); state.equip(id); }
  for (const [id, n] of [['sword', 1], ['helm', 1], ['bread', 2], ['room', 1], ['tent', 1]] as const) state.give(id, n);
  state.hp = state.maxHpTotal;
  state.version = 0;
}

let phone: PhoneDialogue;
beforeAll(() => {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('document', undefined);
  phone = new PhoneDialogue();
});
afterAll(() => { phone?.dispose(); vi.unstubAllGlobals(); });

const phoneState = () => phone.host.handles().state;
const phonePack = () => phone.shown.models.pack as unknown as PackView;
const toasts = () => (phone.shown.models.hud as unknown as { toasts: string[] }).toasts;
const panel = () => (phone.shown.models.hud as unknown as { panel: string | null }).panel;

/** What the app's pack page sends for a worn cell: the slot, and what it showed worn there. */
const cell = (slot: EquipSlot) => {
  const worn = phonePack().worn.find((w) => w.slot === slot);
  expect(worn?.id, `the app shows something worn on the ${slot}`).toBeTruthy();
  return `${slot}:${worn!.id}`;
};

beforeEach(() => {
  phone.host.conversation.close();
  phone.host.presentation.panel = null;
  kit(phoneState());
  phone.refresh();
  phone.host.presentation.toasts.length = 0;
});

type Tap =
  | { open: true } | { close: true }
  | { take: string } | { stow: EquipSlot }
  /** Something put in the pack from outside it, as a chest or a counter does. */
  | { found: string }
  /** Something that hurts the hero, so there is a reason to eat. */
  | { bitten: number };

/** One tap on both sides, and what each says. */
function both(page: PagePack, tap: Tap): { page: string[]; phone: string[] } {
  page.said.length = 0;
  phone.host.presentation.toasts.length = 0;
  if ('open' in tap || 'close' in tap) {
    page.rucksack.toggle();
    phone.act('inventory');
  } else if ('take' in tap) {
    page.tap({ item: tap.take });
    phone.act('take', tap.take);
  } else if ('stow' in tap) {
    page.tap({ slot: tap.stow });
    phone.act('stow', cell(tap.stow));
  } else {
    for (const state of [page.state, phoneState()]) {
      if ('found' in tap) state.give(tap.found);
      else state.hp -= tap.bitten;
    }
    // the page's readouts redraw an open rucksack whenever the hero has changed (`ui/readouts.ts`)
    page.rucksack.refresh();
    phone.refresh();
  }
  return { page: [...page.said], phone: [...toasts()] };
}

/** The two sides agree: the hero, the rows each shows, and whether the pack is open. */
function same(page: PagePack, where: string): void {
  expect(hero(phoneState()), `${where}: the hero`).toEqual(hero(page.state));
  const view = packView(page.state);
  expect(phonePack(), `${where}: the app's pack model`).toEqual(view);
  expect(phone.shown.models.hero, `${where}: the app's hero model`).toMatchObject({
    gold: page.state.inventory.gold, hp: page.state.hp, maxHp: page.state.maxHpTotal, day: page.state.day, time: page.state.time,
  });
  const open = page.rucksack.isOpen;
  expect(panel() === 'rucksack', `${where}: the pack is open on both or neither`).toBe(open);
  expect(phone.shown.owner).toBe(open ? 'BOOK' : 'WORLD');
  if (open) {
    expect(page.rows, `${where}: the page's rows are the app's rows`).toEqual({
      items: view.carried.map((thing) => thing.id), slots: view.worn.filter((w) => w.id).map((w) => w.slot),
    });
  }
}

const name = (id: string) => ITEMS[id].name;

describe('the pack, tapped through the same sequence on the page and the app (#562)', () => {
  it('opens, wears, looks, eats, sleeps, stows and closes to the same hero and the same words', () => {
    const page = new PagePack();
    kit(page.state);
    same(page, 'before anything');

    // each tap, and what the hero is told; written out, so the two cannot be wrong together
    const sequence: Array<[Tap, string[]]> = [
      [{ open: true }, []],
      [{ take: 'tent' }, [`${name('tent')}: ${ITEMS.tent.desc} Worth ${sellPrice(ITEMS.tent)} gold to the right buyer.`]],
      [{ take: 'bread' }, ['You are already at full health.']],
      [{ take: 'sword' }, [`Equipped the ${name('sword')}.`]],
      [{ take: 'helm' }, [`Equipped the ${name('helm')}.`]],
      [{ stow: 'hand' }, [`Stowed the ${name('sword')}.`]],
      [{ take: 'stick' }, [`Equipped the ${name('stick')}.`]],
      [{ found: 'apple' }, []],
      [{ bitten: 45 }, []],
      [{ take: 'bread' }, [`${name('bread')}: +20 hearts.`]],
      [{ take: 'apple' }, [`${name('apple')}: +10 hearts.`]],
      [{ take: 'bread' }, [`${name('bread')}: +20 hearts.`]],
      [{ take: 'room' }, ['You sleep soundly and wake at dawn, fully rested.']],
      [{ stow: 'head' }, [`Stowed the ${name('helm')}.`]],
      [{ close: true }, []],
    ];
    for (const [tap, told] of sequence) {
      const where = JSON.stringify(tap);
      const said = both(page, tap);
      expect(said.page, `${where}: the page says`).toEqual(told);
      expect(said.phone, `${where}: the app says`).toEqual(told);
      same(page, where);
    }

    // and where that leaves the hero, against fixed answers
    expect(page.state.equipped).toEqual({ hand: 'stick', body: 'tunic' });
    expect([...page.state.inventory.items].sort()).toEqual([['helm', 1], ['sword', 1], ['tent', 1]]);
    expect(page.state.day, 'the night\'s rest was slept').toBe(2);
    expect(page.state.hp).toBe(page.state.maxHpTotal);
  });
});

describe('the app\'s pack taps, against the ones the page cannot make (#562)', () => {
  /** The hero and the pack as the app was last shown them. */
  const before = () => ({ hero: hero(phoneState()), pack: phonePack() });
  /**
   * A tap that has to change nothing and say nothing, and is still answered. The app may have been
   * shown a pack older than the hero, so its reply is held to the hero as it is.
   */
  const nothing = (action: 'take' | 'stow', target: string) => {
    const was = hero(phoneState());
    phone.host.presentation.toasts.length = 0;
    phone.act(action, target);
    expect(toasts(), `${action} ${target} says nothing`).toEqual([]);
    expect(hero(phoneState()), `${action} ${target} changes nothing`).toEqual(was);
    expect(phonePack(), `${action} ${target} is answered with the pack as it is`).toEqual(packView(phoneState()));
  };

  it('shows the pack without changing the game', () => {
    const was = before();
    phone.act('inventory');
    expect(panel()).toBe('rucksack');
    expect(phone.shown.busy).toBe('reading');
    phone.refresh();
    phone.refresh();
    phone.act('inventory');
    expect(panel()).toBeNull();
    expect(toasts()).toEqual([]);
    expect(before(), 'opening, reading and closing the pack is not a commit').toEqual(was);

    const page = new PagePack();
    kit(page.state);
    const untouched = hero(page.state);
    page.rucksack.toggle();
    page.rucksack.refresh();
    page.rucksack.toggle();
    expect(hero(page.state), 'nor on the page').toEqual(untouched);
    expect(page.said).toEqual([]);
  });

  it('does nothing with a row that is no longer there', () => {
    phoneState().hp -= 45;
    phone.act('take', 'bread');
    phone.act('take', 'bread');
    expect(phoneState().has('bread'), 'both loaves eaten').toBe(false);
    // a third tap on the bread row the app had not yet redrawn
    nothing('take', 'bread');
    // the sword tapped twice before the reply: worn by the first, and not carried for the second
    phone.act('take', 'sword');
    expect(phoneState().equipped.hand).toBe('sword');
    nothing('take', 'sword');
    expect(phoneState().has('stick'), 'the stick went back in the pack once, and stays there').toBe(true);
    // a worn cell tapped twice: stowed by the first, and empty for the second
    phone.act('stow', 'hand:sword');
    nothing('stow', 'hand:sword');
  });

  it('does nothing with a tap the row does not offer', () => {
    // a curio is looked at and kept; food at full health is refused with a word, and kept
    const was = before();
    phone.act('take', 'tent');
    expect(toasts()).toEqual([`${name('tent')}: ${ITEMS.tent.desc} Worth ${sellPrice(ITEMS.tent)} gold to the right buyer.`]);
    phone.act('take', 'bread');
    expect(toasts().at(-1)).toBe('You are already at full health.');
    expect(before(), 'looking and a refused meal change nothing').toEqual(was);
    // things that are no row at all
    for (const id of ['no-such-thing', 'constructor', '__proto__', 'tunic', 'hand']) nothing('take', id);
    // a cell that is not one, an empty one, and one that does not wear what was named
    for (const target of ['tail:stick', 'constructor:stick', 'head:helm', 'hand:tunic']) nothing('stow', target);
  });

  it('refuses a tap with no row, and a worn cell that does not say what it showed', () => {
    for (const [action, target] of [['take', null], ['stow', null], ['stow', 'hand'], ['stow', 'hand:'], ['stow', 'hand:stick:x']] as const) {
      const was = before();
      const reply = phone.ask({ type: 'action', payload: { action, target, args: null } });
      expect(reply.type, `${action} ${String(target)}`).toBe('error');
      expect(before()).toEqual(was);
    }
  });

  it('acts on the pack as it is when the tap arrives, not as it was shown', () => {
    phone.act('inventory');
    // shown two loaves; one goes over a counter before the tap. The row is still there, on the
    // page as on the app, and the tap eats the one that is left
    phoneState().take('bread');
    phoneState().hp -= 30;
    phone.host.presentation.toasts.length = 0;
    phone.act('take', 'bread');
    expect(toasts()).toEqual([`${name('bread')}: +20 hearts.`]);
    expect(phoneState().has('bread')).toBe(false);

    // shown the helm carried; sold before the tap
    phoneState().take('helm');
    nothing('take', 'helm');

    // shown the stick in hand; the sword is put on by a tap the app has not yet redrawn for. The
    // page redraws its cell as the sword at once, so a click there stows what it shows. The app's
    // cell still showed the stick, and stows nothing rather than a sword the player never saw there
    const stale = cell('hand');
    expect(stale).toBe('hand:stick');
    phone.ask({ type: 'action', payload: { action: 'take', target: 'sword', args: null } });
    expect(phoneState().equipped.hand).toBe('sword');
    nothing('stow', stale);
    expect(phoneState().equipped.hand, 'the sword stays in hand').toBe('sword');
    // and the cell as it is now shown stows it
    phone.host.presentation.toasts.length = 0;
    phone.act('stow', cell('hand'));
    expect(toasts()).toEqual([`Stowed the ${name('sword')}.`]);
    expect(phoneState().equipped.hand).toBeUndefined();
  });
});
