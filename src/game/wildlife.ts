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
 *
 * And they are carried forward rather than merely eased, which is the difference between a game you
 * can fight in and one you cannot. Easing towards the last thing the world said means the screen is
 * always showing where a creature *was*: measured on a live village, a whole tile out on average
 * and nearly six at worst. A wolf is not a tile wide. So the player swings at what is drawn, the
 * world answers about what it has, and the blow lands on nothing — while the same wolf bites him
 * from a tile away, out of what looks like empty grass. Both halves are honest and the game is a
 * liar.
 *
 * So each creature carries the speed the world's own corrections imply, and is drawn where that
 * says it is now rather than where it was a third of a second ago. It is a guess, and it is wrong
 * whenever something stops or turns — but it is wrong by a fraction of what standing still is wrong
 * by, and the next snapshot puts it right.
 */

/** The last thing the world said about a creature, with the speed that implies. */
interface Told {
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** Tiles a second, worked out from the two most recent snapshots. */
  vx: number;
  vz: number;
  /**
   * How sharply it just turned, from nought (straight on) to one (turned right round).
   *
   * Carrying a creature forward along a straight line is a good guess about something walking and
   * a poor one about something circling: a vulture rides a thermal in a tight ring, so a third of
   * a second of its last direction puts it outside the ring altogether — measured at nearly two
   * tiles out, the worst of anything in the world. So the guess is trusted in proportion to how
   * straight the thing was going.
   */
  turn: number;
  /** When it was said, in seconds. */
  at: number;
}

/** What the screen is getting wrong about the world's creatures, in tiles. */
export interface Drift {
  drawn: number;
  worst: number;
  mean: number;
  worstIs: string;
  far: Array<{ kind: string; out: number }>;
  /** How far out the drawn position was each time the world corrected it, since last asked. */
  wrongBy: { worst: number; mean: number; of: number };
  /** The same, for creatures within reach of the hero: the number a fight is decided by. */
  wrongClose: { worst: number; mean: number; of: number; worstIs: string };
  /** The same, smoothed, for something that wants to show it rather than measure it. */
  recent: number;
}

/** How quickly a drawn creature catches up with where the world says it is, per second. */
const CATCH_UP = 9;

/**
 * How far ahead of the last snapshot a creature may be carried, in seconds.
 *
 * Long enough to cover the gap between snapshots, which is what the lag actually is, and no longer:
 * everything past that is guessing about a creature that may have stopped, and a guess that runs on
 * is a deer that slides past its own tree and is yanked back.
 */
const CARRY_AHEAD = 0.45;

/**
 * The most of a creature's own pace the guess will credit it with.
 *
 * The speed is worked out from two positions and a stopwatch, so a snapshot that arrives late makes
 * it look as though the creature sprinted. Nothing in the world outruns its own legs, and a bird
 * gliding is the fastest honest case, so the clamp is a little over its top speed rather than
 * exactly it.
 */
const FASTEST_GUESS = 1.4;

/** How close a creature has to be before being drawn in the wrong place matters, in tiles. */
const CLOSE = 8;

