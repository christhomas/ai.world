import { describe, expect, it } from 'vitest';
import { BOAT, Sailing } from './sailing';
import type { TileWorld } from '../entities/entity';

/** Land is a disc of radius 10 around the origin; everything beyond it is sea. */
const world: TileWorld = {
  heightAt: (x, z) => (Math.hypot(x, z) < 10 ? 0.5 : null),
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

const player = () => ({ entity: { x: 0, z: 0, y: 0, yaw: 0, walk: 0 }, teleport: () => {} }) as never;

describe('sailing', () => {
  it('is bought once, boarded, and remembers where it is moored', () => {
    const boat = new Sailing();
    expect(boat.bought).toBe(false);
    expect(boat.near(0, 0)).toBe(false);
    boat.buy(20, 0, 0);
    expect(boat.bought).toBe(true);
    expect(boat.near(20 + BOAT.REACH - 0.5, 0)).toBe(true);
    expect(boat.near(20 + BOAT.REACH + 1, 0)).toBe(false);
    boat.board();
    expect(boat.sailing).toBe(true);
    const back = Sailing.from(JSON.parse(JSON.stringify(boat.toJSON())));
    expect(back.bought).toBe(true);
    expect(back.x).toBe(20);
    expect(new Sailing().toJSON()).toBeNull();
  });

  it('sails on water, stops at the shore, and slides along it', () => {
    const boat = new Sailing();
    boat.buy(20, 0, Math.PI);   // pointing back at the island
    boat.board();
    for (let t = 0; t < 4; t += 0.1) boat.update(0.1, { forward: 1, turn: 0 }, world, player());
    // it has come in toward the island but cannot climb onto it
    expect(boat.x).toBeLessThan(20);
    expect(world.heightAt(boat.x, boat.z)).toBeNull();
    expect(Math.hypot(boat.x, boat.z)).toBeGreaterThanOrEqual(10);
  });

  it('lands only where there is a shore to land on', () => {
    const boat = new Sailing();
    boat.buy(10.5, 0, 0);
    boat.board();
    const spot = boat.land(world);
    expect(spot).not.toBeNull();
    expect(world.heightAt(spot![0], spot![1])).not.toBeNull();
    expect(boat.sailing).toBe(false);

    const adrift = new Sailing();
    adrift.buy(200, 200, 0);
    adrift.board();
    expect(adrift.land(world)).toBeNull();
    expect(adrift.sailing).toBe(true);   // still aboard, not stranded in the water
  });
});
