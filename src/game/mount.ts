import { mulberry32, type Rng } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd, canStand, yawFor, type TileWorld } from '../entities/entity';
import type { EntityRenderer } from '../render/entities';
import type { Player } from '../entities/player';
import { breedOf, type Breed } from './stables';
import { FUR, type Carcass, type CarriedCarcass } from './furs';

/** What a horse is worth, and how much faster it carries you. */
export const HORSE = {
  PRICE: 140,
  SPEED: 2.1,
  /** How high the saddle sits above the horse's feet. */
  SADDLE: 0.98,
  /** Reach for buying, mounting and dismounting: generous, because horses shift about. */
  REACH: 3.4,
  /**
   * How much of the hero's stride cycle the horse's legs go through. A horse covers the same
   * ground in fewer, longer strides than a person, so running its legs at the hero's rate makes
   * it look like a large dog.
   */
  GAIT: 0.6,
  /**
   * How quickly a horse left standing stops moving its legs, as a share of what is left each
   * frame. Eased rather than cut, so a horse you step off does not freeze mid-stride.
   */
  SETTLES: 0.1,
} as const;

export interface HorseSave {
  name: string;
  x: number;
  z: number;
  palette: number;
  /** Which animal it is. Absent on saves written before there was a choice, which means a horse. */
  breed?: string;
  /** One whole body in the cart tied to this horse, never in the hero's pack. */
  cargo?: CarriedCarcass;
}

/**
 * Your horse: bought from a wild herd, tied up wherever you left it, and ridden by standing on it.
 * The horse is an ordinary entity; riding simply moves it under the hero and stops it thinking
 * for itself.
 */
export class Mount {
  entity: Entity | null = null;
  /** Kept only so the mount can clear its rider's carrier when it leaves the world. */
  private rider: Player | null = null;
  private saved: HorseSave | null = null;
  /** Undefined outside a probe loan; null means the player originally owned no horse. */
  private beforeLoan: HorseSave | null | undefined;

  /** The traversal carrier is the one source of truth for whether this horse is being ridden. */
  get riding(): boolean {
    return this.rider !== null && this.entity !== null && this.rider.entity.mounted === this.entity.kind;
  }

  constructor(private readonly rng: Rng) {}

  get name(): string { return this.entity?.name ?? this.saved?.name ?? 'your horse'; }
  get owned(): boolean { return this.saved !== null; }
  /** What you bought. A save from before there were camels and goats is a horse, as it always was. */
  get breed(): Breed { return breedOf(this.saved?.breed); }
  get cargo(): CarriedCarcass | null { return this.saved?.cargo ?? null; }

  /** The cart has one slot; both hunter and body must be at the parked horse. */
  canLoad(body: Carcass, hasCart: boolean, x: number, z: number): boolean {
    return !!this.saved && !!this.entity && this.breed.id === 'horse' && hasCart && !this.riding &&
      !this.saved.cargo && body.left > 0 &&
      this.near(x, z) && Math.hypot(body.x - x, body.z - z) < FUR.REACH &&
      Math.hypot(body.x - this.entity.x, body.z - this.entity.z) < HORSE.REACH;
  }

  load(body: Carcass, hasCart: boolean, x: number, z: number): boolean {
    if (!this.canLoad(body, hasCart, x, z)) return false;
    this.saved!.cargo = { kind: body.kind, left: body.left };
    return true;
  }

  /** At the parked horse, lift the body back out to carry it where wheels cannot go. */
  unload(x: number, z: number): CarriedCarcass | null {
    if (!this.saved?.cargo || this.riding || !this.near(x, z)) return null;
    const body = this.saved.cargo;
    delete this.saved.cargo;
    return body;
  }

  /** Cart cargo spoils just as a body on the ground does. */
  ageCargo(dt: number, hasCart = true): boolean {
    if (!this.saved?.cargo) return false;
    if (!hasCart) { delete this.saved.cargo; return true; }
    this.saved.cargo.left -= dt;
    if (this.saved.cargo.left > 0) return false;
    delete this.saved.cargo;
    return true;
  }

