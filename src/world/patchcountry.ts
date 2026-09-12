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
   * It grows *one* patch at most, and that is a correction rather than a simplification. It used to
   * warm the eight neighbours on the way past, on the reasoning that a boundary should never be a
   * stall — and a patch measured at five seconds to grow, so the first crossing froze the game for
   * three quarters of a minute and the frame loop never came back. Nine seconds of work a frame is
   * not a smoother boundary, it is no game at all.
   *
   * So the warming is somebody else's job and is deliberately not done here: see `warm`, and the
   * work list item about growing country off the main thread, which is the only real answer.
   */
  moveTo(x: number, z: number): string | null {
    const now = patchOf(x, z);
    if (now === this.standing) return null;
    this.standing = now;
    this.current = this.patches.patch(now);
    return now;
  }

  /**
   * Grow the neighbours, for a caller that can afford five seconds a patch.
   *
   * Which is nobody on the main thread of a running game. It is here for tests and for a world
   * server standing a province up before anybody is in it. The game asks `wants` instead.
   */
  warm(x: number, z: number): void {
    this.patches.around(x, z);
  }

  /**
   * The squares somebody at this spot will want next, nearest first.
   *
   * Handed to whoever can grow them elsewhere. Nearest first because the queue is served in order
   * and the square you are walking into is the one that matters — the diagonals behind you are
   * wanted eventually and never urgently.
   */
  wants(x: number, z: number): string[] {
    const px = Math.floor(x / PATCH);
    const pz = Math.floor(z / PATCH);
    const around: Array<{ patch: string; away: number }> = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        // how far the hero is from that square's nearest edge, near enough for an ordering
        const away = Math.hypot(
          Math.max(0, Math.abs(x - (px + dx) * PATCH - PATCH / 2) - PATCH / 2),
          Math.max(0, Math.abs(z - (pz + dz) * PATCH - PATCH / 2) - PATCH / 2),
        );
        around.push({ patch: `${px + dx},${pz + dz}`, away });
      }
    }
    return around.sort((a, b) => a.away - b.away).map((one) => one.patch);
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
