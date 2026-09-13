import { TileType } from '../world/terrain';
import { WORLD } from '../core/config';
import { rangesAsMassifs } from '../world/ranges';
import { buildSkyIsland, planSkyIslands, type SkyIsland } from '../world/skyisland';
import { skyGroundsIn } from '../world/skygrounds';
import { planEyries, type Eyrie } from './eyries';
import type { Manifest } from '../world/manifest';
import type { SkyIslands } from '../render/skyisland';
import type { TerrainSampler } from '../world/terrain';

/**
 * What stands on and above the rock: the eagles' crags, and the villages in the clouds.
 *
 * The last of item 59d-i. Three things held the world's mountains and each would have failed
 * differently on a patch crossing — the mesh, the chunk manager's ranges and the camera's skyline —
 * and all three were given a way to be told. These two were left, and they fail the same way for
 * the same reason: both are *planned across a whole country*, once, on the morning the world opens.
 *
 * An eyrie is planned from the massifs, and in an endless world the massifs belong to the patch the
 * hero is in. A sky island is planned from `graph.islands`, which is the road graph's own list and
 * therefore the list belonging to one square. Planned once at the origin and never again, a hero
 * who walks a square east is under islands that belong to country behind him and over crags that
 * are not there — which is the same failure as a range dragged along behind him, one layer up.
 *
 * So this owns both, and `standOn` is the whole of it: handed the sampler the hero is now standing
 * in, it re-plans if that is a different sampler and does nothing at all if it is not. Same shape
 * as `Mountains.show`, and safe to call on every crossing for the same reason.
 *
 * ## The arrays are replaced in place, and that is deliberate
 *
 * `eyries` and `isles` are handed out once — to the frame, to what the hero can hear, to the
 * console — and kept. Handing back a fresh array on every crossing would leave every one of those
 * holders looking at the country as it was when they took it, which is exactly the fault this item
 * is about wearing different clothes. So the lists are emptied and refilled rather than rebound.
 */
export class HighCountry {
  /** The crags with eagles on them, for whoever took this list on the first morning. */
  readonly eyries: Eyrie[] = [];
  /** And the islands in the sky over them. */
  readonly isles: SkyIsland[] = [];
  private standing: TerrainSampler | null = null;

  constructor(
    private readonly seed: number,
    private readonly manifest: Manifest,
    private readonly sky: SkyIslands,
  ) {}

  /**
   * Stand on this square's rock. Does nothing when it is the square we were already standing on,
   * which is every frame but the few where somebody crossed a boundary.
   */
  standOn(sampler: TerrainSampler): void {
    if (sampler === this.standing) return;
    this.standing = sampler;

    const high = sampler.ranges ? rangesAsMassifs(sampler.ranges, sampler.mesh) : sampler.massifs;
    const land = (x: number, z: number): boolean => sampler.probe(x, z).land;

    this.eyries.length = 0;
    this.eyries.push(...planEyries(this.seed, high, land));

    // the old islands leave the sky before the new ones arrive, or a hero two squares along is
    // under every island he has ever walked past
    this.sky.clear();
    this.isles.length = 0;
    /*
     * What to hang a village in the clouds over.
     *
     * A road world hangs one over an island, which is a sub-tree of roads with a harbour town on
     * it. An endless patch's graph has an empty island list and always will, so it draws its own
     * places on a stream of its own — see `skygrounds.ts`, which is item 85 and says why an island
     * was never what this actually needed.
     */
    const grounds = sampler.within
      ? skyGroundsIn(this.seed, sampler.within, land)
      : sampler.graph.islands;
    this.isles.push(...planSkyIslands(this.seed, grounds, high, land).map((site) =>
      buildSkyIsland(site, this.manifest.ensure(site.id, 'skyisle', site.x, site.z, site.over).seed, land)));

    const sample = sampler.newSample();
    for (const isle of this.isles) {
      this.sky.add(isle, (x, z) => {
        // where the fall lands. Taken from the sampler rather than from a loaded chunk because the
        // island is built before anything has streamed in, and a plume that stops at zero when the
        // ground under it is four terraces up hangs in the air with a gap under it.
        sampler.sampleTile(Math.floor(x), Math.floor(z), sample);
        return sample.type === TileType.Skip || sample.type === TileType.Seabed
          ? WORLD.WATER_Y : sample.height;
      });
    }
  }
}
