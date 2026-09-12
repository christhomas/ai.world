import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import type { EntityManager } from '../entities/manager';
import type { TerrainSampler } from '../world/terrain';

/**
 * What follows a boat in deep water. Nothing is generated out in the open sea — no land, no
 * chunks, no tiles — so the hunters cannot be spawned by the world the way a herd of deer is.
 * They are put there deliberately, around whoever has sailed out far enough to be worth a look.
 *
 * Once they exist the creatures do their own hunting: circling, closing, and picking their moment.
 * This only decides whether there is anything out there at all.
 */

export const HUNT = {
  /** Water this far from the nearest road is far enough from help. */
  DEEP: 22,
  /** How long a stretch of deep-water sailing before something notices, in seconds. */
  NOTICE: [8, 26] as const,
  /**
   * And how much of that a swimmer gets.
   *
   * A man in the water is noticed sooner than a hull is, which is both true and the thing that makes
   * swimming a decision rather than a shortcut. It is a fraction rather than a second figure so the
   * two can never drift apart: whatever a boat's grace is worth, a swimmer's is a third of it.
   */
  SWIMMER_SHARE: 0.34,
  /** How far off they surface, and how far out before they lose interest and go. */
  ARRIVE: 15,
  LOSE_INTEREST: 40,
  /** Orcas are rarer than sharks, and worse. */
  ORCA_SHARE: 0.25,
} as const;

export class SeaHunt {
  /** Seconds of deep water sailed since the last pack showed up. */
  private sailed = 0;
  private nextAt = 0;
  private hunting = false;

  constructor(private readonly seed: number) {
    this.nextAt = this.roll(0);
  }

  get active(): boolean { return this.hunting; }

  /**
   * Called every frame while above ground.
   * @returns the label of a pack that has just arrived, for a word of warning
   */
  update(
    dt: number,
    /**
     * Out over deep water, by boat or by arm.
     *
     * It was `sailing` when a boat was the only way to be out there. A hero who can swim is out
     * there too, and rather more interesting to whatever is down below — so what this asks now is
     * whether anybody is on the water at all, and `swimming` says which way.
     */
    afloat: boolean,
    x: number,
    z: number,
    sampler: TerrainSampler,
    entities: EntityManager,
    swimming = false,
  ): string | null {
    const here = sampler.probe(x, z);
    const deep = !here.land && here.roadDist > HUNT.DEEP;
    // a swimmer uses up his grace faster than a boat does, which is the whole of why an island on
    // the horizon is a gamble rather than an errand
    const wear = swimming ? dt / HUNT.SWIMMER_SHARE : dt;

    if (this.hunting) {
      // ashore, or in the shallows, or nothing left of the pack: they go
      const gone = entities.packSize === 0;
      if (!afloat || !deep || gone) {
        entities.despawnPack();
        this.hunting = false;
        this.sailed = 0;
        this.nextAt = this.roll(this.sailed);
      }
      return null;
    }

    if (!afloat || !deep) {
      this.sailed = Math.max(0, this.sailed - dt);
      return null;
    }

    this.sailed += wear;
    if (this.sailed < this.nextAt) return null;

    const rng = mulberry32(derive(this.seed, SALT.HUNT) ^ Math.floor(x * 31 + z * 131));
    const kind = rng() < HUNT.ORCA_SHARE ? 'orca' : 'shark';
    const pack = entities.spawnPack(kind, x, z, HUNT.ARRIVE, Math.floor(rng() * 0xffffff));
    if (pack.length === 0) return null;      // no water to put them in after all

    this.hunting = true;
    this.sailed = 0;
    return kind === 'orca' ? 'Orcas' : 'Sharks';
  }

  /** How long the next stretch of open water is before something takes an interest. */
  private roll(at: number): number {
    const rng = mulberry32(derive(this.seed, SALT.HUNT) ^ Math.floor(at * 1000));
    const [soonest, latest] = HUNT.NOTICE;
    return soonest + rng() * (latest - soonest);
  }
}
