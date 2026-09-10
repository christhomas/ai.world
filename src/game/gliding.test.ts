import { describe, expect, it } from 'vitest';
import { KINDS } from '../entities/animals';
import { Entity, Herd, type TileWorld } from '../entities/entity';
import { mulberry32 } from '../core/rng';
import { GLIDE, Glider } from './gliding';
import { JUMP } from '../entities/leap';
import { THERMAL, liftAt, thermalIn, thermalsAround } from '../world/thermals';
import { windAt, windSaid } from '../world/wind';

/**
 * Flying, and the three numbers it is made of: how fast you sink, how fast you go, and how high you
 * started. Everything a glide feels like comes out of those, so what is worth pinning is that they
 * hold together — that height buys distance, that the wind is worth reading, and that a column of
 * warm air gives back more than the wing spends.
 */

/** Flat country at one height, with nothing standing on it. */
function flat(y = 2): TileWorld {
  return {
    heightAt: () => y,
    waterAt: () => null,
    blocked: () => false,
    isRoad: () => true,
  };
}

/** The open sea. */
function sea(): TileWorld {
  return {
    heightAt: () => null,
    waterAt: () => 0.4,
    blocked: () => false,
    isRoad: () => false,
  };
}

function hero(x = 0, z = 0, y = 2): Entity {
  const e = new Entity(KINDS.hero, x, z, new Herd(KINDS.hero, x, z, x, z, 0), 'bench', mulberry32(5));
  e.y = y;
  e.yaw = 0;
  return e;
}

/** Fly until it ends, and say what happened and how far it went. */
function flyOut(glider: Glider, e: Entity, world: TileWorld, seconds = 60): { how: string; far: number } {
  const fromX = e.x, fromZ = e.z;
  for (let n = 0; n < Math.round(seconds * 60); n++) {
    const how = glider.update(1 / 60, { dx: 1, dz: 0 }, e, world);
    if (how !== 'flying') return { how, far: Math.hypot(e.x - fromX, e.z - fromZ) };
  }
  return { how: 'flying', far: Math.hypot(e.x - fromX, e.z - fromZ) };
}

describe('opening the wing', () => {
  it('needs air under you, and a jump is enough of it', () => {
    const glider = new Glider();
    const standing = hero();
    expect(glider.catchTheWind(standing, 2, 1, 1, 0.4), 'it opened on the ground').toBe(false);

    const jumping = hero();
    jumping.leap = JUMP.TIME;
    expect(glider.catchTheWind(jumping, 2, 1, 1, 0.4), 'a jump was not enough air').toBe(true);
    // and it starts at the top of the hop rather than at the instant the key was pressed, or
    // opening it is a reflex test rather than a decision
    expect(glider.altitude).toBeCloseTo(2 + JUMP.RISE, 5);
  });

  it('is enough on its own from somewhere high, without a jump', () => {
    const glider = new Glider();
    const onACliff = hero(0, 0, 12);        // stood on a ledge, ground twelve units below him
    expect(glider.catchTheWind(onACliff, 2, 1, 1, 0.4)).toBe(true);
    expect(glider.altitude).toBeCloseTo(12, 5);
  });
});

describe('a glide', () => {
  it('spends height for distance, and the higher you start the further you go', () => {
    const low = new Glider();
    const fromLow = hero(0, 0, 12);
    low.catchTheWind(fromLow, 2, 1, 1, 0.4);
    const short = flyOut(low, fromLow, flat());

    const high = new Glider();
    const fromHigh = hero(0, 0, 32);
    high.catchTheWind(fromHigh, 2, 1, 1, 0.4);
    const long = flyOut(high, fromHigh, flat());

    expect(short.how).toBe('ground');
    expect(long.how).toBe('ground');
    expect(long.far, 'three times the height did not go further').toBeGreaterThan(short.far * 2);
    // and the ratio is about what the numbers say it should be: forward over down
    expect(short.far / (12 - 2)).toBeGreaterThan(GLIDE.SPEED / GLIDE.SINK * 0.6);
  });

  it('ends in the water when there is nothing else under you', () => {
    const glider = new Glider();
    const out = hero(0, 0, 20);
    glider.catchTheWind(out, 2, 1, 1, 0.4);
    expect(flyOut(glider, out, sea()).how, 'he flew on over the sea for ever').toBe('water');
  });

  it('is over once it is over, whatever anybody asks it afterwards', () => {
    const glider = new Glider();
    const e = hero(0, 0, 6);
    glider.catchTheWind(e, 2, 1, 1, 0.4);
    flyOut(glider, e, flat());
    expect(glider.flying).toBe(false);
    const where = { x: e.x, z: e.z };
    glider.update(1 / 60, { dx: 1, dz: 0 }, e, flat());
    expect({ x: e.x, z: e.z }, 'a folded wing was still flying him').toEqual(where);
  });
});

