import type { Rng } from '../core/rng';
import type { AnimalKind } from './animals';
import type { ShopType } from '../world/structures';

export type EntityRole = 'none' | 'villager' | 'congregation' | 'shopkeeper';

/** What creatures need to know about the ground. Implemented by ChunkManager. */
export interface TileWorld {
  /** Walkable ground height at (x,z); null when unloaded, sea, or river/lake. */
  heightAt(x: number, z: number): number | null;
  /** Water surface height if (x,z) is a river/lake tile, else null. */
  waterAt(x: number, z: number): number | null;
  /** True when a tree / boulder / cactus occupies the tile. */
  blocked(x: number, z: number): boolean;
  isRoad(x: number, z: number): boolean;
}

export type EntityState = 'idle' | 'walk' | 'graze' | 'flee' | 'hop' | 'fly' | 'swim';

/** Max height difference a walker can step across; terrace steps (0.5) are walls, ramps are fine. */
export const STEP_LIMIT = 0.32;

export class Herd {
  members: Entity[] = [];
  timer = 0;
  /** Free-form label substituted into dialogue as {village}. */
  tag = '';
  /** Fliers circle this point. */
  angle = 0;
  baseY = 0;

  constructor(
    readonly kind: AnimalKind,
    public ax: number,
    public az: number,
    readonly homeX: number,
    readonly homeZ: number,
    readonly leash: number,
  ) {}
}

export class Entity {
  y = 0;
  yaw = 0;
  /** Renderer slot inside the kind pool, -1 when not drawn. */
  slot = -1;
  phase: number;
  walk = 0;
  headPitch = 0;
  flap = 0;
  bobY = 0;
  state: EntityState = 'idle';
  timer: number;
  tx: number;
  tz: number;
  fleeX = 0;
  fleeZ = 0;
  readonly tints: number[];
  readonly name: string;
  role: EntityRole = 'none';
  shop: ShopType | null = null;

  constructor(
    readonly kind: AnimalKind,
    public x: number,
    public z: number,
    readonly herd: Herd,
    readonly chunkKey: string,
    rng: Rng,
  ) {
    this.tints = kind.palettes[Math.floor(rng() * kind.palettes.length)];
    this.name = kind.names[Math.floor(rng() * kind.names.length)];
    this.phase = rng() * 6.28;
    this.timer = rng() * 2;
    this.tx = x;
    this.tz = z;
  }

  line(rng: Rng): string {
    const raw = this.kind.lines[Math.floor(rng() * this.kind.lines.length)];
    return raw.replace('{village}', this.herd.tag || 'this village');
  }
}

/** Can this kind stand at (x,z), stepping from height `fromY` (or anywhere if undefined)? */
export function canStand(world: TileWorld, kind: AnimalKind, x: number, z: number, fromY?: number): boolean {
  if (kind.behaviour === 'swim') return world.waterAt(x, z) !== null;
  if (kind.behaviour === 'fly') return true;
  const h = world.heightAt(x, z);
  if (h === null || world.blocked(x, z)) return false;
  if (kind.behaviour === 'travel' && !world.isRoad(x, z)) return false;
  if (fromY !== undefined && Math.abs(h - fromY) > STEP_LIMIT) return false;
  return true;
}

export function groundY(world: TileWorld, kind: AnimalKind, x: number, z: number): number | null {
  if (kind.behaviour === 'swim') return world.waterAt(x, z);
  return world.heightAt(x, z);
}

/** Yaw that makes a +x-facing rig look along (vx, vz). */
export function yawFor(vx: number, vz: number): number {
  return Math.atan2(-vz, vx);
}

function turnToward(current: number, target: number, maxDelta: number): number {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  if (d > maxDelta) d = maxDelta;
  if (d < -maxDelta) d = -maxDelta;
  return current + d;
}

/** Try to move by (dx,dz); slides along obstacles. Returns true if any movement happened. */
export function tryMove(world: TileWorld, e: Entity, dx: number, dz: number): boolean {
  const k = e.kind;
  const attempts: Array<[number, number]> = [[dx, dz], [dx, 0], [0, dz]];
  for (const [mx, mz] of attempts) {
    if (mx === 0 && mz === 0) continue;
    const nx = e.x + mx, nz = e.z + mz;
    if (!canStand(world, k, nx, nz, e.y)) continue;
    e.x = nx; e.z = nz;
    return true;
  }
  return false;
}

interface Ctx { world: TileWorld; rng: Rng; playerX: number; playerZ: number; }

function pickTarget(e: Entity, ctx: Ctx, radius: number): boolean {
  const h = e.herd;
  for (let i = 0; i < 8; i++) {
    const a = ctx.rng() * Math.PI * 2;
    const r = 0.5 + ctx.rng() * radius;
    const tx = h.ax + Math.cos(a) * r, tz = h.az + Math.sin(a) * r;
    if (!canStand(ctx.world, e.kind, tx, tz, e.y)) continue;
    e.tx = tx; e.tz = tz;
    return true;
  }
  return false;
}

/** Advance a herd anchor now and then, so groups drift instead of standing on one spot forever. */
export function updateHerd(h: Herd, dt: number, ctx: Ctx): void {
  h.timer -= dt;
  if (h.timer > 0) return;
  h.timer = 8 + ctx.rng() * 10;
  const wander = h.kind.behaviour === 'prowl' ? 9 : 5;
  for (let i = 0; i < 6; i++) {
    const a = ctx.rng() * Math.PI * 2;
    const nx = h.ax + Math.cos(a) * wander, nz = h.az + Math.sin(a) * wander;
    if (Math.hypot(nx - h.homeX, nz - h.homeZ) > h.leash) continue;
    if (!canStand(ctx.world, h.kind, nx, nz)) continue;
    h.ax = nx; h.az = nz;
    return;
  }
}

