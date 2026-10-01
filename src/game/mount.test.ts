import { describe, expect, it, vi } from 'vitest';
import type { TileWorld } from '../entities/entity';
import { Player } from '../entities/player';
import { canStand } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { offscreenEntityRenderer } from '../render/entities.test.support';
import { Mount } from './mount';
import { breedOf } from './stables';
import type { Input } from '../core/input';
import type { IsoCamera } from '../render/camera';

const meadow: TileWorld = {
  heightAt: () => 0,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

describe('a borrowed mount for a played check', () => {
  it('returns to owning nothing, clears the rider, and can be returned twice', () => {
    const renderer = offscreenEntityRenderer();
    const player = new Player(meadow, renderer, 0, 0);
    const mount = new Mount(() => 0.5);
    const remove = vi.spyOn(renderer, 'remove');
    mount.borrow(0, 0, meadow, renderer);
    mount.mount(player);
    const horse = mount.entity;
    expect(horse).not.toBeNull();
    expect(mount.riding).toBe(true);
    expect(mount.toJSON()).toBeNull();

    mount.returnBorrowed(meadow, renderer);
    mount.returnBorrowed(meadow, renderer);

    expect(remove).toHaveBeenCalledExactlyOnceWith(horse);
    expect(mount.entity).toBeNull();
    expect(mount.owned).toBe(false);
    expect(player.entity.mounted).toBeNull();
  });

  it('preserves the first horse, its position and cargo through repeated loans and saving', () => {
    const renderer = offscreenEntityRenderer();
    const player = new Player(meadow, renderer, 0, 0);
    const original = { name: 'Old Faithful', x: 4, z: 7, palette: 123,
      breed: 'horse', cargo: { kind: 'deer', left: 100 } };
    const mount = Mount.from(original, () => 0.5);
    mount.restore(meadow, renderer);
    mount.entity!.x = 6;
    const expected = { ...original, x: 6 };
    mount.mount(player);
    mount.borrow(20, 30, meadow, renderer, breedOf('goat'));
    expect(player.entity.mounted).toBeNull();
    expect(mount.breed.id).toBe('goat');
    expect(mount.cargo).toBeNull();
    mount.borrow(40, 50, meadow, renderer);
    expect(mount.load({ kind: 'boar', x: 40, z: 50, left: 20 }, true, 40, 50)).toBe(true);
    mount.ageCargo(5);
    mount.entity!.x = 60;
    const savedDuringLoan = mount.toJSON();
    expect(savedDuringLoan).toEqual(expected);
    savedDuringLoan!.cargo!.left = 1;

    mount.returnBorrowed(meadow, renderer);

    expect(mount.toJSON()).toEqual(expected);
    expect(mount.cargo).toEqual(original.cargo);
    expect(mount.entity).toMatchObject({ x: 6, z: 7, kind: { id: 'horse' } });
    expect(mount.riding).toBe(false);
  });

  it('restores a stabled horse when creating the borrowed entity throws', () => {
    const renderer = offscreenEntityRenderer();
    const mount = new Mount(() => 0.5);
    mount.buy(4, 7, meadow, renderer, breedOf('camel'));
    mount.stable(renderer);
    const original = mount.toJSON();
    vi.spyOn(renderer, 'add').mockImplementationOnce(() => { throw new Error('renderer failed'); });

    expect(() => mount.borrow(20, 30, meadow, renderer)).toThrow('renderer failed');

    expect(mount.toJSON()).toEqual(original);
    expect(mount.entity).toMatchObject({ x: 4, z: 7, kind: { id: 'camel' } });
    mount.returnBorrowed(meadow, renderer);
    expect(mount.toJSON()).toEqual(original);
  });
});

describe('putting a rider down', () => {
  it('walks on the horse’s feet rather than measuring a step from saddle height', () => {
    const renderer = offscreenEntityRenderer();
    const ground: TileWorld = { ...meadow, heightAt: (x) => x >= 3 ? 2 : 0 };
    const player = new Player(ground, renderer, 0, 0);
    const mount = new Mount(() => 0.5);
    mount.buy(0, 0, ground, renderer);
    mount.mount(player);
    const input = { isDown: (key: string) => key === 'w' } as unknown as Input;
    const iso = { target: { x: 0, y: 0, z: 0 },
      basis: () => ({ fx: 1, fz: 0, rx: 0, rz: 1 }) } as unknown as IsoCamera;
    player.speedScale = mount.breed.pace.open;
    expect(player.y).toBe(mount.breed.saddle);
    expect(mount.riding).toBe(true);

    for (let frame = 0; frame < 30; frame++) {
      player.update(input, iso, 0.1);
      mount.update(player, ground);
    }

    expect(player.x).toBeGreaterThan(2);
    expect(player.x).toBeLessThan(3);
    expect(mount.entity!.x).toBe(player.x);
    expect(player.y).toBe(mount.entity!.y + mount.breed.saddle);
  });

  it('boards at the parked horse instead of moving it onto the dismount ledge', () => {
    const renderer = offscreenEntityRenderer();
    const ledge: TileWorld = { ...meadow, blocked: (x) => x > 0.8 };
    const player = new Player(ledge, renderer, 1.2, 0);
    const mount = new Mount(() => 0.5);
    mount.buy(0, 0, ledge, renderer);
    player.walkTo(5, 0);
    expect(canStand(ledge, KINDS.horse, player.x, player.z)).toBe(false);

    mount.mount(player);

    expect({ x: player.x, z: player.z }).toEqual({ x: mount.entity!.x, z: mount.entity!.z });
    expect(canStand(ledge, KINDS.horse, player.x, player.z)).toBe(true);
    expect(player.steering).toBe(false);
    expect(mount.riding).toBe(true);
  });

  it('clears the traversal carrier whenever the mount leaves the world', () => {
    const renderer = offscreenEntityRenderer();
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
    const renderer = offscreenEntityRenderer();
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
    const renderer = offscreenEntityRenderer();
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
    const renderer = offscreenEntityRenderer();
    const mount = new Mount(() => 0.5);
    mount.buy(0, 0, meadow, renderer, breedOf('goat'));
    expect(mount.load({ kind: 'deer', x: 0, z: 0, left: 100 }, true, 0, 0)).toBe(false);
  });

  it('keeps cargo with a parked horse through save, but loses it with a replaced horse', () => {
    const renderer = offscreenEntityRenderer();
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
