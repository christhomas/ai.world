import type { Input } from '../core/input';
import type { IsoCamera } from '../render/camera';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { Entity, Herd, canStand, spaceNear, tryMove, type Crowd, type TileWorld } from './entity';
import { JUMP, leapHeight } from './leap';
import { newHero, stride, type Steer } from './stride';
import type { EntityRenderer } from './pool';

/** The hero: an entity driven by the keyboard, or by anything else when the keyboard is still. */
export class Player {
  readonly entity: Entity;
  /** 'follow' = WASD moves the hero and the camera tracks; 'free' = the old fly-around camera. */
  mode: 'follow' | 'free' = 'follow';
  private placed = false;
  /**
   * Whoever else is standing about, so the hero cannot walk through them.
   *
   * Handed in rather than reached for, because the hero walks in three places — here, in the
   * reconciler when the world corrects him, and on the server — and only two of them have a crowd
   * to ask. Absent means nobody is in the way, which is true of an empty room.
   */
  crowd: Crowd | null = null;
  private hop = 0;
  /** How long until he may jump again, in seconds. See `JUMP.REST`. */
  private landed = 0;
  /**
   * The wing, when there is one open.
   *
   * Hung on the player rather than owned by him: what a glide *is* belongs to `game/gliding.ts`,
   * and what this file knows is that while one is open the ground rules are suspended — nothing
   * settles him, nothing clamps him to a hillside, and the steer that would have been a walk is
   * a turn of the wing instead.
   */
  private wing: {
    flying: boolean;
    update: (dt: number, steer: { dx: number; dz: number }, hero: Entity, world: TileWorld) => string;
  } | null = null;
  private static readonly HOP_TIME = 0.28;
  /** While true the hero is carried (ferry): no walking, no ground snapping, camera still follows. */
  riding = false;
  /** Multiplier on walking pace: a horse carries you faster. */
  speedScale = 1;
  /**
   * The steer the last frame was walked with, or null for a frame nobody moved in.
   *
   * Read by whatever is talking to the server: what crosses the wire is what the hero was *trying*
   * to do, so the server can walk him itself rather than take a client's word for where he ended
   * up. Left here rather than returned because `update` is called from several places and only one
   * of them cares.
   */
  steered: Steer | null = null;
  /**
   * A stroll, as a share of the hero's running pace. Under the motion file's `running.from` of
   * 0.55, so ambling is genuinely a different gait and not just a slower run.
   */
  static readonly STROLL = 0.42;
  /**
   * Something other than the keyboard, asked for a direction when the keyboard is idle.
   *
   * A function rather than a behaviour tree, and that is the point of the shape: whether the thing
   * on the other end is a tree out of `behaviours/`, a script walking the hero across a county, or
   * a line of test code is none of this file's business. What it says is that the hero has a way in
   * for a decision he did not make with his hands.
   *
   * Returning nothing means "nothing to say this frame", which is different from standing still —
   * a driver that wanted him stopped simply returns nothing and the ordinary idle takes over.
   */
  autopilot: ((dt: number) => { dx: number; dz: number } | null) | null = null;

  /**
   * How near a spot counts as having got there.
   *
   * A tile and a half. Close enough that the hero is plainly at the thing he was sent to, and loose
   * enough that he is not still shuffling because a cow is standing on the exact tile — `stride`
   * walks him round whatever is in the way, so an autopilot that insisted on a point would pace
   * around it for ever.
   */
  static readonly ARRIVED = 1.5;

  /**
   * How long he may fail to get any nearer before he stops trying.
   *
   * Found by walking one: sent twenty tiles east he went four, met a river, and leant into it for
   * as long as anybody watched. That is exactly what a player pressing W would get and is right —
   * but a script is not watching, and a driver that can push at a riverbank for ever is a test that
   * hangs rather than one that fails. Two seconds is long enough to squeeze past a cow and short
   * enough that nobody waits on it.
   *
   * Giving up clears the autopilot, the same as arriving does, so `steering` going false means
   * "finished" and where he is says which of the two it was.
   */
  static readonly GIVES_UP = 2;

  /**
   * How much nearer counts as getting somewhere, in tiles.
   *
   * Small on purpose: sliding along a wall towards the far side of it is progress, and a hero
   * squeezing between a house and a fence covers very little ground per second while doing exactly
   * what he should.
   */
  static readonly PROGRESS = 0.05;

  constructor(private world: TileWorld, renderer: EntityRenderer, x: number, z: number) {
    this.entity = newHero(x, z);
    renderer.add(this.entity);
  }

  /** Height the hero can step across; the rope item raises it. */
  set climb(v: number) { (this.entity.kind as { climb?: number }).climb = v; }

  /** Swap the ground the hero walks on (overworld ↔ dungeon). */
  setWorld(world: TileWorld): void { this.world = world; this.placed = false; }
  /** And which one that is, for whatever has to ask the ground a question on his behalf. */
  get ground(): TileWorld { return this.world; }

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

