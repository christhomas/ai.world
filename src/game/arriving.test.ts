import { describe, expect, it } from 'vitest';
import { ASK_AGAIN_AFTER, walkingIn, walksIn } from './arriving';

/** A clock the test winds by hand, so nothing here waits five seconds to find out. */
const clock = () => { const at = { ms: 0 }; return { at, now: () => at.ms }; };

describe('walking into a village', () => {
  it('asks the world once for a village the hero is not on the roll of', () => {
    const asked: string[] = [];
    const { now } = clock();
    const watch = walkingIn(() => false, (v) => asked.push(v), now);

    for (let i = 0; i < 100; i++) watch('Ashford');

    expect(asked).toEqual(['Ashford']);
  });

  it('asks again later, because a village the world has not settled refuses', () => {
    const asked: string[] = [];
    const { at, now } = clock();
    const watch = walkingIn(() => false, (v) => asked.push(v), now);

    watch('Ashford');
    at.ms = ASK_AGAIN_AFTER - 1;
    watch('Ashford');
    at.ms = ASK_AGAIN_AFTER;
    watch('Ashford');

    expect(asked).toEqual(['Ashford', 'Ashford']);
  });

  it('stops asking once the roll answers, which is the only sign it worked', () => {
    const asked: string[] = [];
    const { at, now } = clock();
    let on = false;
    const watch = walkingIn(() => on, (v) => { asked.push(v); on = true; }, now);

    watch('Ashford');
    for (let i = 1; i <= 10; i++) { at.ms = i * ASK_AGAIN_AFTER; watch('Ashford'); }

    expect(asked).toEqual(['Ashford']);
  });

  it('asks for every village he walks into, not only the first', () => {
    const asked: string[] = [];
    const { now } = clock();
    const watch = walkingIn(() => false, (v) => asked.push(v), now);

    watch('Ashford');
    watch('Hawkstead');
    watch('Ashford');

    expect(asked).toEqual(['Ashford', 'Hawkstead']);
  });

  it('says nothing about nowhere', () => {
    const asked: string[] = [];
    walkingIn(() => false, (v) => asked.push(v))('');
    expect(asked).toEqual([]);
  });

  it('reads the roll for the hero by his own name', () => {
    const asked: string[] = [];
    const book = { living: (v: string) => (v === 'Ashford' ? [{ name: 'Rowan' }] : []) };
    const watch = walksIn(book, { name: 'Rowan', arrive: (v) => asked.push(v) });

    watch('Ashford');        // he is already on this one
    watch('Hawkstead');      // and not on this one

    expect(asked).toEqual(['Hawkstead']);
  });
});
