import { Register } from '../src/world/register';
import { rangesAsMassifs } from '../src/world/ranges';
import { claimedMines } from '../src/game/mines';
import { ITEMS, sellPrice } from '../src/game/items';
import { oneCountry, type Country } from '../src/world/groundworld';
import type { Massif } from '../src/world/mountains';
import type { TerrainSampler } from '../src/world/terrain';
import type { Village } from '../src/world/structures';
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
 *
 * ## What changed when the country stopped having an edge
 *
 * It took one sampler and read the whole world off it — every village, every cave, every massif, in
 * one go on the morning the world was opened. An endless country has no such morning. What exists
 * is whatever somebody has walked into, and villages arrive a 512-tile square at a time for as long
 * as anybody keeps walking.
 *
 * So it takes a `Country` instead, and the list of villages is a list that *grows*. `catchUp` is
 * the whole of the difference: it looks at what the country has in hand, and anything it has not
 * seen before is folded in — its mines told to the register before it settles anybody, its rock
 * added to the high places, its villages appended to the array every other part of the server is
 * already holding. Appended rather than replaced, deliberately: `wildlife.ts` and the roster took
 * this array once and kept it, and an endless world that handed out a new array on every patch
 * would leave them all holding the country as it was when they started.
 *
 * A bounded world goes through exactly the same door. It catches up once, finds one sampler, and
 * nothing ever changes again — which is what a world with an edge *is*, rather than a special case.
 */
export function peopleOf(
  seed: number,
  ground: TerrainSampler | Country,
  day: number,
  told: {
    /** Somebody who lives here has been killed by something, and the number he travelled under. */
    onFallen: (who: Entity, id: number) => void;
    /** A constable has taken one of the players in. */
    onArrest: (by: number, whom: Standing) => void;
  },
): Folk & { catchUp: () => void } {
  const country: Country = 'forChunk' in ground ? ground : oneCountry(ground);
  const register = new Register(seed, day);

  /*
   * Everything the world has walked into so far, and what it is made of.
   *
   * One array for the villages because it is handed out and held; one set of the patches already
   * folded in, because `inHand` hands back every sampler every time and folding one twice would
   * double a country's villages.
   */
  const villages: Village[] = [];
  const highPlaces: Massif[] = [];
  const mines = new Set<string>();
  const seen = new Set<TerrainSampler>();

  /** Fold in whatever country has arrived since last time. Cheap, and safe to call every tick. */
  const catchUp = (): void => {
    for (const sampler of country.inHand()) {
      if (seen.has(sampler)) continue;
      seen.add(sampler);
      const structures = sampler.structures;
      // the mines first and for the whole world, because the register takes the set rather than
      // adding to it — and because who works a hole has to be known before anybody is settled
      for (const village of claimedMines(structures.villages, structures.caves).keys()) mines.add(village);
      register.minesAt(mines);
      // The world's mountains, whichever kind this patch grew — the same line `growCountry` uses,
      // and for the same reason: what lives on high ground is decided by the height rather than by
      // what the map happens to call the country there. Without it the server would put lowland
      // herds on a massif, and since it is now the only thing spawning anything, that would simply
      // be the world.
      highPlaces.push(...(sampler.ranges ? rangesAsMassifs(sampler.ranges, sampler.mesh) : sampler.massifs));
      villages.push(...structures.villages);
    }
  };
  catchUp();

  return {
    villages,
    register,
    catchUp,
    hasStable: (village) => villages.some((v) => v.name === village && v.stable != null),
    // What a villager is paid for what he sells: the same share of the shop price the player gets,
    // because the world's economy and the player's are one economy.
    priceOf: (id) => (ITEMS[id] ? sellPrice(ITEMS[id]) : 2),
    highland: (x, z) => highPlaces.some((m) => Math.hypot(x - m.x, z - m.z) < m.radius),
    onFallen: told.onFallen,
    onArrest: told.onArrest,
  };
}
