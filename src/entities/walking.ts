import { STEP_LIMIT } from './properties';
import { JUMP } from './leap';
import { swims, type Entity } from './entity';
import type { AnimalKind } from './animals';
import type { Body } from '../world/solids';
import type { TileWorld } from '../world/tiles';

/**
 * Getting about: what a body is, where it may stand, and how a step is taken.
 *
 * Out of `entity.ts` because it is the half of that file which is about *the world* rather than
 * about a creature — a box against a box, a slice of a step against what is standing in the way,
 * the ground under a foot. `entity.ts` keeps what a creature is and what it decides; this is what
 * happens when it tries to move, and it is the same arithmetic for a hero, a wolf and a cow, on the
 * page and on the server.
 *
 * Nothing here imports a creature at runtime — `Entity` crosses as a type only — so the pair are
 * two files rather than a cycle.
 */

/**
 * Can this kind stand at (x,z) — or, for a kind that paddles, be there at all — stepping from height
 * `fromY` (or from anywhere if it is undefined)?
 */
/**
 * @param yaw which way the body is facing, so that what is asked about is the shape it is drawn as.
 * Left out by whoever is asking about a place rather than about a walk — somewhere to spawn, a spot
 * to put somebody down — where there is no heading yet and the answer is about the ground.
 */
export function canStand(
  world: TileWorld, kind: AnimalKind, x: number, z: number, fromY?: number, yaw = 0, over = 0,
): boolean {
  if (swims(kind)) return world.waterAt(x, z) !== null;
  if (kind.behaviour === 'fly') return true;
  const h = world.heightAt(x, z);
  /*
   * Out of his depth, and swimming.
   *
   * `heightAt` is null over anything too deep to stand up in, which is what has always made deep
   * water a wall. For a kind that paddles it is not a wall but a different way of getting about:
   * there is water there, so there is somewhere to be. Nothing else in this function applies — a
   * swimmer is not standing on anything, cannot be blocked by what is buried under the seabed, and
   * has no step height to clear, because the surface is all one height.
   *
   * Climbing back out is the same rule read the other way: the tile he is heading for has ground
   * under it, and he is stepping onto it from the water's surface, which is within a hero's climb
   * of any shore this world grows. Nobody is ever stranded afloat.
   */
  if (h === null) return kind.paddles === true && world.waterAt(x, z) !== null;
  // asked as the body it is, not as the point at its middle — and at the height it is at, which is
  // the ground for everybody except somebody in the middle of a jump
  if (world.blocked(x, z, bodyBox(kind, yaw, over))) return false;
  // Not onto a mountain. The rim of one is gentle for a tile or two before the flank stands up, so
  // a deer following its herd wanders up it and is then stuck on a cliff with nothing to eat; the
  // goats and the things that climb are placed on the high ground rather than walking to it.
  if (!kind.climb && world.buried?.(x, z)) return false;
  if (kind.behaviour === 'travel' && !world.isRoad(x, z)) return false;
  if (fromY !== undefined && Math.abs(h - fromY) > (kind.climb ?? STEP_LIMIT)) return false;
  return true;
}

export function groundY(world: TileWorld, kind: AnimalKind, x: number, z: number): number | null {
  if (swims(kind)) return world.waterAt(x, z);
  const h = world.heightAt(x, z);
  // a swimmer floats at the surface, which is the only height there is out there
  if (h === null && kind.paddles === true) return world.waterAt(x, z);
  return h;
}

/**
 * How much ground a creature stands on.
 *
 * A creature carries its own box — see `creature()` in `properties.ts`, which measures it off the
 * same parts the renderer draws and scales it by the same `scale`. So its size, its shape and what
 * it blocks are one fact about it: move it, turn it or scale it and the box goes with it, because it
 * is not a separate thing that has to be kept in step.
 *
 * This is here only so that callers have a name to reach for rather than a field to remember.
 */
export function bodyOf(kind: AnimalKind): { hw: number; hd: number } {
  return kind.body;
}

