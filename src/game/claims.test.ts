import { describe, expect, it } from 'vitest';
import { Claims } from './claims';

/**
 * Something the page did before the world agreed to it.
 *
 * The half of "act now, be put right later" that is the same whatever was done. Three of these were
 * written on one night — a chest, a crop, a seed — with the same twelve lines in each, which is the
 * shape of a rule that wants writing once.
 */
describe('what the page is owed an answer about', () => {
  it('hands back exactly what was given, rather than anything it worked out later', () => {
    // the whole safety of a rollback: a recomputed undo can be computed differently by the time it
    // runs, and then it puts back something other than what was taken
    const claims = new Claims<{ gold: number }>();
    const seq = claims.ask({ gold: 90 });
    expect(claims.answered(seq)).toEqual({ gold: 90 });
  });

  it('answers a claim once, so nothing is put back twice', () => {
    const claims = new Claims<string>();
    const seq = claims.ask('a chest');
    expect(claims.answered(seq)).toBe('a chest');
    expect(claims.answered(seq), 'the second undoing would take back a coin already returned').toBeNull();
  });

  it('says nothing to an answer it never asked for', () => {
    // somebody else's claim, one already settled, or a world saying a thing this page knows nothing
    // about — all the same answer, and none of them an error
    expect(new Claims<string>().answered(7)).toBeNull();
  });

  it('numbers them so two claims in flight cannot be mistaken for each other', () => {
    const claims = new Claims<string>();
    const first = claims.ask('one');
    const second = claims.ask('two');
    expect(second).not.toBe(first);
    expect(claims.answered(second)).toBe('two');
    expect(claims.answered(first), 'the first was settled by the second’s answer').toBe('one');
  });

  it('counts what is still owed, and forgets what is not', () => {
    const claims = new Claims<string>();
    expect(claims.pending).toBe(0);
    const seq = claims.ask('a crop');
    expect(claims.pending).toBe(1);
    claims.answered(seq);
    expect(claims.pending).toBe(0);
  });

  it('keeps what it is owed while the hero walks away, because the answer is still coming', () => {
    // no timeout, deliberately: a hero who leaves the field with an answer in flight still has the
    // crop in his pack, and an answer that never arrives costs one entry in a map
    const claims = new Claims<string>();
    const seq = claims.ask('a seed');
    for (let elsewhere = 0; elsewhere < 100; elsewhere++) claims.ask('another');
    expect(claims.answered(seq)).toBe('a seed');
  });
});
