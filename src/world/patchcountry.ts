import { PATCH, Patchwork, patchOf } from './patchwork';
import type { TerrainSampler } from './terrain';
import type { Within } from './window';

/**
 * The endless country, as the one thing the game can hold on to.
 *
 * `Patchwork` is the store: squares of country, grown when asked for and dropped when they are far
 * enough behind. This is what the game actually talks to — "the country near the hero" — and the
 * difference between the two is the whole reason this file exists.
 *
 * Everything above the world layer was written against a single `TerrainSampler` that never
 * changes. `growCountry` holds one, the chunk manager is built with one, the game asks one what the
 * ground is doing. None of that can be true in a country with no edge, and rewriting all of it to
 * pass a position into every question would be a very large change to a great deal of code that has
 * nothing to do with endlessness.
 *
 * So the shape here is: there is a *current* sampler, it is the one for the patch the hero is
 * standing in, and it changes when he walks into another one. Callers that already ask the sampler
 * about the ground under them keep working unchanged, because the ground under them is exactly what
 * the current patch answers for. What has to be dealt with deliberately — and is the next piece of
 * work rather than this one — is everything that asks a *world-wide* question: where all the
 * villages are, where every mountain is, which islands exist.
 *
 * ## Why the change is announced rather than silent
 *
 * A patch crossing is not a detail the rest of the game can ignore. The mountains standing in the
 * scene belong to the old patch, the eyries were planned from it, the chunk workers have been told
 * about it. `moveTo` says when it has happened and to which patch, so the things that have to be
 * rebuilt can be rebuilt once, at the moment it matters, rather than every frame or never.
 *
 * ## Why the hero is not asked where he is
 *
 * `moveTo` is called with a position rather than this holding a reference to the player, because
 * the same object is wanted by the world server, which has no player at all: it holds the country
 * round whoever is furthest along, or round each room. One object, two callers, neither of which is
 * the other's business.
 */
export class PatchCountry {
  private readonly patches: Patchwork;
  private standing: string;
  private current: TerrainSampler;

  constructor(
    readonly seed: number,
    x: number,
    z: number,
    grow?: (seed: number, within: Within) => TerrainSampler,
  ) {
    this.patches = grow ? new Patchwork(seed, grow) : new Patchwork(seed);
    this.standing = patchOf(x, z);
    this.current = this.patches.patch(this.standing);
  }

  /** The sampler for the patch whoever this is following is standing in. */
  get sampler(): TerrainSampler {
    return this.current;
  }

  /** Which patch that is, by name. */
  get patch(): string {
    return this.standing;
  }

  /** The store underneath, for the chunk manager, which paints chunks in patches that are not this one. */
  get store(): Patchwork {
    return this.patches;
  }

  /**
   * Follow somebody. Returns the patch they have walked into, or nothing if they are where they were.
   *
   * The neighbours are grown on the way past, which is what stops a patch boundary being a stall:
   * by the time anybody reaches the edge of the square they are in, the next one is already there.
   */
  moveTo(x: number, z: number): string | null {
    const now = patchOf(x, z);
    if (now === this.standing) {
      this.patches.around(x, z);
      return null;
    }
    this.standing = now;
    this.current = this.patches.patch(now);
    this.patches.around(x, z);
    return now;
  }

  /**
   * How far somebody is from leaving the patch they are in, in tiles.
   *
   * For deciding when to do work that a crossing will make necessary — and for a debug readout,
   * because "why did the game hitch just then" is a question worth being able to answer.
   */
  static toEdge(x: number, z: number): number {
    const inX = ((x % PATCH) + PATCH) % PATCH;
    const inZ = ((z % PATCH) + PATCH) % PATCH;
    return Math.min(inX, PATCH - inX, inZ, PATCH - inZ);
  }
}