describe('the warm air', () => {
  it('gives back more than the wing spends, and lifts a glide that would have landed', () => {
    // a sky made entirely of column, which is what circling inside one comes to
    const glider = new Glider(() => THERMAL.RISE);
    const e = hero(0, 0, 6);
    glider.catchTheWind(e, 2, 1, 1, 0.4);
    let climbed = false;
    for (let n = 0; n < 120; n++) {
      glider.update(1 / 60, { dx: 0, dz: 0 }, e, flat());
      if (glider.climbing) climbed = true;
    }
    expect(climbed, 'a column of warm air did not lift him at all').toBe(true);
    expect(glider.altitude, 'he sank through the column').toBeGreaterThan(6);
  });

  it('can be circled inside, which is the whole of whether it is usable', () => {
    // the wing turns at a known rate and flies at a known speed, so the tightest circle it holds is
    // a known size. A column narrower than that is lift nobody can keep.
    const tightest = (GLIDE.SPEED / GLIDE.TURN) * 2;
    expect(THERMAL.RADIUS * 2, 'a column too narrow to turn inside').toBeGreaterThan(tightest);
  });

  it('stands in the same place for everybody, and in different places for different worlds', () => {
    const one = thermalIn(3, -2, 11);
    expect(thermalIn(3, -2, 11), 'the same cell moved between two askings').toEqual(one);
    expect(thermalIn(3, -2, 12), 'two worlds put their columns in the same place').not.toEqual(one);
  });

  it('is a network rather than a scattering: never nowhere, never on top of itself', () => {
    // a long walk across the country, asking what is within reach the whole way
    for (let x = -400; x <= 400; x += 137) {
      for (let z = -400; z <= 400; z += 149) {
        const near = thermalsAround(x, z, THERMAL.SPACING * 1.5, 7);
        expect(near.length, `no warm air at all near ${x},${z}`).toBeGreaterThan(0);
        for (const a of near) {
          for (const b of near) {
            if (a === b) continue;
            expect(Math.hypot(a.x - b.x, a.z - b.z), 'two columns in the same place').toBeGreaterThan(THERMAL.RADIUS);
          }
        }
      }
    }
  });

  it('is strongest in the middle and nothing at all outside', () => {
    const one = thermalIn(0, 0, 3);
    expect(liftAt(one.x, one.z, 3)).toBeCloseTo(THERMAL.RISE, 3);
    expect(liftAt(one.x + THERMAL.RADIUS * 0.5, one.z, 3)).toBeLessThan(THERMAL.RISE);
    expect(liftAt(one.x + THERMAL.RADIUS * 0.5, one.z, 3)).toBeGreaterThan(0);
    expect(liftAt(one.x + THERMAL.RADIUS + 0.01, one.z, 3), 'lift outside the column').toBe(0);
  });
});

describe('the wind', () => {
  it('is the same for everybody in a world at a given hour, and turns as the day goes', () => {
    const morning = windAt(4, 2, 0.3);
    expect(windAt(4, 2, 0.3), 'two askings, two winds').toEqual(morning);
    const evening = windAt(4, 2, 0.8);
    expect(evening, 'the wind never changed all day').not.toEqual(morning);
    // a unit vector, so the strength is the only thing that says how hard it blows
    expect(Math.hypot(morning.x, morning.z)).toBeCloseTo(1, 6);
  });

  it('is named for where it comes from, the way anybody would say it', () => {
    expect(windSaid({ x: 0, z: 1, hard: 1 }), 'a wind going south comes out of the north').toBe('north');
    expect(windSaid({ x: -1, z: 0, hard: 1 }), 'a wind going west comes out of the east').toBe('east');
  });
});
