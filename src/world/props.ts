import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { BIOMES, PropKind, pickWeighted, type Biome } from './biomes';
import { herbAt, richness, seamAt } from './seams';
import { mountainAt, type Ranges } from './ranges';
import {
  COAST_PROP_FACTOR, HIGH_ROCK_DENSITY, PROP_HEADROOM, ROAD_SHOULDER, TileType, type SampleGrid,
} from './terrain';

/**
 * What grows on a tile.
 *
 * A table lookup and a die: the biome says what could be here and how thickly, the tile says
 * whether anything can be, and the seed says which one it is. Kept apart from the sampler because
 * it is about what stands on the ground rather than about where the ground is.
 */
/** Majority filter: a lone tile a terrace off from its neighbourhood joins the crowd. */
export function rollProp(
grid: SampleGrid, gi: number, type: TileType, seed: number, ranges: Ranges | null,
): PropKind {
  const tx = grid.x0 + (gi % grid.G), tz = grid.z0 + Math.floor(gi / grid.G);
  // Nothing grows under a mountain. The ground beneath one is still generated — it is what the
  // rock stands on, and the rim needs it — but a tree rooted in ground that is now the inside of
  // a mountain is a trunk sticking out of a cliff. A hand's breadth of clearance rather than
  // nought, so the skirt where the rock meets the grass still has its scrub.
  if (ranges) {
    const rock = mountainAt(ranges, tx + 0.5, tz + 0.5);
    if (rock !== null && rock > grid.height[gi] + PROP_HEADROOM) return PropKind.None;
  }
  const def = BIOMES[grid.biome[gi]];
  const r = rand2(seed, tx, tz, TILE_SALT.PROP_ROLL);
  const kindRoll = rand2(seed, tx, tz, TILE_SALT.PROP_KIND);
  if (type === TileType.Water) return r < def.waterDensity ? pickWeighted(def.water, kindRoll) : PropKind.None;
  if (grid.bank[gi]) return r < def.bankDensity ? pickWeighted(def.bank, kindRoll) : PropKind.None;
  if (grid.roadDist[gi] < grid.roadWidth[gi] + ROAD_SHOULDER) return PropKind.None;
  switch (type) {
    case TileType.High: return r < HIGH_ROCK_DENSITY ? (kindRoll < 0.5 ? PropKind.Rock : PropKind.Boulder) : PropKind.None;
    case TileType.Ground:
    case TileType.GroundAlt: {
      const grown = r < def.propDensity ? pickWeighted(def.props, kindRoll) : PropKind.None;
      // a tile that grew nothing of its own says what it is hiding instead
      return grown === PropKind.None ? whatTheGroundIsHiding(grid, gi, tx, tz, seed) : grown;
    }
    case TileType.Sand: return r < def.bankDensity * COAST_PROP_FACTOR ? pickWeighted(def.bank, kindRoll) : PropKind.None;
    default: return PropKind.None;
  }
}

/** Flatten yards, lay door paths, and drop each building prop on its centre tile. */
/** Which village a structure belongs to, by whose radius it falls inside. Empty for the wild. */

/**
 * How rich the ground must be before a stone marks it, as the odds of a hole paying.
 *
 * Measured rather than guessed, and the numbers are closer together than they look. Flat meadow
 * sits at exactly the floor, 0.05; stony country — mountain, desert, snow — comes out at 0.17; and
 * the per-terrace bonus almost never applies, because `rise` is `level - base` and those are equal
 * on any ground that is not a slope. So this is very nearly a yes-or-no question about the country
 * rather than a sliding scale, and anything between the two numbers picks out the hill country.
 *
 * The ends were both walked into. At 0.3 nothing qualifies at all and the sign silently does
 * nothing — the stones left in the world are the ones the biome grows as scenery, which is how the
 * first version of this looked like it worked and did not. At 0.05 every tile that takes a spade is
 * marked, which put 901 stones in eleven thousand tiles: a scree slope, and a sign that appears
 * everywhere says nothing.
 */
const WORTH_DIGGING = 0.12;

/**
 * What an empty tile shows about what is under it or growing on it.
 *
 * Two systems in this game could only be found by standing in exactly the right place holding
 * exactly the right tool: a hillside with a seam in it, and ground with herbs on it. Both have
 * always been pure functions of the seed and the tile, so the world has always known — and nothing
 * ever showed it, so a player could dig a hundred holes in ordinary dirt and finish the game
 * without learning that either existed. That is not a hidden depth; it is an undiscoverable one.
 *
 * So the ground says. Somewhere herbs grow, something grows that you would stoop to pick; where
 * there is metal under it, a stone shows at the surface, which is what a seam looks like from above
 * in any country. Neither is a promise — most of the world's rocks are only rocks, and both of
 * these read as ordinary scenery — but somebody who digs where the stones are and picks where the
 * flowers are will do better than somebody who does not, and that is the whole of what a sign
 * should be.
 *
 * Only on tiles that grew nothing of their own, which is most of the country. A herb that displaced
 * a tree would turn a wood into a meadow.
 */
function whatTheGroundIsHiding(
  grid: SampleGrid, gi: number, tx: number, tz: number, seed: number,
): PropKind {
  /*
   * Both questions go through the two systems' own functions rather than a copy of the arithmetic.
   * A sign that disagreed with the thing it advertises is worse than no sign at all: it would send
   * somebody to dig ground that holds nothing.
   *
   * `rooted` and `soft` are true here because this only runs on `Ground` and `GroundAlt` — water,
   * road, sand and floor took their own branch above and never reach this.
   */
  const damp = grid.bank[gi] === 1;
  if (herbAt(seed, tx, tz, { biome: grid.biome[gi] as Biome, damp, rooted: true }) > 0) {
    // a mushroom on damp ground and a flower on dry: the two things this world already draws that
    // somebody would kneel down to
    return damp ? PropKind.Mushroom : PropKind.Flower;
  }
  /*
   * A stone only where the ground is genuinely worth a spade.
   *
   * Every tile that takes a spade holds metal now and then — that is what `DIG.BASE` is — and
   * marking all of them put a stone on eight per cent of the country. Two things wrong with that
   * and the second is the real one: it looks like a scree slope, and a sign that appears everywhere
   * says nothing. `WORTH_DIGGING` is where the odds have risen well above the flat-meadow floor,
   * which is the hillsides and the high desert, and is exactly where the comments in `seams.ts`
   * always said the metal was.
   */
  const rise = Math.max(0, grid.level[gi] - grid.base[gi]);
  const ground = { biome: grid.biome[gi] as Biome, rise, soft: true };
  if (richness(ground) < WORTH_DIGGING) return PropKind.None;
  return seamAt(seed, tx, tz, ground) ? PropKind.Rock : PropKind.None;
}
