import { AWAY, purseOf, type Holder } from '../world/deeds';
import { TRADERS } from '../world/prosperity';
import type { Register } from '../world/register';
import type { Person } from '../world/people';

/**
 * Whose purse the hero's money lands in.
 *
 * `deeds.ts` says what paying *is*; this says who is on the other end of it when the payer is the
 * player. It is the piece that has never existed: the hero has bought horses, ferry crossings,
 * beds, bath houses, houses and hired swords for the whole life of the game by subtracting from
 * `state.inventory.gold`, at fifteen separate sites, and every coin of it left the world. The
 * villagers stopped burning money the night the four livelihoods went in. The player never had.
 *
 * That mattered more than tidiness. A village's whole economy is now other people's money moving
 * — what dinner cost going to whoever grew it, what a keep cost going to whoever sold it — and a
 * player walking through spending hundreds of gold was the one actor in the world whose spending
 * reached nobody. Buying every horse in a county left the county exactly as poor as it started.
 *
 * Two shapes of payee, and the difference is real rather than a convenience:
 *
 * - **A person.** The builder who is putting your house up, the man you hired, the stablehand who
 *   sold you the horse. Named, on the register, and it is *their* purse that gets fatter.
 * - **A village.** A bath house fee, a ferry run by nobody in particular, a market with no seller
 *   standing at it. Nobody in particular is paid, so everybody is, poorest first — because money
 *   arriving in a village should reach the people who have least, and a village where every coin
 *   from outside lands on the innkeeper is a village with one rich man in it.
 *
 * And where the honest answer is that the money leaves — `deeds.AWAY` — this hands that back
 * rather than inventing a recipient. An eagle does not keep a purse.
 */

/** The working adults of a village, poorest first. Children keep no purse and are not paid. */
function earners(register: Register | null, village: string): Person[] {
  return [...(register?.living(village) ?? [])]
    .filter((p) => p.trade)
    .sort((a, b) => a.purse - b.purse);
}

/**
 * A village's money, taken as one pot.
 *
 * Reading it is the sum of every purse in the place, which is the same number `worth` in the
 * economy bench reads and the same one `luxuryFor` is priced against — a village is rich when its
 * people are, and there is no treasury anywhere in this world.
 *
 * Paying in goes poorest first, a whole coin at a time round the room until it is gone, so a
 * hundred gold spent at a bath house is a hundred gold spread across the village rather than a
 * hundred gold on one attendant. Taking out goes richest first, for the same reason in reverse:
 * a village asked for money finds it where there is some.
 */
export function villageTill(register: Register | null, village: string): Holder {
  return {
    get has() { return earners(register, village).reduce((sum, p) => sum + p.purse, 0); },
    take: (much) => {
      let left = Math.max(0, much);
      let took = 0;
      for (const person of earners(register, village).reverse()) {
        if (left <= 0) break;
        const from = purseOf(person).take(left);
        took += from;
        left -= from;
      }
      return took;
    },
    give: (much) => {
      const here = earners(register, village);
      if (here.length === 0 || much <= 0) return;
      // round the room, poorest first, rather than a share each: a share each of seven gold among
      // twenty people is a third of a coin apiece and reads as nothing happening
      let left = much;
      for (let n = 0; left > 0; n++) {
        const person = here[n % here.length];
        const each = Math.min(left, Math.max(1, Math.floor(much / here.length)));
        purseOf(person).give(each);
        left -= each;
      }
    },
  };
}

/**
 * One named person's purse, wherever they are on the register.
 *
 * The right payee whenever the game already knows who it is talking to — which is most of the
 * interesting cases, because the builder, the hired man and the stablehand are all people you are
 * standing in front of. Somebody who has since died or moved on falls back to their village.
 */
export function personTill(register: Register | null, id: string, village = ''): Holder {
  const person = id ? register?.find(id) : undefined;
  if (person) return purseOf(person);
  return village ? villageTill(register, village) : AWAY;
}

/**
 * Whoever in this village would be behind the counter for this: the named trade, or the traders,
 * or the village at large.
 *
 * For the cases where the game knows what *sort* of person it is dealing with but not which one —
 * a stall with nobody modelled at it, a landlord who is a line of dialogue rather than a register
 * entry. The fallback chain is deliberate and ends at the village rather than at nothing: a
 * village that cannot name a shopkeeper still has people in it, and the money should reach them.
 */
export function tradeTill(register: Register | null, village: string, trade?: string): Holder {
  const here = register?.living(village) ?? [];
  const named = trade ? here.find((p) => p.trade === trade) : undefined;
  const anyTrader = here.find((p) => TRADERS.includes(p.trade));
  const who = named ?? anyTrader;
  return who ? purseOf(who) : villageTill(register, village);
}

/**
 * The village nearest a spot, for money paid to somebody who is a voice rather than a person.
 *
 * A boatwright on a pier, an attendant at a door, a stallholder with nobody modelled behind the
 * stall: the game has plenty of people who exist for one line of dialogue and are on no register
 * anywhere. Their takings still have to land somewhere, and the honest somewhere is the nearest
 * village — a pier is built by the place it serves and the man selling boats off it lives there.
 *
 * Past `within` there is genuinely nobody: a pier on an empty island, a shrine on a moor. That
 * money leaves the world, and `AWAY` is how this says so out loud.
 */
export function nearestVillageTill(
  register: Register | null,
  villages: ReadonlyArray<{ name: string; x: number; z: number }>,
  x: number, z: number, within = 160,
): Holder {
  let best = '';
  let away = within;
  for (const village of villages) {
    const d = Math.hypot(village.x - x, village.z - z);
    if (d < away) { away = d; best = village.name; }
  }
  return best ? villageTill(register, best) : AWAY;
}
