import { describe, expect, it } from 'vitest';
import { Register } from '../world/register';
import { generateWebGraph } from '../world/roadweb';
import { TerrainSampler } from '../world/terrain';
import { GroundWorld } from '../world/groundworld';
import { EntityManager } from './manager';
import { Roster } from './roster';
import { propFootprints } from './props';
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

/**
 * A child is a child, and not a small hunter.
 *
 * Found by the Domesday Book within a minute of it first rendering: a nine-year-old with no trade on
 * the register, out hunting. A body in a street is given a rolled trade so that a stranger has a day
 * to follow, and a child kept it — the line that was meant to overwrite it read
 * `if (resident.trade !== '')`, which looks like care and is the opposite of it.
 *
 * Asked of a real street rather than of the register, because the register was never wrong: it said
 * the child had no trade and the street ignored it.
 */
describe('a villager standing in a street', () => {
  it('is following their own trade and nobody else\'s', () => {
    /*
     * The invariant, stated without needing a child to be standing anywhere.
     *
     * A body is given a rolled trade when it is stood up, so that a stranger in a street has a day
     * to follow at all. Whoever the register names then overwrites it — and the line that did that
     * read `if (resident.trade !== '')`, which looks like care and is the opposite of it: a child
     * has no trade, so nothing overwrote the roll and the child kept somebody else's day. The
     * Domesday Book found it as a nine-year-old out hunting.
     *
     * Asked of every villager rather than of the children, because "the street says what the
     * register says" is the whole rule and a child is only the case where it was visibly broken.
     */
    const sampler = new TerrainSampler(generateWebGraph(3));
    const ground = new GroundWorld(sampler, propFootprints());
    const register = new Register(3, 30);
    let checked = 0;

    for (const where of sampler.structures.villages.slice(0, 4)) {
      ground.reach(where.x, where.z, 3);
      const manager = new EntityManager(
        new Roster(), ground, ground, 3, sampler.structures.villages, undefined, undefined, register,
      );
      for (let n = 0; n < 20; n++) manager.update(0.05, where.x, where.z, false, () => {}, 0.5);

      for (const e of manager.within(where.x, where.z, 60)) {
        const who = e.person === '' ? undefined : register.find(e.person);
        if (!who) continue;
        // the two roles a village hands out itself, which are jobs a building has rather than
        // trades anybody is born to
        if (e.role === 'elder' || e.role === 'stablehand') continue;
        checked++;
        expect(e.trade, `${who.name} is on the register as "${who.trade}" and is out being a ${e.trade}`)
          .toBe(who.trade);
      }
    }
    expect(checked, 'nobody was standing in any street at all').toBeGreaterThan(0);
  });
});
