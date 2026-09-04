import { describe, expect, it } from 'vitest';
import { STRIKE, arcOf, blowOf, bodyLean, limbTurn, strikeAt } from './blows';
import { KINDS } from './animals';

/**
 * A blow exists to be watched, so what is tested is that it actually moves something, that every
 * creature in the game throws one, and that the shape goes back before it comes forward.
 */
describe('throwing a blow', () => {
  it('winds up before it comes through, and settles at the end', () => {
    expect(arcOf(0)).toBe(0);
    expect(arcOf(STRIKE.WIND / 2), 'must go back first').toBeLessThan(0);
    expect(arcOf(STRIKE.WIND + (1 - STRIKE.WIND) / 2), 'and then come forward').toBeGreaterThan(0);
    expect(arcOf(1)).toBe(0);
  });

  it('reads a countdown as how far through the blow is', () => {
    expect(strikeAt(0)).toBe(0);
    expect(strikeAt(STRIKE.LASTS)).toBeCloseTo(0, 5);
    expect(strikeAt(STRIKE.LASTS / 2)).toBeCloseTo(0.5, 5);
  });

  it('moves the arm for a swing and the leg for a kick, and never both', () => {
    const at = STRIKE.WIND + 0.3;
    expect(limbTurn('armR', 'swing', at, false)).not.toBeNull();
    expect(limbTurn('legR', 'swing', at, false)).toBeNull();
    expect(limbTurn('legR', 'kick', at, false)).not.toBeNull();
    expect(limbTurn('armR', 'kick', at, false)).toBeNull();
  });

  it('throws with the other hand when told to, so a flurry is not one arm four times', () => {
    const at = STRIKE.WIND + 0.3;
    expect(limbTurn('armR', 'punch', at, false)).not.toBeNull();
    expect(limbTurn('armR', 'punch', at, true)).toBeNull();
    expect(limbTurn('armL', 'punch', at, true)).not.toBeNull();
  });

  it('swings a weapon further than it throws a fist', () => {
    const at = STRIKE.WIND + (1 - STRIKE.WIND) / 2;
    expect(Math.abs(limbTurn('armR', 'swing', at, false)!))
      .toBeGreaterThan(Math.abs(limbTurn('armR', 'punch', at, false)!));
  });

  it('tips the whole body over for a rear, and for nothing else', () => {
    const at = STRIKE.WIND + 0.3;
    expect(bodyLean('rear', at)).not.toBe(0);
    expect(bodyLean('lunge', at), 'and for a thing with nothing else to throw').not.toBe(0);
    for (const blow of ['swing', 'punch', 'kick', 'bite'] as const) {
      expect(bodyLean(blow, at), blow).toBe(0);
    }
  });

  it('gives every creature in the game something to throw', () => {
    for (const [id, kind] of Object.entries(KINDS)) {
      const blow = blowOf(kind);
      expect(['swing', 'punch', 'kick', 'bite', 'rear', 'lunge'], id).toContain(blow);
      // and whatever it is, it must actually move a part this creature has
      const roles = new Set(kind.parts.map((p) => p.anim));
      const at = STRIKE.WIND + 0.3;
      const moved = [...roles].some((role) => limbTurn(role, blow, at, false) !== null);
      expect(moved || bodyLean(blow, at) !== 0, `${id} throws a ${blow} that moves nothing`).toBe(true);
    }
  });

  it('has a bear go up on its hind legs and a wolf use its teeth', () => {
    expect(blowOf(KINDS.bear)).toBe('rear');
    expect(blowOf(KINDS.wolf)).toBe('bite');
    expect(blowOf(KINDS.villager), 'anything with arms throws hands').toBe('punch');
  });
});
