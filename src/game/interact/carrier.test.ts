import { describe, expect, it } from 'vitest';
import { carrierInteractions } from './carrier';
import type { Surroundings } from './context';

describe('the visible carrier interaction', () => {
  it('shows cargo and offers guarding or robbery when the hero reaches the road', () => {
    const sent: string[] = [];
    const hero = { x: 10, z: 0 };
    let shown: { pages: string[]; choices: Array<{ label: string; next: () => null }> } | null = null;
    const ctx = {
      player: hero, state: { day: 3, time: 0.5 },
      structures: { villages: [{ name: 'Barrowgate', x: 0, z: 0 }, { name: 'Stonerock', x: 20, z: 0 }] },
      sampler: { graph: { nodes: [] } },
      register: { carrierFacts: () => [{ kind: 'cart-loaded', day: 3, from: 'Barrowgate',
        to: 'Stonerock', meals: 12, price: 1, paying: [], paid: [] }] },
      online: { connected: true, cartAction: (type: string) => sent.push(type) },
      dialogue: { start: (page: typeof shown) => { shown = page; } },
    } as unknown as Surroundings;
    const { tryCarrier } = carrierInteractions(ctx);
    expect(tryCarrier(true)).toBe(true);
    expect(shown).toBeNull();
    expect(tryCarrier()).toBe(true);
    expect(shown!.pages[0]).toContain('12.0 meals');
    shown!.choices[0].next();
    shown!.choices[1].next();
    expect(sent).toEqual(['escort-cart', 'rob-cart']);
    hero.x = 30;
    expect(tryCarrier(true)).toBe(false);
  });
});
