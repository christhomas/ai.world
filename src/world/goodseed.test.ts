import { describe, expect, it } from 'vitest';
import {
  TRIES, WORTH, aWorldWorthOpening, aWorldWorthOpeningAsync, seedsReadOffThread, whatIsWrongWith,
  worthPlaying,
} from './goodseed';
import type { CountryReply, CountryRequest } from './countrymessages';
import type { PatchParts } from './endless';
import type { Reading } from './seedscore';

/**
 * Drawing a world somebody would want to play — #323.
 *
 * Two halves, tested apart on purpose. **What the bars catch** is arithmetic over a reading and can
 * be held exactly. **How many times to draw** is a loop with a stopping rule, and the stopping rule
 * is the part with a real decision in it — so `draw` and `read` are handed in and the world is
 * never grown here at all.
 *
 * What is deliberately *not* tested is whether the numbers in `WORTH` are the right numbers. They
 * came out of a measured distribution and they are a judgement; a test asserting them would only
 * assert that somebody had typed them, and would have to be edited every time they are tuned.
 * What is held instead is that each bar catches the thing it names and lets everything else past.
 */

/**
 * A seed that clears the bar comfortably, which each case below then spoils in one way.
 *
 * The other four numbers are set to ordinary middling values off the measured run rather than to
 * anything the bar reads, because nothing reads them — which is the point of the run and is what
 * these tests are here to keep true.
 */
const good = (over: Partial<Reading> = {}): Reading => ({
  seed: 1,
  land: 0.8,
  whole: 1,
  villages: WORTH.VILLAGES + 3,
  spread: 428,
  home: 241,
  ...over,
});

describe('what makes a world not worth handing out', () => {
  it('is nothing at all, for a world that clears the bar', () => {
    expect(whatIsWrongWith(good())).toBeNull();
    expect(worthPlaying(good())).toBe(true);
  });

  /*
   * The floor the measurement actually found: a patch with nobody in it at all turned up in two
   * hundred seeds, and `home` reported that world as having no village to walk to. It is the plain
   * in the issue's own first sentence.
   */
  it('catches a plain with nobody on it', () => {
    expect(whatIsWrongWith(good({ villages: 0 }))).toBe('nobody lives here');
  });

  /*
   * And the same fault one step up. `spread` — the distance between the two furthest-apart villages
   * — is nought at the bottom of the measured range, which is exactly what a world with fewer than
   * two villages measures. Somewhere to be and nowhere to go.
   */
  it('catches a world whose only village is the one you are standing in', () => {
    expect(whatIsWrongWith(good({ villages: 1, spread: 0 }))).toBe('nowhere to walk to');
  });

  it('lets a world with somewhere to walk to past', () => {
    expect(whatIsWrongWith(good({ villages: 2 }))).toBeNull();
  });

  /**
   * The bars that are deliberately not here, held so that nobody quietly adds one.
   *
   * Two hundred seeds produced no bad tail in `land` or `whole` — the thinnest world is still
   * fifty-one per cent dry and the most broken-up still has seventy-two per cent of its land in one
   * piece. A bar on either would look like protection and never once fire. `home` has no cliff
   * either, only a long slope from 31 to 570, so a cut there would be somebody deciding how far a
   * player should have to walk rather than a measurement.
   *
   * These are the worst values the run actually produced. If a future bar is meant to catch them it
   * will have to be argued for against the run, which is the whole point.
   */
  it('passes the thinnest, most broken and loneliest worlds the measured run produced', () => {
    expect(worthPlaying(good({ land: 0.515 })), 'the thinnest world in two hundred').toBe(true);
    expect(worthPlaying(good({ whole: 0.717 })), 'the most broken-up land in two hundred').toBe(true);
    expect(worthPlaying(good({ home: 570 })), 'the longest walk to a first village').toBe(true);
  });
});

