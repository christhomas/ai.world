import { describe, expect, it } from 'vitest';
import { whichShopsToTry } from './probes';

/**
 * Which shop a probe walks into, and whether it can be pointed at one.
 *
 * Found by walking the hunting loop in a browser (issue #2, filed as 106): `__enterShop('store')`
 * took the first village in the world that had one, every time, so a walk that needed *this*
 * village's shop could not be written. The fur premium bug the same walk uncovered was a price that
 * differs by country — snow quoted 15g and desert 23g — and the probe could only ever stand in one
 * of them.
 *
 * A tool that can only reach one example is a tool that cannot test the thing the example varies.
 *
 * This used to read `probes.ts` as source and match the shape of the door with a regular
 * expression, because standing a probe up needs a browser, a scene and a grown world. It went red
 * the day the parameter was renamed, which is the trouble with checking the spelling of a claim:
 * it fails for reasons that are not the claim, and it passes for reasons that are not either — the
 * probe could have taken a village name and ignored it. The choosing is a rule of its own now, and
 * the rule is what is asked. The walking is `chore playtest`'s, which is where a real one belongs.
 */
describe('reaching a shop from a test harness', () => {
  const villages = [
    { name: 'Crossroads Town', x: 0, z: 0 },
    { name: 'Snowhold', x: 200, z: 0 },
    { name: 'Dunecamp', x: -50, z: 40 },
  ];

  it('can be told which village, rather than always taking the first', () => {
    expect(whichShopsToTry(villages, { x: 0, z: 0 }, 'dune').map((v) => v.name)).toEqual(['Dunecamp']);
  });

  it('matches a name the way somebody typing it would', () => {
    expect(whichShopsToTry(villages, { x: 0, z: 0 }, 'SNOW').map((v) => v.name)).toEqual(['Snowhold']);
  });

  it('takes the nearest when nobody says which, rather than the first in the world', () => {
    // the whole of 106: every other probe answers about where the hero is, and this one did not
    expect(whichShopsToTry(villages, { x: 190, z: 10 }, undefined).map((v) => v.name))
      .toEqual(['Snowhold', 'Crossroads Town', 'Dunecamp']);
  });

  it('still offers all of them, so a hero by a village with no such counter finds another', () => {
    expect(whichShopsToTry(villages, { x: 0, z: 0 }, undefined)).toHaveLength(3);
  });

  it('finds nowhere when the name matches nowhere, rather than quietly the nearest', () => {
    // a probe that silently walks somewhere else is worse than one that says it could not find the
    // place: the reading it takes is of the wrong village, and it looks like a reading
    expect(whichShopsToTry(villages, { x: 0, z: 0 }, 'atlantis')).toEqual([]);
  });
});