  /** Buy a horse: it appears saddled and waiting at the spot given. */
  buy(x: number, z: number, world: TileWorld, renderer: EntityRenderer, breed: Breed = breedOf('horse')): string {
    if (this.entity) {
      this.leaveRider();
      renderer.remove(this.entity);
    }
    const kind = KINDS[breed.id] ?? KINDS.horse;
    const names = kind.names;
    const name = names[Math.floor(this.rng() * names.length)];
    this.saved = { name, x, z, palette: Math.floor(this.rng() * 0xffffff), breed: breed.id };
    this.entity = null;
    this.restore(world, renderer);
    return name;
  }

  /** A probe may try several mounts without replacing the player's original horse or cargo. */
  borrow(x: number, z: number, world: TileWorld, renderer: EntityRenderer, breed: Breed = breedOf('horse')): void {
    if (this.beforeLoan === undefined) this.beforeLoan = this.toJSON();
    try {
      this.stable(renderer);
      this.buy(x, z, world, renderer, breed);
    } catch (error) {
      this.returnBorrowed(world, renderer);
      throw error;
    }
  }

  /** Idempotent cleanup, including a loan taken when the player owned nothing. */
  returnBorrowed(world: TileWorld, renderer: EntityRenderer): void {
    if (this.beforeLoan === undefined) return;
    this.stable(renderer);
    this.saved = this.beforeLoan;
    this.beforeLoan = undefined;
    this.restore(world, renderer);
  }

  /** Put the horse back in the world after a load, or when the hero returns outdoors. */
  restore(world: TileWorld, renderer: EntityRenderer): void {
    if (!this.saved || this.entity) return;
    const kind = KINDS[this.saved.breed ?? 'horse'] ?? KINDS.horse;
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
    this.leaveRider();
    this.remember();
    renderer.remove(this.entity);
    this.entity = null;
  }

  /** Putting a rider down always restores their own traversal rules. */
  private leaveRider(): void {
    if (this.rider) this.rider.entity.mounted = null;
    this.rider = null;
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
    // A rider can stand on a ledge the horse cannot. Board where the parked horse stands;
    // moving the horse under the rider on the next frame would strand both on that ledge.
    player.walkTo();
    player.teleport(this.entity.x, this.entity.z);
    this.rider = player;
    // and from here it is the horse that decides where he may go, not his own legs: a hero paddles
    // and a horse does not, so the sea stops being a road the moment he is on one. `whatCarriesHim`
    player.entity.mounted = this.entity.kind;
    player.entity.y = this.entity.y + this.breed.saddle;
  }

  dismount(player: Player, world: TileWorld): void {
    if (!this.entity) return;
    this.leaveRider();
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
      horse.walk += (0 - horse.walk) * HORSE.SETTLES;
      return;
    }
    const ground = world.heightAt(player.x, player.z);
    horse.x = player.x;
    horse.z = player.z;
    if (ground !== null) horse.y = ground;
    horse.yaw = player.entity.yaw;
    horse.walk = player.entity.walk;
    horse.phase = player.entity.phase * HORSE.GAIT;
    player.entity.y = horse.y + this.breed.saddle;
    player.entity.bobY = 0;
  }

  toJSON(): HorseSave | null {
    this.remember();
    // Autosave during a played check must not persist its temporary purchase.
    const saved = this.beforeLoan === undefined ? this.saved : this.beforeLoan;
    return saved ? { ...saved, cargo: saved.cargo ? { ...saved.cargo } : undefined } : null;
  }

  static from(json: HorseSave | null | undefined, rng: Rng): Mount {
    const mount = new Mount(rng);
    if (json) mount.saved = { ...json, cargo: json.cargo ? { ...json.cargo } : undefined };
    return mount;
  }

  /** Name a wild horse being offered for sale. */
  offer(): string {
    return ['a steady bay', 'a rangy grey', 'a stubborn chestnut', 'a bright-eyed roan'][Math.floor(this.rng() * 4)];
  }
}

export { yawFor };