export class Wildlife {
  private readonly bodies = new Map<number, Entity>();
  /**
   * Where the world last said each one was, how fast it seemed to be going when it said so, and
   * how long ago that was — which together are where it probably is now.
   */
  private readonly wanted = new Map<number, Told>();
  /**
   * How wrong the screen turned out to be, each time the world says where something is.
   *
   * Measured at the moment a snapshot lands, against where that creature was being drawn a
   * heartbeat earlier. It is the honest form of "I swung at a wolf and hit nothing": the player
   * aims at what is drawn and the world answers about what it has, so this is the distance between
   * the game and the truth, in tiles.
   */
  private wrong = { n: 0, total: 0, worst: 0 };
  /** The same, for the creatures close enough to fight, which is the number that decides a swing. */
  private wrongClose = { n: 0, total: 0, worst: 0, worstIs: '' };
  /**
   * The same thing as a running average, for the corner of the screen.
   *
   * The tally above is emptied by whoever reads it, which is right for a measurement and useless
   * for a display: an overlay reading it sixty times a second would empty it before it held
   * anything. This is smoothed instead, so it can be watched while something is being tuned.
   */
  private recent = 0;

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
  apply(near: CreatureSnap[], gone: number[], hero?: { x: number; z: number }): void {
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
      // how far out the screen was about this creature, before believing the new position
      const out = Math.hypot(body.x - snap.x, body.z - snap.z);
      this.wrong.n++;
      this.wrong.total += out;
      if (out > this.wrong.worst) this.wrong.worst = out;
      this.recent = this.recent * 0.96 + out * 0.04;
      // and separately for what the player could actually reach, because a deer forty tiles off
      // being drawn a little behind costs nobody anything
      if (hero && Math.hypot(snap.x - hero.x, snap.z - hero.z) <= CLOSE) {
        this.wrongClose.n++;
        this.wrongClose.total += out;
        if (out > this.wrongClose.worst) { this.wrongClose.worst = out; this.wrongClose.worstIs = body.kind.id; }
      }
      body.state = snap.state;
      body.walk = snap.walk;
      body.hp = snap.hp;
      this.wanted.set(snap.id, this.told(body, snap));
    }
    for (const id of gone) {
      const body = this.bodies.get(id);
      if (!body) continue;
      this.renderer.remove(body);
      this.bodies.delete(id);
      this.wanted.delete(id);
    }
  }

  /**
   * How far behind the world each drawn creature is, in tiles.
   *
   * The number that matters when somebody says they cannot hit a wolf: a blow is resolved by the
   * world against where the world has the wolf, and the player is swinging at where it is drawn.
   * If those two are a body's width apart, the game is lying to the player about where things are.
   */
  /**
   * @param clear empty the running tally, which is what a measurement wants and a display does not.
   */
  drift(clear = true): Drift {
    let worst = 0, total = 0, n = 0, worstIs = '';
    const far: Array<{ kind: string; out: number }> = [];
    for (const [id, body] of this.bodies) {
      const to = this.wanted.get(id);
      if (!to) continue;
      const out = Math.hypot(to.x - body.x, to.z - body.z);
      if (out > worst) { worst = out; worstIs = body.kind.id; }
      if (out > 0.5) far.push({ kind: body.kind.id, out: Math.round(out * 100) / 100 });
      total += out;
      n++;
    }
    const seen = this.wrong, close = this.wrongClose;
    if (clear) {
      this.wrong = { n: 0, total: 0, worst: 0 };
      this.wrongClose = { n: 0, total: 0, worst: 0, worstIs: '' };
    }
    return {
      drawn: this.bodies.size, worst, mean: n > 0 ? total / n : 0, worstIs, far,
      // how wrong the screen was, since the last time anybody asked
      wrongBy: { worst: seen.worst, mean: seen.n > 0 ? seen.total / seen.n : 0, of: seen.n },
      wrongClose: { worst: close.worst, mean: close.n > 0 ? close.total / close.n : 0, of: close.n, worstIs: close.worstIs },
      recent: this.recent,
    };
  }

  /** The creature the world calls by this number, if it is on our screen. */
  find(id: number): Entity | null { return this.bodies.get(id) ?? null; }

  /**
   * What the world said about a creature, and how fast that says it is moving.
   *
   * The speed comes from the last two things the world said and the time between them, because the
   * wire does not carry one: a creature is six numbers on the way over and adding two more to every
   * one of ninety creatures, three times a second, to say something both ends can work out is a
   * poor trade. It is clamped to a little over the creature's own pace, so a snapshot that arrives
   * late cannot make a deer look like an arrow.
   */
  private told(body: Entity, snap: CreatureSnap): Told {
    const now = performance.now() / 1000;
    const was = this.wanted.get(snap.id);
    let vx = 0, vz = 0, turn = 0;
    if (was) {
      const gap = now - was.at;
      if (gap > 0.01) {
        vx = (snap.x - was.x) / gap;
        vz = (snap.z - was.z) / gap;
        const speed = Math.hypot(vx, vz);
        const most = Math.max(body.kind.speed, body.kind.runSpeed) * FASTEST_GUESS;
        if (speed > most) { vx = (vx / speed) * most; vz = (vz / speed) * most; }
        // how far off its old course this puts it, as a share of a half turn
        const old = Math.hypot(was.vx, was.vz);
        if (old > 0.05 && speed > 0.05) {
          const alike = (was.vx * vx + was.vz * vz) / (old * Math.hypot(vx, vz));
          turn = Math.acos(Math.max(-1, Math.min(1, alike))) / Math.PI;
        }
      }
    }
    return { x: snap.x, z: snap.z, y: snap.y, yaw: snap.yaw, vx, vz, turn, at: now };
  }

  /** Walk each drawn creature towards where the world's last word says it is *now*. */
  update(dt: number): void {
    const k = Math.min(1, dt * CATCH_UP);
    const now = performance.now() / 1000;
    for (const [id, body] of this.bodies) {
      const held = this.wanted.get(id);
      if (!held) continue;
      // carried forward from where it was last seen, for as long as that is still a fair guess
      const ahead = Math.min(now - held.at, CARRY_AHEAD * (1 - held.turn));
      const to = { x: held.x + held.vx * ahead, z: held.z + held.vz * ahead, y: held.y, yaw: held.yaw };
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
