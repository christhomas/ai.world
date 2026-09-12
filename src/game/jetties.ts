import { BUILDS, isFinished, type Commission } from './building';

/**
 * Every jetty in this world: the ones the country was grown with, and the ones somebody paid for.
 *
 * A small module for one seam, and the seam is the whole of what item 23 needed. `structures.piers`
 * is grown from the seed — it is where the ferries run and where the boatwright stands — and a
 * jetty a player commissions cannot be in it, because the country was laid out before anybody had
 * any gold. Everything that asks "is there a jetty near here" has to ask about both, or the first
 * one somebody pays for is a row of boards that nothing in the game can see.
 *
 * ## Why a mooring rather than a `Pier`
 *
 * It would have been easy to fake a whole `Pier` and push it into the list, and it would have been
 * wrong. A `Pier` carries an island and a side, and `ferry.ts` pairs them up by those: a synthetic
 * one would either be ignored — in which case the fields were a lie — or would put a ferry on a
 * route with one end. What every caller of this actually wants is narrower and is all a jetty is
 * to a boat: the tile at the seaward end, and the way it points. So that is what comes back, and
 * a real `Pier` satisfies it without being converted at all.
 *
 * ## Finished rather than paid for
 *
 * A boat is handed over when she is paid for, because she is a possession and the builder holds
 * her until he has his money. A jetty is not anybody's. The day the last board goes down it is a
 * place boats tie up, and there is nobody for it to be handed to — the village simply has one. What
 * an unpaid balance costs is what it costs for a house: the village hears about it every morning.
 */

/** Where something that floats can be tied up: the tile at the end, and the way it points. */
export interface Mooring {
  dockX: number;
  dockZ: number;
  dx: number;
  dz: number;
}

/**
 * Where a boat lies at a jetty somebody paid for: alongside it, near the bank.
 *
 * The commission stands on the shore tile at the landward end and its `rot` is the way the builder
 * ran her out — towards the water rather than wherever the player happened to be facing, because
 * `builder.ts` takes the bearing off the sea it measured to get there. So the deck runs out along
 * that bearing, and the mooring is abeam of the near end of it rather than past the far end.
 *
 * That is where the difference between this and one of the country's own piers shows, and it is
 * worth being plain about. A seeded pier's deck is stamped into the terrain and you walk out along
 * it, so a boat at the end of it is a boat you can reach. A commissioned jetty is drawn rather than
 * stamped — it is a prop on a tile, like every other commission — so its boards are something you
 * see and not something you stand on, and a hull tied five tiles out past them would be a hull
 * nobody could ever board. Alongside, near the bank, is both reachable from the shore and what a
 * small boat actually does at a landing stage: she lies against it rather than sitting off the end.
 *
 * The heading still runs the way the jetty does, so she lies along it with her bow to the open
 * water, which is how a boat is left when somebody means to go out in her again.
 */
export function mooringOf(job: Commission): Mooring {
  const rot = job.rot ?? 0;
  const dx = Math.cos(rot), dz = -Math.sin(rot);
  // abeam is the run turned a quarter, and `moorageFor` adds one more step along the run — so the
  // hull ends up beside the second or third board rather than beside the first
  const along = 1.5, abeam = 1.2;
  return {
    dockX: Math.floor(job.x + dx * along - dz * abeam),
    dockZ: Math.floor(job.z + dz * along + dx * abeam),
    dx,
    dz,
  };
}

/** Whether a commission is a jetty that is standing, rather than one still being driven. */
export function isAJetty(job: Commission, day: number): boolean {
  return job.what === BUILDS.JETTY && isFinished(job, day);
}

/**
 * Everything a boat could be tied to today, wherever it came from.
 *
 * The country's own first, because they were there first and because a list that changes order as
 * somebody builds things would make "the nearest jetty" flicker between two answers at equal
 * distance. Beyond that the order does not matter: every caller measures.
 */
export function jettiesIn(
  piers: ReadonlyArray<Mooring>, jobs: readonly Commission[], day: number,
): Mooring[] {
  return [...piers, ...jobs.filter((job) => isAJetty(job, day)).map(mooringOf)];
}