/**
 * The box a creature collides with: the one it is drawn as, turned the way it is facing.
 *
 * Not a point, which puts a whole animal inside a wall, and not a circle, which cannot be both as
 * long as a horse and as narrow as one. The model is a rectangle; what it bumps into is a
 * rectangle; the two are compared as they are.
 */
export function bodyBox(kind: AnimalKind, yaw: number, over = 0): Body {
  const body = bodyOf(kind);
  return { hw: body.hw, hd: body.hd, rot: -yaw, over };
}

/** Whoever is already standing somewhere. The manager keeps the crowd; this is all a mover needs. */
export interface Crowd {
  /** Is anybody but `ignore` standing at this point? */
  occupied(x: number, z: number, ignore: Entity): boolean;
}

/**
 * Is anybody in `near` but `ignore` standing at this point?
 *
 * Here rather than on the manager because it is arithmetic about two bodies and knows nothing about
 * spawning, herds or chunks — the manager's job is to find who is nearby, and this is what to do
 * with them. Dead things do not count: a body on the floor is something to step over, and a carcass
 * that blocked the way would make a fight in a doorway unwinnable.
 */
export function anybodyAt(near: Iterable<Entity>, x: number, z: number, ignore: Entity): boolean {
  const own = bodyOf(ignore.kind);
  // the mover as a radius rather than a box, because it is turning as it goes and its own length
  // is not what it leads with; the narrower half is the honest one to push about with
  const mine = Math.min(own.hw, own.hd);
  for (const e of near) {
    if (e === ignore || e.dead) continue;
    const body = bodyOf(e.kind);
    // into the creature's own frame, where its box is square to the axes and its length is x
    const dx = x - e.x, dz = z - e.z;
    const cos = Math.cos(-e.yaw), sin = Math.sin(-e.yaw);
    const alongX = Math.abs(dx * cos - dz * sin), alongZ = Math.abs(dx * sin + dz * cos);
    if (alongX < body.hw + mine && alongZ < body.hd + mine) return true;
  }
  return false;
}

/**
 * The furthest anything may move without looking at the ground in between, in tiles.
 *
 * A move used to be one jump: work out where the step ends, ask whether that spot is standable,
 * and go there if it is. Nothing was ever asked about the ground between the two ends, so anything
 * thinner than a step simply was not there. The thinnest solid in the world is `MIN_BLOCK` either
 * side of its middle — a fence rail, a stall counter, the wall of a house is thicker but a hero on
 * a courser covers 4.8 tiles in one server step, which is a house and out the other side.
 *
 * That made walking through things a matter of *frame rate*, which is why it was reported as
 * intermittent and impossible to pin down: at sixty frames a step is a twentieth of a tile and
 * everything stops you, and on a slow frame, a laden horse or a batched steer the same code walks
 * you through a wall. So a move is now swept in slices no longer than this, and this is shorter
 * than the thinnest thing anybody can bump into.
 */
export const SWEEP = 0.2;

/**
 * Move something as far as the ground allows, and say whether it got anywhere.
 *
 * Long moves are walked in slices rather than jumped, so that what is between the two ends is what
 * stops you — see `SWEEP`. Each slice slides: the whole move first, then each axis on its own, so
 * that walking into a wall at an angle carries you along it instead of stopping you dead.
 */
export function tryMove(world: TileWorld, e: Entity, dx: number, dz: number, crowd?: Crowd): boolean {
  const far = Math.hypot(dx, dz);
  const slices = far > SWEEP ? Math.ceil(far / SWEEP) : 1;
  let moved = false;
  for (let i = 0; i < slices; i++) {
    // a slice that gets nowhere is the end of the move: the next one is in the same direction from
    // the same spot, so it would be refused for the same reason
    if (!slide(world, e, dx / slices, dz / slices, crowd)) break;
    moved = true;
  }
  // a man who takes a step is no longer standing on the tower, whether he meant to leave it or
  // was knocked off it. One line, because this is the only way anything in the world moves itself
  if (moved) e.perch = null;
  return moved;
}

