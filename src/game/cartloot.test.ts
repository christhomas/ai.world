import { describe, expect, it } from 'vitest';
import type { CarrierFact } from '../world/carrierbook';
import { GameState } from './state';
import { claimCartCargo } from './cartloot';

const facts: CarrierFact[] = [
  { kind: 'cart-finished', day: 3, loadedOn: 3, outcome: 'robbed', robber: 'Rowan',
    receiving: [['buyer', 0.37]] },
  { kind: 'cart-loaded', day: 3, from: 'Barrowgate', to: 'Stonerock', meals: 3.7, price: 0.1,
    paying: [['buyer', -0.37]], paid: [['seller', 0.37]] },
];

describe('recorded cart cargo', () => {
  it('grants only the robber whole meals once, including after save and replay', () => {
    const state = GameState.fresh();
    const before = state.inventory.items.get('apple') ?? 0;
    expect(claimCartCargo(state, 'Another', facts)).toBe(0);
    expect(claimCartCargo(state, 'Rowan', [facts[0]])).toBe(0);
    expect(claimCartCargo(state, 'Rowan', facts)).toBe(3);
    expect(state.inventory.items.get('apple')).toBe(before + 3);
    expect(claimCartCargo(state, 'Rowan', facts)).toBe(0);
    const replay = GameState.from(state.toJSON());
    expect(claimCartCargo(replay, 'Rowan', facts)).toBe(0);
    expect(replay.inventory.items.get('apple')).toBe(before + 3);
  });
});
