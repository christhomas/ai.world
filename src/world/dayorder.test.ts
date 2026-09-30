import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { THE_HALL_OWNER } from './holdings';
import { POST } from './postings';
import type { CartLoaded } from './carrierbook';

/**
 * The order of a village's morning, which has to be one order however the morning is reached.
 *
 * A day has three things in it that move a hall's money: the day's own living, the posts it stands,
 * and the told facts dated to it — a vote carried, a cart loaded. Since #434 a hall-owned yard is
 * paid from the treasury, and whether it can afford a crew at all is a fifth of the treasury
 * against `POST.BUILDER`. So a morning on which a cart takes the hall below sixty gold hires a crew
 * if the posts are stood before the cart and nobody if they are stood after it.
 *
 * `settle` (a village founded late, or re-lived) and `advance` (a page that was there) used to run
 * those steps in different orders — posts before the told facts in one, after them in the other —
 * and the advice about who is already spoken for (`whoIsSpokenFor`, #360) read the purse at a third
 * moment again. #485.
 */
const TRADES = ['farmer', 'seller', 'builder', 'hunter', 'woodcutter'];
const VILLAGES = ['Ashford', 'Brook'];

/**
 * Seed 12, day 87: found by scanning seeds 1–200 for a morning on which a yard that has fallen to
 * the hall (its builder died on the 86th) is stood by a hall-paid crew in a journaled register of
 * two villages, whichever order the morning is lived in — the first such morning is the 86th with
 * the posts after the day's living and the 87th with them before it. The hall is rich that
 * morning, so the cart below is made to fit it: it takes the hall to thirty gold short of its
 * evening, which is under the sixty a crew needs whichever side of the posts it lands on, and
 * never more than the hall has, whichever side of the posts it lands on.
 */
const SEED = 12;
const ON = 87;

const grown = (register: Register): Register => {
  for (const village of VILLAGES) register.settle(village, 6, TRADES);
  return register;
};

/** Every crew the hall paid for on one morning, from the book both ways of living write. */
const hallCrews = (register: Register, day: number) => (register.madeOf('Ashford').holdings ?? [])
  .filter((holding) => holding.kind === 'yard')
  .flatMap((holding) => register.holdingsBook.on(holding.id))
  .filter((fact) => fact.day === day && fact.funder === THE_HALL_OWNER);

describe('a hall near the price of a crew, on a morning a cart takes its money', () => {
  it('stands the same crews whether the morning was lived through or caught up', () => {
    // what the morning looks like with no cart, to size one that crosses the line
    const probe = grown(new Register(SEED, ON, undefined, 'journaled'));
    expect(hallCrews(probe, ON).length, 'no hall-paid crew stood on this morning').toBeGreaterThan(0);
    const evening = probe.hallOf('Ashford')!.purse;
    const price = Math.round((evening - 30) * 100) / 100;
    expect(price, 'the hall is too poor on this morning for a cart to matter').toBeGreaterThan(0);
    expect(evening - price, 'the cart leaves the hall able to afford a crew anyway')
      .toBeLessThan(POST.BUILDER / POST.LAYS_OUT);
    const seller = probe.living('Brook')[0].id;
    const cart: CartLoaded = {
      kind: 'cart-loaded', day: ON, from: 'Brook', to: 'Ashford', meals: 1, price,
      paying: [[THE_HALL_OWNER, -price]], paid: [[seller, price]],
    };

    // caught up: the cart is known before the village is founded, and replayed on its morning
    const relived = new Register(SEED, ON, undefined, 'journaled');
    expect(relived.recordCarrier(cart), 'the cart was refused').toBe(true);
    grown(relived);

    // watched: lived a day at a time, and told of the cart the evening before its morning — a page
    // that is a day behind the world, which is the ordinary case for a joining client
    const watched = grown(new Register(SEED, 1, undefined, 'journaled'));
    for (let day = 2; day < ON; day++) watched.advance(day);
    expect(watched.recordCarrier(cart), 'the cart was refused').toBe(true);
    watched.advance(ON);

    // the precondition: the cart was actually paid for on both, or this compares two quiet mornings
    for (const register of [relived, watched]) {
      expect(register.hallOf('Ashford')!.purse, 'the cart never took the hall\'s money')
        .toBeLessThan(POST.BUILDER / POST.LAYS_OUT);
    }
    expect(hallCrews(watched, ON)).toEqual(hallCrews(relived, ON));
    expect(watched.hallOf('Ashford')).toEqual(relived.hallOf('Ashford'));
    const purses = (register: Register) => register.living('Ashford').map((person) => [person.id, person.purse]);
    expect(purses(watched)).toEqual(purses(relived));
  });
});

/**
 * And the advice, which has to be about the morning the posts are stood on.
 *
 * `tidings.ts` asks `whoIsSpokenFor(day)` and then lives the day, so a builder the advice left free
 * can be offered a day of the hall's work. If the advice reads the treasury before the day's own
 * living and the posts read it after, a hall that crossed sixty gold overnight is a builder offered
 * hall work and then posted on a hall yard the same morning, or neither.
 */
describe('who a village has already spoken for, against who then stands', () => {
  it('names exactly the posts that are then stood, every morning', () => {
    const register = grown(new Register(SEED, 1, undefined, 'journaled'));
    let hallMornings = 0, posted = 0;
    const wrong: string[] = [];
    for (let day = 2; day <= ON + 20; day++) {
      const said = register.whoIsSpokenFor(day);
      register.advance(day);
      const stood = register.postsStanding();
      for (const village of VILLAGES) {
        const one = JSON.stringify(said.get(village) ?? []), two = JSON.stringify(stood.get(village) ?? []);
        if (one !== two) wrong.push(`day ${day} ${village}: advised ${one}, stood ${two}`);
        posted += (stood.get(village) ?? []).length;
      }
      if ((stood.get('Ashford') ?? []).some((post) => post.funder === THE_HALL_OWNER)) hallMornings++;
      // and asked again once the morning is lived, which is `tidings.ts` on a day with no catch-up
      const again = register.whoIsSpokenFor(day);
      for (const village of VILLAGES) {
        const one = JSON.stringify(again.get(village) ?? []), two = JSON.stringify(stood.get(village) ?? []);
        if (one !== two) wrong.push(`day ${day} ${village}, asked after it was lived: advised ${one}, stood ${two}`);
      }
    }
    expect(posted, 'nobody stood anything in a hundred days').toBeGreaterThan(0);
    expect(hallMornings, 'the hall never paid for a post, so its purse was never read').toBeGreaterThan(0);
    expect(wrong.slice(0, 5)).toEqual([]);
  });
});
