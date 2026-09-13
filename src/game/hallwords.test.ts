import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  saidOfTheMayor, saidOfTheSaving, saidOfTheTreasury, saidOfTheWatch, saidOfWhatStands,
  whatTheHallSays,
} from './hallwords';
import type { Person } from '../world/people';

/**
 * A building that answers questions.
 *
 * Item 89: *"A building that answers questions is a much better interface than a panel about a
 * building."* The difference is not presentation. A panel is a thing the game shows and has to keep
 * correct; a conversation is a thing you *ask*, so it can say **nobody has told me** — which is the
 * honest answer surprisingly often, and one a panel has no way to give.
 *
 * `whatTheHallKnows` has gathered the four facts since the 13th and nothing ever asked it. The hall
 * building has stood in every large village since before that and nothing in `src/game` read it.
 * Four issues were waiting on a hall that could be talked to.
 */
describe('what a hall says when you ask it', () => {
  const nobody = () => null;
  const somebody = (name: string) => (): Person => ({ name } as Person);

  it('admits an empty chest rather than quoting nought', () => {
    expect(saidOfTheTreasury(0)).toMatch(/empty/i);
    expect(saidOfTheTreasury(412.7)).toContain('412');
  });

  it('says nobody speaks for a village too small to need anybody to', () => {
    expect(saidOfTheMayor('', nobody)).toMatch(/nobody speaks/i);
    expect(saidOfTheMayor('p1', somebody('Ada Vos'))).toContain('Ada Vos');
  });

  it('tells an empty tower from no tower at all, because they mean different things', () => {
    /*
     * No tower is a village that has not bought one. An empty tower is a village that could not
     * pay the wage this morning, which is exactly what running out of money looks like — and a
     * panel with a blank field would read as a bug rather than as the mechanic working.
     */
    const none = saidOfTheWatch('', [], nobody);
    const empty = saidOfTheWatch('', ['watchtower:120'], nobody);
    const manned = saidOfTheWatch('p2', ['watchtower:120'], somebody('Jan Bakker'));
    expect(none).toMatch(/no tower/i);
    expect(empty).toMatch(/empty tonight/i);
    expect(none).not.toBe(empty);
    expect(manned).toContain('Jan Bakker');
  });

  it('says what it is saving for and how far off it is', () => {
    const said = saidOfTheSaving('watchtower', 1000);
    expect(said).toContain('3800');
    expect(said).toMatch(/2800 short/);
    expect(saidOfTheSaving('watchtower', 99999)).toMatch(/has enough/);
  });

  it('says it wants nothing when there is nothing left to want', () => {
    expect(saidOfTheSaving(null, 5000)).toMatch(/nothing/i);
  });

  it('admits that every coin went on wages rather than listing an empty village', () => {
    expect(saidOfWhatStands([])).toMatch(/wages/i);
    expect(saidOfWhatStands(['well:20', 'watchtower:400'])).toContain('well');
  });

  it('answers in the order somebody standing in front of it would ask', () => {
    const said = whatTheHallSays(
      { holds: 900, mayor: 'p1', watch: '', raised: ['well:20'], savingFor: 'storey' },
      somebody('Ada Vos'),
    );
    expect(said).toHaveLength(5);
    for (const line of said) expect(line.length).toBeGreaterThan(20);
  });

  it('is actually asked by somebody standing at the hall', () => {
    // the fault this codebase keeps finding: the building has stood in every large village and
    // nothing in `src/game` has ever read `village.hall`
    expect(readFileSync('src/game/interact/village.ts', 'utf8')).toContain('whatTheHallSays(');
  });
});
