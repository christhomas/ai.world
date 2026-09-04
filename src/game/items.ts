/**
 * Every item in the game. Gear carries the stats it grants while worn; consumables carry an
 * effect; tools grant an ability only while equipped, so a lantern in your pack lights nothing.
 */

export type EquipSlot = 'head' | 'body' | 'hand' | 'offhand' | 'feet' | 'trinket';

export const SLOTS: readonly EquipSlot[] = ['head', 'body', 'hand', 'offhand', 'feet', 'trinket'];

export const SLOT_NAMES: Record<EquipSlot, string> = {
  head: 'Head', body: 'Body', hand: 'Hand', offhand: 'Off hand', feet: 'Feet', trinket: 'Pocket',
};

export const SLOT_ICONS: Record<EquipSlot, string> = {
  head: '🎩', body: '🧥', hand: '🗡️', offhand: '🛡️', feet: '🥾', trinket: '🎒',
};

export type ItemEffect =
  | { type: 'heal'; amount: number }
  | { type: 'rest' };

/** Something an item does while it is equipped. */
export type Ability = 'light' | 'map' | 'climb' | 'fish' | 'dig' | 'fell' | 'kindle' | 'skin' | 'hew' | 'grind' | 'camp';

export const ABILITY_NOTES: Record<Ability, string> = {
  light: 'lights your way at night',
  map: 'reveals the whole map',
  climb: 'climb two terraces at once',
  fish: 'lets you fish at the water',
  dig: 'turn over the ground for metal',
  fell: 'bring a tree down for its wood',
  kindle: 'get a fire going',
  skin: 'take the fur off what you killed',
  hew: 'work ore out of rock a spade rings off',
  grind: 'reduce what you gather to something you can drink',
  camp: 'make a bed wherever you are standing',
};

export interface Item {
  id: string;
  name: string;
  emoji: string;
  /** Shop price. Selling pays SELL_SHARE of it. */
  price: number;
  desc: string;
  /** Where it goes on the body. Absent for consumables and junk. */
  slot?: EquipSlot;
  attack?: number;
  defence?: number;
  /** Extra maximum hearts while worn. */
  hearts?: number;
  ability?: Ability;
  /**
   * A tool works from inside the pack rather than from a hand.
   *
   * There are too many of them for the offhand: with a saw, a shovel, a knife, a pick and a
   * mortar all wanting the same slot, you end up digging in the dark because the lantern lost,
   * and swapping gear becomes the main thing you do. The offhand keeps what is about staying
   * alive; a tool is about doing a job, and doing a job only requires having brought it.
   */
  tool?: boolean;
  /** Consumables only. */
  effect?: ItemEffect;
  /** Fish and other things shops buy but do not sell. */
  loot?: boolean;
}

/** Shops pay this share of an item's price. */
export const SELL_SHARE = 0.5;

export function sellPrice(item: Item): number {
  return Math.max(1, Math.floor(item.price * SELL_SHARE));
}

