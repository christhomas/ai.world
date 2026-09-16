import { describe, expect, it } from 'vitest';
import { WANTS, whoWantsSomething, wouldBringItTo, type Want } from './wants';
import type { Person } from './people';

/**
 * Why a villager would ever walk over to you, which is the half this game has never had.
 *
 * Every interaction in the game begins with the player walking up to somebody. The pieces for the
 * reverse were all here: `behaviours/villagers.json` already has a branch that drops its mark and
 * walks at the hero — *"which is what following is"* — so the tree language can target him; and
 * `memory.ts` keys an `Opinion` by name, so a villager could always have held a view of anybody
 * named. The only reason none held one of the hero is that he had no row, which #260 fixed.
 *
 * So what was missing was never the machinery. It was a **reason**.
 *
 * ## The reason is the interesting part
 *
 * The hero is the one who comes back from the dead. A villager is raised once, rarely, at the
 * village's own expense, and returns a blank stranger with no parents; the hero is raised over and
 * over, bills himself, and keeps everything he knows. That is a fact about the books — `shrine.ts`
 * and `reckoning.ts` — rather than a story bolted beside them.
 *
 * Which is why villagers ask *him* for the things nobody else can be asked. Not because he is the
 * player, but because he is the one who will still be there next season and can be sent somewhere
 * nobody comes back from. A quest system that follows from the economy rather than sitting next to
 * it.
 *
 * ## What decides it
 *
 * Nothing rolled on the village's own stream. A want is read off what a person already is — their
 * trade, what they have lost, what they think of him — so two machines agree about who walks over
 * without a word passing between them, and a village re-lived from its seed has the same people
 * asking the same things.
 */

let next = 0;
const soul = (over: Partial<Person> = {}): Person => {
  next++;
  return {
    id: `p${next}`, name: `Person ${next}`, village: 'Ashford', sex: 'woman', trade: 'farmer',
    born: -30, lives: 70, mother: '', father: '', knows: [], memories: [], opinions: [],
    purse: 20, hungry: 0, ...over,
  };
};

const hero = (over: Partial<Person> = {}): Person =>
  soul({ name: 'Rowan', deathless: true, trade: '', ...over });

describe('who has something to ask', () => {
  it('has a list of wants at all, each with something to say', () => {
    expect(WANTS.length).toBeGreaterThan(0);
    for (const want of WANTS) {
      expect(want.id, 'a want with no id').not.toBe('');
      expect(want.asks.length, `${want.id} asks for nothing`).toBeGreaterThan(10);
      expect(want.because.length, `${want.id} gives no reason`).toBeGreaterThan(20);
    }
  });

  it('gives the same person the same want twice, because nothing here is rolled', () => {
    const villager = soul({ trade: 'doctor' });
    const once = whoWantsSomething([villager], 40);
    const twice = whoWantsSomething([villager], 40);
    expect(once.map((w) => w.want.id)).toEqual(twice.map((w) => w.want.id));
  });

  it('does not give the hero a want, because he is the one being asked', () => {
    expect(whoWantsSomething([hero()], 40).map((w) => w.who.name)).not.toContain('Rowan');
  });

  it('does not give a child a want, who has no trade and nothing to ask for', () => {
    const child = soul({ trade: '', born: 38 });
    expect(whoWantsSomething([child], 40)).toEqual([]);
  });

  it('changes what is wanted as the days pass, so a village is not frozen', () => {
    /*
     * A real village rather than three people. Somebody has something to ask about one morning in
     * forty, so a hamlet of three is silent almost every day and four samples of silence say
     * nothing about whether the thing moves — which is what the first version of this test
     * measured.
     */
    const trades = ['doctor', 'builder', 'miner', 'farmer', 'hunter', 'apothecary'];
    const villagers = Array.from({ length: 24 }, (_, n) => soul({ trade: trades[n % trades.length] }));
    const asked = new Set<string>();
    for (let day = 20; day < 400; day++) {
      for (const one of whoWantsSomething(villagers, day)) asked.add(`${one.who.name}:${one.want.id}`);
    }
    expect(asked.size, 'nobody in a village of twenty-four ever asked for anything').toBeGreaterThan(1);
  });

  it('asks rarely, because an errand nobody else can run is worth nothing if it is daily', () => {
    const villagers = Array.from({ length: 24 }, () => soul({ trade: 'farmer' }));
    let mornings = 0;
    for (let day = 20; day < 120; day++) if (whoWantsSomething(villagers, day).length > 0) mornings++;
    expect(mornings, 'somebody stops you every morning, which is a village of shopkeepers')
      .toBeLessThan(60);
  });
});

describe('whether they would bring it to you', () => {
  const want: Want = WANTS[0];

  it('will not, from somebody who thinks badly of you', () => {
    const sour = soul({ opinions: [{ who: 'Rowan', regard: -0.8, times: 4, at: 1 }] as never });
    expect(wouldBringItTo(sour, 'Rowan', want)).toBe(false);
  });

  it('will, from somebody who has no view of you either way', () => {
    // a stranger asking a stranger is the ordinary case: you are the one who comes back, and that
    // is known about you before anybody has an opinion of you
    expect(wouldBringItTo(soul(), 'Rowan', want)).toBe(true);
  });

  it('will, from somebody who thinks well of you', () => {
    const warm = soul({ opinions: [{ who: 'Rowan', regard: 0.7, times: 3, at: 1 }] as never });
    expect(wouldBringItTo(warm, 'Rowan', want)).toBe(true);
  });

  it('will not, if he is not somebody they could be asking', () => {
    expect(wouldBringItTo(soul(), '', want)).toBe(false);
  });
});
