import type { ShopType } from '../world/structures';

/** Things for sale. Effects are flavour for now; later phases can hang mechanics on ids. */
export type ItemEffect =
  | { type: 'heal'; amount: number }
  | { type: 'rest' }
  | { type: 'passive'; note: string };

export interface Item {
  id: string;
  name: string;
  emoji: string;
  price: number;
  desc: string;
  /** What using/owning it does. Consumables are used from the inventory panel. */
  effect?: ItemEffect;
}

export const ITEMS: Record<string, Item> = {
  apple: { id: 'apple', name: 'Apple', emoji: '🍎', price: 5, desc: 'Crisp and sweet. Keeps well on the road.', effect: { type: 'heal', amount: 1 } },
  bread: { id: 'bread', name: 'Bread', emoji: '🍞', price: 8, desc: 'Still warm from the oven.', effect: { type: 'heal', amount: 2 } },
  rope: { id: 'rope', name: 'Rope', emoji: '🪢', price: 12, desc: 'Twenty feet of good hemp rope. Lets you climb two terraces at once.', effect: { type: 'passive', note: 'climb two terraces' } },
  lantern: { id: 'lantern', name: 'Lantern', emoji: '🏮', price: 30, desc: 'Lights your way at night.', effect: { type: 'passive', note: 'light at night' } },
  map: { id: 'map', name: 'Region Map', emoji: '🗺️', price: 25, desc: 'Hand-drawn. Reveals the whole minimap.', effect: { type: 'passive', note: 'reveals the map' } },
  sword: { id: 'sword', name: 'Iron Sword', emoji: '🗡️', price: 60, desc: 'Plain, sharp, dependable. Wolves and bears keep their distance.', effect: { type: 'passive', note: 'predators flee' } },
  shield: { id: 'shield', name: 'Wooden Shield', emoji: '🛡️', price: 45, desc: 'Oak planks bound with iron. Halves the damage you take.', effect: { type: 'passive', note: 'halves damage' } },
  helm: { id: 'helm', name: 'Leather Helm', emoji: '🪖', price: 35, desc: 'Better than nothing. Two extra hearts.', effect: { type: 'passive', note: '+2 max health' } },
  potion: { id: 'potion', name: 'Red Potion', emoji: '🧪', price: 15, desc: 'Tastes of cherries and regret.', effect: { type: 'heal', amount: 5 } },
  herbs: { id: 'herbs', name: 'Healing Herbs', emoji: '🌿', price: 8, desc: 'Chew slowly. Do not ask what is in it.', effect: { type: 'heal', amount: 2 } },
  antidote: { id: 'antidote', name: 'Antidote', emoji: '💊', price: 12, desc: 'For swamp bites and bad decisions.', effect: { type: 'heal', amount: 3 } },
  ale: { id: 'ale', name: 'Mug of Ale', emoji: '🍺', price: 6, desc: 'The house brew. Strong.', effect: { type: 'heal', amount: 1 } },
  room: { id: 'room', name: "Night's Rest", emoji: '🛏️', price: 10, desc: 'A warm bed and a quiet night. Use it to sleep until dawn, fully healed.', effect: { type: 'rest' } },
  stew: { id: 'stew', name: 'Hearty Stew', emoji: '🍲', price: 9, desc: 'Whatever was in the pot today.', effect: { type: 'heal', amount: 3 } },
};

export interface ShopDef {
  name: string;
  title: string;
  items: string[];
  greetings: string[];
}

export const SHOP_DEFS: Record<ShopType, ShopDef> = {
  store: {
    name: 'General Store', title: 'the Storekeeper',
    items: ['apple', 'bread', 'rope', 'lantern', 'map'],
    greetings: ['Welcome to the general store! Need supplies for the road?', 'Come in, come in. Everything a traveller could want.'],
  },
  smith: {
    name: 'Blacksmith', title: 'the Smith',
    items: ['sword', 'shield', 'helm'],
    greetings: ['*wipes soot from brow* Looking for steel?', 'Forge is hot today. What do you need?'],
  },
  inn: {
    name: 'Inn', title: 'the Innkeeper',
    items: ['ale', 'stew', 'room'],
    greetings: ['Welcome to the inn, stranger. Sit, sit!', 'A room, a meal, or just the gossip?'],
  },
  apothecary: {
    name: 'Apothecary', title: 'the Apothecary',
    items: ['potion', 'herbs', 'antidote'],
    greetings: ['*peers over spectacles* Ah, a customer. Mind the jars.', 'Tonics, cures and curiosities. What ails you?'],
  },
};

export interface InventoryJson { gold: number; items: Record<string, number> }

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
