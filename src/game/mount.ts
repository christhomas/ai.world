import { mulberry32, type Rng } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd, canStand, yawFor, type TileWorld } from '../entities/entity';
import type { EntityRenderer } from '../entities/pool';
import type { Player } from '../entities/player';

/** What a horse is worth, and how much faster it carries you. */
export const HORSE = {
  PRICE: 140,
  SPEED: 2.1,
  /** How high the saddle sits above the horse's feet. */
  SADDLE: 0.98,
  /** Reach for buying, mounting and dismounting: generous, because horses shift about. */
  REACH: 3.4,
} as const;

export interface HorseSave {
  name: string;
  x: number;
  z: number;
  palette: number;
}

/**
 * Your horse: bought from a wild herd, tied up wherever you left it, and ridden by standing on it.
 * The horse is an ordinary entity; riding simply moves it under the hero and stops it thinking
 * for itself.
 */
export class Mount {
  entity: Entity | null = null;
  riding = false;
  private saved: HorseSave | null = null;

  constructor(private readonly rng: Rng) {}

  get name(): string { return this.entity?.name ?? this.saved?.name ?? 'your horse'; }
  get owned(): boolean { return this.saved !== null; }

  /** Buy a horse: it appears saddled and waiting at the spot given. */
  buy(x: number, z: number, world: TileWorld, renderer: EntityRenderer): string {
    const kind = KINDS.horse;
    const names = kind.names;
    const name = names[Math.floor(this.rng() * names.length)];
    this.saved = { name, x, z, palette: Math.floor(this.rng() * 0xffffff) };
    this.entity = null;
    this.restore(world, renderer);
    return name;
  }

  /** Put the horse back in the world after a load, or when the hero returns outdoors. */
  restore(world: TileWorld, renderer: EntityRenderer): void {
    if (!this.saved || this.entity) return;
    const kind = KINDS.horse;
    const herd = new Herd(kind, this.saved.x, this.saved.z, this.saved.x, this.saved.z, 0);
    // the palette seeds the rig, so the same horse always comes back the same colour
    const horse = new Entity(kind, this.saved.x, this.saved.z, herd, 'mount', mulberry32(this.saved.palette));
    horse.role = 'mount';
    horse.timer = 1e9;
    horse.y = world.heightAt(horse.x, horse.z) ?? 0;
    renderer.add(horse);
    this.entity = horse;
  }

  /** Leave the horse behind when the hero goes somewhere a horse cannot follow. */
  stable(renderer: EntityRenderer): void {
    if (!this.entity) return;
    this.remember();
    renderer.remove(this.entity);
    this.entity = null;
    this.riding = false;
  }

  private remember(): void {
    if (this.entity && this.saved) {
      this.saved.x = this.entity.x;
      this.saved.z = this.entity.z;
    }
  }

  near(x: number, z: number): boolean {
    return this.entity !== null && Math.hypot(this.entity.x - x, this.entity.z - z) < HORSE.REACH;
  }

  mount(player: Player): void {
    if (!this.entity) return;
    this.riding = true;
    player.entity.y = this.entity.y + HORSE.SADDLE;
  }

  dismount(player: Player, world: TileWorld): void {
    if (!this.entity) return;
    this.riding = false;
    // step off to a tile the hero can actually stand on
    const spots: Array<[number, number]> = [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]];
    for (const [dx, dz] of spots) {
      const x = this.entity.x + dx, z = this.entity.z + dz;
      if (!canStand(world, player.entity.kind, x, z)) continue;
      player.teleport(x, z);
      break;
    }
    this.remember();
  }

  /** While riding, the horse is wherever the hero is, facing where they face. */
  update(player: Player, world: TileWorld): void {
    const horse = this.entity;
    if (!horse) return;
    if (!this.riding) {
      horse.walk += (0 - horse.walk) * 0.1;
      return;
    }
    const ground = world.heightAt(player.x, player.z);
    horse.x = player.x;
    horse.z = player.z;
    if (ground !== null) horse.y = ground;
    horse.yaw = player.entity.yaw;
    horse.walk = player.entity.walk;
    horse.phase = player.entity.phase * 0.6;
    player.entity.y = horse.y + HORSE.SADDLE;
    player.entity.bobY = 0;
  }

  toJSON(): HorseSave | null {
    this.remember();
    return this.saved;
  }

  static from(json: HorseSave | null | undefined, rng: Rng): Mount {
    const mount = new Mount(rng);
    if (json) mount.saved = { ...json };
    return mount;
  }

  /** Name a wild horse being offered for sale. */
  offer(): string {
    return ['a steady bay', 'a rangy grey', 'a stubborn chestnut', 'a bright-eyed roan'][Math.floor(this.rng() * 4)];
  }
}

export { yawFor };
