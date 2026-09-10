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

/**
 * The trades whose living is a thing to watch rather than a line in a ledger.
 *
 * A village of thirty shows seven people at a time and, until now, took whichever seven the
 * register happened to list first — which is birth order, and has nothing to do with what anybody
 * is doing. The one farmer in Crossroads Town was indoors at eight in the morning while four
 * doctors stood on the square, so the field was full of his cattle and empty of him.
 *
 * These three are the ones whose day *goes somewhere and does something*: the farmer out to the
 * field, the hunter into the woods and back to the stall with a deer over his shoulder, the seller
 * behind that stall buying it off him. Between them they are the whole of the economy that is not
 * underground, so one of each is out before anybody else is considered.
 *
 * Deliberately three and not eleven. Everybody has a trade and reserving a place for each of them
 * would fill the street with the trades and leave no room for the children, the old and whoever
 * else makes a village a place rather than a labour exchange — which is the same fault, from the
 * other side, that `howManyAreOut` was written to fix.
 */
const WORK_YOU_CAN_WATCH: readonly string[] = ['farmer', 'hunter', 'seller'];
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
  const first: Person[] = [];
  if (lawWantsSomebody) {
    const constable = here.find((p) => p.trade === 'constable');
    if (constable) first.push(constable);
  }
  for (const trade of WORK_YOU_CAN_WATCH) {
    const worker = here.find((p) => p.trade === trade && !first.includes(p));
    if (worker) first.push(worker);
  }
  const rest = here.filter((p) => !first.includes(p));
  return [...first, ...rest].slice(0, wanted);
}
