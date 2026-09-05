/**
 * Making sure the world happens to you.
 *
 * Almost everything interesting in this game is built and placed and then waits: warbands walk
 * their rounds, Old Nettle schemes at a village, a place under pressure asks for help. All of it
 * is gated on the player being near enough, and the player is one person walking one road. An hour
 * of play can pass without meeting any of it, which is not a content problem — it is a distance
 * problem.
 *
 * So this keeps one number: how long it has been since anything happened. While that grows, the
 * distance at which the world's set pieces notice the player grows with it, up to a limit. Quiet
 * is allowed — a few minutes of nothing is a walk in the country — but a whole evening of it is a
 * game that never started.
 *
 * What it deliberately does not do is invent anything. It never spawns, never moves a band, never
 * makes the rare things common. It widens the radius at which what already exists is willing to be
 * found, and the moment something does happen it goes back to normal. A player walking into
 * trouble constantly sees exactly the world as it was tuned; a player who has found nothing for
 * twenty minutes gets a world that is looking slightly harder for them.
 */

export const DIRECTOR = {
  /** Quiet shorter than this is just quiet, and nothing is done about it. */
  PATIENCE: 240,
  /** By this much quiet, the world is reaching as far as it ever will. */
  GIVING_UP: 900,
  /** The furthest it will reach, as a multiple of the ordinary distance. */
  MOST: 2.6,
} as const;

/** Things worth counting as "something happened". */
export type Happening = 'band' | 'nemesis' | 'trouble' | 'fight';

export class Director {
  /** Seconds since the last happening. */
  private quiet = 0;
  private lastKind: Happening | null = null;

  /** Time passing with nothing in it. */
  advance(dt: number): void {
    this.quiet += dt;
  }

  /** Something happened, so the world can stop straining to be noticed. */
  saw(what: Happening): void {
    this.quiet = 0;
    this.lastKind = what;
  }

  /** How long it has been, in seconds. For the debug readout and for tests. */
  get quietFor(): number { return this.quiet; }
  get last(): Happening | null { return this.lastKind; }

  /**
   * How much further than usual the world should reach right now, as a multiple.
   *
   * One while anything is happening, easing up to MOST across the stretch between PATIENCE and
   * GIVING_UP. Eased rather than stepped so nothing pops into existence the instant a timer
   * expires.
   */
  get reach(): number {
    if (this.quiet <= DIRECTOR.PATIENCE) return 1;
    const t = Math.min(1, (this.quiet - DIRECTOR.PATIENCE) / (DIRECTOR.GIVING_UP - DIRECTOR.PATIENCE));
    return 1 + (DIRECTOR.MOST - 1) * (t * t * (3 - 2 * t));
  }
}
