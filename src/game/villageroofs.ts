import { isARoof } from '../world/roofs';
import type { Village } from '../world/structures';

/**
 * The houses a village has raised for itself, as things a player can walk up to.
 *
 * The whole of item 44 was invisible until this existed. A village fills its houses, saves, raises
 * another and grows into it — and a player standing in the square saw the same ten roofs for two
 * hundred days, because the houses that are *drawn* come from the seed's own list and nothing ever
 * added to one. Thirty-one souls became ninety-three with nothing built that anybody could see.
 *
 * The route was argued for in the work list before any of this was written, and it is the one a
 * player's own commissions already take: a commission is drawn from the list of commissions rather
 * than from the world's structures, *precisely because it was not there when the terrain was
 * generated*. A village's raised roof is the same object on the same plot rules, so it goes through
 * the same door.
 *
 * Where they stand is the seed's business rather than this file's: `structures.ts` finds the plots
 * a village has not built on when it lays the place out, after everything else is standing, so the
 * eleventh house is where the country always said it would be and two machines agree about it
 * without a word crossing the wire.
 */

/** One roof, in the shape the building site draws a commission in. */
export interface Raised {
  id: string;
  x: number;
  z: number;
  rot: number;
  what: string;
  stage: 'done';
  storeys: number;
}

/**
 * Every roof every village near the hero has raised.
 *
 * Finished, always: a village's building work is a day's wages in a ledger rather than a site with
 * pegs in it, and there is nothing anywhere that says which morning of its six a village house is
 * on. That is a thing worth having one day — a frame going up in a village you are walking through
 * is the whole of why the stages exist — and it needs the day the village began it, which the
 * register does not keep.
 *
 * Capped at the plots the founding found, so a village whose books have run ahead of its ground
 * draws what it has room for and no more. A roof with nowhere to stand is a roof nobody can see
 * anyway, and inventing a plot here would put a house through a paddock wall.
 */
export function raisedRoofs(villages: readonly Village[], worksOf: (village: string) => readonly string[]): Raised[] {
  const out: Raised[] = [];
  for (const village of villages) {
    const raised = worksOf(village.name).filter(isARoof);
    for (let n = 0; n < raised.length && n < village.spare.length; n++) {
      const plot = village.spare[n];
      out.push({
        id: `${village.name}-roof-${n}`,
        x: plot.tx + 0.5,
        z: plot.tz + 0.5,
        rot: plot.rot,
        /*
         * Drawn as that country's own cottage whatever size it is, for now.
         *
         * A village raises four sizes — cottage, house, longhouse, great house — and the renderer
         * has one house per biome. Drawing a great house as a cottage would be a lie about a thing
         * a player can walk up to; drawing all four as the house that exists is the truthful
         * version of the same compromise, and the day there are four models this line reads
         * `roofOfWork(...)`. The biome goes in the name because that is how `render/site.ts` is
         * told which of the six to put up, the same way the terrain is told.
         */
        what: `raised-${plot.biome}`,
        stage: 'done',
        storeys: 1,
      });
    }
  }
  return out;
}

/**
 * The same list, worked out about once a day instead of sixty times a second.
 *
 * What a village has raised changes when the register advances and at no other moment, so asking
 * it every frame is asking a question whose answer is already known — and the answer is a walk
 * over every village within reach and every line in its books. The count of villages is in the key
 * as well as the day, because in an endless country a patch arriving is the other way the answer
 * changes, and it does not wait for morning.
 */
export function roofWatch(
  villagesNow: () => readonly Village[],
  worksOf: (village: string) => readonly string[],
): (day: number) => readonly Raised[] {
  let asked = '';
  let built: readonly Raised[] = [];
  return (day) => {
    const villages = villagesNow();
    const key = `${Math.floor(day)},${villages.length}`;
    if (key !== asked) {
      asked = key;
      built = raisedRoofs(villages, worksOf);
    }
    return built;
  };
}
