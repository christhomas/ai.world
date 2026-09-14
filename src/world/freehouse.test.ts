import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isFree, saidOfAFreeHouse, whatABedCosts } from './homes';

/**
 * What a free house is for.
 *
 * The ownership rule landed with **64**: a village's houses come out of the seed in a fixed order,
 * its households off the register in founding order, first to first — so two people who have never
 * spoken walk into the same cottage and are told the same family lives there, because the
 * arithmetic says so. What is left over is a **free house**: nobody's, standing, with a roof.
 *
 * Until now that was only a name. "An empty house in Ashford" told you whose it wasn't and offered
 * nothing. A village that shrank should differ from one that did not by more than a caption.
 *
 * The rule is the same for the hero and for a villager, which is what keeps it from being a player
 * convenience bolted onto a simulation.
 */
describe('a house nobody lives in', () => {
  it('is free exactly when no family is on it', () => {
    expect(isFree('')).toBe(true);
    expect(isFree('Vos')).toBe(false);
  });

  it('costs nothing, where an inn costs what an inn costs', () => {
    expect(whatABedCosts('')).toBe(0);
    expect(whatABedCosts('Vos')).toBeNull();     // not yours to sleep in, at any price
  });

  it('says it is empty from the doorway, so nobody has to try every door', () => {
    const said = saidOfAFreeHouse('Ashford');
    expect(said).toContain('Ashford');
    expect(said.length).toBeGreaterThan(30);
  });

  it('says something different about a house with people in it', () => {
    expect(saidOfAFreeHouse('Ashford')).not.toBe(saidOfAFreeHouse('Stonedale'));
  });
});

/**
 * And the seam, because a rule nothing asks is a caption with tests.
 */
describe('and somebody who actually offers the bed', () => {
  const body = (file: string): string => readFileSync(file, 'utf8');

  it('is offered where the hero is standing, since there is nobody to talk to', () => {
    expect(body('src/game/interact/village.ts')).toContain('whatABedCosts(');
    expect(body('src/game/interact/index.ts'), 'the indoors chain never reaches it')
      .toContain('village.tryFreeBed(');
  });

  it('asks the register whose house it is, rather than keeping a second copy', () => {
    // `places.ts` works the family out to name the room and has no other use for it; a copy on the
    // room would be a second record of one fact, which is how they come to disagree
    expect(body('src/game/interact/village.ts')).toContain('familyOfDoor(structures.villages');
  });
});
