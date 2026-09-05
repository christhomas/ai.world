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
  private hop = 0;
  private static readonly HOP_TIME = 0.28;
  /** While true the hero is carried (ferry): no walking, no ground snapping, camera still follows. */
  riding = false;
  /** Multiplier on walking pace: a horse carries you faster. */
  speedScale = 1;
  /**
   * A stroll, as a share of the hero's running pace. Under the motion file's `running.from` of
   * 0.55, so ambling is genuinely a different gait and not just a slower run.
   */
  static readonly STROLL = 0.42;

  constructor(private world: TileWorld, renderer: EntityRenderer, x: number, z: number) {
    const kind = KINDS.hero;
    const herd = new Herd(kind, x, z, x, z, 0);
    this.entity = new Entity(kind, x, z, herd, 'player', mulberry32(1));
    renderer.add(this.entity);
  }

  /** Height the hero can step across; the rope item raises it. */
  set climb(v: number) { (this.entity.kind as { climb?: number }).climb = v; }

  /** Swap the ground the hero walks on (overworld ↔ dungeon). */
  setWorld(world: TileWorld): void { this.world = world; this.placed = false; }

  /**
   * Shove the hero, for a blow that lands on them.
   *
   * It goes through the same walkability check as walking does, so being knocked back never puts
   * you through a wall or off a terrace you could not have stepped off yourself.
   */
  shove(dx: number, dz: number): void {
    const e = this.entity;
    const nx = e.x + dx, nz = e.z + dz;
    if (!canStand(this.world, e.kind, nx, nz, e.y)) return;
    e.x = nx;
    e.z = nz;
    this.placed = false;                 // let the ground be found again under the new spot
  }

  teleport(x: number, z: number): void {
    this.entity.x = x; this.entity.z = z;
    this.placed = false;
    this.riding = false;
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

  update(input: Input, iso: IsoCamera, dt: number, frozen = false, fixedCamera = false): void {
    const e = this.entity;
    // the hero does not go through updateEntity, so nothing else counts a blow down for them.
    // Without this the timer sticks at full, the blow never advances past its first frame, and
    // pressing attack looks like pressing nothing at all.
    if (e.strike > 0) e.strike = Math.max(0, e.strike - dt);
    if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
    if (this.riding) {
      e.walk += (0 - e.walk) * Math.min(1, dt * 10); e.phase += dt * 1.5; e.bobY = 0;
      const k = Math.min(1, dt * 7);
      iso.target.x += (e.x - iso.target.x) * k;
      iso.target.z += (e.z - iso.target.z) * k;
      iso.target.y += (e.y - iso.target.y) * k;
      return;
    }
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
    // Hold shift to stroll. The hero has only ever had one pace, so the run lean and the long
    // stride the motion file gives a running creature were on him permanently, even crossing a
    // village square. Running stays the default and stays exactly the speed it was, so nothing
    // about outrunning a wolf changes; this only adds the slower gear.
    const pace = input.isDown('shift') ? Player.STROLL : 1;
    if (len > 0) {
      dx /= len; dz /= len;
      const step = e.kind.speed * this.speedScale * pace * dt;
      e.yaw = yawFor(dx, dz);
      moved = tryMove(this.world, e, dx * step, dz * step);
    }
    if (moved) {
      // `walk` is the pace rather than a flag, so the animation follows the legs: below the motion
      // file's `running.from` it is an amble and above it the stride opens out
      e.walk += (pace - e.walk) * Math.min(1, dt * 12);
      e.phase += dt * 14 * (0.5 + 0.5 * pace);
    } else {
      e.walk += (0 - e.walk) * Math.min(1, dt * 12);
      e.phase += dt * 1.5;
    }
    const h = this.world.heightAt(e.x, e.z);
    if (h !== null) {
      // a full terrace step triggers a little hop; ramps just glide
      if (this.hop <= 0 && Math.abs(h - e.y) > 0.3) this.hop = Player.HOP_TIME;
      e.y += (h - e.y) * Math.min(1, dt * (this.hop > 0 ? 22 : 14));
    }
    if (this.hop > 0) {
      this.hop -= dt;
      e.bobY = Math.sin(Math.PI * (1 - Math.max(0, this.hop) / Player.HOP_TIME)) * 0.3;
    } else {
      e.bobY += (0 - e.bobY) * Math.min(1, dt * 12);
    }

    if (fixedCamera) return;   // indoors the room stays put and the hero moves within it

    // camera trails the hero, with a faint bob while walking
    const k = Math.min(1, dt * 7);
    iso.target.x += (e.x - iso.target.x) * k;
    iso.target.z += (e.z - iso.target.z) * k;
    iso.target.y += (e.y + Math.abs(Math.sin(e.phase * 0.5)) * 0.05 * e.walk - iso.target.y) * k;
  }
}
