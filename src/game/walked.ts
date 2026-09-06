import type { Entity, TileWorld } from '../entities/entity';
import { stride, type Steer } from '../entities/stride';

/**
 * The client's half of a hero the server owns.
 *
 * The server walks the hero and says where he is; the round trip to a Raspberry Pi is a tenth of a
 * second, and a game that waited for it before moving anybody would be unplayable. So the client
 * walks him too, immediately, and keeps a note of every steer it has walked. When an answer comes
 * back it says which steer it had run when it wrote it, so everything after that one is still in
 * flight: put the hero where the server says he was, walk the steers it had not seen yet back on
 * top, and that is where he should be standing now.
 *
 * The usual outcome is that this changes nothing, because both halves did the same arithmetic on
 * the same ground — that is what `stride` is for. What is left is the cases where they could not
 * agree: a wall the server knew about and the client had not streamed yet, a steer lost on the way,
 * somebody's clock. Those are real disagreements and the server is right about them by definition,
 * so the hero is moved. Gently, if the gap is small enough to be arithmetic; at once, if it is big
 * enough to be a fact.
 */

/** How long a steer may gather before it is sent, in seconds. Thirty a second, near enough. */
const BATCH = 0.033;

/**
 * How far out the client may be before it is worth moving the hero at all, in tiles.
 *
 * Under this the two halves are agreeing and the difference is the last digit of a float. Nudging
 * the hero for that would be a permanent, pointless jitter.
 */
const NEVER_MIND = 0.03;

/**
 * And how far out before the correction stops being eased in and simply happens, in tiles.
 *
 * A small gap is closed over a few frames because a hero that twitches reads worse than one a
 * hand's breadth out of place. A large one is not a disagreement about arithmetic — it is the
 * client being somewhere the world says it is not, and easing into that would mean walking through
 * whatever is in between.
 */
const TOO_FAR = 1.5;

/** How much of a small gap is closed per second, as a share of what is left. */
const EASE = 12;

/** One steer, as it was sent, kept until the server says it has run it. */
interface Sent extends Steer {
  seq: number;
}

export class Walked {
  /** Steers sent and not yet acknowledged, oldest first. */
  private pending: Sent[] = [];
  private seq = 0;
  /** The steer being gathered now, and how long it has been gathering. */
  private heldDx = 0;
  private heldDz = 0;
  private heldPace = 0;
  private held = 0;
  /** What is left of a correction being eased in: how far the hero still owes the world. */
  private owedX = 0;
  private owedZ = 0;

  /**
   * @param send what to do with a steer that is ready to go. Returns nothing: the sequence number
   * is this object's business, and the wire's job is only to carry it.
   */
  constructor(private readonly send: (steer: Sent) => void) {}

  /** Nobody is walking this hero from here any more: forget what was in flight. */
  reset(): void {
    this.pending = [];
    this.held = 0;
    this.heldDx = 0; this.heldDz = 0; this.heldPace = 0;
    this.owedX = 0; this.owedZ = 0;
  }

  /**
   * A frame's worth of walking has happened here. Gather it, and send it when there is enough.
   *
   * Batched rather than sent per frame because a frame is sixteen milliseconds and a steer is
   * sixty bytes: one per frame is four kilobytes a second a player up the wire for a hero who is
   * usually walking in a straight line. A change of direction closes the batch immediately, so
   * nothing is ever averaged — every batch has one direction in it, and the only difference from
   * what the client did is that the server takes it in one step instead of two.
   */
  walked(steer: Steer | null): void {
    const dx = steer?.dx ?? 0, dz = steer?.dz ?? 0, pace = steer?.pace ?? 0;
    const turned = dx !== this.heldDx || dz !== this.heldDz || pace !== this.heldPace;
    if (turned) this.flush();
    this.heldDx = dx; this.heldDz = dz; this.heldPace = pace;
    if (steer) this.held += steer.dt;
    if (this.held >= BATCH) this.flush();
  }

  private flush(): void {
    if (this.held <= 0) return;
    const out: Sent = {
      seq: ++this.seq, dx: this.heldDx, dz: this.heldDz, pace: this.heldPace, dt: this.held,
    };
    this.held = 0;
    // standing still is not worth a message: the server walks nobody nowhere
    if (out.pace <= 0 || (out.dx === 0 && out.dz === 0)) return;
    this.pending.push(out);
    this.send(out);
  }

  /**
   * The world's answer. Put the hero where it says, walk back everything it had not seen, and say
   * how far out the client turned out to be.
   */
  toldWhereHeIs(hero: Entity, world: TileWorld, seq: number, x: number, z: number): number {
    this.pending = this.pending.filter((s) => s.seq > seq);
    const wasX = hero.x, wasZ = hero.z;
    hero.x = x; hero.z = z;
    for (const steer of this.pending) stride(world, hero, steer);
    const out = Math.hypot(hero.x - wasX, hero.z - wasZ);
    if (out < NEVER_MIND) {
      hero.x = wasX; hero.z = wasZ;
      return 0;
    }
    if (out < TOO_FAR) {
      // keep the hero where he was drawn and carry the gap as something to walk off over the next
      // few frames, so a correction is a lean rather than a jump
      this.owedX = hero.x - wasX;
      this.owedZ = hero.z - wasZ;
      hero.x = wasX; hero.z = wasZ;
    } else {
      this.owedX = 0; this.owedZ = 0;
    }
    return out;
  }

  /** Walk off whatever is left of a small correction. Call once a frame, after the hero moves. */
  settle(hero: Entity, dt: number): void {
    if (this.owedX === 0 && this.owedZ === 0) return;
    // the tail of an easing curve is infinite and the last few centimetres of it are not worth a
    // frame, so once what is left is too small to see it is simply paid off
    if (Math.hypot(this.owedX, this.owedZ) < NEVER_MIND) {
      hero.x += this.owedX; hero.z += this.owedZ;
      this.owedX = 0; this.owedZ = 0;
      return;
    }
    const k = Math.min(1, dt * EASE);
    hero.x += this.owedX * k;
    hero.z += this.owedZ * k;
    this.owedX *= 1 - k;
    this.owedZ *= 1 - k;
  }
}
