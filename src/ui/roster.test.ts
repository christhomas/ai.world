import { describe, expect, it } from 'vitest';
import { orderBy } from './roster';
import type { Person } from '../world/people';

/**
 * The order the roster puts people in.
 *
 * The panel itself is DOM and is checked by opening it; what is worth a test is the one piece of
 * judgement in it — that the two columns which are *questions* (who has the most, who has gone
 * longest without) come back with the answer at the top, and the three that are labels read like a
 * list you look somebody up in.
 */

const somebody = (over: Partial<Person>): Person => ({
  id: over.name ?? 'x', name: 'Nobody', village: 'Elsewhere', trade: 'farmer', born: 0, lives: 900,
  mother: '', father: '', knows: [], memories: [], opinions: [], purse: 0, hungry: 0, ...over,
} as Person);

describe('the order of the roster', () => {
  const day = 100;
  const folk = [
    somebody({ name: 'Ada', village: 'Byre', purse: 3, hungry: 0, born: 60 }),
    somebody({ name: 'Bo', village: 'Alder', purse: 40, hungry: 2, born: 10 }),
    somebody({ name: 'Cass', village: 'Alder', purse: 12, hungry: 5, born: 80 }),
  ];
  const namesIn = (by: Parameters<typeof orderBy>[0]) => [...folk].sort(orderBy(by, day)).map((p) => p.name);

  it('puts the richest first when the question is money', () => {
    expect(namesIn('purse')).toEqual(['Bo', 'Cass', 'Ada']);
  });

  it('puts whoever has gone longest without first when the question is hunger', () => {
    expect(namesIn('hunger')).toEqual(['Cass', 'Bo', 'Ada']);
  });

  it('puts the oldest first when the question is age', () => {
    // born earliest is oldest: Bo at day 10 has ninety days on him
    expect(namesIn('age')).toEqual(['Bo', 'Ada', 'Cass']);
  });

  it('reads like a list when it is a list', () => {
    expect(namesIn('name')).toEqual(['Ada', 'Bo', 'Cass']);
    // by village, and by name inside a village, which is how you look somebody up
    expect(namesIn('village')).toEqual(['Bo', 'Cass', 'Ada']);
  });
});
