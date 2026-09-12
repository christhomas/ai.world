import { describe, expect, it } from 'vitest';
import { shortOf } from './vacancies';

/**
 * What a mayor is for, before there is a mayor.
 *
 * A trade is inherited, and inheritance on its own is drift: every funeral is a chance to lose a
 * trade and no funeral is ever a chance to gain one back. `chore sanity` measured where that ends —
 * villages that could support ten trades holding two, no farmer in the fields, no seller at the
 * market, and every purse balancing to the coin the whole way down. So somebody looks at the place
 * and says what it needs, and this is that question.
 */

/** Three commonest trades, weight three apiece in `TRADES`. */
const STAPLE = ['farmer', 'hunter', 'seller'];

describe('what a village is short of', () => {
  it('names the trade nobody is doing', () => {
    expect(shortOf(STAPLE, ['farmer', 'hunter'])).toBe('seller');
  });

  it('says nothing at all about a village that is fairly staffed', () => {
    expect(shortOf(STAPLE, ['farmer', 'hunter', 'seller'])).toBeNull();
  });

  it('fills the emptiest job first when several are missing', () => {
    // a village of nine with nobody farming wants a farmer more than it wants a second hunter
    const held = ['hunter', 'hunter', 'seller', 'seller', 'seller'];
    expect(shortOf(STAPLE, held)).toBe('farmer');
  });

  it('weighs a trade by how common it should be, not by the order it is written in', () => {
    /*
     * `TRADES` says a seller is three parts and a doctor one, so a village of a dozen that is
     * missing both wants the seller first. Without that, the mayor would fill whichever job
     * happened to be first in the list and a village would be all doctors.
     */
    const trades = ['seller', 'doctor'];
    expect(shortOf(trades, ['doctor'])).toBe('seller');
  });

  it('leaves the rare trades to families once the common ones are covered', () => {
    /*
     * The line that keeps this from swallowing inheritance whole. In a village of nine working
     * people a weight-one trade comes to under half a person, so it is not a vacancy — a doctor is
     * somebody's daughter following her mother, or one villager in ten striking out.
     */
    const trades = ['farmer', 'hunter', 'seller', 'climber'];
    const held = ['farmer', 'hunter', 'seller'];
    expect(shortOf(trades, held)).toBeNull();
  });

  it('counts the person about to start work, so a village of children still raises a farmer', () => {
    expect(shortOf(STAPLE, [])).toBe('farmer');
  });

  it('says nothing about a place that supports no trades at all', () => {
    expect(shortOf([], ['farmer'])).toBeNull();
  });

  it('treats a trade it has never heard of as an ordinary one rather than crashing', () => {
    // village trades are strings on the register and a save from an older world may name anything
    expect(shortOf(['astronaut', 'farmer'], ['farmer', 'farmer'])).toBe('astronaut');
  });
});
