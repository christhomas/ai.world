import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { Entity, Herd, tryMove, yawFor, type Crowd, type TileWorld } from './entity';

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
  /**
   * How fast, as a multiple of a hero's running pace: the gait and whatever is carrying him, in one
   * number. One is a run, `Player.STROLL` an amble, and a horse is more than one.
   *
   * One number rather than two on purpose. It used to be the gait here and the mount applied
   * separately by whoever was doing the walking — which was fine until the world started doing some
   * of the walking, because it has never seen anybody's horse. A hero on a courser outran the world
   * by two and a half times and was hauled back for it at every answer.
   */
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

/**
 * The fastest anybody may ask to go, as a multiple of a hero's own running pace.
 *
 * A pace is a gait — a run is one, an amble less — multiplied by whatever is carrying you, and the
 * quickest thing in the game is a courser on a road with a cart behind it at about three and a
 * half. The world cannot check what is in somebody's stable any more than it can check what is in
 * their pack, so it does what it does for the climbing rope: allows the most anything could be, and
 * leaves the client to be the stricter of the two. What this stops is a pace of a hundred.
 */
export const FASTEST = 3.5;

/**
 * Swimming, as a fraction of the pace the same hero walks at.
 *
 * Slower than walking on purpose, and by enough to feel. A crossing has to be a decision — long
 * enough that the far shore is a commitment rather than a detour, long enough for something with a
 * fin to have time to reach you. At a little over two tiles a second the widest river is a few
 * seconds and an island on the horizon is a minute of open water with no way to hurry.
 *
 * It is here rather than with whatever is holding the keyboard because the server walks the hero
 * with this same function: a page that swam at walking pace would be corrected the whole way
 * across, which is the one thing shared arithmetic exists to prevent.
 */
export const SWIM = 0.4;

/**
 * Move a hero by one steer, and say whether they got anywhere.
 *
 * Nothing here is trusted: the direction is normalised, the pace is clamped and the step is
 * capped, because on the server this is being handed numbers by somebody else's computer. The
 * client passes its own honest ones through the same gate so that both come out the same.
 */
export function stride(world: TileWorld, e: Entity, steer: Steer, crowd?: Crowd): boolean {
  const len = Math.hypot(steer.dx, steer.dz);
  if (len <= 0) return false;
  const dt = Math.max(0, Math.min(LONGEST_STEP, steer.dt));
  if (dt <= 0) return false;
  const pace = Math.max(0, Math.min(FASTEST, steer.pace));
  if (pace <= 0) return false;
  const dx = steer.dx / len, dz = steer.dz / len;
  e.yaw = yawFor(dx, dz);
  // a stroke rather than a stride, when there is nothing underfoot to push off
  const stroke = afloat(world, e) ? SWIM : 1;
  const step = e.kind.speed * pace * dt * stroke;
  return tryMove(world, e, dx * step, dz * step, crowd);
}

/**
 * Is this creature swimming — out where there is water and no bottom within reach?
 *
 * Asked of where it *is* rather than of where it is going, because a stroke is slower for the whole
 * of the step that starts in the water: a hero wading out of the shallows gets the last of his
 * footing, and one reaching the shore is still swimming until he is standing on it.
 */
export function afloat(world: TileWorld, e: Entity): boolean {
  if (e.kind.paddles !== true) return false;
  return world.heightAt(e.x, e.z) === null && world.waterAt(e.x, e.z) !== null;
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
  if (h !== null) { e.y = h; return; }
  // and a swimmer floats at the surface, which is the height the water is rather than the height of
  // whatever is at the bottom of it
  if (e.kind.paddles === true) {
    const surface = world.waterAt(e.x, e.z);
    if (surface !== null) e.y = surface;
  }
}
