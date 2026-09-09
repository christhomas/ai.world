import { Simplex2D } from './noise';
import { countryOf, type Country } from './localmesh';
import { graphIn, levelAt } from './localgraph';
import { highlandNear, landOf } from './localland';
import { junctionsIn, nameOf, townAt, type Land } from './localroads';
import { waterIn } from './localwater';
import { rockIn } from './localrock';
import { crossingsIn } from './localsea';
import { TerrainSampler } from './terrain';
import type { Founding } from './structures';
import type { Within } from './window';

/**
 * A patch of the endless country, as something you can stand on.
 *
 * Every piece of this was built and proved on its own — the sites, the mesh, the roads and towns,
 * the ground, the water, the founding of a village from its own name — and none of them was a
 * world. This is the join: it hands a sampler a country instead of a world, and what comes back
 * draws tiles, holds structures and answers questions exactly as the bounded one does, because it
 * is the same sampler.
 *
 * What is not here yet is the rock. A bounded world's mountains are geometry grown from its
 * polygons; this one has the high country they stand on — walkable, snowed on, drawn on the map —
 * and nothing standing on it. The last few hundred feet are their own piece of work.
 */

/** How coarse the country is: the spacing of its sites, in tiles. `MESH.NEAR`/`FAR`, in local terms. */
const DIALS = { near: 34, far: 62, tries: 6 } as const;

/** How coarsely the fine-grained country gives way to the open country. `MESH.GRAIN`. */
const GRAIN = 0.0026;

/**
 * How far past a patch its neighbours are looked up, in tiles.
 *
 * A signpost points at what is within a day's walk, and most of what is around the edge of a patch
 * is in the next one. This has to be at least that walk, or a signpost at the edge names fewer
 * places than the same signpost seen from the patch next door — which would be a signpost that
 * changes what it says depending on where you came from.
 */
const LOOKING = 300;

/**
 * The country of a seed: the sites, the faces, and whether a given spot is dry.
 *
 * Held rather than made per question. Everything below asks the same patch about the same faces
 * over and over — a road asks for the face across the border, a village asks what it is standing
 * on, the sampler asks whether every tile of every chunk is land — and a country with no memory of
 * the cells it has worked out does that arithmetic from the beginning every time.
 */
export function countryFor(seed: number): Land {
  const grain = new Simplex2D(seed ^ 0x1234);
  const country: Country = countryOf(
    seed, (x, z) => (grain.fbm(x * GRAIN, z * GRAIN, 2) + 1) * 0.5, DIALS,
  );
  return { ...country, land: landOf(country) };
}

/** The towns of a patch, as places a village can be founded on. */
export function townsIn(world: Land, within: Within): Founding[] {
  const out: Founding[] = [];
  // only the towns standing in the patch: one outside it belongs to the patch it is in, and would
  // otherwise be founded twice. `junctionsIn` is what makes "in the patch" mean the same thing to
  // both of two neighbours.
  for (const junction of junctionsIn(world, within)) {
    const town = townAt(world, junction);
    if (!town) continue;
    out.push({
      id: town.id,
      name: nameOf(world.seed, town.id),
      x: town.x, z: town.z,
      level: levelAt(world.seed, town.x, town.z),
      // a market town, an ordinary one, or a few cottages, as the crossroads itself decided
      size: town.level >= 3 ? 'hub' : town.level === 2 ? 'town' : 'village',
    });
  }
  return out;
}

/**
 * A sampler for one patch of the endless country.
 *
 * The patch is what the sampler answers for. It holds roads, water and villages that reach into it
 * and nothing else, so two patches side by side hold different things and agree about the ground
 * they share — which is the property everything above this was built to have.
 */
export function samplerIn(seed: number, within: Within): TerrainSampler {
  const world = countryFor(seed);
  const graph = graphIn(world, within);
  return new TerrainSampler(graph, {
    within,
    country: { land: (x, z) => world.land(x, z), highland: highlandNear(world, within) },
    hydro: waterIn(world, within),
    settling: {
      towns: townsIn(world, within),
      posts: junctionsIn(world, within).map((j) => ({ id: j.id, x: j.x, z: j.z })),
      // wider than the patch, because a signpost near its edge points at the next patch's villages
      neighbours: townsIn(world, {
        x0: within.x0 - LOOKING, z0: within.z0 - LOOKING,
        x1: within.x1 + LOOKING, z1: within.z1 + LOOKING,
      }),
      crossings: crossingsIn(world, within).map((c) => ({
        id: c.between.join('~'), from: { x: c.from.x, z: c.from.z }, to: { x: c.to.x, z: c.to.z },
      })),
    },
    // last, because the rock stands on the finished ground rather than being part of it
    rock: (ground) => rockIn(world, within, ground),
  });
}
