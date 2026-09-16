import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kindOf, type SessionSave, type WorldKind } from '../save/store';
import { SWITCHES } from './switches';
import { nameOf } from './title';

/**
 * The world kind decides the whole terrain: the same seed grows two completely different countries.
 * So it has to be chosen when a world is made and honoured for ever afterwards — reopening one as
 * the other kind would put the ground somewhere else underneath a house, a planted field, and every
 * dungeon and island anchor the manifest is holding.
 *
 * There are two kinds again. What is left of #228 here is a migration rather than a collapse: the
 * weeks when nothing wrote the field are weeks of endless worlds, and they have to keep opening as
 * endless ones.
 */

/** What the title screen does when a slot is taken: the save's own kind, whatever else is asked for. */
function continuing(save: SessionSave): WorldKind {
  return kindOf(save.world);
}

describe('which world a save is in', () => {
  it('opens a road save as the road world it was written in', () => {
    expect(continuing({ seed: 1, world: 'road' } as SessionSave)).toBe('road');
  });

  it('opens a polygon save as a road world, that generator being test-owned still', () => {
    expect(continuing({ seed: 1, world: 'mesh' } as unknown as SessionSave)).toBe('road');
  });

  it('opens a save with nothing written on it as endless', () => {
    /*
     * The migration #228 made necessary. Between it and the seam going back in there was one
     * country and nothing wrote the field at all, so every save from those weeks is an endless
     * world with nothing on it that says so. Reading them as road worlds would move the ground out
     * from under everything in them. Saves older than that said `road` in as many words and are
     * covered above.
     */
    expect(continuing({ seed: 1 } as SessionSave)).toBe('endless');
  });

  it('keeps an endless world endless, which is the whole reason the field exists', () => {
    /*
     * The mistake this prevents cannot be undone afterwards. A world written as an endless one and
     * read back as a road world puts a house, a sown field and every anchor in the manifest
     * somewhere that is now open sea, and there is nothing left in the save that says which of the
     * two it meant.
     */
    expect(continuing({ seed: 1, world: 'endless' } as SessionSave)).toBe('endless');
  });
});

describe('choosing a country before you go into it', () => {
  it('offers the choice, because there are two countries again', () => {
    /*
     * The inverse of the guard that stood here. #228 asserted there was no control for a world
     * kind, which was correct while there was one country to choose from, and became a guard
     * against putting the choice back the moment there were two.
     *
     * It lives in `switches.ts` beside the render path rather than in `title.ts` beside the slots,
     * for the reason that file gives: what is remembered between visits is a different subject from
     * what is drawn.
     */
    const country = SWITCHES.find((one) => one.id === 'endless');
    expect(country, 'no way to ask for the other country').toBeDefined();
    expect(country!.fallback, 'a new world is still endless').toBe(true);
    expect(readFileSync('src/ui/title.ts', 'utf8'), 'the switch has to decide the world, not merely exist')
      .toContain('chosenWorld');
  });

  it('reads the switch only for a new world, never for one that exists', () => {
    /*
     * The half of this that could lose somebody's town. A continued world takes its kind from its
     * own save and must not be able to take it from a switch — somebody who turns the switch off
     * and presses Continue has to get the world they saved, not the same seed grown the other way
     * with their house in open sea.
     */
    const source = readFileSync('src/ui/title.ts', 'utf8');
    const continueLine = source.split('\n').find((line) => line.includes("act === 'continue'") || line.includes('save: saves[i]'));
    expect(continueLine, 'the continue path should exist').toBeDefined();
    expect(source).toMatch(/save: saves\[i\][^\n]*world: kindOf\(saves\[i\]!\.world\)/);
  });

  it('names a save as the country it is actually in', () => {
    expect(nameOf('endless')).toBe('endless country');
    expect(nameOf('road')).toBe('open country');
    // nothing written on it means endless, for the reason `kindOf` gives
    expect(nameOf(undefined)).toBe('endless country');
  });
});