describe('drawing until one is worth opening', () => {
  /** A draw that hands out the seeds given, in order, and then repeats the last for ever. */
  const handing = (...seeds: number[]) => {
    let at = 0;
    return () => seeds[Math.min(at++, seeds.length - 1)];
  };
  /** A reading that is good for the seeds named and bad for every other. */
  const goodFor = (...seeds: number[]) => (seed: number): Reading =>
    (seeds.includes(seed) ? good({ seed }) : good({ seed, villages: 0 }));

  it('takes the first one when the first one is worth opening', () => {
    expect(aWorldWorthOpening(handing(11, 22), goodFor(11, 22)))
      .toEqual({ seed: 11, drawn: 1, worth: true });
  });

  it('draws again past a bad one, and says how many it took', () => {
    expect(aWorldWorthOpening(handing(11, 22, 33), goodFor(33)))
      .toEqual({ seed: 33, drawn: 3, worth: true });
  });

  /*
   * The floor, and the reason it is the *first* rather than the best. "The best of them" needs a
   * ranking, a ranking needs weights, and weights are the score this whole file exists not to have.
   * A player who draws nothing but bad worlds gets the world they would have got before any of this
   * existed — this can make the game better and it must never make it worse.
   */
  it('settles for the first it drew when every try was bad, rather than for nothing', () => {
    const settled = aWorldWorthOpening(handing(11, 22, 33), goodFor(), 3);
    expect(settled).toEqual({ seed: 11, drawn: 3, worth: false });
  });

  it('never hands back nothing, whatever it is asked for', () => {
    expect(aWorldWorthOpening(handing(7), goodFor(), 0).seed).toBe(7);
    expect(aWorldWorthOpening(handing(7), goodFor(), -1).seed).toBe(7);
  });

  it('reads no more worlds than it drew, because growing a patch is the cost here', () => {
    const read: number[] = [];
    aWorldWorthOpening(handing(1, 2, 3, 4), (seed) => { read.push(seed); return good({ seed, villages: 0 }); }, 4);
    expect(read).toEqual([1, 2, 3, 4]);
  });

  it('stops at the first good one rather than measuring the rest', () => {
    const read: number[] = [];
    aWorldWorthOpening(handing(1, 2, 3, 4), (seed) => { read.push(seed); return good({ seed }); }, 4);
    expect(read).toEqual([1]);
  });

  /*
   * Four. Under one world in twenty is rejected, so a second draw is already unusual and a fifth is
   * a thing nobody will meet — and every draw past the first costs a whole patch grown and thrown
   * away, which is the real price of this feature.
   */
  it('draws few enough times that a rejection stays cheap', () => {
    expect(TRIES).toBeGreaterThanOrEqual(2);
    expect(TRIES).toBeLessThanOrEqual(8);
  });
});

/**
 * The two decisions, held to one answer.
 *
 * `aWorldWorthOpeningAsync` exists because measuring a seed grows a patch and the title screen
 * cannot do that on the thread it draws on — see #358. It is a twin rather than a shared function,
 * deliberately: the sync one is what the tools and the rest of these tests use and has no reason to
 * become a promise. What must not drift is the *rule*, so this runs both over the same readings.
 *
 * If these ever disagree, one of the two has had the settling rule changed without the other.
 */
