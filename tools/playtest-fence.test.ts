import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const { chooseFenceApproach, playFence } = createRequire(import.meta.url)('./playtest-fence.cjs');
const yard = { x: 0, z: 0, half: 3, gate: [0, -3] };
const rail = (x: number, z: number) =>
  (Math.abs(Math.abs(x - 0.5) - 3) < 0.1 && Math.abs(z - 0.5) <= 3.5) ||
  (Math.abs(Math.abs(z - 0.5) - 3) < 0.1 && Math.abs(x - 0.5) <= 3.5 && x !== 0.5);
// A larger body reaches the rail before its centre. Only the east side has an open runway.
const horseFits = (x: number, z: number) => x >= 4.7 && Math.abs(z - 0.5) < 2;

describe('a mounted approach to a thin paddock rail', () => {
  it('finds a solid thin rail with a clear runway for the actual horse body', () => {
    const at = chooseFenceApproach(yard, rail, horseFits, () => 0, []);
    expect(at).not.toBeNull();
    expect(at).toMatchObject({ x: 3.5, z: 0.5, nx: 1, nz: 0 });
    expect(at.start.x).toBeGreaterThan(at.x + 4);
    expect(at.near).toBeGreaterThan(1);
    expect(at.yaw).toBe(Math.PI);
  });

  it('rejects a clear centre ray when the horse body cannot fit', () => {
    expect(chooseFenceApproach(yard, rail, () => false, () => 0, [])).toBeNull();
  });

  it('does not treat missing rails or a thick wall as a thin fence', () => {
    expect(chooseFenceApproach(yard, () => false, horseFits, () => 0, [])).toBeNull();
    expect(chooseFenceApproach(yard, () => true, horseFits, () => 0, [])).toBeNull();
  });

  it('rejects unloaded ground and a live animal on the runway', () => {
    expect(chooseFenceApproach(yard, rail, horseFits, () => null, [])).toBeNull();
    const cow = { x: 6, z: 0.5, dead: false, role: 'wild' };
    expect(chooseFenceApproach(yard, rail, horseFits, () => 0, [cow])).toBeNull();
    expect(chooseFenceApproach(yard, rail, horseFits, () => 0, [{ ...cow, dead: true }])).not.toBeNull();
  });

  it('rejects a runway that changes height beyond the carrier climb', () => {
    const stands = (x: number, z: number, _yaw: number, fromY: number) => horseFits(x, z) && fromY === 0;
    expect(chooseFenceApproach(yard, rail, stands, () => 2, [])).toBeNull();
  });

  it.each([false, true])('returns its loan after a walking failure (key release fails: %s)', async (releaseFails) => {
    const original = { name: 'Faithful', x: 4, z: 7, palette: 123, cargo: { kind: 'deer', left: 100 } };
    const player = { x: 0.5, z: 0.5, placed: true, ground: { heightAt: () => 0 } };
    let borrowed = false;
    const borrow = vi.fn(() => { borrowed = true; });
    const giveBack = vi.fn(() => { borrowed = false; });
    const window = {
      __player: player, __villages: [{ name: 'Test paddock', stable: yard }],
      __solid: rail, __mountClear: horseFits, __entitiesFull: () => [],
      __mount: () => ({ saved: original, riding: borrowed, breed: 'horse', under: 0,
        hero: { x: player.x, z: player.z }, horse: borrowed ? { x: player.x, z: player.z } : null }),
      __borrowHorse: borrow, __returnHorse: giveBack,
    };
    const page = {
      evaluate: async (fn: Function, argument?: unknown) => runInNewContext(`(${fn.toString()})(argument)`,
        { window, globalThis: window, argument, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} }),
      waitForFunction: async () => true,
      keyboard: { up: vi.fn(async () => { if (releaseFails) throw new Error('key release failed'); }) },
    };
    const walk = vi.fn(async () => { throw new Error('walk failed'); });
    const go = async (x: number, z: number) => { player.x = x; player.z = z; };

    await expect(playFence(page, () => {}, go, async () => {}, walk))
      .rejects.toThrow(releaseFails ? 'key release failed' : 'walk failed');

    expect(borrow).toHaveBeenCalledTimes(2);
    expect(walk).toHaveBeenCalledOnce();
    expect(page.keyboard.up).toHaveBeenCalledExactlyOnceWith('w');
    expect(giveBack).toHaveBeenCalledOnce();
    expect(borrowed).toBe(false);
    expect(window.__mount().saved).toEqual(original);
    expect(window).not.toHaveProperty('__fenceTrace');
  });
});
