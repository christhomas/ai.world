import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HighCountry } from '../src/game/highcountry';
import type { SkyIslands } from '../src/render/skyisland';
import { Manifest } from '../src/world/manifest';
import { mayChangeEyrie } from './eyries';
import { cleanDelta, type WorldDelta } from './protocol';
import { FileVault } from './filevault';
import { Forgetful } from './vault';
import { SharedWorld, worldPath } from './world';

const SEED = 73;
const nest = () => new Manifest(SEED).ensure('eyrie:12,34', 'eyrie', 12, 34);
const add = (): Extract<WorldDelta, { kind: 'eyrie' }> =>
  ({ kind: 'eyrie', anchor: nest(), present: true });
const remove = (): Extract<WorldDelta, { kind: 'eyrie' }> =>
  ({ kind: 'eyrie', anchor: nest(), present: false });
const client = () => {
  const manifest = new Manifest(SEED);
  const high = new HighCountry(SEED, manifest, {} as SkyIslands);
  return { manifest, high, receive(delta: WorldDelta) {
    if (delta.kind === 'eyrie') high.applyBaited(delta.anchor, delta.present);
  } };
};

describe('shared baited nests', () => {
  it('offers nests from an older manifest that has no delta log', () => {
    const vault = new Forgetful();
    const manifest = new Manifest(SEED);
    manifest.anchors.set(nest().id, nest());
    vault.write('old-world.json', JSON.stringify({ seed: SEED, clock: { day: 1, time: 0 },
      deltas: [], manifest: manifest.toJSON() }));
    const world = new SharedWorld(SEED, 'old-world.json', { day: 1, time: 0 }, '', vault);
    expect(world.log).toEqual([add()]);
  });

  it('validates the nest anchor and the reporting hero before changing the world', () => {
    const manifest = new Manifest(SEED);
    const delta = add();
    expect(cleanDelta(delta)).toEqual(delta);
    expect(mayChangeEyrie(manifest, { x: 12, z: 35 }, delta)).toBe(true);
    expect(mayChangeEyrie(manifest, { x: 120, z: 350 }, delta)).toBe(false);
    expect(mayChangeEyrie(manifest, null, delta)).toBe(false);
    expect(mayChangeEyrie(manifest, { x: 12, z: 35 }, remove())).toBe(false);
    expect(cleanDelta({ ...delta, anchor: { ...delta.anchor, seed: Number.NaN } })).toBeNull();
    expect(cleanDelta({ ...delta, anchor: { ...delta.anchor, id: 'other' } })).toBeNull();
    expect(cleanDelta({ ...delta, present: 'yes' as never })).toBeNull();
    manifest.anchors.set(delta.anchor.id, delta.anchor);
    expect(mayChangeEyrie(manifest, { x: 12, z: 35 }, remove())).toBe(true);
  });

  it('gives two clients, a reconnect, and a restarted world the same single nest and removal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiworld-eyrie-'));
    try {
      const path = worldPath(dir, SEED);
      const world = new SharedWorld(SEED, path, { day: 1, time: 0 }, dir, new FileVault());
      const a = client(), b = client();
      expect(world.apply(add())).toBe(true);
      expect(world.apply(add())).toBe(false);
      // The baiting page applies its own accepted anchor; the other receives the broadcast.
      a.receive(add());
      b.receive(world.log[0]);
      expect(a.high.eyries.map((e) => e.id)).toEqual([nest().id]);
      expect(b.high.eyries).toEqual(a.high.eyries);
      expect(world.manifest.byKind('eyrie')).toEqual([nest()]);
      world.save();

      const restarted = new SharedWorld(SEED, path, { day: 9, time: 0 }, dir, new FileVault());
      const reconnect = client();
      for (const delta of restarted.log) reconnect.receive(delta);
      expect(reconnect.high.eyries).toEqual(a.high.eyries);
      expect(restarted.log).toHaveLength(1);
      expect(restarted.apply(remove())).toBe(true);
      expect(restarted.apply(remove())).toBe(false);
      for (const page of [a, b, reconnect]) {
        page.receive(restarted.log[0]);
        expect(page.manifest.byKind('eyrie')).toEqual([]);
        expect(page.high.eyries).toEqual([]);
      }
      restarted.save();
      const afterRemoval = new SharedWorld(SEED, path, { day: 1, time: 0 }, dir, new FileVault());
      const late = client();
      for (const delta of afterRemoval.log) late.receive(delta);
      expect(afterRemoval.log).toEqual([remove()]);
      expect(afterRemoval.manifest.byKind('eyrie')).toEqual([]);
      expect(late.high.eyries).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replaces saved page nests with the remote snapshot across removal and save/load', () => {
    const local = new Manifest(SEED);
    const ghost = nest();
    local.anchors.set(ghost.id, ghost);
    const high = new HighCountry(SEED, local, {} as SkyIslands);
    high.reconcileBaited([]);
    expect(new Manifest(SEED, local.toJSON()).byKind('eyrie')).toEqual([]);

    const accepted = new Manifest(SEED).ensure('eyrie:20,30', 'eyrie', 20, 30);
    high.reconcileBaited([accepted]);
    expect(new Manifest(SEED, local.toJSON()).byKind('eyrie')).toEqual([accepted]);
  });
});