const list: Item[] = [
  // --- food and potions ---
  { id: 'apple', name: 'Apple', emoji: '🍎', price: 5, desc: 'Crisp and sweet. Keeps well on the road.', effect: { type: 'heal', amount: 1 } },
  { id: 'bread', name: 'Bread', emoji: '🍞', price: 8, desc: 'Still warm from the oven.', effect: { type: 'heal', amount: 2 } },
  { id: 'stew', name: 'Hearty Stew', emoji: '🍲', price: 9, desc: 'Whatever was in the pot today.', effect: { type: 'heal', amount: 3 } },
  { id: 'ale', name: 'Mug of Ale', emoji: '🍺', price: 6, desc: 'The house brew. Strong.', effect: { type: 'heal', amount: 1 } },
  { id: 'room', name: "Night's Rest", emoji: '🛏️', price: 10, desc: 'A bed until dawn, and full hearts with it.', effect: { type: 'rest' } },
  { id: 'herbs', name: 'Healing Herbs', emoji: '🌿', price: 8, desc: 'Chew slowly. Do not ask what is in it.', effect: { type: 'heal', amount: 2 } },
  { id: 'potion', name: 'Red Potion', emoji: '🧪', price: 15, desc: 'Tastes of cherries and regret.', effect: { type: 'heal', amount: 5 } },
  { id: 'antidote', name: 'Antidote', emoji: '💊', price: 12, desc: 'For swamp bites and bad decisions.', effect: { type: 'heal', amount: 3 } },
  { id: 'elixir', name: 'Green Elixir', emoji: '🥤', price: 40, desc: 'Bitter, and worth every drop.', effect: { type: 'heal', amount: 10 } },

  // --- weapons (hand) ---
  { id: 'stick', name: 'Stout Stick', emoji: '🪵', price: 6, desc: 'Better than knuckles.', slot: 'hand', attack: 1 },
  { id: 'sword', name: 'Iron Sword', emoji: '🗡️', price: 60, desc: 'Plain, sharp, dependable.', slot: 'hand', attack: 2 },
  { id: 'steelsword', name: 'Steel Sword', emoji: '⚔️', price: 140, desc: 'Keeps its edge through a whole cave.', slot: 'hand', attack: 3 },
  { id: 'axe', name: 'War Axe', emoji: '🪓', price: 210, desc: 'Slow, heavy, final.', slot: 'hand', attack: 4 },

  // --- heads ---
  { id: 'cap', name: 'Leather Cap', emoji: '🧢', price: 20, desc: 'Keeps the rain out, mostly.', slot: 'head', defence: 1 },
  { id: 'helm', name: 'Iron Helm', emoji: '🪖', price: 55, desc: 'Heavy on the neck, kind to the skull.', slot: 'head', defence: 2, hearts: 2 },

  // --- bodies ---
  { id: 'tunic', name: "Traveller's Tunic", emoji: '👕', price: 18, desc: 'Wool, patched at the elbows.', slot: 'body', defence: 1 },
  { id: 'jerkin', name: 'Leather Jerkin', emoji: '🧥', price: 65, desc: 'Boiled leather, stitched thick.', slot: 'body', defence: 2, hearts: 2 },
  { id: 'mail', name: 'Chain Mail', emoji: '🥋', price: 180, desc: 'A smith spent a winter on this.', slot: 'body', defence: 4, hearts: 4 },

  // --- off hand ---
  { id: 'shield', name: 'Wooden Shield', emoji: '🛡️', price: 45, desc: 'Oak planks bound with iron.', slot: 'offhand', defence: 2 },
  { id: 'ironshield', name: 'Iron Shield', emoji: '🛡️', price: 120, desc: 'Dents instead of splitting.', slot: 'offhand', defence: 4 },
  { id: 'lantern', name: 'Lantern', emoji: '🏮', price: 30, desc: 'Hold it up and the night gives way.', slot: 'offhand', ability: 'light' },
  { id: 'rod', name: 'Fishing Rod', emoji: '🎣', price: 28, desc: 'Cane, line and a hook. Carry it to the water and cast.', tool: true, ability: 'fish' },
  { id: 'shovel', name: 'Shovel', emoji: '⛏️', price: 34, desc: 'Ash handle, iron blade. Stand on a hillside with it and see what the hill has been keeping.', tool: true, ability: 'dig' },
  { id: 'saw', name: 'Felling Saw', emoji: '🪚', price: 42, desc: 'Two handles and a long tooth. Takes a while, and then the tree is firewood.', tool: true, ability: 'fell' },
  { id: 'firerocks', name: 'Fire Rocks', emoji: '🪨', price: 9, desc: 'Strike them together over dry tinder and step back.', tool: true, ability: 'kindle' },
  { id: 'knife', name: 'Skinning Knife', emoji: '🔪', price: 26, desc: 'Short, curved, and kept sharper than any sword. A pelt is worth nothing torn.', tool: true, ability: 'skin' },
  { id: 'pick', name: 'Pickaxe', emoji: '⚒️', price: 48, desc: 'For the rock a spade only rings off.', tool: true, ability: 'hew' },
  { id: 'mortar', name: 'Mortar and Pestle', emoji: '🥣', price: 38, desc: 'Stone bowl, stone club. What you grind in it stops being a leaf.', tool: true, ability: 'grind' },
  { id: 'tent', name: 'Canvas Tent', emoji: '⛺', price: 55, desc: 'Rolled on your back all day so that you have somewhere to be at night.', tool: true, ability: 'camp' },

  // --- feet ---
  { id: 'boots', name: 'Walking Boots', emoji: '🥾', price: 26, desc: 'Broken in by someone else.', slot: 'feet', defence: 1 },
  { id: 'greaves', name: 'Iron Greaves', emoji: '🦿', price: 90, desc: 'Shins that fear no wolf.', slot: 'feet', defence: 2 },

  // --- pocket ---
  { id: 'map', name: 'Region Map', emoji: '🗺️', price: 25, desc: 'Hand-drawn. Keep it to hand and the fog lifts.', slot: 'trinket', ability: 'map' },
  { id: 'rope', name: 'Climbing Rope', emoji: '🪢', price: 12, desc: 'Twenty feet of good hemp. Coiled on your belt.', slot: 'trinket', ability: 'climb' },
  { id: 'charm', name: 'Luck Charm', emoji: '🍀', price: 70, desc: 'A pressed clover in glass. It cannot hurt.', slot: 'trinket', hearts: 2 },

  // --- seeds and crops ---
  { id: 'wheatseed', name: 'Wheat Seeds', emoji: '🌱', price: 6, desc: 'Sow on bare earth beside a village. Three days to ripen, spring or summer.' },
  { id: 'turnipseed', name: 'Turnip Seeds', emoji: '🌱', price: 4, desc: 'Two days in the ground, spring or autumn.' },
  { id: 'pumpkinseed', name: 'Pumpkin Seeds', emoji: '🌱', price: 12, desc: 'Five days, summer or autumn, and worth the wait.' },
  { id: 'wheat', name: 'Wheat', emoji: '🌾', price: 14, desc: 'Grown from your own ground.', effect: { type: 'heal', amount: 2 }, loot: true },
  { id: 'turnip', name: 'Turnip', emoji: '🥔', price: 10, desc: 'Grown from your own ground.', effect: { type: 'heal', amount: 2 }, loot: true },
  { id: 'pumpkin', name: 'Pumpkin', emoji: '🎃', price: 29, desc: 'Grown from your own ground.', effect: { type: 'heal', amount: 3 }, loot: true },

  // --- catch and salvage ---
  { id: 'minnow', name: 'Minnow', emoji: '🐟', price: 4, desc: 'Small, bony, and everywhere.', effect: { type: 'heal', amount: 1 }, loot: true },
  { id: 'perch', name: 'Perch', emoji: '🐠', price: 12, desc: 'A decent fish. The inn will buy it.', effect: { type: 'heal', amount: 2 }, loot: true },
  { id: 'eel', name: 'Eel', emoji: '🪱', price: 22, desc: 'It is still moving. Best cook it soon.', effect: { type: 'heal', amount: 3 }, loot: true },
  { id: 'pike', name: 'Pike', emoji: '🦈', price: 30, desc: 'All teeth and temper. Worth good coin.', effect: { type: 'heal', amount: 4 }, loot: true },
  { id: 'pelt', name: 'Wolf Pelt', emoji: '🟤', price: 26, desc: 'Thick winter fur. Traders pay for these.', loot: true },
  { id: 'fang', name: 'Bear Fang', emoji: '🦷', price: 45, desc: 'As long as your thumb.', loot: true },
  { id: 'bone', name: 'Old Bone', emoji: '🦴', price: 8, desc: 'From something that used to walk down here.', loot: true },
  { id: 'gem', name: 'Cave Gem', emoji: '💎', price: 120, desc: 'Cut by nothing but water and time.', loot: true },

  // --- dug out of the ground ---
  { id: 'wood', name: 'Cut Wood', emoji: '🪵', price: 5, desc: 'Green and heavy. A market that gathers enough of it starts thinking about carts.', loot: true },
  { id: 'meat', name: 'Raw Meat', emoji: '🥩', price: 7, desc: 'It wants a fire before it wants your mouth.', effect: { type: 'heal', amount: 1 }, loot: true },
  { id: 'roast', name: 'Roast Meat', emoji: '🍖', price: 20, desc: 'Cooked over your own fire, which is most of why it is worth eating.', effect: { type: 'heal', amount: 5 }, loot: true },
  { id: 'bearpelt', name: 'Bear Pelt', emoji: '🟫', price: 70, desc: 'Heavy, warm, and worth a great deal further south.', loot: true },
  { id: 'herb', name: 'Bitter Herb', emoji: '🌿', price: 4, desc: 'Grows where the ground is damp. On its own it is a leaf.', loot: true },
  { id: 'salve', name: 'Salve', emoji: '🧪', price: 32, desc: 'Ground herb and clean water. Drink it and the worst of it goes.', effect: { type: 'heal', amount: 8 } },
  { id: 'ward', name: 'Warding Draught', emoji: '🔮', price: 60, desc: 'Turns aside what is coming for a little while. Long enough to get away, if you go now.' },
  { id: 'bow', name: 'Hunting Bow', emoji: '🏹', price: 90, desc: 'Yew and gut. The only thing here that reaches something in the air.', slot: 'hand', attack: 2 },
  { id: 'cart', name: 'Horse Cart', emoji: '🛒', price: 120, desc: 'Built by a village wright out of wood you carried in. Hauls more, and faster, behind a horse.' },
  { id: 'arrow', name: 'Arrows', emoji: '🎯', price: 2, desc: 'Goose-fletched. You get most of them back, if you look.' },
  { id: 'nugget', name: 'Gold Nugget', emoji: '🪙', price: 95, desc: 'Heavy for its size, and the colour of a good year.', loot: true },
  { id: 'silverore', name: 'Silver Ore', emoji: '🪨', price: 34, desc: 'Grey rock with a bright vein through it. A smith knows what to do with it.', loot: true },
];

export const ITEMS: Record<string, Item> = Object.fromEntries(list.map((i) => [i.id, i]));

export function isEquippable(item: Item): boolean {
  return item.slot !== undefined;
}

export function isConsumable(item: Item): boolean {
  return item.effect !== undefined && item.slot === undefined;
}

/** One-line summary of what an item does, for tooltips and the rucksack. */
export function itemSummary(item: Item): string {
  const bits: string[] = [];
  if (item.attack) bits.push(`+${item.attack} attack`);
  if (item.defence) bits.push(`+${item.defence} defence`);
  if (item.hearts) bits.push(`+${item.hearts} hearts`);
  if (item.ability) bits.push(ABILITY_NOTES[item.ability]);
  if (item.effect?.type === 'heal') bits.push(`heals ${item.effect.amount}`);
  if (item.effect?.type === 'rest') bits.push('sleep until dawn');
  return bits.join(', ');
}
