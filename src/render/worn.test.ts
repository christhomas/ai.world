import { describe, expect, it } from 'vitest';
import { GameState } from '../game/state';
import { Painted, dressed, isDressing } from './worn';

/**
 * Armour is what the hero is made of, not a second hero drawn over the first.
 *
 * The thing worth testing is the undressing. Repainting a body part is easy; putting back what was
 * underneath is where a scheme like this goes wrong, because the colour that was there has been
 * overwritten and there is nothing left to restore it from. So every answer is built from the
 * palette he was born with rather than from whatever he happens to be painted in.
 */

/** The hero's palette out of `properties/people.json`: shirt, hair, trousers, boots, arms. */
const BORN = [0x2fb36a, 0xf2d15c, 0x4a3a2a, 0x3a2a1a, 0xffdab9];

/** A hero with the given kit on, and nothing else. */
function wearing(...kit: string[]): GameState {
  const state = GameState.fresh();
  for (const slot of ['body', 'head', 'feet'] as const) state.unequip(slot);
  for (const id of kit) { state.give(id, 1); state.equip(id); }
  return state;
}

describe('what the hero is wearing', () => {
  it('leaves him as he was born when he is wearing nothing', () => {
    expect(dressed(BORN, (slot) => wearing().worn(slot))).toEqual(BORN);
  });

  it('makes his chest mail, and nothing else', () => {
    const state = wearing('mail');
    const tints = dressed(BORN, (slot) => state.worn(slot));
    expect(tints[Painted.Shirt]).not.toBe(BORN[Painted.Shirt]);
    expect(tints[Painted.Hair]).toBe(BORN[Painted.Hair]);
    expect(tints[Painted.Trousers]).toBe(BORN[Painted.Trousers]);
  });

  /*
   * The arms, which are the whole difference between the two iron shirts.
   *
   * A mail shirt has sleeves of cloth or none at all, so bare arms under mail are the right
   * picture and must stay that way — the temptation, once the arms can take a colour, is to paint
   * everything metal with it. A harness is vambraces as much as breastplate, and the man in one
   * with two pink arms has put on half a suit.
   */
  it('leaves his arms bare under mail and plates them under a harness', () => {
    const inMail = wearing('mail');
    expect(dressed(BORN, (slot) => inMail.worn(slot))[Painted.Arms]).toBe(BORN[Painted.Arms]);
    const inPlate = wearing('plate');
    const tints = dressed(BORN, (slot) => inPlate.worn(slot));
    expect(tints[Painted.Arms]).not.toBe(BORN[Painted.Arms]);
    expect(tints[Painted.Arms]).toBe(tints[Painted.Shirt]);
  });

  it('gives him his own arms back when the harness comes off', () => {
    const state = wearing('plate');
    state.unequip('body');
    expect(dressed(BORN, (slot) => state.worn(slot))).toEqual(BORN);
  });

  it('armours the shin as well as the foot, since greaves are worn over both', () => {
    const state = wearing('greaves');
    const tints = dressed(BORN, (slot) => state.worn(slot));
    expect(tints[Painted.Trousers]).toBe(tints[Painted.Boots]);
    expect(tints[Painted.Trousers]).not.toBe(BORN[Painted.Trousers]);
  });

  it('gives him back his own hair when the helm comes off', () => {
    const on = wearing('helm');
    expect(dressed(BORN, (slot) => on.worn(slot))[Painted.Hair]).not.toBe(BORN[Painted.Hair]);
    on.unequip('head');
    expect(dressed(BORN, (slot) => on.worn(slot))).toEqual(BORN);
  });

  it('knows a thing he becomes from a thing he carries', () => {
    const state = wearing('mail', 'sword');
    expect(isDressing(state.worn('body')!)).toBe(true);
    expect(isDressing(state.worn('hand')!)).toBe(false);
  });
});
