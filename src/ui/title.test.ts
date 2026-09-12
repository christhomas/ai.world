import { describe, expect, it } from 'vitest';
import { kindOf, type SessionSave, type WorldKind } from '../save/store';
import { SWITCHES, nameOf } from './title';

/**
 * The world type decides the whole terrain: the same seed grows two completely different
 * countries. So it has to be chosen when a world is made and honoured for ever afterwards —
 * reopening one as the other kind would put the ground somewhere else underneath a house, a
 * planted field, and every dungeon and island anchor the manifest is holding.
 *
 * There is one kind of world now, and this is what is left of that: a save that names the other one
 * still opens, as the country that exists.
 */

/** What the title screen does when a slot is taken: the save's own kind, whatever else is asked for. */
function continuing(save: SessionSave): WorldKind {
  return kindOf(save.world);
}

describe('which world a save is in', () => {
  it('is whatever the save says, so the ground never moves under a hero', () => {
    expect(continuing({ seed: 1, world: 'mesh' } as unknown as SessionSave)).toBe('road');
    expect(continuing({ seed: 1, world: 'road' } as SessionSave)).toBe('road');
  });

  it('is the flat one for a save made before the choice existed', () => {
    // every world that already exists was grown by the road tree, whatever anybody picks today
    expect(continuing({ seed: 1 } as SessionSave)).toBe('road');
  });

  it('keeps an endless world endless, which is the whole reason the field exists', () => {
    /*
     * The mistake this prevents cannot be undone afterwards. A world written as an endless one and
     * read back as a road world puts a house, a sown field and every anchor in the manifest
     * somewhere that is now open sea, and there is nothing left in the save that says which of the
     * two it meant. So the kind is written down before the game can even grow one on purpose.
     */
    expect(continuing({ seed: 1, world: 'endless' } as SessionSave)).toBe('endless');
  });
});

describe('choosing a country before you go into it', () => {
  /*
   * The switch machinery on the title screen was kept empty for a year on the argument that a title
   * screen which can offer a choice about a world is a thing this game would want again. These are
   * the two things that have to be true about the choice it now offers.
   */
  it('offers the endless country, and starts nobody in it by accident', () => {
    const endless = SWITCHES.find((sw) => sw.id === 'endless');
    expect(endless, 'the choice is not on the screen').toBeDefined();
    expect(endless!.fallback, 'somebody would get an endless world without asking for one').toBe(false);
  });

  it('says in the slot which country a save is, because the same seed grows two of them', () => {
    // a slot that did not say would be one you could not tell from its neighbour until you were
    // standing in it, and by then the ground under your house is the other world's ground
    expect(nameOf('endless')).not.toBe(nameOf('road'));
    expect(nameOf(undefined), 'a save from before the choice existed').toBe(nameOf('road'));
  });
});
