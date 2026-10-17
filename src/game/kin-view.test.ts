import { describe, expect, it } from 'vitest';
import { Register } from '../world/register';
import { kinRecord, kinView } from './kin-view';
import { layOut, lineageOf, type Kin, type Lineage } from './lineage';

/**
 * The descent as any screen draws it (#575): the page's lineage panel and the phone's kin page both
 * read the headline and each person's record from here, so they say the same thing.
 */
describe('the descent laid out for a screen', () => {
  it('puts everybody on the table where the layout puts them, with the lines between them', () => {
    const register = new Register(1);
    register.settle('Ashford', 8, ['farmer', 'hunter', 'seller']);
    register.advance(120);
    const tree = lineageOf(register, 'Ashford', 120);
    const placed = layOut(tree);
    const view = kinView(tree, placed);

    expect(view.village).toBe('Ashford');
    expect(view.people.map((p) => p.id)).toEqual(placed.map((p) => p.kin.id));
    expect(view.people[0]).toMatchObject({ x: placed[0].x, y: placed[0].y, name: placed[0].kin.name });
    expect(view.people.every((p) => p.record[0] === p.name), 'a record starts with who it is').toBe(true);
    const on = new Set(view.people.map((p) => p.id));
    expect(view.ties.length).toBeGreaterThan(0);
    expect(view.ties.every((t) => on.has(t.child) && on.has(t.parent)), 'a line to nobody on the table').toBe(true);
    expect(view.headline).toMatch(new RegExp(`^Ashford: ${placed.length} of them over ${tree.generations} generations`));
  });

  it('says so when the clerk keeps nobody', () => {
    const empty: Lineage = { village: 'Nowhere', people: [], ties: [], houses: [], generations: 0 };
    expect(kinView(empty, [])).toEqual({ village: 'Nowhere', headline: 'Nobody has kept a record at Nowhere', people: [], ties: [] });
  });

  it('reads one person as the clerk has them: a year is not "1 years", and the dead are dead', () => {
    const one = (over: Partial<Kin>): Kin => ({ id: 'x', name: 'Ada Marsh', trade: 'miller', born: 3, died: null, age: 1,
      purse: 12.4, standing: 'living', mother: 'Bea Marsh', father: '', depth: 1, ...over });
    const ada = one({});
    const tree: Lineage = { village: 'Ashford', people: [ada, one({ id: 'y', name: 'Cal Marsh', mother: 'Ada Marsh' })],
      ties: [], houses: [], generations: 2 };
    expect(kinRecord(tree, ada)).toEqual(['Ada Marsh', 'miller · living', '1 year old', 'born on day 3', 'holds 12 gold',
      'child of Bea Marsh', 'parent of Cal Marsh']);
    expect(kinRecord(tree, one({ trade: '', standing: 'buried', died: 40, age: 70, purse: null, born: null, mother: '' })))
      .toEqual(['Ada Marsh', 'no trade · died on day 40', '70 years old when they died', 'parent of Cal Marsh']);
  });
});
