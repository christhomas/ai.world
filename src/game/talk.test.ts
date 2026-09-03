import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { GameState } from './state';
import { dialogueFor } from './talk';

describe('shop dialogue', () => {
  it('buy flow deducts gold, adds the item, refuses when broke', () => {
    const rng = mulberry32(5);
    const herd = new Herd(KINDS.shopkeeper, 0, 0, 0, 0, 1);
    herd.tag = 'Testford';
    const e = new Entity(KINDS.shopkeeper, 0, 0, herd, 'k', rng);
    e.role = 'shopkeeper';
    e.shop = 'store';
    const state = new GameState();
    const inventory = state.inventory;
    let changes = 0;
    const ctx = { state, rng, time: 0.5, quests: new Map(), onInventoryChange: () => changes++, onQuestChange: () => {} };

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

  it('shops are shut at night', () => {
    const rng = mulberry32(9);
    const herd = new Herd(KINDS.shopkeeper, 0, 0, 0, 0, 1);
    herd.tag = 'Nightfall';
    const keeper = new Entity(KINDS.shopkeeper, 0, 0, herd, 'k', rng);
    keeper.role = 'shopkeeper';
    keeper.shop = 'smith';
    const state = new GameState();
    const night = dialogueFor(keeper, { state, rng, time: 0.95, quests: new Map(), onInventoryChange: () => {}, onQuestChange: () => {} });
    expect(night.choices).toBeUndefined();
    expect(night.pages[0]).toContain('shut for the night');
    const day = dialogueFor(keeper, { state, rng, time: 0.5, quests: new Map(), onInventoryChange: () => {}, onQuestChange: () => {} });
    expect(day.choices?.map((c) => c.label)).toContain('Buy');
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
