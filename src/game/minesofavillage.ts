import { claimedMines, mineIdOf, type Mines } from './mines';
import type { Places } from './places';
import type { Register } from '../world/register';
import type { Structures } from '../world/structures';

/**
 * Which hole a village works, what it believes about it, and whether the hero is down one.
 *
 * Three questions that travel together and were three helpers in the middle of `main.ts`. They
 * belong to each other: each is about the same map from a village to the cave it works, and each
 * is asked by something else entirely — the register when it decides whether a village raises
 * miners, a clerk or an innkeeper putting the mine into words, and a swing deciding whether
 * killing something down there has made anybody's mine safer.
 *
 * Lifted out when `main.ts` went past the line the architecture test draws, and a better home than
 * the wiring file regardless: somebody looking for "how does a village know which hole is its
 * hole" now has one place to look.
 */
export function minesOfAVillage(ctx: {
  structures: Structures;
  register: Register;
  mines: Mines;
  /**
   * Where the hero is, asked for rather than held.
   *
   * A function because the map of villages to holes is worked out before anybody has decided where
   * the hero is standing — `places` is built further down the wiring — and because the answer
   * changes every time he takes a staircase.
   */
  places: () => Places;
}) {
  const { structures, register, mines, places } = ctx;

  /**
   * Which cave each village calls its mine. A pure function of the structures, so it is worked
   * out once: the ground does not move and neither do the villages standing on it.
   */
  const claimed = claimedMines(structures.villages, structures.caves);

  // said before anybody settles, because a village is founded once and its trades are fixed then:
  // tell the register after the fact and the mining village has already been raised without miners
  register.minesAt(claimed.keys());

  /**
   * What a village believes about its mine, for anybody who has to put it into words.
   *
   * Belief rather than fact on purpose. A mine the player emptied on Tuesday goes on being spoken
   * of as a death trap until somebody has walked back in to say otherwise, and that gap is the
   * point: it is what makes going back and telling them a thing worth doing.
   */
  const saidOfMine = (village: string): string => {
    const cave = claimed.get(village);
    return cave ? mines.saidOf(mineIdOf(cave)) : '';
  };

  /**
   * The mine the hero is currently swinging inside, or nothing.
   *
   * Only a cave counts. A vault and a thicket are places to go rather than places anybody works,
   * and counting a kill in one of those would quietly make safe a mine nobody has been near.
   */
  const fightingInAMine = (): string | null => {
    const under = places().underground;
    return under?.style === 'cave' ? under.anchorId : null;
  };

  return { claimed, saidOfMine, fightingInAMine };
}
