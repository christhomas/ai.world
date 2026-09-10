import { Register } from '../src/world/register';
import { rangesAsMassifs } from '../src/world/ranges';
import { claimedMines } from '../src/game/mines';
import { ITEMS, sellPrice } from '../src/game/items';
import type { TerrainSampler } from '../src/world/terrain';
import type { Entity } from '../src/entities/entity';
import type { Folk, Standing } from './wildlife';

/**
 * Who lives in a world the server is holding, and everything a village needs in order to be a
 * village rather than a shape on a map.
 *
 * It is assembled here rather than in the simulation because every line of it is the same line the
 * game runs on its own side — the same register, the same mines, the same prices, the same rock —
 * and putting them together in one place is what makes "the server grows the same village you do" a
 * thing somebody can check rather than a thing somebody hopes.
 *
 * The order matters and is the order `main.ts` uses, for the reason it says there: which villages
 * have a mine on their doorstep has to be said *before* anybody settles, because a village is
 * founded once and its trades are fixed then. Tell the register afterwards and the mining village
 * has already been raised without miners in it.
 */
export function peopleOf(
  seed: number,
  sampler: TerrainSampler,
  day: number,
  told: {
    /** Somebody who lives here has been killed by something, and the number he travelled under. */
    onFallen: (who: Entity, id: number) => void;
    /** A constable has taken one of the players in. */
    onArrest: (by: number, whom: Standing) => void;
  },
): Folk {
  const structures = sampler.structures;
  const register = new Register(seed, day);
  register.minesAt(claimedMines(structures.villages, structures.caves).keys());
  // The world's mountains, whichever kind this world grew — the same line `growCountry` uses, and
  // for the same reason: what lives on high ground is decided by the height rather than by what the
  // map happens to call the country there. Without it the server would put lowland herds on a
  // massif, and since it is now the only thing spawning anything, that would simply be the world.
  const highPlaces = sampler.ranges ? rangesAsMassifs(sampler.ranges, sampler.mesh) : sampler.massifs;
  return {
    villages: structures.villages,
    register,
    hasStable: (village) => structures.villages.some((v) => v.name === village && v.stable != null),
    // What a villager is paid for what he sells: the same share of the shop price the player gets,
    // because the world's economy and the player's are one economy.
    priceOf: (id) => (ITEMS[id] ? sellPrice(ITEMS[id]) : 2),
    highland: (x, z) => highPlaces.some((m) => Math.hypot(x - m.x, z - m.z) < m.radius),
    onFallen: told.onFallen,
    onArrest: told.onArrest,
  };
}