  /**
   * Is there anywhere to stand near this point, in the world he is walking in *now*?
   *
   * Asked before a jump, because a jump does not change which world he is in. Teleporting to a
   * surface coordinate while standing on the third floor of a vault asks that floor whether it has
   * any ground at 322, 53 — it has not, and it never will — so he arrived nowhere: no ground under
   * him, `settle` refusing to place him, and the game quietly holding an invisible man in the dark.
   * A jump that cannot land is better refused with a sentence than taken.
   */
  groundNear(x: number, z: number): boolean {
    return spaceNear(this.world, this.entity.kind, x, z) !== null;
  }

  /**
   * Off the ground, for as long as a jump lasts.
   *
   * Refused while he is already in the air or has only just landed, and while he is being carried:
   * a hero on a horse or a boat is a passenger, and a passenger who jumps leaves the thing carrying
   * him behind. Answers whether it happened, because the key that asks wants to make a sound only
   * when it did.
   */
  /**
   * Hand the player a wing, or take it away again.
   *
   * A setter rather than a constructor argument because a glider is a thing somebody buys halfway
   * through a game, and because the shape of it is `game/gliding.ts`'s business and not this
   * file's: all that is needed here is something that says whether it is open and moves the hero
   * when it is.
   */
  carries(wing: Player['wing']): void { this.wing = wing; }

  /** Is he in the air under canvas? Everything that clamps a hero to the ground asks this. */
  get gliding(): boolean { return this.wing?.flying === true; }

  jump(): boolean {
    if (this.entity.leap > 0 || this.landed > 0 || this.riding) return false;
    this.entity.leap = JUMP.TIME;
    return true;
  }

  teleport(x: number, z: number): void {
    this.entity.x = x; this.entity.z = z;
    this.placed = false;
    this.riding = false;
    this.warped = true;
  }

  /**
   * Set by a teleport and cleared by the next update, which takes the camera along.
   *
   * The camera follows the hero by easing toward him a little each frame, and that easing sits
   * past the early return taken while a dialogue is open — so being carried off after a knockout
   * left the view behind at the place you fell, watching an empty patch of grass, and then sliding
   * across the county once you dismissed the dialogue. Every other teleport in the game had the
   * same slide: out of a dungeon, off a ferry, into a cell.
   */
  private warped = false;

  get x(): number { return this.entity.x; }
  get z(): number { return this.entity.z; }
  get y(): number { return this.entity.y; }

  /** First frames: the spawn chunk may not be loaded yet; snap to ground once it is. */
  /**
   * Walk there, and stop when you arrive.
   *
   * The first thing built on `autopilot`, and the one that makes an automated game possible: a
   * script can say where the hero should be rather than which keys a person would have held to get
   * him there. Everything about the walk is the ordinary walk — the same `stride`, the same
   * collision, the same crowd — because all this does is hand over the steer the keyboard would
   * have handed over.
   *
   * It clears itself on arrival rather than being switched off by whoever set it. A driver that had
   * to be told to stop is a driver that keeps walking when the thing that set it has gone away, and
   * a hero pressed against a wall for ever is the failure nobody would think to look for. It also
   * clears itself when he stops getting any nearer — see `GIVES_UP` — because the wall is real and
   * a script cannot see him leaning on it.
   *
   * Passing nothing stops him where he is, which is what a caller wants when the plan has changed.
   */
  walkTo(x?: number, z?: number, within = Player.ARRIVED): void {
    if (x === undefined || z === undefined) { this.autopilot = null; return; }
    let nearest = Infinity, stuck = 0;
    this.autopilot = (dt) => {
      const dx = x - this.entity.x, dz = z - this.entity.z;
      const away = Math.hypot(dx, dz);
      if (away <= within) { this.autopilot = null; return null; }
      // measured against the best he has ever managed rather than against last frame, so that
      // being shoved backwards by a crowd and then recovering is not counted as progress twice
      if (away < nearest - Player.PROGRESS) { nearest = away; stuck = 0; } else { stuck += dt; }
      if (stuck >= Player.GIVES_UP) { this.autopilot = null; return null; }
      return { dx, dz };
    };
  }

  /** Whether something other than a person is presently steering, for anybody checking. */
  get steering(): boolean { return this.autopilot !== null; }

  private settle(): boolean {
    const e = this.entity;
    if (this.placed) return true;
    const h = this.world.heightAt(e.x, e.z);
    if (h === null) {
      // the ground here has not arrived yet, or is not ground: find some
      const clear = spaceNear(this.world, e.kind, e.x, e.z, 12);
      if (!clear) return false;
      e.x = clear.x; e.z = clear.z;
      e.y = this.world.heightAt(clear.x, clear.z)!;
      this.placed = true;
      return true;
    }
    // and not inside anything standing on it. Set down two tiles from the middle of a village is
    // sometimes set down inside a market stall, and being trapped in one is the one fault a player
    // has no way round — so the landing is moved to the nearest place a body fits.
    if (this.world.blocked(e.x, e.z)) {
      const clear = spaceNear(this.world, e.kind, e.x, e.z);
      if (!clear) { e.x += 1; return false; }
      e.x = clear.x; e.z = clear.z;
      e.y = this.world.heightAt(clear.x, clear.z) ?? h;
      this.placed = true;
      return true;
    }
    e.y = h;
    this.placed = true;
    return true;
  }