/**
 * How much deeper into a solid a step may go while getting out of one, in tiles.
 *
 * Nought in spirit: this is float slack, not a budget. A hundredth of a tile is a centimetre at the
 * scale the world is drawn, which is less than the ground under anybody is flat to and far less
 * than a step.
 */
const DEEPER = 1e-4;

/**
 * How high a thing may stand and still not be in this creature's way, in world units.
 *
 * Two ways to be over something and they are the same number. `leap` is a hero in the middle of a
 * jump on somebody's screen; `clears` is standing permission, which is how the server walks a hero
 * — it has never seen the keyboard and cannot know whether the jump happened, so it allows what the
 * page allows and leaves the page to be the stricter of the two. The same bargain, and for the same
 * reason, as `ROPED_CLIMB` in `stride.ts`.
 */
function clearing(e: Entity): number {
  return e.leap > 0 ? JUMP.CLEARS : e.clears;
}

/** One slice of a move: the whole of it if it fits, else along whichever axis does. */
function slide(world: TileWorld, e: Entity, dx: number, dz: number, crowd?: Crowd): boolean {
  const k = e.kind;
  /*
   * Whoever is standing there stops you — unless you are already standing in them.
   *
   * A horse is nearly two tiles nose to tail, and things do end up inside each other: a creature
   * spawns beside one, a blow knocks somebody back, the world corrects a hero onto a cow. If the
   * crowd were asked unconditionally then every direction out of that would be refused too, and
   * being stuck for ever is a worse fault than the walking-through this replaced. So the question
   * is only asked of somebody who is standing clear to begin with; anybody already overlapping is
   * free to move, and moves apart within a step or two because nothing is pushing them together.
   */
  const stuck = crowd?.occupied(e.x, e.z, e) ?? false;
  /*
   * And the same mercy for the scenery: somebody standing inside a wall may walk out of it.
   *
   * Nothing walks into a solid, but plenty of things are *put* into one — a hero carried home after
   * a knock on the head and set down two tiles from the village middle, which is sometimes a stall;
   * a boat run aground; a floor that has been rebuilt under somebody. Once inside, every direction
   * out of it fails the same test that should have stopped him getting in, and the game has eaten
   * the player: no message, no way out, nothing to do but reload. That is a worse fault than any
   * amount of walking through walls, so being already inside something is a reason to be let out
   * rather than a reason to be held.
   *
   * Only the props are waived. The ground still has to be ground: this is a way out of a wall, not
   * a way into the sea or up a cliff.
   */
  // how high off his own ground he is: nought for everybody, except a hero in mid-jump — see
  // `entities/leap.ts` — and a hero on the server, who is allowed everything the page allows
  const over = clearing(e);
  const boxedIn = world.blocked(e.x, e.z, bodyBox(k, e.yaw, over)) && standable(world, k, e.x, e.z);
  /*
   * And the mercy is pointed outward rather than granted outright.
   *
   * Waiving the walls for anybody who is already touching one is a way *through* every wall in the
   * game, and it is reachable by walking: a body is a rectangle turned the way it faces, so
   * standing flush against a curtain wall and turning forty-five degrees catches the corner of your
   * own box on it — and from that step on nothing solid stops you, so you walk into the castle and
   * are then stuck inside it. That is the fault as it was reported: *I can walk inside the building
   * and I should not be there.*
   *
   * So how deep in it is is measured, and a step is allowed only while it does not go *deeper* than
   * it already was. Out is always downhill in that measure and there is always an out, so nobody is
   * held: what is refused is pushing further in, which is the whole of the fault — somebody
   * standing against the outside of a wall is a whisker deep, and the next step through it is
   * deeper. It does mean out is out by the near face rather than whichever face you happen to be
   * pressing at, and that is the right trade: crossing the middle of a wall to leave by the far
   * side is walking through it, however you came to be standing in it.
   *
   * Not strictly shallower, which was tried and is too tight: a hero set down at the exact middle
   * of a market stall is the same depth in whichever way he faces — that is what being in the
   * middle means — so a rule that demands progress on the first step refuses every step and leaves
   * him there for ever, which is the trap this mercy exists to prevent.
   *
   * Nothing that flies is asked. A bird goes over a cottage rather than round it, which is what
   * `canStand` says by letting it stand anywhere, and a vulture crossing a roof is inside the box
   * the whole way across — the same carve-out, and the same reason, as the crossing test below.
   *
   * A world with no depth to report keeps the older, blunter mercy.
   */
  const wasIn = boxedIn && world.depth && k.behaviour !== 'fly'
    ? world.depth(e.x, e.z, bodyBox(k, e.yaw, over))
    : 0;
  const attempts: Array<[number, number]> = [[dx, dz], [dx, 0], [0, dz]];
  for (const [mx, mz] of attempts) {
    if (mx === 0 && mz === 0) continue;
    const nx = e.x + mx, nz = e.z + mz;
    if (boxedIn) {
      if (!standable(world, k, nx, nz, e.y)) continue;
      // no deeper than it already is, with a whisker of slack so that a step across the middle of
      // something is not refused by the last bit of a float
      if (wasIn > 0 && world.depth!(nx, nz, bodyBox(k, e.yaw, over)) > wasIn + DEEPER) continue;
    } else {
      if (!canStand(world, k, nx, nz, e.y, e.yaw, over)) continue;
      // and the way there, not only the far end of it: a box is crossed or it is not, whatever the
      // length of the step that crossed it. Not for anything that flies: a bird goes over a cottage
      // rather than round it, which is what `canStand` says by letting it stand anywhere, and a path
      // test that did not know it turned every roof in the world into a wall in the sky.
      if (k.behaviour !== 'fly' && world.crosses?.(e.x, e.z, nx, nz, bodyBox(k, e.yaw, over))) continue;
    }
    // the ground first, because the ground is the cheap question
    if (!stuck && crowd?.occupied(nx, nz, e)) continue;
    e.x = nx; e.z = nz;
    return true;
  }
  return false;
}

