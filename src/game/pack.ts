import { ITEMS, SLOTS, SLOT_ICONS, SLOT_NAMES, isConsumable, isEquippable, itemSummary, sellPrice, type EquipSlot } from './items';
import type { GameState } from './state';

/** What a carried thing answers to when it is taken out of the pack. */
export type PackVerb = 'wear' | 'use' | 'look';

/** The pack as a reader sees it: what is on the body, and what is carried, in the pack's order. */
export interface PackView {
  gold: number;
  hp: number;
  maxHp: number;
  attack: number;
  defence: number;
  worn: Array<{ slot: EquipSlot; slotName: string; icon: string; id: string | null; name: string | null; emoji: string | null; note: string }>;
  carried: Array<{ id: string; name: string; emoji: string; count: number; verb: PackVerb; note: string; price: number }>;
}

/** Sort order in the pack: weapons, armour, tools, then everything else. */
function rank(slot: EquipSlot | undefined): number {
  switch (slot) {
    case 'hand': return 0;
    case 'offhand': return 1;
    case 'head': return 2;
    case 'body': return 3;
    case 'feet': return 4;
    case 'trinket': return 5;
    default: return 6;
  }
}

/**
 * The pack, read off the hero (#573). The page's rucksack draws this and an installed app's pack
 * page shows the same rows, so the two cannot disagree about what is carried or what a tap does.
 */
export function packView(state: GameState): PackView {
  return {
    gold: state.inventory.gold, hp: state.hp, maxHp: state.maxHpTotal, attack: state.attack, defence: state.defence,
    worn: SLOTS.map((slot) => {
      const item = state.worn(slot);
      return { slot, slotName: SLOT_NAMES[slot], icon: SLOT_ICONS[slot], id: item?.id ?? null, name: item?.name ?? null,
        emoji: item?.emoji ?? null, note: item ? itemSummary(item) : '' };
    }),
    carried: [...state.inventory.items.entries()]
      .map(([id, count]) => ({ item: ITEMS[id], count }))
      .filter((entry) => entry.item)
      .sort((a, b) => rank(a.item.slot) - rank(b.item.slot) || a.item.name.localeCompare(b.item.name))
      .map(({ item, count }) => ({
        id: item.id, name: item.name, emoji: item.emoji, count,
        verb: isEquippable(item) ? 'wear' as const : isConsumable(item) ? 'use' as const : 'look' as const,
        note: itemSummary(item) || item.desc, price: sellPrice(item),
      })),
  };
}

/**
 * Take a carried thing out of the pack: wear it, eat or drink it, or look at it. Nothing is ever
 * destroyed by equipping, so swapping gear always puts the old piece back in the pack. Says what
 * happened, or nothing if there was no such thing to take.
 */
export function takeFromPack(state: GameState, id: string): string | null {
  const item = ITEMS[id];
  if (!item || !state.inventory.items.has(id)) return null;
  if (isEquippable(item)) {
    const worn = state.equip(id);
    return worn ? `Equipped the ${worn.name}.` : null;
  }
  if (isConsumable(item)) return state.use(id);
  return `${item.name}: ${item.desc} Worth ${sellPrice(item)} gold to the right buyer.`;
}

/** Take something worn off and put it in the pack. Says what was stowed, or nothing. */
export function stowWorn(state: GameState, slot: string): string | null {
  if (!(SLOTS as readonly string[]).includes(slot)) return null;
  const item = state.unequip(slot as EquipSlot);
  return item ? `Stowed the ${item.name}.` : null;
}
