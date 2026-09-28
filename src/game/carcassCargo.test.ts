import { describe, expect, it } from 'vitest';
import { GameState } from './state';

describe('carcass carried on foot', () => {
  it('survives a save with the time left intact', () => {
    const state = GameState.fresh();
    state.shouldering = { kind: 'goat', left: 37 };
    const restored = GameState.from(state.toJSON());
    expect(restored.shouldering).toEqual({ kind: 'goat', left: 37 });
    expect(restored.toJSON().shouldering).toEqual({ kind: 'goat', left: 37 });
  });

  it('does not restore a spoiled or unrecognized body', () => {
    const save = GameState.fresh().toJSON();
    expect(GameState.from({ ...save, shouldering: { kind: 'goat', left: 0 } }).shouldering).toBeNull();
    expect(GameState.from({ ...save, shouldering: { kind: 'skeleton', left: 20 } }).shouldering).toBeNull();
  });
});
