import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { chooseHouseApproach, chooseGroundedDoors } = createRequire(import.meta.url)('./playtest-approach.cjs') as {
  chooseHouseApproach: (
    house: { x: number; z: number; rot: number },
    solid: (x: number, z: number) => boolean,
    grounded?: (x: number, z: number) => boolean,
    crowd?: { x: number; z: number; dead?: boolean; role?: string }[],
    doors?: { x: number; z: number }[],
  ) => { x: number; z: number; fullRay: boolean } | null;
  chooseGroundedDoors: (
    doors: { x: number; z: number }[], player: { x: number; z: number },
    heightAt: (x: number, z: number) => number | null,
    solid: (x: number, z: number) => boolean,
  ) => { x: number; z: number }[];
};

describe('the played house approach', () => {
  const house = { x: 0, z: 0, rot: 0 };

  it('rejects a centre-line obstacle between the mounted start and the foot start', () => {
    const approach = chooseHouseApproach(house, (x, z) => Math.abs(x + 7) < 0.2 && Math.abs(z) < 0.2);
    expect(approach?.x).toBeCloseTo(4);
    expect(approach?.fullRay).toBe(true);
  });

  it('checks the horse width along the whole ray', () => {
    const approach = chooseHouseApproach(house, (x, z) => Math.abs(x + 6) < 0.2 && Math.abs(z - 0.55) < 0.1);
    expect(approach?.x).toBeCloseTo(4);
    expect(approach?.fullRay).toBe(true);
  });

  it('leaves room for the horse body around a clear centre ray', () => {
    const approach = chooseHouseApproach(house, (x, z) => Math.abs(x + 7) < 0.2 && Math.abs(z - 0.9) < 0.1);
    expect(approach?.x).toBeCloseTo(4);
    expect(approach?.fullRay).toBe(true);
  });

  it('reports when only a four-tile foot approach exists', () => {
    const approach = chooseHouseApproach(house, (x, z) =>
      (Math.abs(x) > 5.5 || Math.abs(z) > 5.5) && (Math.abs(x) < 6.5 || Math.abs(z) < 6.5));
    expect(approach?.x).toBeCloseTo(-4);
    expect(approach?.fullRay).toBe(false);
  });

  it('rejects a horse ray that crosses a tile without ground', () => {
    const approach = chooseHouseApproach(house, () => false,
      (x, z) => !(Math.abs(x + 7) < 0.2 && Math.abs(z) < 0.2));
    expect(approach?.x).toBeCloseTo(4);
    expect(approach?.fullRay).toBe(true);
  });

  it('chooses a different side when somebody is standing in the mounted approach', () => {
    const approach = chooseHouseApproach(house, () => false, () => true,
      [{ x: -6, z: 0, dead: false, role: 'animal' }]);
    expect(approach?.x).toBeCloseTo(4);
    expect(approach?.fullRay).toBe(true);
  });

  it('never walks the wall check into a door, which would take the hero indoors', () => {
    const approach = chooseHouseApproach(house, () => false, () => true, [], [{ x: -1.5, z: 0 }]);
    expect(approach?.x).toBeCloseTo(4);
    expect(approach?.fullRay).toBe(true);
  });

  it('has no approach at all when the only side not blocked crosses the door (#523)', () => {
    // everything but the front (-x) is walled at three tiles out, and the front holds the door
    const approach = chooseHouseApproach(house, (x, z) => x > 2.5 || Math.abs(z) > 2.5, () => true, [],
      [{ x: -1.5, z: 0 }]);
    expect(approach).toBeNull();
  });
});

describe('door selection', () => {
  it('prefers a nearby grounded door and skips unloaded or solid doorsteps', () => {
    const doors = [{ x: 1, z: 0 }, { x: 3, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }];
    const chosen = chooseGroundedDoors(doors, { x: 0, z: 0 },
      (x) => x === 1 ? null : 0, (x) => x === 2);
    expect(chosen.map((d) => d.x)).toEqual([3, 4]);
  });
});
