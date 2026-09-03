import type { ShopType } from '../world/structures';

/** Things for sale. Effects are flavour for now; later phases can hang mechanics on ids. */
export { ITEMS, SELL_SHARE, SLOTS, SLOT_ICONS, SLOT_NAMES, isConsumable, isEquippable, itemSummary, sellPrice } from './items';
export type { Ability, EquipSlot, Item, ItemEffect } from './items';
import { ITEMS, type Item, sellPrice } from './items';

export interface ShopDef {
  name: string;
  title: string;
  /** Stock, in the order it is offered. */
  items: string[];
  /** What this shop is willing to buy from you. */
  buys: (item: Item) => boolean;
  greetings: string[];
}

const isGear = (item: Item) => item.slot === 'hand' || item.slot === 'head' || item.slot === 'body' || item.slot === 'offhand' || item.slot === 'feet';
const isFood = (item: Item) => item.effect !== undefined && item.slot === undefined;
const isCatch = (item: Item) => item.loot === true;

export const SHOP_DEFS: Record<ShopType, ShopDef> = {
  store: {
    name: 'General Store', title: 'the Storekeeper',
    items: ['apple', 'bread', 'tunic', 'boots', 'stick', 'rope', 'lantern', 'map', 'rod'],
    // the general store will take anything off your hands
    buys: () => true,
    greetings: ['Welcome to the general store! Need supplies for the road?', 'Come in, come in. Everything a traveller could want.'],
  },
  smith: {
    name: 'Blacksmith', title: 'the Smith',
    items: ['sword', 'steelsword', 'axe', 'cap', 'helm', 'jerkin', 'mail', 'shield', 'ironshield', 'greaves'],
    buys: (item) => isGear(item) || item.id === 'gem' || item.id === 'bone',
    greetings: ['*wipes soot from brow* Looking for steel?', 'Forge is hot today. What do you need?'],
  },
  inn: {
    name: 'Inn', title: 'the Innkeeper',
    items: ['ale', 'stew', 'room'],
    buys: (item) => isFood(item) || isCatch(item),
    greetings: ['Welcome to the inn, stranger. Sit, sit!', 'A room, a meal, or just the gossip?'],
  },
  apothecary: {
    name: 'Apothecary', title: 'the Apothecary',
    items: ['potion', 'herbs', 'antidote', 'elixir', 'charm'],
    buys: (item) => isFood(item) || isCatch(item) || item.id === 'charm',
    greetings: ['*peers over spectacles* Ah, a customer. Mind the jars.', 'Tonics, cures and curiosities. What ails you?'],
  },
};

/** What a shop will pay for each carried item it is willing to buy. */
export function sellableAt(def: ShopDef, carried: Iterable<[string, number]>): Array<{ item: Item; count: number; price: number }> {
  const out: Array<{ item: Item; count: number; price: number }> = [];
  for (const [id, count] of carried) {
    const item = ITEMS[id];
    if (!item || count <= 0 || !def.buys(item)) continue;
    out.push({ item, count, price: sellPrice(item) });
  }
  return out.sort((a, b) => b.price * b.count - a.price * a.count);
}

export interface InventoryJson {
  gold: number;
  items: Record<string, number>;
  /** Item id per equipment slot. */
  equipped?: Record<string, string>;
}

export class Inventory {
  gold = 50;
  readonly items = new Map<string, number>();

  canAfford(item: Item): boolean { return this.gold >= item.price; }

  buy(item: Item): boolean {
    if (!this.canAfford(item)) return false;
    this.gold -= item.price;
    this.items.set(item.id, (this.items.get(item.id) ?? 0) + 1);
    return true;
  }

  toJSON(): InventoryJson {
    return { gold: this.gold, items: Object.fromEntries(this.items) };
  }

  static from(json: InventoryJson | undefined): Inventory {
    const inv = new Inventory();
    if (!json) return inv;
    inv.gold = json.gold;
    for (const [k, v] of Object.entries(json.items)) if (ITEMS[k]) inv.items.set(k, v);
    return inv;
  }
}
