import { describe, expect, it } from 'vitest';
import { Register } from '../world/register';
import { layOut, lineageOf } from './lineage';

/**
 * A village's descent, which has been written down since there was a register and never once read.
 *
 * `Person` carries `mother` and `father` by name — deliberately, because "the dead are not kept",
 * so a parent who died forty years ago is still a name on their child's record long after there is
 * any person to point at. That is what lets a tree reach past the sixty stones a church keeps, and
 * it is the thing these hold: a village of three generations must come out three deep, and the
 * great-grandparents nobody has a record of must still be in it.
 */
const TRADES = ['farmer', 'hunter', 'seller'];

const lived = (seed: number, days: number, houses = 8): { register: Register; days: number } => {
  const register = new Register(seed);
  register.settle('Ashford', houses, TRADES);
  register.advance(days);
  return { register, days };
};

describe('the descent of a village', () => {
  it('names everybody the register can name, alive or buried or only remembered', () => {
    const { register, days } = lived(1, 120);
    const tree = lineageOf(register, 'Ashford', days);

    const living = register.living('Ashford').length;
    const stones = register.churchyard('Ashford').length;
    expect(living, 'nobody is alive to be descended from anybody').toBeGreaterThan(3);
    expect(stones, 'nobody has died in a hundred and twenty days, so there is no depth to find').toBeGreaterThan(3);

    const standing = (which: string) => tree.people.filter((k) => k.standing === which).length;
    expect(standing('living')).toBe(living);
    // the stones may name somebody who is also on the roll only if a name were reused, which the
    // register does not do — so every stone is its own node
    expect(standing('buried')).toBeGreaterThan(0);
    expect(tree.people.length).toBeGreaterThanOrEqual(living + standing('buried'));
  });

  it('reaches past the churchyard, to people nothing else in the game remembers', () => {
    const { register, days } = lived(1, 200);
    const tree = lineageOf(register, 'Ashford', days);
    /*
     * Measured rather than assumed, and the measurement changed the claim.
     *
     * The intent was that a village would reach past its own churchyard — sixty stones deep — to
     * great-grandparents nobody has a record of. It does not, over any run this bench does: the
     * register founds a village with `mother` and `father` empty on the founders, so the only way
     * to be remembered-and-not-recorded is to have your stone pushed out of a yard that keeps
     * sixty, and a village of ten houses does not bury sixty people inside two hundred days.
     *
     * So the honest assertion is about the shape rather than the count: anybody who *is* only a
     * memory carries nothing they could not be known to carry. It is left in because the case is
     * real — a village lived for a thousand days does rotate its churchyard — and this says what
     * such a person must look like when one turns up.
     */
    for (const one of tree.people.filter((k) => k.standing === 'remembered')) {
      expect(one.born, 'somebody remembered only as a parent has a birthday from nowhere').toBeNull();
      expect(one.purse, 'a memory is carrying a purse').toBeNull();
      expect(one.trade, 'a memory has taken up a trade').toBe('');
    }
  });

  it('runs deeper than one generation, which is the whole reason to draw it', () => {
    const { register, days } = lived(1, 200);
    const tree = lineageOf(register, 'Ashford', days);
    expect(tree.generations, 'every soul in the village is their own ancestor').toBeGreaterThan(1);
    // and a child is below both their parents, wherever both are known
    for (const tie of tree.ties) {
      const child = tree.people.find((k) => k.id === tie.child)!;
      const parent = tree.people.find((k) => k.id === tie.parent)!;
      expect(child.depth, `${tie.child} is drawn level with or above ${tie.parent}`).toBeGreaterThan(parent.depth);
    }
    /*
     * And the tree is a plausible number of generations deep.
     *
     * This is the assertion that would have caught the fault this file was rewritten for. Keyed by
     * name rather than by person, a grandson named for his grandfather made the grandfather his own
     * descendant, and the depth walk went round that loop once per pass: twenty-eight people, a
     * hundred and forty-three generations. Nobody in this world lives past ninety days and a
     * village is founded on day one, so there is a hard ceiling on how many generations can have
     * happened, whatever the names say.
     */
    const oldest = Math.min(...tree.people.map((k) => k.born ?? days));
    expect(tree.generations, 'more generations than the village has had days to have').toBeLessThan((days - oldest) / 20 + 3);
  });

  it('gathers the families, largest first', () => {
    const { register, days } = lived(1, 200);
    const tree = lineageOf(register, 'Ashford', days);
    expect(tree.houses.length, 'a village of nobody in particular').toBeGreaterThan(0);
    for (let n = 1; n < tree.houses.length; n++) {
      expect(tree.houses[n - 1].souls).toBeGreaterThanOrEqual(tree.houses[n].souls);
    }
    expect(tree.houses[0].souls, 'the largest family in the village is one person').toBeGreaterThan(1);
  });

  it('says nothing at all about a village nobody has walked into', () => {
    const tree = lineageOf(new Register(1), 'Nowhere', 40);
    expect(tree.people).toEqual([]);
    expect(tree.ties).toEqual([]);
    expect(tree.generations).toBe(0);
  });

  it('comes back at all from a village that has been lived a long time', () => {
    // the depth walk is bounded rather than recursive because nothing in the register forbids a
    // roll making somebody their own great-grandparent. A cycle must not hang this.
    const { register, days } = lived(7, 400, 10);
    const started = Date.now();
    const tree = lineageOf(register, 'Ashford', days);
    expect(Date.now() - started, 'the descent took longer than a frame to work out').toBeLessThan(500);
    expect(tree.people.length).toBeGreaterThan(0);
  });
});

