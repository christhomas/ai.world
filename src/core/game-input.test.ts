import { describe, expect, it } from 'vitest';
import { GameInput } from './game-input';

describe('host input ownership', () => {
  it('releases held controls and frame deltas when disposed, including one-shot handlers', () => {
    const input = new GameInput();
    let attacks = 0;
    input.onKey('ENTER', () => attacks++);
    input.hold('W'); input.press('enter');
    input.dragging = true; input.dragDX = 12; input.wheelDelta = 20; input.clicked = true;
    input.endFrame();
    expect(input.isDown('w')).toBe(true);
    expect(input.dragDX).toBe(0);
    input.dispose();
    input.press('enter');
    expect(attacks).toBe(1);
    expect(input.isDown('w')).toBe(false);
    expect(input.dragging).toBe(false);
  });
});
