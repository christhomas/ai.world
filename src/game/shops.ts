import type { ShopType } from '../world/structures';

/** Things for sale. Effects are flavour for now; later phases can hang mechanics on ids. */
export interface Item {
  id: string;
  name: string;
  emoji: string;
  price: number;
  desc: string;
}

export const ITEMS: Record<string, Item> = {
  apple: { id: 'apple', name: 'Apple', emoji: '🍎', price: 5, desc: 'Crisp and sweet. Keeps well on the road.' },
  bread: { id: 'bread', name: 'Bread', emoji: '🍞', price: 8, desc: 'Still warm from the oven.' },
  rope: { id: 'rope', name: 'Rope', emoji: '🪢', price: 12, desc: 'Twenty feet of good hemp rope.' },
  lantern: { id: 'lantern', name: 'Lantern', emoji: '🏮', price: 30, desc: 'For the dark places under the hills.' },
  map: { id: 'map', name: 'Region Map', emoji: '🗺️', price: 25, desc: 'Hand-drawn. The cartographer swears it is accurate.' },
  sword: { id: 'sword', name: 'Iron Sword', emoji: '🗡️', price: 60, desc: 'Plain, sharp, dependable.' },
  shield: { id: 'shield', name: 'Wooden Shield', emoji: '🛡️', price: 45, desc: 'Oak planks bound with iron.' },
  helm: { id: 'helm', name: 'Leather Helm', emoji: '🪖', price: 35, desc: 'Better than nothing. Barely.' },
  potion: { id: 'potion', name: 'Red Potion', emoji: '🧪', price: 15, desc: 'Tastes of cherries and regret.' },
  herbs: { id: 'herbs', name: 'Healing Herbs', emoji: '🌿', price: 8, desc: 'Chew slowly. Do not ask what is in it.' },
  antidote: { id: 'antidote', name: 'Antidote', emoji: '💊', price: 12, desc: 'For swamp bites and bad decisions.' },
  ale: { id: 'ale', name: 'Mug of Ale', emoji: '🍺', price: 6, desc: 'The house brew. Strong.' },
  room: { id: 'room', name: "Night's Rest", emoji: '🛏️', price: 10, desc: 'A warm bed and a quiet night.' },
  stew: { id: 'stew', name: 'Hearty Stew', emoji: '🍲', price: 9, desc: 'Whatever was in the pot today.' },
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
