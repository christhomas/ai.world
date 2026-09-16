import type { Patchwork } from './patchwork';
import type { TerrainSampler } from './terrain';

/**
 * A world generator, as the thing the game is handed rather than the thing it is built out of.
 *
 * #228 took the choice of country out by deleting the alternative, and those are two different
 * acts. The decision it was taken to serve — that the endless country is the future of the map —
 * can be taken and re-taken behind an interface; it cannot be taken back once the other
 * implementation is gone. And the other implementation was never gone: the road tree spent three
 * weeks as `graph.test.fixture.ts`, 746 lines of live generator with no door on it, which most of
 * the test suite went on growing its worlds with.
 *
 * So this is the door. What the game needs to know about the ground is small, and it is all here:
 * which sampler answers for where somebody is standing, whether there is more country to be grown
 * beyond it, and what to do when somebody walks off the edge of what has been grown. Everything
 * else the game asks — where the villages are, how high the ground is, what grows on it — it asks
 * the sampler, and a sampler is a sampler whichever generator filled it in.
 *
 * Note for the reader: `localmesh.ts` also exports a `Country`, and it is a different thing — the
 * polygon mesh a patch is glued out of. This one is the country as the game holds it.
 */
export type WorldKind = 'road' | 'endless';

export interface Country {
  /** Which generator grew this, which the save has to record. See `kindOf` in `save/store.ts`. */
  readonly kind: WorldKind;
  readonly seed: number;
  /** The sampler for wherever whoever we are following is standing. */
  readonly sampler: TerrainSampler;
  /**
   * The squares already grown, for the chunk painter and for what is near the hero.
   *
   * Null for a country that exists all at once, which is the whole of how the rest of the game
   * tells the two apart.
   */
  readonly store: Patchwork | null;
  /** Follow somebody. The square they have walked into, or nothing if they are where they were. */
  moveTo(x: number, z: number): string | null;
  /** Which squares somebody standing here will want next, for whoever is growing them. */
  wants(x: number, z: number): string[];
}

/**
 * The road tree, as a country: one sampler, grown once, that never changes underneath anybody.
 *
 * Every method that is about there being more country than has been grown answers that there is
 * not, and answers it honestly rather than by throwing — a bounded world is not a country with an
 * unimplemented edge, it is a country whose edge is the sea. `frame.ts` asks for a crossing on
 * every frame and gets `null` on every frame, which is exactly what walking around one island
 * ought to cost.
 */
export class RoadCountry implements Country {
  readonly kind = 'road' as const;
  readonly store = null;

  constructor(readonly seed: number, private readonly only: TerrainSampler) {}

  get sampler(): TerrainSampler { return this.only; }

  moveTo(): string | null { return null; }

  wants(): string[] { return []; }
}
