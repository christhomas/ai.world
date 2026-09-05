import type { Village } from '../world/structures';
import type { Register } from '../world/register';
import { stageOf, type Person } from '../world/people';
import { tradesFor } from './trades';
import type { Post } from './entity';

/**
 * Which of a village's residents are out on the street right now.
 *
 * A village holds far more people than are ever drawn at once, so this takes the grown ones who
 * are not already standing somewhere else. Babies stay indoors, which is why nobody ever meets
 * one; they turn up as children a week later.
 *
 * Split out of the entity manager because it is a question about the register rather than about
 * entities: given a village, a day and a list of who is already outdoors, the answer is fixed.
 */
export function residentsOnTheStreet(
  register: Register,
  village: Village,
  posts: Partial<Record<Post, [number, number]>>,
  wanted: number,
  alreadyOut: ReadonlySet<string | undefined>,
  lawWantsSomebody: boolean,
): Person[] {
  const trades = tradesFor(posts).map((t) => t.id);
  const here = register.settle(village.name, village.houses.length, trades)
    .filter((p) => !alreadyOut.has(p.id) && stageOf(p, register.today) !== 'baby');

  // a village shows only a handful of its people at once, so who those are matters. When the law
  // wants somebody, the constable is one of them: a police force that is statistically unlikely
  // to be outdoors is not a police force.
  if (lawWantsSomebody) {
    return [...here].sort((a, b) => Number(b.trade === 'constable') - Number(a.trade === 'constable')).slice(0, wanted);
  }
  return here.slice(0, wanted);
}