export function updateEntity(e: Entity, dt: number, ctx: Ctx): void {
  const k = e.kind;
  const { world } = ctx;
  e.timer -= dt;

  if (k.behaviour === 'fly') {
    updateFlier(e, dt, ctx);
    return;
  }

  // prey run from the player
  const pdx = e.x - ctx.playerX, pdz = e.z - ctx.playerZ;
  const pd2 = pdx * pdx + pdz * pdz;
  if (k.timid && e.state !== 'flee' && pd2 < 3.5 * 3.5) {
    e.state = 'flee';
    e.timer = 1.5 + ctx.rng() * 1.5;
    const len = Math.sqrt(pd2) || 1;
    e.fleeX = pdx / len; e.fleeZ = pdz / len;
    e.headPitch = 0;
  }

  const hopper = k.behaviour === 'hop';
  let moving = false;
  let speed = 0;

  switch (e.state) {
    case 'idle':
      e.walk = 0;
      e.headPitch += (0 - e.headPitch) * Math.min(1, dt * 6);
      if (e.timer <= 0) {
        const r = ctx.rng();
        if (k.behaviour === 'graze' && r < 0.45) {
          e.state = 'graze'; e.timer = 2 + ctx.rng() * 4;
        } else if (k.behaviour === 'swim' && r < 0.3) {
          e.state = 'graze'; e.timer = 1 + ctx.rng() * 2;
        } else {
          const radius = k.behaviour === 'prowl' ? 8 : k.behaviour === 'travel' ? 7 : hopper ? 2.5 : 4;
          if (pickTarget(e, ctx, radius)) {
            e.state = hopper ? 'hop' : 'walk';
            e.timer = hopper ? 0.5 : 6;
          } else {
            e.timer = 1 + ctx.rng() * 2;
          }
        }
      }
      break;

    case 'graze':
      e.walk = 0;
      e.headPitch += (-0.7 - e.headPitch) * Math.min(1, dt * 4);
      if (e.timer <= 0) { e.state = 'idle'; e.timer = 0.5 + ctx.rng() * 1.5; }
      break;

    case 'walk':
    case 'flee':
    case 'hop': {
      let dx: number, dz: number;
      if (e.state === 'flee') {
        dx = e.fleeX; dz = e.fleeZ;
        speed = k.runSpeed;
      } else {
        dx = e.tx - e.x; dz = e.tz - e.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.25 || e.timer <= 0) {
          e.state = 'idle'; e.timer = hopper ? 0.4 + ctx.rng() * 1.5 : 1 + ctx.rng() * 3;
          e.bobY = 0;
          break;
        }
        dx /= dist; dz /= dist;
        speed = hopper ? k.runSpeed * 0.8 : k.speed;
      }
      const stepLen = speed * dt;
      const desiredYaw = yawFor(dx, dz);
      e.yaw = turnToward(e.yaw, desiredYaw, dt * 8);
      moving = tryMove(world, e, dx * stepLen, dz * stepLen);
      if (!moving) {
        if (e.state === 'flee') {
          // bounce off the obstacle at a new angle
          const a = Math.atan2(e.fleeZ, e.fleeX) + (ctx.rng() < 0.5 ? 1.2 : -1.2);
          e.fleeX = Math.cos(a); e.fleeZ = Math.sin(a);
        } else {
          e.state = 'idle'; e.timer = 0.5 + ctx.rng();
          e.bobY = 0;
        }
      }
      if (e.state === 'flee' && e.timer <= 0) { e.state = 'idle'; e.timer = 1 + ctx.rng(); e.bobY = 0; }
      break;
    }
    default:
      e.state = 'idle';
  }

  // animation drivers
  if (moving) {
    e.walk += (1 - e.walk) * Math.min(1, dt * 10);
    e.phase += dt * (hopper ? 14 : 4 + speed * 3);
    if (hopper) e.bobY = Math.abs(Math.sin(e.phase * 0.5)) * 0.35;
  } else {
    e.walk += (0 - e.walk) * Math.min(1, dt * 10);
    e.phase += dt * 1.5;
    e.bobY += (0 - e.bobY) * Math.min(1, dt * 8);
  }

  const gy = groundY(world, k, e.x, e.z);
  if (gy !== null) e.y += (gy - e.y) * Math.min(1, dt * 12);
}

function updateFlier(e: Entity, dt: number, ctx: Ctx): void {
  const h = e.herd;
  const k = e.kind;
  const radius = 4 + (e.slot % 3) * 1.5;
  h.angle += dt * (k.speed / radius);
  const a = h.angle + (e.slot % 3) * 2.1;
  const nx = h.ax + Math.cos(a) * radius, nz = h.az + Math.sin(a) * radius;
  const vx = nx - e.x, vz = nz - e.z;
  e.x = nx; e.z = nz;
  e.yaw = yawFor(vx, vz);
  e.phase += dt * 5;
  e.flap = 1;
  e.walk = 0;
  const ground = ctx.world.heightAt(h.ax, h.az);
  if (ground !== null) h.baseY = ground;
  const target = h.baseY + (k.altitude ?? 7) + Math.sin(e.phase * 0.3) * 0.4;
  e.y += (target - e.y) * Math.min(1, dt * 2);
  e.state = 'fly';
}
