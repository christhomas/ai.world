import { describe, expect, it } from 'vitest';
import { GameState } from './state';
import { ITEMS, SLOTS, isConsumable, isEquippable } from './items';
import { packView, stowWorn, takeFromPack } from './pack';

/**
 * The pack's rules, which the page's rucksack and an installed app's pack page both answer by
 * (#573): what is shown, and what a tap on a row does.
 */
describe('the pack, wherever it is drawn', () => {
  it('reads the hero: every slot in order, and each carried thing with the verb a tap answers to', () => {
    const state = GameState.fresh();
    const view = packView(state);
    expect(view.worn.map((slot) => slot.slot)).toEqual([...SLOTS]);
    expect(view.gold).toBe(state.inventory.gold);
    for (const thing of view.carried) {
      const item = ITEMS[thing.id];
      expect(thing.verb).toBe(isEquippable(item) ? 'wear' : isConsumable(item) ? 'use' : 'look');
      expect(thing.count).toBe(state.inventory.items.get(thing.id));
    }
  });

  it('stows what is worn and wears it again, and nothing leaves the world on the way', () => {
    const state = GameState.fresh();
    const hand = state.worn('hand');
    expect(hand, 'a fresh hero has something in hand').not.toBeNull();
    expect(stowWorn(state, 'hand')).toBe(`Stowed the ${hand!.name}.`);
    expect(state.worn('hand')).toBeNull();
    expect(packView(state).carried.map((thing) => thing.id)).toContain(hand!.id);
    expect(takeFromPack(state, hand!.id)).toBe(`Equipped the ${hand!.name}.`);
    expect(state.worn('hand')?.id).toBe(hand!.id);
  });

  it('eats what is eaten, and looks at what is only worth something', () => {
    const state = GameState.fresh();
    const food = Object.values(ITEMS).find(isConsumable)!;
    const curio = Object.values(ITEMS).find((item) => !isConsumable(item) && !isEquippable(item))!;
    state.inventory.items.set(food.id, 2);
    state.inventory.items.set(curio.id, 1);
    state.hp = 1;                                  // hungry enough that eating is not refused
    expect(takeFromPack(state, food.id)).toBeTypeOf('string');
    expect(state.inventory.items.get(food.id) ?? 0).toBeLessThan(2);
    expect(takeFromPack(state, curio.id)).toContain(curio.name);
    expect(state.inventory.items.get(curio.id)).toBe(1);
  });

  it('refuses what is not carried, a slot that is not one, and a thing that does not exist', () => {
    const state = GameState.fresh();
    // neither carried nor already worn: a new hero starts with a stick in hand, which is not in the pack
    const elsewhere = Object.values(ITEMS).find((item) => isEquippable(item) && !state.inventory.items.has(item.id)
      && state.worn(item.slot!)?.id !== item.id)!;
    expect(takeFromPack(state, elsewhere.id)).toBeNull();
    expect(state.worn(elsewhere.slot!)?.id).not.toBe(elsewhere.id);
    expect(takeFromPack(state, 'no-such-thing')).toBeNull();
    expect(stowWorn(state, 'tail')).toBeNull();
  });
});
