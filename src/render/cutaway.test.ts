import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CUT, CUTAWAY_KEY, Cutaway, rememberCutaway, wantsCutaway } from './cutaway';

/**
 * The hole in front of the hero, and the switch that keeps it open.
 *
 * What is worth pinning here is not the shader — a fragment program cannot be unit tested and the
 * only honest check of it is a photograph, which is in the commit that brought it back. It is the
 * two things around it that can go quietly wrong: that turning it on and off costs a number rather
 * than a recompile, and that a browser which refuses to remember anything does not take the game
 * down with it.
 */

/** A store that has been turned off, which is an ordinary state for a browser to be in. */
const refuses = {
  getItem(): string | null { throw new Error('storage is disabled'); },
  setItem(): void { throw new Error('storage is disabled'); },
};

/** And one that works, without touching the real one. */
function kept(): Storage {
  const held = new Map<string, string>();
  return {
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => { held.set(k, v); },
  } as unknown as Storage;
}

describe('the see-through switch', () => {
  it('starts off, which is what it was before anybody asked for it back', () => {
    expect(wantsCutaway(kept())).toBe(false);
  });

  it('remembers being turned on, so a world opens the way it was left', () => {
    const store = kept();
    rememberCutaway(true, store);
    expect(store.getItem(CUTAWAY_KEY)).toBe('on');
    expect(wantsCutaway(store)).toBe(true);
    rememberCutaway(false, store);
    expect(wantsCutaway(store)).toBe(false);
  });

  it('shrugs at a browser that will not remember anything', () => {
    // private windows, storage turned off in settings, a page in a sandboxed frame: all of them
    // throw on the way in, and none of them is a reason a game should not start
    expect(() => rememberCutaway(true, refuses)).not.toThrow();
    expect(wantsCutaway(refuses)).toBe(false);
  });
});

describe('the hole itself', () => {
  it('is off until it is asked for, and says which it is', () => {
    const cut = new Cutaway();
    expect(cut.on).toBe(false);
    cut.show(true);
    expect(cut.on).toBe(true);
    cut.show(false);
    expect(cut.on).toBe(false);
  });

  it('does not recompile a material to change its mind', () => {
    /*
     * The reason the switch is a uniform. `three` caches compiled programs by a key, so a material
     * patched differently is a different program — and rebuilding shaders as somebody ticks a box
     * is a stutter they would blame on the game. Flipping the switch must not touch the key.
     */
    const cut = new Cutaway();
    const material = new THREE.MeshLambertMaterial();
    cut.attach(material);
    const before = material.customProgramCacheKey?.();
    cut.show(true);
    expect(material.customProgramCacheKey?.(), 'turning it on rebuilt the shader').toBe(before);
  });

  it('leaves alone whatever is standing at the hero\'s own feet', () => {
    // the floor test, as a number rather than as prose: the ground in front of somebody is at his
    // feet and a wall is not, which is the whole of why the ground is never punched through
    expect(CUT.ABOVE).toBeGreaterThan(0);
  });
});
