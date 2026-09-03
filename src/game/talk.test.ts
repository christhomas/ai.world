import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { Inventory } from './shops';
import { dialogueFor } from './talk';

describe('shop dialogue', () => {
  it('buy flow deducts gold, adds the item, refuses when broke', () => {
    const rng = mulberry32(5);
    const herd = new Herd(KINDS.shopkeeper, 0, 0, 0, 0, 1);
    herd.tag = 'Testford';
    const e = new Entity(KINDS.shopkeeper, 0, 0, herd, 'k', rng);
    e.role = 'shopkeeper';
    e.shop = 'store';
    const inventory = new Inventory();
    let changes = 0;
    const ctx = { inventory, rng, onInventoryChange: () => changes++ };

    const root = dialogueFor(e, ctx);
    expect(root.choices?.map((c) => c.label)).toEqual(['Buy', 'Chat', 'Leave']);
    const menu = root.choices![0].next()!;
    expect(menu.pages[0]).toContain('50 gold');
    expect(menu.choices![0].label).toContain('Apple');
    const bought = menu.choices![0].next()!;
    expect(inventory.gold).toBe(45);
    expect(inventory.items.get('apple')).toBe(1);
    expect(changes).toBe(1);
    expect(bought.pages[0]).toContain('Apple');

    // drain gold, then a lantern (30g) must be refused
    inventory.gold = 10;
    const menu2 = bought.choices![0].next()!;
    const lantern = menu2.choices!.find((c) => c.label.includes('Lantern'))!;
    const refused = lantern.next()!;
    expect(refused.pages[0]).toContain("only got 10");
    expect(inventory.gold).toBe(10);
    expect(changes).toBe(1);

    // villager dialogue substitutes the village name
    const v = new Entity(KINDS.villager, 0, 0, herd, 'k', rng);
    const line = v.line(() => 0);
    expect(line).toContain('Testford');
  });
});