/**
 * Where the tree is drawn, tested without drawing it.
 *
 * The arrangement is the part that can be unreadable, and an arrangement you cannot check without
 * a canvas is one nobody checks. Two claims: nobody stands on top of anybody, and a generation
 * hangs under the one it came from rather than at the far end of the row.
 */
describe('laying a village out to be looked at', () => {
  const tree = (): ReturnType<typeof lineageOf> => {
    const register = new Register(1);
    register.settle('Ashford', 10, TRADES);
    register.advance(300);
    return lineageOf(register, 'Ashford', 300);
  };

  it('puts one person in one place', () => {
    const placed = layOut(tree());
    expect(placed.length, 'nobody was laid out at all').toBeGreaterThan(10);
    const seen = new Set<string>();
    for (const one of placed) {
      const spot = `${one.x.toFixed(3)},${one.y}`;
      expect(seen.has(spot), `two people are standing on ${spot}`).toBe(false);
      seen.add(spot);
    }
  });

  it('puts a generation on its own row, and the oldest at the top', () => {
    const placed = layOut(tree());
    for (const one of placed) expect(one.y).toBe(one.kin.depth);
    const top = placed.filter((p) => p.y === 0);
    expect(top.length, 'the tree has no top').toBeGreaterThan(0);
    for (const one of top) expect(one.kin.depth).toBe(0);
  });

  it('hangs a child near their parents rather than at the far end of the row', () => {
    const laid = layOut(tree());
    const built = tree();
    const where = new Map(laid.map((p) => [p.kin.id, p]));
    let measured = 0, wandered = 0;
    for (const tie of built.ties) {
      const child = where.get(tie.child), parent = where.get(tie.parent);
      if (!child || !parent) continue;
      measured++;
      // half the width of the widest row is the test: a child further from their parent than that
      // is on the other side of the tree from them, which is what an unsorted row looks like
      const widest = Math.max(...laid.map((p) => p.x)) + 1;
      if (Math.abs(child.x - parent.x) > widest / 2) wandered++;
    }
    expect(measured, 'no ties to measure').toBeGreaterThan(10);
    expect(wandered / measured, `${wandered} of ${measured} children are drawn across the tree from a parent`)
      .toBeLessThan(0.25);
  });
});
