import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { GameState } from './state';
import { ITEMS, sellPrice } from './items';
import { dialogueFor } from './talk';

describe('shop dialogue', () => {
  const keeper = (shop: 'store' | 'smith' | 'inn' | 'apothecary', rng = mulberry32(5)) => {
    const herd = new Herd(KINDS.shopkeeper, 0, 0, 0, 0, 1);
    herd.tag = 'Testford';
    const e = new Entity(KINDS.shopkeeper, 0, 0, herd, 'k', rng);
    e.role = 'shopkeeper';
    e.shop = shop;
    return e;
  };

  it('buying puts the item in the rucksack, unworn, and refuses when broke', () => {
    const rng = mulberry32(5);
    const e = keeper('store', rng);
    const state = new GameState();
    let changes = 0;
    const ctx = { state, rng, time: 0.5, quests: new Map(), onInventoryChange: () => changes++, onQuestChange: () => {} };

    const root = dialogueFor(e, ctx);
    expect(root.choices?.map((c) => c.label)).toEqual(['Buy', 'Sell', 'Chat', 'Leave']);
    const menu = root.choices![0].next()!;
    expect(menu.pages[0]).toContain('50 gold');
    const apple = menu.choices!.find((c) => c.label.includes('Apple'))!;
    const bought = apple.next()!;
    expect(state.inventory.gold).toBe(45);
    expect(state.count('apple')).toBe(1);
    expect(changes).toBe(1);
    expect(bought.pages[1]).toContain('in your pack');

    // gear is bought into the pack, not worn
    state.inventory.gold = 100;
    const gearMenu = dialogueFor(e, ctx).choices![0].next()!;
    gearMenu.choices!.find((c) => c.label.includes('Stout Stick'))!.next();
    expect(state.count('stick')).toBe(1);
    expect(state.worn('hand')).toBeNull();

    // too poor
    state.inventory.gold = 1;
    const refused = dialogueFor(e, ctx).choices![0].next()!.choices!.find((c) => c.label.includes('Lantern'))!.next()!;
    expect(refused.pages[0]).toContain("only got 1");
    expect(state.count('lantern')).toBe(0);
  });

  it('selling pays half price and empties the pack, and shops only buy what they deal in', () => {
    const rng = mulberry32(11);
    const state = new GameState();
    state.give('pike', 2);
    state.give('sword', 1);
    const ctx = { state, rng, time: 0.5, quests: new Map(), onInventoryChange: () => {}, onQuestChange: () => {} };

    // the inn takes fish but not swords
    const innMenu = dialogueFor(keeper('inn', rng), ctx).choices![1].next()!;
    const labels = innMenu.choices!.map((c) => c.label);
    expect(labels.some((l) => l.includes('Pike'))).toBe(true);
    expect(labels.some((l) => l.includes('Iron Sword'))).toBe(false);

    const gold = state.inventory.gold;
    innMenu.choices!.find((c) => c.label.startsWith('Sell the lot'))!.next();
    expect(state.count('pike')).toBe(0);
    expect(state.inventory.gold).toBe(gold + sellPrice(ITEMS.pike) * 2);
    expect(state.count('sword')).toBe(1);   // the inn did not touch it

    // the smith takes the sword
    const smithMenu = dialogueFor(keeper('smith', rng), ctx).choices![1].next()!;
    smithMenu.choices!.find((c) => c.label.includes('Iron Sword'))!.next();
    expect(state.count('sword')).toBe(0);
  });

  it('villager dialogue substitutes the village name', () => {
    const rng = mulberry32(3);
    const herd = new Herd(KINDS.villager, 0, 0, 0, 0, 1);
    herd.tag = 'Testford';
    const v = new Entity(KINDS.villager, 0, 0, herd, 'k', rng);
    expect(v.line(() => 0)).toContain('Testford');
  });

  it('shops are shut at night', () => {
    const rng = mulberry32(9);
    const state = new GameState();
    const night = dialogueFor(keeper('smith', rng), { state, rng, time: 0.95, quests: new Map(), onInventoryChange: () => {}, onQuestChange: () => {} });
    expect(night.choices).toBeUndefined();
    expect(night.pages[0]).toContain('shut for the night');
  });
});

describe('quests', () => {
  it('generates one quest per village deterministically and the elder flow pays out', async () => {
    const { generateRoadGraph } = await import('../world/graph');
    const { TerrainSampler } = await import('../world/terrain');
    const { generateQuests } = await import('./quests');
    const sampler = new TerrainSampler(generateRoadGraph(3));
    const a = generateQuests(sampler.structures, 3);
    const b = generateQuests(sampler.structures, 3);
    expect(a.length).toBeGreaterThan(3);
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    const fetch = a.find((q) => q.kind === 'fetch');
    const visit = a.find((q) => q.kind === 'visit');
    expect(fetch && visit).toBeTruthy();

    const rng = mulberry32(1);
    const state = new GameState();
    const herd = new Herd(KINDS.villager, 0, 0, 0, 0, 1);
    herd.tag = visit!.village;
    const elder = new Entity(KINDS.villager, 0, 0, herd, 'k', rng);
    elder.role = 'elder';
    const changes: string[] = [];
    const ctx = { state, rng, time: 0.5, quests: new Map(a.map((q) => [q.village, q])), onInventoryChange: () => {}, onQuestChange: (_q: unknown, s: string) => changes.push(s) };

    const offer = dialogueFor(elder, ctx);
    expect(offer.choices?.[0].label).toBe('Accept');
    offer.choices![0].next();
    expect(state.quests.get(visit!.id)).toBe('active');
    expect(dialogueFor(elder, ctx).pages[0]).toBe(visit!.reminder);
    state.discovered.add(visit!.target);
    const turnIn = dialogueFor(elder, ctx);
    expect(turnIn.choices?.[0].label).toContain(String(visit!.reward));
    const gold = state.inventory.gold;
    turnIn.choices![0].next();
    expect(state.inventory.gold).toBe(gold + visit!.reward);
    expect(state.quests.get(visit!.id)).toBe('done');
    expect(changes).toEqual(['active', 'done']);
  });
});
