import { describe, expect, it } from 'vitest';
import type { CarrierFact } from '../world/carrierbook';
import { GameState } from './state';
import { claimCartCargo } from './cartloot';

const facts: CarrierFact[] = [
  { kind: 'cart-finished', day: 3, loadedOn: 3, outcome: 'robbed', robber: 'Rowan',
    robberId: '11111111-1111-4111-8111-111111111111',
    receiving: [['buyer', 0.37]] },
  { kind: 'cart-loaded', day: 3, from: 'Barrowgate', to: 'Stonerock', meals: 3.7, price: 0.1,
    paying: [['buyer', -0.37]], paid: [['seller', 0.37]] },
];

describe('recorded cart cargo', () => {
  it('grants only the robber whole meals once, including after save and replay', () => {
    const state = GameState.fresh();
    const before = state.inventory.items.get('apple') ?? 0;
    expect(claimCartCargo(state, '22222222-2222-4222-8222-222222222222', facts)).toBe(0);
    expect(claimCartCargo(state, '11111111-1111-4111-8111-111111111111', [facts[0]])).toBe(0);
    expect(claimCartCargo(state, '11111111-1111-4111-8111-111111111111', facts)).toBe(3);
    expect(state.inventory.items.get('apple')).toBe(before + 3);
    expect(claimCartCargo(state, '11111111-1111-4111-8111-111111111111', facts)).toBe(0);
    const replay = GameState.from(state.toJSON());
    expect(claimCartCargo(replay, '11111111-1111-4111-8111-111111111111', facts)).toBe(0);
    expect(replay.inventory.items.get('apple')).toBe(before + 3);
  });

  it('does not let another save with the same display name claim the recorded cargo', () => {
    const other = GameState.fresh();
    const before = other.inventory.items.get('apple') ?? 0;
    expect(claimCartCargo(other, '22222222-2222-4222-8222-222222222222', facts)).toBe(0);
    expect(other.inventory.items.get('apple')).toBe(before);
  });
});
