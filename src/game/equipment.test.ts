import { describe, expect, it } from 'vitest';
import { ITEMS } from './items';
import { GameState } from './state';

describe('a fresh hero', () => {
  it('sets out dressed, with a stick and some food', () => {
    const s = GameState.fresh();
    expect(s.worn('body')?.id).toBe('tunic');
    expect(s.worn('feet')?.id).toBe('boots');
    expect(s.worn('hand')?.id).toBe('stick');
    expect(s.count('apple')).toBe(2);
    expect(s.attack).toBe(1 + ITEMS.stick.attack!);
    expect(s.armed).toBe(false);            // a stick does not frighten a wolf
    expect(s.defence).toBe(ITEMS.tunic.defence! + ITEMS.boots.defence!);
    // a save with no state at all still starts you dressed
    expect(GameState.from(undefined).worn('body')?.id).toBe('tunic');
    // an existing save is taken as it is, not topped up with a kit
    const loaded = GameState.from({ hp: 4 });
    expect(loaded.worn('body')).toBeNull();
    expect(loaded.hp).toBe(4);
  });
});

describe('equipment', () => {
  it('wearing takes from the pack, swapping puts the old piece back', () => {
    const s = new GameState();
    s.give('sword', 1);
    s.give('steelsword', 1);
    expect(s.attack).toBe(1);                 // bare hands until it is in your hand

    expect(s.equip('sword')?.id).toBe('sword');
    expect(s.count('sword')).toBe(0);
    expect(s.worn('hand')?.id).toBe('sword');
    expect(s.attack).toBe(3);                 // 1 + 2
    expect(s.armed).toBe(true);

    expect(s.equip('steelsword')?.id).toBe('steelsword');
    expect(s.worn('hand')?.id).toBe('steelsword');
    expect(s.count('sword')).toBe(1);         // the old sword came back to the pack
    expect(s.attack).toBe(4);

    s.unequip('hand');
    expect(s.worn('hand')).toBeNull();
    expect(s.count('steelsword')).toBe(1);
    expect(s.attack).toBe(1);
    expect(s.equip('apple')).toBeNull();      // food is not gear
  });

  it('armour adds hearts and turns bites aside, never below one', () => {
    const s = new GameState();
    s.give('mail', 1);
    s.give('shield', 1);
    const baseMax = s.maxHpTotal;
    s.equip('mail');
    s.equip('shield');
    expect(s.defence).toBe(ITEMS.mail.defence! + ITEMS.shield.defence!);
    expect(s.maxHpTotal).toBe(baseMax + ITEMS.mail.hearts!);

    s.hp = s.maxHpTotal;
    s.damage(4);                              // 4 - floor(6/2) = 1
    expect(s.hp).toBe(s.maxHpTotal - 1);
    s.damage(1);
    expect(s.hp).toBe(s.maxHpTotal - 2);      // a scratch still costs a heart

    // taking off gear you were relying on cannot leave you above your maximum
    s.hp = s.maxHpTotal;
    s.unequip('body');
    expect(s.hp).toBeLessThanOrEqual(s.maxHpTotal);
  });

  it('tools only work while held', () => {
    const s = new GameState();
    s.give('lantern', 1);
    s.give('rope', 1);
    s.give('map', 1);
    expect(s.can('light')).toBe(false);
    expect(s.climb).toBeLessThan(1);
    s.equip('lantern');
    s.equip('rope');
    expect(s.can('light')).toBe(true);
    expect(s.can('climb')).toBe(true);
    expect(s.climb).toBeGreaterThan(1);
    expect(s.can('map')).toBe(false);         // only one pocket, and the rope is in it
    s.equip('map');
    expect(s.can('map')).toBe(true);
    expect(s.can('climb')).toBe(false);
    expect(s.count('rope')).toBe(1);
  });

  it('worn gear survives a save and reload, and unknown ids are dropped', () => {
    const s = new GameState();
    s.give('helm', 1);
    s.give('rod', 1);
    s.equip('helm');
    s.equip('rod');
    s.give('perch', 3);
    const json = JSON.parse(JSON.stringify(s.toJSON()));
    const back = GameState.from(json);
    expect(back.worn('head')?.id).toBe('helm');
    expect(back.can('fish')).toBe(true);
    expect(back.count('perch')).toBe(3);
    expect(back.maxHpTotal).toBe(s.maxHpTotal);

    json.inventory.equipped.head = 'not-a-real-item';
    json.inventory.equipped.body = 'sword';   // wrong slot for a sword
    const patched = GameState.from(json);
    expect(patched.worn('head')).toBeNull();
    expect(patched.worn('body')).toBeNull();
  });
});

/**
 * A tool works for being carried; worn kit works for being worn. The line matters because it is
 * what stops nine tools taking turns in one hand, and what stops a lantern lighting the way from
 * the bottom of a rucksack.
 */
describe('a tool in the pack', () => {
  it('works without being held, however many of them there are', () => {
    const s = GameState.fresh();
    expect(s.can('dig')).toBe(false);
    for (const tool of ['shovel', 'saw', 'knife', 'rod', 'tent', 'mortar']) s.give(tool, 1);

    for (const ability of ['dig', 'fell', 'skin', 'fish', 'camp', 'grind'] as const) {
      expect(s.can(ability), ability).toBe(true);
    }
    expect(s.equipped.offhand, 'a tool should not have taken the offhand').toBeUndefined();
  });

  it('stops working once it is out of the pack', () => {
    const s = GameState.fresh();
    s.give('saw', 1);
    expect(s.can('fell')).toBe(true);
    s.take('saw', 1);
    expect(s.can('fell')).toBe(false);
  });

  it('will not let a lantern light the way from inside the pack', () => {
    const s = GameState.fresh();
    s.give('lantern', 1);
    expect(s.can('light'), 'a lantern has to be held up').toBe(false);
    s.equip('lantern');
    expect(s.can('light')).toBe(true);
  });
});
