import { describe, expect, it } from 'vitest';
import { Register } from '../world/register';
import { residentsOnTheStreet } from './residents';
import type { Post } from './entity';
import type { Village } from '../world/structures';

/**
 * Which seven of a village's thirty people are the seven you meet.
 *
 * It used to be whichever seven the register listed first, which is birth order and has nothing to
 * do with what anybody does. The fault that came of it is the one this whole item is about: a
 * village's field was full of its cattle and empty of the man who keeps them, because the one
 * farmer in a village of thirty-one was indoors at eight in the morning while four doctors stood
 * on the square.
 */

/** As much of a village as the street needs: a name and a number of houses. */
const village = (name: string, houses: number): Village =>
  ({ name, houses: Array.from({ length: houses }, () => ({})) } as unknown as Village);

/** Everywhere an inland village's day can send somebody. One spot; nothing here reads the position. */
const inland = (): Partial<Record<Post, [number, number]>> => {
  const here: [number, number] = [0, 0];
  const posts: Partial<Record<Post, [number, number]>> = {};
  for (const post of ['square', 'market', 'inn', 'shop', 'doctor', 'field', 'woods', 'gate', 'heights'] as Post[]) {
    posts[post] = here;
  }
  return posts;
};

/** A village big enough to hold more people than it ever shows at once. */
const settled = (seed: number, houses = 12) => {
  const register = new Register(seed, 30);
  return { register, place: village('Testing', houses), posts: inland() };
};

describe('who a village has out of doors', () => {
  it('puts the farmer, the hunter and the seller out before anybody else', () => {
    const { register, place, posts } = settled(5);
    const all = register.settle(place.name, 12, ['farmer', 'hunter', 'seller', 'doctor', 'soldier', 'explorer']);
    const out = residentsOnTheStreet(register, place, posts, 7, new Set(), false);

    for (const trade of ['farmer', 'hunter', 'seller']) {
      // only asked of the trades this village actually raised — a place with no hunter cannot
      // put one out and is not wrong for it
      if (!all.some((p) => p.trade === trade)) continue;
      expect(out.some((p) => p.trade === trade), `nobody out to do the ${trade}'s day`).toBe(true);
    }
  });

  it('leaves room for everybody else', () => {
    // a street of nothing but the three working trades is a labour exchange rather than a village
    const { register, place, posts } = settled(5);
    register.settle(place.name, 12, ['farmer', 'hunter', 'seller', 'doctor', 'soldier', 'explorer']);
    const out = residentsOnTheStreet(register, place, posts, 7, new Set(), false);
    expect(out.filter((p) => !['farmer', 'hunter', 'seller'].includes(p.trade)).length).toBeGreaterThan(0);
  });

  it('still turns the constable out first when the law wants somebody', () => {
    const { register, place, posts } = settled(5);
    const all = register.settle(place.name, 12, ['farmer', 'hunter', 'seller', 'constable', 'soldier']);
    if (!all.some((p) => p.trade === 'constable')) return;      // this seed raised none
    const out = residentsOnTheStreet(register, place, posts, 7, new Set(), true);
    expect(out[0].trade, 'a police force that is usually indoors is not a police force').toBe('constable');
  });

  it('never puts out somebody who is already standing somewhere', () => {
    const { register, place, posts } = settled(5);
    const all = register.settle(place.name, 12, ['farmer', 'hunter', 'seller', 'doctor']);
    const farmer = all.find((p) => p.trade === 'farmer');
    if (!farmer) return;
    const out = residentsOnTheStreet(register, place, posts, 7, new Set([farmer.id]), false);
    expect(out.some((p) => p.id === farmer.id), 'a man was shown in two places at once').toBe(false);
  });

  it('shows no more than were asked for', () => {
    const { register, place, posts } = settled(5);
    register.settle(place.name, 12, ['farmer', 'hunter', 'seller', 'doctor', 'soldier']);
    expect(residentsOnTheStreet(register, place, posts, 3, new Set(), false).length).toBe(3);
  });
});
