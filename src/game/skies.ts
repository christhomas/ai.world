import { WORLD } from '../core/config';
import type { TileWorld } from '../entities/entity';
import type { Player } from '../entities/player';
import type { IsoCamera } from '../render/camera';
import { SKY, onSkyIsland, skyIndex, type SkyIsland } from '../world/skyisland';

/**
 * Being up there.
 *
 * A sky island is additional geometry in the ordinary outdoor world rather than a scene of its
 * own, so going up is not entering a place the way a cave is: the chunks below carry on streaming
 * and drawing, and everything you can see over the rim is the real country. The only thing that
 * changes is what the hero's feet are on, which is why this is a `TileWorld` and a switch, and
 * nothing more.
 *
 * The rule this file exists to keep is that you can always get down. The way up is bought and can
 * be refused; the way down is free, is never refused, and is answered for from anywhere on the
 * island — being stranded on a rock in the sky with a bird that wants money is not a difficulty,
 * it is a lost save.
 */

/** How the hero is kept on the island. */
const ALOFT = {
  /**
   * How near the perch you have to be for the bird to take you off.
   *
   * Wider than the reach of anything on the ground. The consequence of missing a doorway is a
   * step to the left; the consequence of not finding the way off a sky island is the end of that
   * save, so this errs the other way on purpose.
   */
  PERCH_REACH: 5,
  /** And how near the loft's door you stand to talk to its keeper. */
  LOFT_REACH: 2.6,
} as const;

/** The ground of one sky island: a flat grid at cloud height, and nothing at all beyond its rim. */
export class SkyWorld implements TileWorld {
  constructor(readonly isle: SkyIsland) {}

  heightAt(x: number, z: number): number | null {
    const i = skyIndex(this.isle, x, z);
    if (i < 0) return null;
    const top = this.isle.top[i];
    // the stream is water like any other: you walk beside it, not down it
    if (Number.isNaN(top) || this.isle.water[i] > 0) return null;
    return top;
  }

  waterAt(x: number, z: number): number | null {
    const i = skyIndex(this.isle, x, z);
    if (i < 0) return null;
    return this.isle.water[i] > 0 ? this.isle.water[i] : null;
  }

  blocked(x: number, z: number): boolean {
    const i = skyIndex(this.isle, x, z);
    return i < 0 ? true : this.isle.blocked[i] === 1;
  }

  /** No roads up here: six houses round a spring do not need one. */
  isRoad(): boolean { return false; }
}

/** Everything the switch needs to move the hero between the ground and the clouds. */
export interface SkyContext {
  player: Player;
  iso: IsoCamera;
  /** The ground the hero walks on when they are not up here. */
  ground: TileWorld;
  flash: (message: string) => void;
  chime: () => void;
  discover: (name: string) => void;
  persist: () => void;
}

export class Skies {
  /** The island the hero is standing on, or null when they are on the ground. */
  private visiting: SkyIsland | null = null;
  /** Where the bird will put them back down, remembered from the crag they left. */
  private home: { x: number; z: number } | null = null;

  constructor(private readonly ctx: SkyContext, readonly isles: readonly SkyIsland[]) {}

  get aloft(): SkyIsland | null { return this.visiting; }

  /** The island by its anchor id, or null when this world has none there. */
  byId(id: string): SkyIsland | null {
    return this.isles.find((s) => s.site.id === id) ?? null;
  }

  /** Carry the hero up, from a crag they can be put back on. */
  fly(isle: SkyIsland, from: { x: number; z: number }): void {
    const { player, iso } = this.ctx;
    this.visiting = isle;
    this.home = { x: from.x, z: from.z };
    player.setWorld(new SkyWorld(isle));
    this.setDown(isle.perch);
    iso.target.set(isle.perch.x, isle.site.y, isle.perch.z);
    this.ctx.chime();
    this.ctx.discover(isle.name);
    this.ctx.flash(`${isle.name}. The water goes over the edge behind you.`);
    this.ctx.persist();
  }

