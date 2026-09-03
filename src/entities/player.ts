import type { Input } from '../core/input';
import type { IsoCamera } from '../render/camera';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { Entity, Herd, canStand, tryMove, yawFor, type TileWorld } from './entity';
import type { EntityRenderer } from './pool';

/** The hero: an entity driven by the keyboard, with the camera trailing it. */
export class Player {
  readonly entity: Entity;
  /** 'follow' = WASD moves the hero and the camera tracks; 'free' = the old fly-around camera. */
  mode: 'follow' | 'free' = 'follow';
  private placed = false;

  constructor(private readonly world: TileWorld, renderer: EntityRenderer, x: number, z: number) {
    const kind = KINDS.hero;
    const herd = new Herd(kind, x, z, x, z, 0);
    this.entity = new Entity(kind, x, z, herd, 'player', mulberry32(1));
    renderer.add(this.entity);
  }

  get x(): number { return this.entity.x; }
  get z(): number { return this.entity.z; }
  get y(): number { return this.entity.y; }

  /** First frames: the spawn chunk may not be loaded yet; snap to ground once it is. */
  private settle(): boolean {
    const e = this.entity;
    if (this.placed) return true;
    const h = this.world.heightAt(e.x, e.z);
    if (h === null) {
      // look for the nearest standable tile in a widening ring
      for (let r = 1; r < 12; r++) {
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const x = e.x + Math.cos(ang) * r, z = e.z + Math.sin(ang) * r;
          if (canStand(this.world, e.kind, x, z)) { e.x = x; e.z = z; e.y = this.world.heightAt(x, z)!; this.placed = true; return true; }
        }
      }
      return false;
    }
    if (this.world.blocked(e.x, e.z)) { e.x += 1; return false; }
    e.y = h;
    this.placed = true;
    return true;
  }

  update(input: Input, iso: IsoCamera, dt: number, frozen = false): void {
    const e = this.entity;
    if (!this.settle()) return;
    if (this.mode !== 'follow' || frozen) { e.walk += (0 - e.walk) * Math.min(1, dt * 10); e.phase += dt * 1.5; return; }

    const { fx, fz, rx, rz } = iso.basis();
    let dx = 0, dz = 0;
    if (input.isDown('w', 'arrowup')) { dx += fx; dz += fz; }
    if (input.isDown('s', 'arrowdown')) { dx -= fx; dz -= fz; }
    if (input.isDown('a', 'arrowleft')) { dx -= rx; dz -= rz; }
    if (input.isDown('d', 'arrowright')) { dx += rx; dz += rz; }
    const len = Math.hypot(dx, dz);
    let moved = false;
    if (len > 0) {
      dx /= len; dz /= len;
      const step = e.kind.speed * dt;
      e.yaw = yawFor(dx, dz);
      moved = tryMove(this.world, e, dx * step, dz * step);
    }
    if (moved) {
      e.walk += (1 - e.walk) * Math.min(1, dt * 12);
      e.phase += dt * 14;
    } else {
      e.walk += (0 - e.walk) * Math.min(1, dt * 12);
      e.phase += dt * 1.5;
    }
    const h = this.world.heightAt(e.x, e.z);
    if (h !== null) e.y += (h - e.y) * Math.min(1, dt * 14);

    // camera trails the hero
    const k = Math.min(1, dt * 7);
    iso.target.x += (e.x - iso.target.x) * k;
    iso.target.z += (e.z - iso.target.z) * k;
    iso.target.y += (e.y - iso.target.y) * k;
  }
}
