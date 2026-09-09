import { hashString, rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { ROAM, type Stop } from './roaming';

/**
 * Which places a band works out of, and why that is a question about a place rather than a count.
 *
 * The bands used to be dealt: twenty-four of them per world, each taking the next ground off a
 * shuffled deck of every stop there is, villages before landmarks. That works exactly once, in a
 * world you can count — and a country with no edge has no deck to shuffle and no twenty-four to
 * deal. So a place holds a band because of what it is, and a wide country has more of them the way
 * a wide country has more villages.
 *
 * Three rules, and the second and third are both here because the first alone was measurably wrong:
 *
 * - **A place decides for itself**, from a hash of its own name. Nothing wider is consulted.
 * - **Landmarks are held apart.** The deck spread the grounds whether it meant to or not, simply by
 *   shuffling; a hash asked of each place separately does not, and where names happen to fall
 *   together a neighbourhood ended up with nine or ten bands working it inside one five-day
 *   window. Eight is what one person can hold while still having a life, so ten is a region nobody
 *   can defend and a country beyond it that is quieter by exactly those two.
 * - **A village alone in its country keeps its own pack**, because a round only reaches what lies
 *   within a circuit of its home. A village with nothing inside that reach is a village no band can
 *   be sent to, and a village nothing ever happens to is scenery. Crossroads Town in seed 12.
 *
 * What is deliberately *not* here is a guarantee that every village is somebody's home. Forcing
 * that was tried and is what put nine bands over one neighbourhood. Coverage belongs to the round
 * instead — a band prefers the ground near it that nobody holds — which is `bandFor`'s business and
 * is a question about its own neighbourhood rather than about the world.
 */

/** Salts, so the questions asked of one place cannot be the same number. */
const OF_A_BAND = 0x20a3;
/**
 * The ground a band id names, or null for a string that is not one of ours.
 *
 * A band is named after the place it works out of rather than by a number, and that is the whole of
 * this change: a slot is a position in a list of everything there is, and a name is a fact about one
 * place. Two people in different corners of an endless country can agree that the pack at
 * Stonemere is the pack at Stonemere; they could never agree that it was the eleventh.
 */
export function groundOf(id: string): string | null {
  return id.startsWith('band:') ? id.slice('band:'.length) : null;
}

/**
 * Would this place hold a band, asked of the place alone?
 *
 * Its own name and nothing else — no count of what the country already has, no list of what was
 * dealt before it. That is what makes it work in a country with no edge.
 */
function wouldHoldABand(seed: number, stop: Stop): boolean {
  const roll = rand2(derive(seed, SALT.ROAM), hashString(stop.name), 0, OF_A_BAND);
  return roll < (stop.lived ? ROAM.LIVED_IN : ROAM.OUT_THERE);
}

/**
 * And does it keep it, given what stands near it?
 *
 * A village always does: every village is somebody's ground, which is what "nowhere is permanently
 * safe" means and what a test holds this to. A landmark gives way to anything better within a
 * band's own reach — a village first, then a better-named landmark.
 *
 * This is the mutual-choice rule the ferries and the springs already use, and it is here for a
 * measured reason rather than for tidiness. The deck this replaced shuffled the whole world, which
 * spread the grounds whether it meant to or not; a hash asked of each place separately does not,
 * and where three or four names happen to fall together a neighbourhood ends up with ten bands
 * working it inside one five-day window. Eight is what one person can hold while still having a
 * life — `HOLD` — so ten is a region nobody can defend, and the country beyond it is emptier by
 * exactly those two.
 */
export function holdsABand(seed: number, stop: Stop, near: readonly Stop[]): boolean {
  if (!wouldHoldABand(seed, stop)) return alone(seed, stop, near);
  if (stop.lived) return true;
  for (const other of near) {
    if (other === stop || Math.hypot(other.x - stop.x, other.z - stop.z) >= ROAM.APART) continue;
    if (!wouldHoldABand(seed, other)) continue;
    // a village outranks any landmark, and between two landmarks the name settles it
    if (other.lived || other.name < stop.name) return false;
  }
  return true;
}

/**
 * Is this a village nothing else could ever walk to?
 *
 * The last clause of coverage, and the one that cannot be got rid of. A round is drawn from what
 * lies within a band's circuit of its home, so a village with no ground inside that reach is a
 * village no band can be sent to — and a village nothing ever happens to is a village that is
 * scenery. Crossroads Town in seed 12 was exactly that.
 *
 * Still a bounded question: it asks what stands within one circuit of here and nothing wider. A
 * village that is alone in its part of the country keeps its own pack, which is also the truer
 * story — the place with no neighbours is the place with something living in the woods behind it.
 */
function alone(seed: number, stop: Stop, near: readonly Stop[]): boolean {
  if (!stop.lived) return false;
  for (const other of near) {
    if (other.name === stop.name) continue;
    if (Math.hypot(other.x - stop.x, other.z - stop.z) > ROAM.CIRCUIT) continue;
    if (wouldHoldABand(seed, other)) return false;      // somebody near enough could come here
  }
  return true;
}

/**
 * The grounds of a country: every place in it that holds a band, in an order everybody agrees on.
 *
 * By name, because a name is the one thing about a place that is the same however it was found. The
 * order does not decide anything any more — that was the deck's job and the deck is gone — but a
 * roster that came out shuffled would make every list in the game jump about between one visit and
 * the next.
 */
export function groundsOf(seed: number, stops: readonly Stop[]): Stop[] {
  return stops.filter((stop) => holdsABand(seed, stop, stops)).sort((a, b) => (a.name < b.name ? -1 : 1));
}
