import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { Entity, Herd, tryMove, yawFor, type TileWorld } from './entity';

/**
 * One step of a hero, worked out the same way wherever it is worked out.
 *
 * Phase four of `docs/server-authority.md` moves the hero across: the server says where he is, and
 * the client guesses ahead of it so the game still answers the keyboard immediately. That only
 * works if the guess and the answer are the same arithmetic — a client that rounds a corner half a
 * tile differently from the server is a client that is corrected every time it rounds a corner,
 * and the hero rubber-bands for as long as anybody plays.
 *
 * So the step is here, once, with nothing in it about keyboards, cameras, sockets or animation. It
 * takes where a hero is, where they are trying to go and for how long, and moves them as far as the
 * ground allows. The client calls it every frame; the server calls it with what the client said it
 * did; a test calls it with neither.
 */

/**
 * How high a hero may step with a rope on their belt, which is the most any of them can.
 *
 * The server walks every hero with this rather than with the bare figure, and that is deliberate.
 * What is in somebody's pack lives in their own save — the server has never held it and this is
 * not the phase that changes that — so the server cannot tell a player with a rope from one
 * without. Given the choice between refusing a step the client allowed and allowing one the client
 * refused, take the second: the client is the stricter of the two and stops them itself, and
 * nobody is corrected for a wall their own game let them over.
 */
export const ROPED_CLIMB = 1.06;

/** A body for a hero, wherever a hero is needed: on the screen, or on the server walking about. */
export function newHero(x: number, z: number, climb?: number): Entity {
  const kind = climb === undefined ? KINDS.hero : { ...KINDS.hero, climb };
  const herd = new Herd(kind, x, z, x, z, 0);
  return new Entity(kind, x, z, herd, 'player', mulberry32(1));
}

/** What a hero is trying to do, in the world's own directions rather than the camera's. */
export interface Steer {
  /**
   * The way they are pushing. Any length: it is normalised here, so a client that sends a longer
   * vector than it should cannot walk faster for it.
   */
  dx: number;
  dz: number;
  /** A share of the running pace. One is a run, and `Player.STROLL` an amble. */
  pace: number;
  /** How long it is held for, in seconds. */
  dt: number;
}

/**
 * The longest one step may be, in seconds.
 *
 * A step is integrated in one go rather than in slices, so a very long one walks through whatever
 * is between its two ends. On the client that is only a stutter; on the server it is somebody
 * claiming a hundred seconds passed and stepping across a river. Hence a ceiling, and the same one
 * on both sides so a slow frame is clamped identically by whoever is doing the arithmetic.
 */
export const LONGEST_STEP = 0.25;

/** The fastest pace anybody may ask for, so that "pace" cannot be sent as a hundred. */
export const FASTEST = 1;

/**
 * Move a hero by one steer, and say whether they got anywhere.
 *
 * Nothing here is trusted: the direction is normalised, the pace is clamped and the step is
 * capped, because on the server this is being handed numbers by somebody else's computer. The
 * client passes its own honest ones through the same gate so that both come out the same.
 */
export function stride(world: TileWorld, e: Entity, steer: Steer, speedScale = 1): boolean {
  const len = Math.hypot(steer.dx, steer.dz);
  if (len <= 0) return false;
  const dt = Math.max(0, Math.min(LONGEST_STEP, steer.dt));
  if (dt <= 0) return false;
  const pace = Math.max(0, Math.min(FASTEST, steer.pace));
  if (pace <= 0) return false;
  const dx = steer.dx / len, dz = steer.dz / len;
  e.yaw = yawFor(dx, dz);
  const step = e.kind.speed * speedScale * pace * dt;
  return tryMove(world, e, dx * step, dz * step);
}

/**
 * Settle a hero onto the ground under them, the way a walk does between steps.
 *
 * The client eases this over a few frames because a camera that jumps is worse than one that
 * lags. The server has no camera and no frames worth the name, so it takes the ground as it finds
 * it: what it is keeping is where the hero is standing, not what that looked like on the way.
 */
export function settleOnto(world: TileWorld, e: Entity): void {
  const h = world.heightAt(e.x, e.z);
  if (h !== null) e.y = h;
}
