import { rangesAsMassifs } from './ranges';
import type { PatchCountry } from './patchcountry';
import type { TerrainSampler } from './terrain';
import type { Massif } from './mountains';

/**
 * What the game reads about the country it is standing in *now*.
 *
 * `growCountry` used to read `sampler`, `graph`, `structures` and `highPlaces` off the patch the
 * hero booted in and hand those values out. `main.ts` then closed over them — the biome probe, the
 * field survey, every villages lookup, the high-place check — and `frame.ts` refreshed the
 * mountains, the chunks, the skyline and the high-country renderer on a crossing but could not
 * refresh those, because they were copies rather than questions.
 *
 * So a hero who walked into the next patch went on being told about the villages of the patch he
 * had left, and a field survey ran against terrain that was not under him.
 *
 * This is a **view**, and that is the whole of the fix: nothing here holds a copy, so nothing here
 * can hold a stale one. Every property asks `PatchCountry` which patch the hero is in and answers
 * from that patch. A crossing needs no notification and no refresh, because there is nothing to
 * refresh — which is why this is a smaller thing to get right than a list of consumers to remember.
 *
 * The one value that is not simply forwarded is `highPlaces`: it is derived rather than held, so it
 * is worked out once per patch and kept against the sampler it was worked out from. A `Map` keyed
 * by sampler rather than by patch name, so a patch regrown into a new sampler gets a new answer
 * rather than the old one under the same name.
 */
export interface PatchView {
  /** The sampler for the patch the hero is standing in. */
  readonly sampler: TerrainSampler;
  /** Its road graph. */
  readonly graph: TerrainSampler['graph'];
  /** What is built on it: the villages, the roads, everything placed. */
  readonly structures: TerrainSampler['structures'];
  /** And its mountains, in the terms everything that stands on one reads. */
  readonly highPlaces: readonly Massif[];
}

export function viewOf(endless: PatchCountry): PatchView {
  /*
   * Keyed by the sampler and not by the patch name, so that regrowing a patch is a new answer.
   * A `WeakMap` because the key is the only thing keeping the entry interesting: when a patch is
   * dropped and its sampler collected, the massifs worked out from it should go with it rather
   * than accumulating for the life of the session, one entry per patch ever visited.
   */
  const massifs = new WeakMap<TerrainSampler, readonly Massif[]>();

  return {
    get sampler(): TerrainSampler { return endless.sampler; },
    get graph(): TerrainSampler['graph'] { return endless.sampler.graph; },
    get structures(): TerrainSampler['structures'] { return endless.sampler.structures; },
    get highPlaces(): readonly Massif[] {
      const now = endless.sampler;
      const known = massifs.get(now);
      if (known) return known;
      const worked = now.ranges ? rangesAsMassifs(now.ranges, now.mesh) : now.massifs;
      massifs.set(now, worked);
      return worked;
    },
  };
}
