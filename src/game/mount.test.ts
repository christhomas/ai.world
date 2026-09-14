import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TileWorld } from '../entities/entity';
import { Player } from '../entities/player';
import { EntityRenderer } from '../entities/pool';
import { Mount } from './mount';

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