/**
 * Somewhere near here that this kind can actually stand: here, if here will do.
 *
 * Whatever *puts* somebody somewhere — a hero carried home after a knock on the head, a staircase,
 * a boat, a teleport, the first placing of a new game — is choosing a point on a map, not a place
 * to stand, and points on a map land inside stalls and under carts. Being put inside a solid used
 * to mean being trapped in it, which is the one fault a player cannot work around.
 *
 * A widening ring rather than a nudge in one direction: pushing east a tile at a time gets out of a
 * hut and into the sea.
 */
export function spaceNear(world: TileWorld, kind: AnimalKind, x: number, z: number, within = 8): { x: number; z: number } | null {
  if (canStand(world, kind, x, z)) return { x, z };
  for (let r = 0.5; r <= within; r += 0.5) {
    // enough points that a ring cannot step over a gap narrower than a doorway
    const points = Math.max(8, Math.round(r * 12));
    for (let a = 0; a < points; a++) {
      const angle = (a / points) * Math.PI * 2;
      const nx = x + Math.cos(angle) * r, nz = z + Math.sin(angle) * r;
      if (canStand(world, kind, nx, nz)) return { x: nx, z: nz };
    }
  }
  return null;
}

/**
 * Is the ground itself walkable here, whatever is standing on it?
 *
 * `canStand` asks two questions at once — is this ground, and is anything in the way — which is
 * right for a step and wrong for an escape. Somebody inside a wall needs the first answer without
 * the second.
 */
function standable(world: TileWorld, kind: AnimalKind, x: number, z: number, fromY?: number): boolean {
  if (swims(kind)) return world.waterAt(x, z) !== null;
  if (kind.behaviour === 'fly') return true;
  const h = world.heightAt(x, z);
  if (h === null) return false;
  if (!kind.climb && world.buried?.(x, z)) return false;
  if (fromY !== undefined && Math.abs(h - fromY) > (kind.climb ?? STEP_LIMIT)) return false;
  return true;
}
