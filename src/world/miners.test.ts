import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { foundVillage } from './people';

/**
 * Mining is where every coin in the world is minted, and it was very nearly not happening.
 *
 * The trade is only offered to villages with high ground behind them, but villages are put where
 * people would live rather than where the rock is. Measured across seed 1: seventeen villages,
 * eight with a claimed mine, and four miners in the entire world. A faucet that feeds four people
 * is not a faucet.
 */
describe('who actually goes down the mine', () => {
  const TRADES = ['seller', 'farmer', 'hunter', 'soldier', 'constable', 'innkeeper'];
  const villages = ['Ashford', 'Mossreach', 'Fernreach', 'Hawkholm', 'Willowstead', 'Saltmoor'];

  const minersIn = (register: Register, village: string) =>
    register.settle(village, 6, TRADES).filter((p) => p.trade === 'miner').length;

  it('is nobody, when the village was never told it has a mine', () => {
    const register = new Register(1);
    // the trade is not even on offer: this is the state every non-mining village is in
    for (const village of villages) expect(minersIn(register, village)).toBe(0);
  });

  it('is somebody, in every single village that works one', () => {
    const register = new Register(1);
    register.minesAt(villages);
    for (const village of villages) {
      expect(minersIn(register, village), `${village} has a mine and nobody down it`).toBeGreaterThan(0);
    }
  });

  it('changes nothing else about the village it does it to', () => {
    // putting `miner` into the weighted list instead reshuffles every draw, so mining villages came
    // out with systematically fewer of everything else — Ashford lost its only farmer that way, and
    // Fernreach ended up with five miners out of twelve adults. One adult changes job; nobody else.
    for (const village of villages) {
      const plain = new Register(1).settle(village, 6, TRADES);
      const mining = new Register(1);
      mining.minesAt(villages);
      const withMine = mining.settle(village, 6, TRADES);
      const count = (people: readonly { trade: string }[], trade: string) =>
        people.filter((p) => p.trade === trade).length;
      for (const trade of TRADES.filter((t) => t !== 'farmer')) {
        expect(Math.abs(count(withMine, trade) - count(plain, trade)), `${village} lost ${trade}s`)
          .toBeLessThanOrEqual(1);
      }
      // and the farmers are untouched, because a village survives nobody mining for a week and
      // does not survive nobody putting dinner on the table
      expect(count(withMine, 'farmer'), `${village} lost a farmer to the mine`).toBe(count(plain, 'farmer'));
    }
  });

  it('sends exactly one person down, not half the village', () => {
    const register = new Register(1);
    register.minesAt(villages);
    for (const village of villages) {
      expect(minersIn(register, village), `${village} is a mine with a village attached`).toBe(1);
    }
  });

  it('says the same thing twice, so two players agree about who is a miner', () => {
    const one = new Register(1); one.minesAt(villages);
    const two = new Register(1); two.minesAt(villages);
    const trades = (r: Register) => r.settle('Ashford', 6, TRADES).map((p) => `${p.name}:${p.trade}`);
    expect(trades(one)).toEqual(trades(two));
  });

  it('leaves a village alone when it already raised one of its own', () => {
    // nothing is overwritten just because the village was asked for a trade it already had
    const withTrade = foundVillage(1, 'Ashford', 6, [...TRADES, 'miner'], ['miner']);
    expect(withTrade.filter((p) => p.trade === 'miner').length).toBeGreaterThan(0);
  });
});
