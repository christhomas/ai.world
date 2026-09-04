import { WORLD } from '../core/config';
import type { TileWorld } from '../entities/entity';
import type { Player } from '../entities/player';

/** What a boat costs and how it handles. */
export const BOAT = {
  PRICE: 220,
  /** Tiles per second under sail: quicker than walking, slower than a horse at gallop. */
  SPEED: 7.5,
  /** How fast the bow comes round, radians per second. */
  TURN: 2.4,
  /** How close to the boat you must be to climb aboard. */
  REACH: 3.2,
  /** Seconds spent in the water after being thrown out of the boat. */
  OVERBOARD: 2.4,
  /** The boat floats this far below the water line. */
  DRAFT: 0.12,
} as const;

export interface BoatSave {
  x: number;
  z: number;
  yaw: number;
}

/**
 * A boat you own and steer. The sea is everything that is not walkable land, so sailing is simply
 * the inverse of walking: the hull may cross water and shallow seabed, and must stop at a shore.
 */
export class Sailing {
  x = 0;
  z = 0;
  yaw = 0;
  sailing = false;
  private owned = false;
  /** Seconds left treading water after being thrown out of the boat, 0 when aboard. */
  private overboardFor = 0;

  /** True while the hero is in the water beside the hull rather than in it. */
  get overboard(): boolean { return this.overboardFor > 0; }

  /**
   * Thrown out of the boat — by a whale coming down on it, or anything else that hits hard
   * enough. The boat stays where it is; the hero has to climb back in, which takes a moment.
   */
  throwOverboard(): void {
    if (!this.sailing) return;
    this.overboardFor = BOAT.OVERBOARD;
  }

  get bought(): boolean { return this.owned; }

  /** Buy a boat, moored at the spot given. */
  buy(x: number, z: number, yaw: number): void {
    this.owned = true;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
  }

  near(x: number, z: number): boolean {
    return this.owned && Math.hypot(this.x - x, this.z - z) < BOAT.REACH;
  }

  board(): void { if (this.owned) this.sailing = true; }

  /**
   * Off the boat, wherever you have ended up — dragged ashore after a knock-out, say. The boat
   * stays moored where it was, which is where you will have to go back to for it.
   */
  abandon(): void {
    this.sailing = false;
    this.overboardFor = 0;
  }

  /**
   * Step ashore. Returns the tile to stand on, or null when there is no land within reach,
   * so you cannot strand yourself in open water.
   */
  land(world: TileWorld): [number, number] | null {
    for (let r = 1; r <= 3; r += 0.5) {
      for (let a = 0; a < 16; a++) {
        const angle = (a / 16) * Math.PI * 2;
        const x = this.x + Math.cos(angle) * r, z = this.z + Math.sin(angle) * r;
        if (world.heightAt(x, z) !== null && !world.blocked(x, z)) {
          this.sailing = false;
          return [x, z];
        }
      }
    }
    return null;
  }

  /** Can the hull sit here? Open sea and shallows yes, dry land no. */
  navigable(world: TileWorld, x: number, z: number): boolean {
    return world.heightAt(x, z) === null;
  }

  /**
   * Steer: forward and back along the bow, left and right swinging it round. The hero rides along,
   * so the camera follows the boat exactly as it follows a walk.
   */
  update(dt: number, input: { forward: number; turn: number }, world: TileWorld, player: Player): void {
    if (!this.sailing) return;
    if (this.overboardFor > 0) {
      // in the water beside the hull: no steering until you have hauled yourself back aboard
      this.overboardFor = Math.max(0, this.overboardFor - dt);
      const bob = Math.sin(this.overboardFor * 7) * 0.06;
      player.entity.x = this.x + Math.cos(this.yaw + Math.PI / 2) * 1.1;
      player.entity.z = this.z - Math.sin(this.yaw + Math.PI / 2) * 1.1;
      player.entity.y = WORLD.WATER_Y - 0.3 + bob;
      player.entity.yaw = this.yaw;
      player.entity.walk = 0.35;
      return;
    }
    this.yaw += input.turn * BOAT.TURN * dt;
    if (input.forward !== 0) {
      const step = input.forward * BOAT.SPEED * dt;
      const nx = this.x + Math.cos(this.yaw) * step;
      const nz = this.z - Math.sin(this.yaw) * step;
      // slide along a coast rather than sticking to it
      if (this.navigable(world, nx, nz)) { this.x = nx; this.z = nz; }
      else if (this.navigable(world, nx, this.z)) this.x = nx;
      else if (this.navigable(world, this.x, nz)) this.z = nz;
    }
    player.entity.x = this.x;
    player.entity.z = this.z;
    player.entity.y = 0.55;
    player.entity.yaw = this.yaw;
    player.entity.walk = 0;
  }

  toJSON(): BoatSave | null {
    return this.owned ? { x: this.x, z: this.z, yaw: this.yaw } : null;
  }

  static from(json: BoatSave | null | undefined): Sailing {
    const sailing = new Sailing();
    if (json) sailing.buy(json.x, json.z, json.yaw);
    return sailing;
  }
}