  /**
   * Put the hero back on the ground.
   *
   * Never refused and never charged when no destination is named: that flight is the way home and
   * has to work whatever state anything else is in. `to` is the loft's business — a bird sent
   * somewhere across the country — and lands the hero there instead.
   *
   * If the crag they came from has been forgotten — a world reopened while they were up here, say
   * — the island underneath is the fallback, because it is land by construction and the hero's own
   * settling will find footing on it.
   */
  descend(to?: { x: number; z: number }, said = 'Down through the cloud, and the ground comes up to meet you.'): void {
    const isle = this.visiting;
    if (!isle) return;
    const { player, iso } = this.ctx;
    const back = to ?? this.home ?? { x: isle.site.x, z: isle.site.z };
    this.visiting = null;
    this.home = null;
    player.setWorld(this.ctx.ground);
    player.teleport(back.x, back.z);
    iso.target.set(back.x, 0, back.z);
    this.ctx.chime();
    this.ctx.flash(said);
    this.ctx.persist();
  }

  /** Reopening a world that was saved up in the clouds puts the hero back where they were. */
  restore(id: string): void {
    const isle = this.byId(id);
    if (isle) this.fly(isle, { x: isle.site.x, z: isle.site.z });
  }

  /** The id to write on the save, or null when the hero is on the ground. */
  save(): string | null { return this.visiting?.site.id ?? null; }

  /** Whether the hero is standing on the crag the bird uses. */
  atPerch(x: number, z: number): boolean {
    const isle = this.visiting;
    return isle !== null && Math.hypot(isle.perch.x - x, isle.perch.z - z) <= ALOFT.PERCH_REACH;
  }

  /** Whether they are at the loft's door. */
  atLoft(x: number, z: number): boolean {
    const isle = this.visiting;
    return isle !== null && Math.hypot(isle.loft.x - x, isle.loft.z - z) <= ALOFT.LOFT_REACH;
  }

  /** The island whose eagles are standing near enough to be asked, down at the foot of its fall. */
  calledFrom(x: number, z: number): SkyIsland | null {
    if (this.visiting) return null;
    return this.isles.find((s) => Math.hypot(s.crag.x - x, s.crag.z - z) <= SKY.CALL) ?? null;
  }

  /**
   * Called every frame.
   *
   * Two jobs, both of them about not losing the player. Walking to the foot of the fall names the
   * place, so somebody who has found the one way up is told they have found it rather than having
   * to guess that a keypress does anything here.
   *
   * And the rim is a wall — `heightAt` is null past it, so walking off is refused the way walking
   * into the sea is — but a knock-back, a shove or a teleport from anywhere else in the game does
   * not ask permission, and one of those putting the hero over the side would drop them out of the
   * world entirely. So the island checks, every frame, that whoever is standing on it still is.
   */
  update(): void {
    const { player } = this.ctx;
    const isle = this.visiting;
    if (!isle) {
      // the falls get a name of their own, so finding the bottom of them and reaching the top are
      // two separate discoveries — which is what they are
      const called = this.calledFrom(player.x, player.z);
      if (called) this.ctx.discover(`${called.name} Falls`);
      return;
    }
    if (onSkyIsland(isle, player.x, player.z) && player.y > isle.site.y - WORLD.STEP * 3) return;
    this.setDown(isle.perch);
    this.ctx.flash('The wind puts you back on the crag.');
  }

  /** Stand the hero on a tile of this island, with the ground found before the first frame. */
  private setDown(at: { x: number; z: number }): void {
    const isle = this.visiting;
    if (!isle) return;
    const { player } = this.ctx;
    player.teleport(at.x, at.z);
    const i = skyIndex(isle, at.x, at.z);
    player.entity.y = i >= 0 && !Number.isNaN(isle.top[i]) ? isle.top[i] : isle.site.y;
  }
}