  update(input: Input, iso: IsoCamera, dt: number, frozen = false, fixedCamera = false): void {
    const e = this.entity;
    // cleared first, because most of the ways out of this method are early returns and a steer left
    // lying about would be sent to the server as a step the hero never took
    this.steered = null;
    // the hero does not go through updateEntity, so nothing else counts a blow down for them.
    // Without this the timer sticks at full, the blow never advances past its first frame, and
    // pressing attack looks like pressing nothing at all.
    if (e.strike > 0) e.strike = Math.max(0, e.strike - dt);
    if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
    // whoever moved him, the view goes too, and before anything below can return early. The height
    // is left to ease: the ground under the new place may not have loaded yet, and a camera that
    // drops to nought and climbs back is worse than one that settles.
    if (this.warped) {
      this.warped = false;
      iso.target.x = e.x;
      iso.target.z = e.z;
    }
    /*
     * Under canvas, the ground stops having a say.
     *
     * Before everything below, because everything below is about walking: settling onto the
     * terrain, sliding along what is solid, the little hop up a terrace. A glide is none of those —
     * it is a steer, a sink rate and a height — so it is answered here and the rest is skipped.
     */
    if (this.wing?.flying) {
      const { fx, fz, rx, rz } = iso.basis();
      let dx = 0, dz = 0;
      if (input.isDown('w', 'arrowup')) { dx += fx; dz += fz; }
      if (input.isDown('s', 'arrowdown')) { dx -= fx; dz -= fz; }
      if (input.isDown('a', 'arrowleft')) { dx -= rx; dz -= rz; }
      if (input.isDown('d', 'arrowright')) { dx += rx; dz += rz; }
      this.wing.update(dt, { dx, dz }, e, this.world);
      // the legs are still: a man hanging in a harness is not walking, whatever the keys say
      e.walk += (0 - e.walk) * Math.min(1, dt * 8);
      e.phase += dt * 1.5;
      this.placed = false;                 // the ground under where he lands is found again
      if (fixedCamera) return;
      const k = Math.min(1, dt * 7);
      iso.target.x += (e.x - iso.target.x) * k;
      iso.target.z += (e.z - iso.target.z) * k;
      iso.target.y += (e.y - iso.target.y) * k;
      return;
    }
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
    let len = Math.hypot(dx, dz);
    /*
     * Nobody is pressing anything, so whatever else is driving him may have a turn.
     *
     * This is the seam the whole vocabulary was built towards, and it is deliberately one line
     * rather than a machine. The decisions a hero makes and the decisions a villager makes are the
     * same decisions — it is who picks that differs, and a villager's tree picks for itself where
     * the hero's branches are offered to a player as a menu. So the hero does not need a tree
     * *instead of* hands; he needs somewhere for one to reach him when the hands are still.
     *
     * Input wins outright and without ceremony. A hero who argued with the keyboard for a frame
     * would be unplayable, and there is no version of "the autopilot was mid-thought" that a player
     * would forgive — so this is only consulted when nothing is held down at all.
     *
     * What it is for: a scripted playtest that drives a real hero through the real verbs rather
     * than synthesising keypresses; "walk to Frostgard" becoming the `goTo` a villager already
     * uses; and a disconnected player standing down sensibly instead of freezing in a field.
     */
    if (len === 0 && this.autopilot) {
      const asked = this.autopilot(dt);
      if (asked) { dx = asked.dx; dz = asked.dz; len = Math.hypot(dx, dz); }
    }
    let moved = false;
    // Hold shift to stroll. The hero has only ever had one pace, so the run lean and the long
    // stride the motion file gives a running creature were on him permanently, even crossing a
    // village square. Running stays the default and stays exactly the speed it was, so nothing
    // about outrunning a wolf changes; this only adds the slower gear.
    const pace = input.isDown('shift') ? Player.STROLL : 1;
    // through the same gate the server walks him through, so a guess made here and an answer given
    // there are the same arithmetic rather than two arrangements that agree most of the time
    // the mount goes into the steer rather than beside it, so that what is walked here and what is
    // walked by the world are one number and cannot drift apart
    this.steered = len > 0 ? { dx, dz, pace: pace * this.speedScale, dt } : null;
    // the crowd as well as the ground: a hero walked through cows and through villagers
    if (this.steered) moved = stride(this.world, e, this.steered, this.crowd ?? undefined);
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
    /*
     * How far off his own ground he is drawn: a jump, a terrace hop, or settling back to nothing.
     *
     * A jump wins over the hop rather than adding to it. Stepping up a terrace *while* jumping is
     * exactly when both would fire, and two arcs summed put him twice as high as either was worth
     * — which reads as the ground throwing him rather than as him jumping.
     */
    if (this.landed > 0) this.landed = Math.max(0, this.landed - dt);
    if (e.leap > 0) {
      e.leap = Math.max(0, e.leap - dt);
      e.bobY = leapHeight(e.leap);
      if (e.leap <= 0) this.landed = JUMP.REST;
    } else if (this.hop > 0) {
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
