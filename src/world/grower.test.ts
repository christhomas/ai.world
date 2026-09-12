import { describe, expect, it } from 'vitest';
import { Grower } from './grower';
import { PATCH, Patchwork, patchOf } from './patchwork';
import type { CountryRequest } from './countrymessages';
import type { TerrainSampler } from './terrain';
import type { Within } from './window';

/**
 * Asking somebody else to grow the country.
 *
 * A patch is five seconds of work and a tenth of a second to rebuild from its parts — the two
 * numbers that make an endless world possible at all — so the page asks a worker and never blocks.
 * What is worth pinning is the asking, because every way this goes wrong is a way of asking badly:
 * the same square asked for twice, a square asked for that is already in hand, three squares in
 * flight so the one you are walking into waits behind two you are not, or a reply that arrives and
 * is dropped.
 *
 * No `Worker` here. The sending is handed in, which is the only reason any of this is testable —
 * and the same seam lets a world server, which has no workers at all, use the same object.
 */

const SEED = 4242;
/** A sampler-shaped nothing: this file is about bookkeeping, not about ground. */
const nothing = (patch: string) => ({ patch } as unknown as TerrainSampler);

function harness(keeps = 9) {
  const sent: CountryRequest[] = [];
  const patches = new Patchwork(SEED, (_s: number, within: Within) => nothing(String(within.x0)), keeps);
  const grower = new Grower(SEED, patches, (msg) => sent.push(msg), (_seed, _within, parts) =>
    nothing(String((parts as unknown as { of?: string }).of ?? '')));
  return { sent, patches, grower };
}

/** A reply for whatever was asked last, as the worker would send it. */
const reply = (patch: string, took = 5000) =>
  ({ type: 'grown' as const, patch, parts: { of: patch } as never, took });

describe('asking for a square of country', () => {
  it('asks once, however many times it is wanted', () => {
    // called every frame with the same answer for minutes at a time, which is the normal case
    const { sent, grower } = harness();
    grower.want('0,0');
    grower.want('0,0');
    grower.want('0,0');
    expect(sent.length).toBe(1);
  });

  it('does not ask for a square that is already in hand', () => {
    const { sent, patches, grower } = harness();
    patches.patch('0,0');                        // grown here, the slow way
    grower.want('0,0');
    expect(sent, 'it asked for country it was already standing on').toEqual([]);
  });

  it('keeps one in flight, so the square you are walking into is not behind two you are not', () => {
    /*
     * Three workers growing three patches finish none of them sooner — the work is processor-bound
     * and the cores are already drawing the game. What three would do is hold three patches of
     * country in memory and make the one that matters wait.
     */
    const { sent, grower } = harness();
    grower.want('0,0');
    grower.want('1,0');
    grower.want('2,0');
    expect(sent.length).toBe(1);
    expect(grower.waiting).toEqual(['0,0', '1,0', '2,0']);
  });

  it('sends the next one as soon as the last comes back', () => {
    const { sent, grower } = harness();
    grower.want('0,0');
    grower.want('1,0');
    grower.took(reply('0,0'));
    expect(sent.map((m) => m.patch)).toEqual(['0,0', '1,0']);
    expect(grower.waiting).toEqual(['1,0']);
  });
});

describe('a square coming back', () => {
  it('is put with the rest, and is then in hand', () => {
    const { patches, grower } = harness();
    grower.want('0,0');
    expect(patches.has('0,0')).toBe(false);
    grower.took(reply('0,0'));
    expect(patches.has('0,0'), 'it arrived and was dropped on the floor').toBe(true);
  });

  it('says how long it took, because that is the number this whole arrangement exists for', () => {
    // a number nobody can see is a number that quietly stops being true
    const { grower } = harness();
    grower.want('0,0');
    grower.took(reply('0,0', 4820));
    expect(grower.lastTook).toBe(4820);
    expect(grower.grown).toBe(1);
  });

  it('does not replace a square somebody is already standing on', () => {
    /*
     * The race worth thinking about: the hero outwalks the worker, the main thread grows the square
     * itself so there is ground under him, and the worker's copy turns up a second later. Swapping
     * it would change the sampler under somebody's feet to an identical one, for nothing.
     */
    const { patches, grower } = harness();
    grower.want('0,0');
    const standing = patches.patch('0,0');
    grower.took(reply('0,0'));
    expect(patches.patch('0,0'), 'the ground was swapped under him').toBe(standing);
  });
});

describe('what the hero is standing on', () => {
  it('is grown here rather than waited for, which is why the worker can be late', () => {
    // the worker is an optimisation and never a guarantee: a hole in the world is not an option
    const { patches, grower } = harness();
    grower.want(patchOf(PATCH + 5, 5));
    const here = patches.patch(patchOf(PATCH + 5, 5));
    expect(here, 'there was no ground under him').toBeDefined();
  });
});