describe('the same decision, whether the reading comes back now or later', () => {
  const handing = (...seeds: number[]) => {
    let at = 0;
    return () => seeds[Math.min(at++, seeds.length - 1)];
  };
  const goodFor = (...seeds: number[]) => (seed: number): Reading =>
    (seeds.includes(seed) ? good({ seed }) : good({ seed, villages: 0 }));

  const cases: Array<{ what: string; seeds: number[]; good: number[]; tries?: number }> = [
    { what: 'the first is worth opening', seeds: [11, 22], good: [11, 22] },
    { what: 'the third is the first worth opening', seeds: [11, 22, 33], good: [33] },
    { what: 'none is worth opening and the tries run out', seeds: [11, 22, 33], good: [], tries: 3 },
    { what: 'there is only one try', seeds: [7], good: [], tries: 1 },
    { what: 'there are no tries at all', seeds: [7], good: [], tries: 0 },
  ];

  for (const one of cases) {
    it(`agrees when ${one.what}`, async () => {
      const now = aWorldWorthOpening(handing(...one.seeds), goodFor(...one.good), one.tries);
      const later = await aWorldWorthOpeningAsync(
        handing(...one.seeds), async (seed) => goodFor(...one.good)(seed), one.tries,
      );
      expect(later).toEqual(now);
    });
  }

  it('asks for one seed at a time and waits for each answer', async () => {
    /*
     * The thing the worker arrangement needs and the sync one gets for free. A decision that asked
     * for all four at once would need a queue on the other side and would grow patches nobody was
     * going to use, which is the cost this whole change is about.
     */
    let inFlight = 0, most = 0;
    await aWorldWorthOpeningAsync(handing(11, 22, 33, 44), async (seed) => {
      most = Math.max(most, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return good({ seed, villages: 0 });
    });
    expect(most, 'never more than one measurement at a time').toBe(1);
  });
});

/**
 * And what becomes of the patches that were grown to measure with — #358's second half.
 *
 * Measuring a seed grows its home patch and then threw it away, and the game grew the very same
 * square again the moment the world opened. So the reader keeps one: the patch of the seed it was
 * last asked about, which is the seed the decision settles on when it settles on anything.
 *
 * The rule has two halves and both are worth holding. **Only one is kept** — up to `TRIES` patches
 * are grown and three of them are worlds nobody is going to walk into, so each arriving patch
 * releases the one before it. **And it is kept by seed**, because the one case where the settled
 * seed is not the last measured is the case where the tries ran out and the *first* is taken: a
 * reader that handed over whatever it happened to be holding would open that world on another
 * world's ground.
 */
describe('the patch a seed was measured by', () => {
  /** The parts of a grown patch, as the one thing a test can tell apart: one object per seed. */
  const parts = new Map<number, PatchParts>();
  const partsFor = (seed: number): PatchParts => {
    if (!parts.has(seed)) parts.set(seed, { seed } as unknown as PatchParts);
    return parts.get(seed)!;
  };

  /**
   * The country worker, as much of it as reading a seed uses: it answers a measurement at once,
   * with the patch it grew to make it.
   */
  const workerWhere = (worth: (seed: number) => boolean) => {
    const grew: number[] = [];
    const hears: Array<(e: MessageEvent<CountryReply>) => void> = [];
    let shut = false;
    return {
      grew,
      get shut() { return shut; },
      postMessage(msg: CountryRequest): void {
        if (msg.type !== 'measure') return;
        grew.push(msg.seed);
        const reading = good({ seed: msg.seed, villages: worth(msg.seed) ? WORTH.VILLAGES : 0 });
        const reply: CountryReply = {
          type: 'measured', seed: msg.seed, reading, patch: '0,0', parts: partsFor(msg.seed), took: 1,
        };
        for (const hear of [...hears]) hear({ data: reply } as MessageEvent<CountryReply>);
      },
      addEventListener(_type: 'message', hear: (e: MessageEvent<CountryReply>) => void): void {
        hears.push(hear);
      },
      removeEventListener(_type: 'message', hear: (e: MessageEvent<CountryReply>) => void): void {
        hears.splice(hears.indexOf(hear), 1);
      },
      terminate(): void { shut = true; },
    };
  };
  const handing = (...seeds: number[]) => {
    let at = 0;
    return () => seeds[Math.min(at++, seeds.length - 1)];
  };

  it('is the patch of the seed the drawing settled on', async () => {
    const worker = workerWhere((seed) => seed === 33);
    const reader = seedsReadOffThread(worker);
    const drawn = await aWorldWorthOpeningAsync(handing(11, 22, 33), reader.read);
    expect(worker.grew, 'it measured a seed it did not need to').toEqual([11, 22, 33]);
    expect(drawn.seed).toBe(33);
    expect(reader.grownFor(33)).toEqual({ seed: 33, patch: '0,0', parts: partsFor(33) });
  });

  it('is let go of the moment a rejected seed is done with', async () => {
    const worker = workerWhere((seed) => seed === 33);
    const reader = seedsReadOffThread(worker);
    await aWorldWorthOpeningAsync(handing(11, 22, 33), reader.read);
    expect(reader.grownFor(11), 'a rejected world was still being held').toBeUndefined();
    expect(reader.grownFor(22), 'a rejected world was still being held').toBeUndefined();
  });

  /*
   * The case that makes this keyed by seed rather than "the last one". When nothing drawn is worth
   * opening the *first* seed is taken, and the patch grown for it went three measurements ago. A
   * reader that handed over the one it was holding would hand over the fourth world's ground for
   * the first world's seed, which is the worst outcome available here: not a slow world, a wrong
   * one.
   */
  it('is nothing at all when the tries ran out and the first seed was settled for', async () => {
    const worker = workerWhere(() => false);
    const reader = seedsReadOffThread(worker);
    const drawn = await aWorldWorthOpeningAsync(handing(11, 22, 33, 44), reader.read);
    expect(drawn, 'the settling rule changed').toEqual({ seed: 11, drawn: TRIES, worth: false });
    expect(reader.grownFor(drawn.seed), 'another world\'s patch was offered for this seed')
      .toBeUndefined();
  });

  it('closes the worker it opened, because a title screen draws more than one world', () => {
    const worker = workerWhere(() => true);
    seedsReadOffThread(worker).close();
    expect(worker.shut).toBe(true);
  });
});
