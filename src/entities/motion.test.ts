import { describe, expect, it } from 'vitest';
import {
  BLOW_NAMES, arcOf, blowOf, bodyLean, cycleTurn, isBlow, lastsFor, limbTurn, mirrors, strikeAt,
} from './motion';
import { KINDS } from './animals';

const still = { walk: 0, flap: 0, phase: 0, headPitch: 0 };
const walking = { walk: 1, flap: 1, phase: Math.PI / 2, headPitch: 0 };

/**
 * The point of animations/motion.json is that somebody can change how the game moves without
 * touching a line of code, so what is tested is that the file is actually in charge: every blow
 * comes from it, every creature can throw one, and a limb that moves does so because the file
 * said a number.
 */
describe('the motion file', () => {
  it('is what says which blows exist at all', () => {
    for (const name of ['swing', 'punch', 'kick', 'bite', 'rear', 'lunge']) {
      expect(BLOW_NAMES, name).toContain(name);
      expect(isBlow(name)).toBe(true);
    }
    expect(isBlow('pirouette')).toBe(false);
  });

  it('gives every blow a length, and takes it from the file', () => {
    for (const name of BLOW_NAMES) {
      expect(lastsFor(name as never), name).toBeGreaterThan(0);
    }
    // a bear takes longer to go up and come down than somebody throws a punch
    expect(lastsFor('rear')).toBeGreaterThan(lastsFor('punch'));
  });

  it('winds up before it comes through, and settles at the end', () => {
    expect(arcOf('swing', 0)).toBe(0);
    expect(arcOf('swing', 0.1), 'must go back first').toBeLessThan(0);
    expect(arcOf('swing', 0.6), 'and then come forward').toBeGreaterThan(0);
    expect(arcOf('swing', 1)).toBe(0);
  });

  it('reads a countdown as how far through the blow is', () => {
    expect(strikeAt('swing', 0)).toBe(0);
    expect(strikeAt('swing', lastsFor('swing'))).toBeCloseTo(0, 5);
    expect(strikeAt('swing', lastsFor('swing') / 2)).toBeCloseTo(0.5, 5);
  });

  it('moves the arm for a swing and the leg for a kick, and never both', () => {
    expect(limbTurn('armR', 'swing', 0.6, false)).not.toBeNull();
    expect(limbTurn('legR', 'swing', 0.6, false)).toBeNull();
    expect(limbTurn('legR', 'kick', 0.6, false)).not.toBeNull();
    expect(limbTurn('armR', 'kick', 0.6, false)).toBeNull();
  });

  it('throws with the other hand when told to, so a flurry is not one arm four times', () => {
    expect(mirrors('punch')).toBe(true);
    expect(limbTurn('armR', 'punch', 0.6, false)).not.toBeNull();
    expect(limbTurn('armR', 'punch', 0.6, true)).toBeNull();
    expect(limbTurn('armL', 'punch', 0.6, true)).not.toBeNull();
  });

  it('swings a weapon further than it throws a fist, because the file says so', () => {
    expect(Math.abs(limbTurn('armR', 'swing', 0.6, false)!))
      .toBeGreaterThan(Math.abs(limbTurn('armR', 'punch', 0.6, false)!));
  });

  it('tips the whole body over for a rear and a lunge, and for nothing else', () => {
    expect(bodyLean('rear', 0.6)).not.toBe(0);
    expect(bodyLean('lunge', 0.6)).not.toBe(0);
    for (const blow of ['swing', 'punch', 'kick', 'bite'] as const) {
      expect(bodyLean(blow, 0.6), blow).toBe(0);
    }
  });

  it('gives every creature in the game something to throw that moves something', () => {
    for (const [id, kind] of Object.entries(KINDS)) {
      const blow = blowOf(kind);
      expect(BLOW_NAMES, id).toContain(blow);
      const roles = new Set(kind.parts.map((p) => p.anim));
      const moved = [...roles].some((role) => limbTurn(role, blow, 0.6, false) !== null);
      expect(moved || bodyLean(blow, 0.6) !== 0, `${id} throws a ${blow} that moves nothing`).toBe(true);
    }
  });

  it('has a bear go up on its hind legs and a wolf use its teeth', () => {
    expect(blowOf(KINDS.bear)).toBe('rear');
    expect(blowOf(KINDS.wolf)).toBe('bite');
    expect(blowOf(KINDS.villager), 'anything with arms throws hands').toBe('punch');
  });
});

describe('the walk cycle', () => {
  it('holds a leg still when nothing is walking and swings it when something is', () => {
    expect(cycleTurn('legL', still)[2]).toBeCloseTo(0, 5);
    expect(Math.abs(cycleTurn('legL', walking)[2])).toBeGreaterThan(0.1);
  });

  it('swings the legs opposite ways, or it is not a walk', () => {
    const [, , left] = cycleTurn('legL', walking);
    const [, , right] = cycleTurn('legR', walking);
    expect(Math.sign(left)).toBe(-Math.sign(right));
  });

  it('beats a wing on its own axis rather than the one legs walk on', () => {
    const [x, , z] = cycleTurn('wingL', { ...walking, phase: 1 });
    expect(Math.abs(x)).toBeGreaterThan(0);
    expect(z).toBe(0);
  });

  it('waves a tail whether or not anything is moving, because a tail does', () => {
    expect(Math.abs(cycleTurn('tail', { ...still, phase: 1 })[1])).toBeGreaterThan(0);
  });

  it('leaves a part the file says nothing about exactly where it was', () => {
    expect(cycleTurn(undefined, walking)).toEqual([0, 0, 0]);
  });
});
