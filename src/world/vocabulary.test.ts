import { describe, expect, it } from 'vitest';
import { CREATURE_VERBS } from '../entities/verbs';
import { DEEDS, HOLDINGS, spoken } from './vocabulary';

/**
 * The vocabulary held to itself.
 *
 * The point of naming every deed in one place is that the list can be checked, and a list nobody
 * checks drifts within a fortnight — which is exactly what happened to `TRADERS` in
 * `prosperity.ts`, a set naming four jobs nobody in this world can hold, paying a higher wage to
 * one person per village for a very long time before anybody noticed.
 *
 * So: both directions. A deed that exists and is not named here is a word nobody can find. A name
 * here with nothing behind it is a promise the vocabulary does not keep.
 */

describe('the list of deeds', () => {
  const words = new Set(spoken());

  it('names nothing that does not exist', () => {
    const missing = DEEDS.filter((d) => !words.has(d.deed)).map((d) => d.deed);
    expect(missing, 'named in DEEDS and exported by nothing').toEqual([]);
  });

  it('names every place a deed can act on', () => {
    const missing = HOLDINGS.filter((h) => !words.has(h.maker)).map((h) => h.maker);
    expect(missing, 'named in HOLDINGS and exported by nothing').toEqual([]);
  });

  it('leaves no deed unnamed', () => {
    /*
     * Everything the module exports that is a deed rather than a shape it acts on, a type, or the
     * list itself. Spelt as an exclusion rather than an inclusion on purpose: a new export is
     * caught by default and has to be deliberately accounted for, which is the only way a
     * catalogue check ever holds.
     */
    const notADeed = new Set([
      ...HOLDINGS.map((h) => h.maker), 'DEEDS', 'HOLDINGS', 'spoken',
    ]);
    const unnamed = [...words].filter((w) => !notADeed.has(w) && !DEEDS.some((d) => d.deed === w));
    expect(unnamed, 'exported as a deed and named in no list').toEqual([]);
  });

  it('says what each of them is for', () => {
    for (const { deed, does } of DEEDS) {
      expect(does.length, `${deed} is named and not explained`).toBeGreaterThan(20);
    }
    for (const { maker, is } of HOLDINGS) {
      expect(is.length, `${maker} is named and not explained`).toBeGreaterThan(20);
    }
  });
});

/**
 * And the half of the world that was already speaking, still speaking.
 *
 * The creature verbs are the older of the two vocabularies and the one a behaviour tree is written
 * in, so a tree naming `sell` has to go on getting `sell` whatever is done underneath it. This is
 * the check that the split of `verbs.ts` into `verbs.ts` and `living.ts` — done the night the trade
 * verbs outgrew their corner of it — is invisible from `behaviours/`, where it matters.
 */
describe('the verbs a behaviour tree is written in', () => {
  it('still answers to every name the trades use', () => {
    for (const verb of ['stalkQuarry', 'take', 'sell', 'spend', 'dig', 'tendStock']) {
      expect(typeof CREATURE_VERBS.actions[verb], `a tree naming ${verb} would find nothing`)
        .toBe('function');
    }
  });

  it('still answers to the ones that have nothing to do with a trade', () => {
    for (const verb of ['wander', 'goTo', 'flee', 'idle', 'bite', 'arrest', 'beHealed']) {
      expect(typeof CREATURE_VERBS.actions[verb]).toBe('function');
    }
  });
});
