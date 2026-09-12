import { hashString, mulberry32 } from '../core/rng';
import { RANKS, type Rank } from '../world/rank';
import { ROAM, bandAt, type Band, type Pressing, type Steading } from './roaming';
import { saidOfPress } from './roamwords';

/**
 * What a band does to the village it is standing over.
 *
 * Out of `roaming.ts` because that file answers a different question: where the bands are, where
 * they go next, and which ground each of them holds. This is what one of them *costs* a place — the
 * mood it is in, how hard it is leaning, how many it takes, and what somebody in the street would
 * say about it.
 *
 * The split was forced by size and is right on its own merits. A band's round is a fact about the
 * country, worked out from the seed and the same on every machine for ever; a pressing is a fact
 * about one village on one day, and it is the half that the register, the books and the chat all
 * read.
 */

/**
 * How bad a mood a band is in today, nought to one.
 *
 * Rolled per spell of days rather than per day, and lifted and dropped across the spell rather
 * than held flat, so a band has bad fortnights and quiet ones instead of a steady appetite. A
 * player who arrives during a quiet spell sees a village doing well enough with a wolf pack two
 * fields away, which is exactly the warning they should get.
 */
export function temperOf(band: Band, day: number): number {
  const since = Math.max(0, day + band.offset);
  const rng = mulberry32(band.seed ^ Math.imul(Math.floor(since / ROAM.SPELL), 0x27d4));
  const worst = rng();
  if (worst < ROAM.QUIET) return 0;
  const through = (since % ROAM.SPELL) / ROAM.SPELL;
  return worst * Math.sin(through * Math.PI);
}

/**
 * How hard a band is leaning on a place today, nought to one. Nought for a band that is nowhere
 * near, nought during a quiet spell, and nought for one that has been broken up.
 *
 * @param standing how many of it are still on their feet, out of its whole size
 */
export function pressureOn(
  band: Band, place: Steading, day: number, standing = band.size, rank: Rank = 'hamlet',
): number {
  if (standing <= 0) return 0;
  const now = bandAt(band, day);
  const away = Math.hypot(place.x - now.x, place.z - now.z);
  if (away >= ROAM.PRESS_WITHIN) return 0;
  const close = 1 - away / ROAM.PRESS_WITHIN;
  return ROAM.SORTS[band.kind].menace * (standing / band.size) * temperOf(band, day) * close
    * worthPressing(rank);
}

/**
 * How much harder a band leans on a place worth leaning on.
 *
 * The answer to "what stops a town running away", and a better one than a number in a constants
 * file. A village that has outgrown what is around it is a village worth attacking: there is more
 * in the granary, more in the purses and more standing in the paddock, so an ogre that would have
 * walked past a hamlet comes down out of the hills for a town.
 *
 * The rule this is built to keep is that **a brake the player can see and fight is worth ten brakes
 * in a constants file**. Nothing here caps anything. A town under pressure earns less, buries
 * people and stops building — and it stops when somebody drives the band off, which is a thing a
 * player does with a sword rather than a thing the simulation decides.
 *
 * A third again for a town and two thirds again for a city, which is deliberately modest: it has to
 * be felt over the years a place takes to grow, and it must never be the reason a place *cannot*
 * grow. What it buys is that growth has a cost and the cost arrives as a story.
 */
export function worthPressing(rank: Rank): number {
  const at = RANKS.findIndex((step) => step.id === rank);
  return 1 + Math.max(0, at - 1) * ROAM.WORTH_TAKING;
}

/** What a night in the open near a pressed village is worth multiplying by. */
export function nightsNear(pressure: number): number {
  return 1 + Math.max(0, pressure) * ROAM.NIGHTS_WORSE;
}

/**
 * How many of a village's people a band takes today.
 *
 * Rolled from the band, the village and the day, so it is the same number on every screen and the
 * same number when a client that was offline yesterday works out what it missed. Whoever keeps
 * the register decides who: this only says how many.
 */
export function tollOf(band: Band, place: Steading, day: number, pressure: number): number {
  if (pressure <= 0) return 0;
  const rng = mulberry32(band.seed ^ hashString(place.name) ^ Math.imul(Math.floor(day), 0x1b3f));
  // the fraction is settled by the roll rather than rounded away, so light pressure is an
  // occasional funeral instead of no funeral at all
  return Math.floor(pressure * ROAM.TAKES + rng());
}

/**
 * How many of a village's cattle a dragon takes today.
 *
 * What a dragon is *for*, economically. It flies a round of four stops across a quarter of the
 * country and a village it passes over loses beasts — which is better than a dragon that eats
 * people, because bands already do that and because a herd is a thing this economy can actually
 * feel. The farmers' whole living is the herd: fewer cattle is less meat sold to the next valley,
 * which is less money in the village, which is a hall that stops building.
 *
 * So a village does not merely fear the thing. It gets poorer in a way anybody living there could
 * explain, the Domesday Book shows the herd falling week on week, and killing it is worth doing for
 * a reason that is not a quest marker.
 *
 * Only a dragon, and that is the point rather than a simplification: a wolf pack that could carry
 * off cattle would make the distinction between the sorts of band into a number rather than a
 * difference in kind. Wolves take people, a dragon takes the herd, and you can tell which is
 * overhead by what the village has lost.
 */
export function cattleTaken(band: Band, place: Steading, day: number, pressure: number, herd: number): number {
  if (band.kind !== 'dragon' || pressure <= 0 || herd <= 0) return 0;
  const rng = mulberry32(band.seed ^ hashString(place.name) ^ Math.imul(Math.floor(day), 0x5e17));
  // a share of what is standing in the paddock rather than a flat number, so a dragon over a big
  // herd is a catastrophe and one over four cows is a bad week rather than the end of farming
  const taken = herd * pressure * ROAM.DRAGON_TAKES;
  return Math.min(herd, Math.floor(taken + rng()));
}

/**
 * Everything a band is doing to a village today, or null when it is doing nothing. Handed back
 * rather than applied: burying people is the register's business and this file will not do it.
 */
export function pressingOn(
  band: Band, place: Steading, day: number, standing = band.size, rank: Rank = 'hamlet', herd = 0,
): Pressing | null {
  const pressure = pressureOn(band, place, day, standing, rank);
  if (pressure <= 0) return null;
  return {
    band,
    village: place.name,
    pressure,
    nights: nightsNear(pressure),
    toll: tollOf(band, place, day, pressure),
    cattle: cattleTaken(band, place, day, pressure, herd),
    said: saidOfPress(band, place, pressure),
  };
}
