import { KINDS } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import type { EntityRenderer } from '../entities/pool';
import type { EntityManager } from '../entities/manager';
import { mulberry32 } from '../core/rng';
import type { CreatureSnap } from '../../server/protocol';

/**
 * The creatures the world says are there, drawn.
 *
 * When the simulation owns the wildlife — which it does whether it is running on a server or in the
 * next thread along — the client stops deciding what lives where and starts being told. This is the
 * telling: a creature arrives as an id, a kind and a position, and becomes an ordinary entity in
 * the ordinary pool, drawn exactly as one the client used to invent for itself.
 *
 * Nothing here decides anything. It does not spawn, it does not think, it does not kill: it moves
 * what it is told about and removes what it is told has gone. Everything a creature *does* happens
 * in one place now, and that place is the world server.
 *
 * Positions are eased rather than snapped. Snapshots arrive three times a second and frames are
 * drawn sixty; without the easing a deer teleports twenty times a second, which reads as broken
 * even though every position in it is true.
 */

/** How quickly a drawn creature catches up with where the world says it is, per second. */
const CATCH_UP = 9;

export class Wildlife {
  private readonly bodies = new Map<number, Entity>();
  /** Where the world last said each one was, which is what they are easing towards. */
  private readonly wanted = new Map<number, { x: number; z: number; y: number; yaw: number }>();

  /**
   * The renderer draws them; the manager holds them so everything that looks for creatures — a
   * swing, a hunt, an arrow, the console's `entities` — finds them like any other. What they do is
   * still decided by the world.
   */
  constructor(private readonly renderer: EntityRenderer, manager: EntityManager) {
    // Everything that asks the manager what is nearby finds these too: a swing, an arrow, a hunt,
    // the console. What they do is still decided by the world that owns them.
    //
    // An object with an iterator rather than `bodies.values()`, which is an iterator and is
    // therefore empty the second time anybody reads it — the first `within` would have found the
    // world's creatures and every one after it would have found nothing.
    manager.guests = { [Symbol.iterator]: () => this.bodies.values() };
  }

  /** How many creatures are being drawn from what the world said. */
  get count(): number { return this.bodies.size; }

  /** What the world says is near: new ones appear, known ones are aimed at where they now are. */
  apply(near: CreatureSnap[], gone: number[]): void {
    for (const snap of near) {
      let body = this.bodies.get(snap.id);
      if (!body) {
        const kind = KINDS[snap.kind];
        if (!kind) continue;                 // a creature this client has no drawing for
        const herd = new Herd(kind, snap.x, snap.z, snap.x, snap.z, 0);
        body = new Entity(kind, snap.x, snap.z, herd, `world:${snap.id}`, mulberry32(snap.id));
        body.y = snap.y;
        body.worldId = snap.id;
        if (!this.renderer.add(body)) continue;
        this.bodies.set(snap.id, body);
      }
      body.state = snap.state;
      body.walk = snap.walk;
      body.hp = snap.hp;
      this.wanted.set(snap.id, { x: snap.x, z: snap.z, y: snap.y, yaw: snap.yaw });
    }
    for (const id of gone) {
      const body = this.bodies.get(id);
      if (!body) continue;
      this.renderer.remove(body);
      this.bodies.delete(id);
      this.wanted.delete(id);
    }
  }

  /** The creature the world calls by this number, if it is on our screen. */
  find(id: number): Entity | null { return this.bodies.get(id) ?? null; }

  /** Walk each drawn creature towards where the world last said it was. */
  update(dt: number): void {
    const k = Math.min(1, dt * CATCH_UP);
    for (const [id, body] of this.bodies) {
      const to = this.wanted.get(id);
      if (!to) continue;
      body.x += (to.x - body.x) * k;
      body.z += (to.z - body.z) * k;
      body.y += (to.y - body.y) * k;
      // the shortest way round the circle, so nothing spins the long way to face the same direction
      let turn = to.yaw - body.yaw;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      body.yaw += turn * k;
      body.phase += body.walk * dt * 6;
    }
  }

  /** Forget everything: the world stopped being ours to draw. */
  clear(): void {
    for (const body of this.bodies.values()) this.renderer.remove(body);
    this.bodies.clear();
    this.wanted.clear();
  }
}
