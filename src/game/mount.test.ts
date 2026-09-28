import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TileWorld } from '../entities/entity';
import { Player } from '../entities/player';
import { EntityRenderer } from '../entities/pool';
import { Mount } from './mount';
import { breedOf } from './stables';

const meadow: TileWorld = {
  heightAt: () => 0,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

describe('putting a rider down', () => {
  it('clears the traversal carrier whenever the mount leaves the world', () => {
    const renderer = new EntityRenderer(new THREE.Scene());
    const player = new Player(meadow, renderer, 0, 0);
    const mount = new Mount(() => 0.5);
    mount.buy(0, 0, meadow, renderer);
    mount.mount(player);
    expect(mount.riding).toBe(true);
    expect(player.entity.mounted).not.toBeNull();

    mount.stable(renderer);

    expect(mount.riding).toBe(false);
    expect(player.entity.mounted).toBeNull();
  });

  it('stops riding when another path clears the traversal carrier', () => {
    const renderer = new EntityRenderer(new THREE.Scene());
    const player = new Player(meadow, renderer, 0, 0);
    const mount = new Mount(() => 0.5);
    mount.buy(0, 0, meadow, renderer);
    mount.mount(player);

    player.teleport(2, 2);

    expect(player.entity.mounted).toBeNull();
    expect(mount.riding).toBe(false);
  });
});

describe('a carcass in a horse cart', () => {
  it('requires an owned horse, a cart, dismounting and close ground access, and holds one body', () => {
    const renderer = new EntityRenderer(new THREE.Scene());
    const player = new Player(meadow, renderer, 0, 0);
    const mount = new Mount(() => 0.5);
    const body = { kind: 'goat', x: 1, z: 0, left: 200 };
    expect(mount.load(body, true, player.x, player.z)).toBe(false);
    mount.buy(0, 0, meadow, renderer);
    expect(mount.load(body, false, player.x, player.z)).toBe(false);
    mount.mount(player);
    expect(mount.load(body, true, player.x, player.z)).toBe(false);
    mount.dismount(player, meadow);
    expect(mount.load({ ...body, x: 10 }, true, player.x, player.z)).toBe(false);
    expect(mount.load(body, true, player.x, player.z)).toBe(true);
    expect(mount.load(body, true, player.x, player.z)).toBe(false);
    expect(mount.cargo).toEqual({ kind: 'goat', left: 200 });
    expect(mount.unload(40, 40)).toBeNull();
    expect(mount.unload(player.x, player.z)).toEqual({ kind: 'goat', left: 200 });
    expect(mount.cargo).toBeNull();
    mount.mount(player);
    expect(mount.unload(player.x, player.z)).toBeNull();
  });

  it('will not hitch a carcass cart to a goat', () => {
    const renderer = new EntityRenderer(new THREE.Scene());
    const mount = new Mount(() => 0.5);
    mount.buy(0, 0, meadow, renderer, breedOf('goat'));
    expect(mount.load({ kind: 'deer', x: 0, z: 0, left: 100 }, true, 0, 0)).toBe(false);
  });

  it('keeps cargo with a parked horse through save, but loses it with a replaced horse', () => {
    const renderer = new EntityRenderer(new THREE.Scene());
    const mount = new Mount(() => 0.5);
    mount.buy(0, 0, meadow, renderer);
    expect(mount.load({ kind: 'deer', x: 0, z: 0, left: 100 }, true, 0, 0)).toBe(true);
    mount.stable(renderer);
    const restored = Mount.from(mount.toJSON(), () => 0.5);
    restored.restore(meadow, renderer);
    expect(restored.cargo).toEqual({ kind: 'deer', left: 100 });
    restored.ageCargo(101);
    expect(restored.cargo).toBeNull();
    restored.load({ kind: 'goat', x: 0, z: 0, left: 100 }, true, 0, 0);
    expect(restored.ageCargo(1, false)).toBe(true);
    expect(restored.cargo).toBeNull();
    restored.load({ kind: 'goat', x: 0, z: 0, left: 100 }, true, 0, 0);
    restored.buy(0, 0, meadow, renderer);
    expect(restored.cargo).toBeNull();
  });
});
