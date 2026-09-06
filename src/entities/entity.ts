import { Memory, type Node } from '../core/behaviour';
// a type only: the trees know about this file, and this file must not know about them
import type { Mind } from './verbs';
import type { Rng } from '../core/rng';
import type { AnimalKind, Behaviour } from './animals';
import type { ShopType } from '../world/structures';
import { lastsFor, mirrors, type Blow } from './motion';

export type EntityRole = 'none' | 'villager' | 'congregation' | 'shopkeeper' | 'elder' | 'mount' | 'stablehand';

/** Places a villager's working day sends them, named so a behaviour file can say where. */
export type Post = 'home' | 'work' | 'square' | 'inn' | 'market' | 'shop' | 'field' | 'gate' | 'shore' | 'heights' | 'woods' | 'doctor';

/** What creatures need to know about the ground. Implemented by ChunkManager. */
export interface TileWorld {
  /** Walkable ground height at (x,z); null when unloaded, sea, or river/lake. */
  heightAt(x: number, z: number): number | null;
  /** Water surface height if (x,z) is a river/lake tile, else null. */
  waterAt(x: number, z: number): number | null;
  /** True when a tree / boulder / cactus occupies the tile. */
  blocked(x: number, z: number): boolean;
  /**
   * True where a mountain stands over this tile, so the ground here is the inside of a cliff.
   *
   * Optional, because it is only true of the outdoor world of a polygon country. Nothing should
   * live on a mountain flank or under one: the flank is too steep to stand on and the ground under
   * it cannot be seen, so a herd spawned there is a herd nobody will ever meet.
   */
  buried?(x: number, z: number): boolean;
  isRoad(x: number, z: number): boolean;
}

export type EntityState = 'idle' | 'walk' | 'graze' | 'flee' | 'hop' | 'fly' | 'swim';

/** Max height difference a walker can step across; terrace steps (0.5) are walls, ramps are fine. */
export const STEP_LIMIT = 0.32;

/** Behaviour tuning shared by every creature. Distances in tiles, times in seconds. */
export const BEHAVIOUR = {
  FLEE_RADIUS: 3.5,        // prey bolt when the hero is this close
  FLEE_TIME: [1.5, 3],     // how long a flee lasts
  STALK_RADIUS: 7,         // predators walk at the hero from here
  BITE_RANGE: 1.4,
  BITE_COOLDOWN: 1.6,
  /**
   * How much of a blow happens before it lands, as a share of the animation.
   *
   * This is the single most important number in a fight, because before it existed there was no
   * such thing as reacting. A creature threw its animation and applied its damage in the same
   * instant, so the swing you could see was the report of a hit you had already taken; nothing
   * on screen ever preceded anything. Every complaint about the combat — that it is one button
   * jammed until somebody falls over — starts here, because with no tell there is nothing to
   * answer and mashing is not merely the easiest play, it is the only one.
   *
   * Just over half, so the blow lands a little past the top of the swing where the eye expects
   * it, and the wind-up is long enough to be read but too short to stroll out of.
   */
  WIND_UP: 0.55,
  /**
   * How far outside its reach you can be when the blow finally lands and still be caught.
   *
   * Not nought, or backing off one step would beat everything in the game for ever; not large, or
   * stepping out would never work. It is the width of the decision.
   */
  BITE_SLIP: 0.4,
  ARRIVE_DISTANCE: 0.25,   // close enough to a target to stop
  HUNT_RADIUS: 12,         // dungeon monsters come after the hero from here
  HURT_TIME: 0.35,         // stagger after taking a hit
  KNOCKBACK: 0.7,          // tiles pushed per hit
  /**
   * How close anything may get to the hero before it is pushed out again, in tiles.
   *
   * Without this a swarm stands inside you: three bats occupy the same square as your head, every
   * one of them in reach, and there is no space to react in because there is no space at all. It
   * is the difference between a fight and being deleted.
   */
  PERSONAL: 0.95,
  /** And how close two creatures may get to each other. Less, because a herd should still huddle. */
  ELBOW: 0.6,
  /** How hard bodies push apart, in tiles a second. Firm enough to be immediate, not a bounce. */
  SHOVE: 7,
  HERD_DRIFT: 5,           // how far a herd anchor wanders per move
  PROWL_DRIFT: 9,
  HERD_DRIFT_TIME: [8, 18],
  TURN_RATE: 8,            // radians per second toward the travel direction
  /** Sea hunters notice a swimmer or a boat from here. */
  CIRCLE_NOTICE: 18,
  /** How far off they keep while they are only looking. */
  CIRCLE_RADIUS: 6,
  /** How quickly the ring tightens while they work themselves up. */
  CIRCLE_CLOSE: 0.25,
  /** Seconds between one of them breaking off to charge, fewest and most. */
  CHARGE_EVERY: [5, 11],
  /** How long a charge lasts before it gives up and goes back to circling. */
  CHARGE_TIME: 2.6,
  /**
   * How long a sea hunter waits after a strike before it will bite again. Much longer than a
   * wolf's: a swimmer cannot back away, so without this a pack simply eats them where they float.
   */
  SEA_BITE_COOLDOWN: 5.5,
} as const;

/** Kinds that live in the water and can only move through it. */
export function swims(kind: { behaviour: string }): boolean {
  return kind.behaviour === 'swim' || kind.behaviour === 'circle';
}

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
  /**
   * Position in the floor's monster roster, fixed at spawn. The living list shrinks as creatures
   * are killed, so a plain array index would mean something different on each client; this does
   * not, which is what lets two players agree about the same monster.
   */
  rosterIndex = -1;
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
  /**
   * What to call them. A creature's is drawn from its kind; a villager's is overwritten at spawn
   * with the name the village register has for whoever is standing there.
   */
  name: string;
  role: EntityRole = 'none';
  /**
   * Which villager on the register this is, or empty for anything that is not a resident. It is
   * the register, not this object, that knows their family and what they have seen happen.
   */
  person = '';
  /**
   * What this villager does for a living, which decides their whole day. The name of a tree in
   * behaviours/villagers.json; empty for anything that is not a working person.
   */
  trade = '';
  /** Where their day takes them, filled in when they are spawned into a village. */
  posts: Partial<Record<Post, [number, number]>> = {};
  /** What they have earned and not yet spent. */
  purse = 0;
  /** What they are carrying to market, if anything. */
  carrying: { id: string; count: number } | null = null;
  /**
   * Who this creature is presently interested in: prey it has picked out, or trouble it means to
   * break up. Null means the hero, who is everybody's default business.
   */
  target: Entity | null = null;
  shop: ShopType | null = null;
  /** Door tile villagers walk back to at dusk; they vanish inside on arrival. */
  /** Hidden indoors: not drawn, not interactive, until morning. */
  indoors = false;
  attackCooldown = 0;
  /**
   * Seconds left of the blow being thrown, and which shape it is. A countdown rather than a flag,
   * because the drawing needs to know how far through it is, and because it ends by itself if
   * whatever started it walks away or dies half way through the swing.
   */
  strike = 0;
  blow: Blow = 'punch';
  /** Blows alternate hands, so a flurry of punches is not the same arm four times. */
  offhandBlow = false;
  /** Seconds left of a charge at the player; the movement code reads it to pick a speed. */
  charging = 0;
  /**
   * Seconds left of a blow that has been started but has not landed yet.
   *
   * The gap between deciding to bite and biting, which is the window the player gets to move out
   * of, guard against, or accept. Positive only between those two moments.
   */
  winding = 0;
  /**
   * Whether this particular wind-up has already been announced out loud.
   *
   * A wind-up is only a warning if you can perceive it, and the animation is no use whatsoever for
   * something standing behind you — which is the case where a warning is worth most. So the sound
   * moved to the front of the blow, and this stops it being made again on every frame of one.
   */
  warned = false;
  /** Whatever this creature's behaviour is part way through. Its own, and nobody else's. */
  readonly mind = new Memory();
  hp: number;
  /** Rig parts to leave undrawn, by tag: a helm replaces the hero's own hat. */
  readonly hiddenTags = new Set<string>();
  /** Counts down after a hit; the renderer flashes the creature white while it is positive. */
  hurt = 0;
  dead = false;
  /**
   * Seconds left of going down. A killed creature used to leave the world on the frame it died,
   * which read as things blinking out of a fight rather than being beaten in one; it now keeps a
   * body for as long as this, falls over, and sinks out of sight before it is taken away. Nothing
   * acts, is talked to, is hit again or is counted as alive while it is positive.
   */
  dying = 0;

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
    this.hp = kind.hp ?? 1;
  }

  line(rng: Rng): string {
    const raw = this.kind.lines[Math.floor(rng() * this.kind.lines.length)];
    return raw.replace('{village}', this.herd.tag || 'this village');
  }
}

/** Can this kind stand at (x,z), stepping from height `fromY` (or anywhere if undefined)? */
export function canStand(world: TileWorld, kind: AnimalKind, x: number, z: number, fromY?: number): boolean {
  if (swims(kind)) return world.waterAt(x, z) !== null;
  if (kind.behaviour === 'fly') return true;
  const h = world.heightAt(x, z);
  if (h === null || world.blocked(x, z)) return false;
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

export interface Ctx {
  world: TileWorld;
  rng: Rng;
  playerX: number;
  playerZ: number;
  /** Fraction of the day; villagers go home when it gets late. */
  time?: number;
  /** Hero carries a sword: predators keep away instead of biting. */
  playerArmed: boolean;
  /** Hero is in the water or on a boat, which is what sea hunters are interested in. */
  playerAfloat?: boolean;
  /**
   * The behaviour tree that decides for a creature. Handed in rather than imported: this file is
   * the mechanism, the trees are the content, and the content is allowed to know about the
   * mechanism but not the other way about.
   */
  treeFor?: (e: Entity) => Node<Mind> | null;
  /** The nearest wild animal to somebody, for a villager whose trade is hunting. */
  quarry?: (from: Entity, within: number) => Entity | null;
  /** Take a creature out of the world: a hunter's catch. */
  removeEntity?: (prey: Entity) => void;
  /** The nearest person to somebody: what a wolf is really looking for. */
  nearestPerson?: (from: Entity, within: number) => Entity | null;
  /** The nearest creature attacking somebody, for anybody whose job is to stop that. */
  nearestTrouble?: (from: Entity, within: number) => Entity | null;
  /** One creature hurting another, with nobody's hearts involved. */
  strike?: (attacker: Entity, victim: Entity, damage: number) => void;
  /** What something fetches at market, which is the game's business and not this file's. */
  worth?: (id: string) => number;
  /**
   * A villager has sold something. Handed up rather than kept, because a body in the street is
   * destroyed when the player walks away and the register is what outlives it.
   */
  banked?: (person: string, coin: number) => void;
  /** The hero is wanted by the law: what takes a constable off their beat. */
  wanted?: boolean;
  /** A constable has laid hands on a wanted hero. What that means is the game's business. */
  arrest?: (constable: Entity) => void;
  onAttack: (e: Entity, damage: number) => void;
}

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
  h.timer = BEHAVIOUR.HERD_DRIFT_TIME[0] + ctx.rng() * (BEHAVIOUR.HERD_DRIFT_TIME[1] - BEHAVIOUR.HERD_DRIFT_TIME[0]);
  const wander = h.kind.behaviour === 'prowl' ? BEHAVIOUR.PROWL_DRIFT : BEHAVIOUR.HERD_DRIFT;
  for (let i = 0; i < 6; i++) {
    const a = ctx.rng() * Math.PI * 2;
    const nx = h.ax + Math.cos(a) * wander, nz = h.az + Math.sin(a) * wander;
    if (Math.hypot(nx - h.homeX, nz - h.homeZ) > h.leash) continue;
    if (!canStand(ctx.world, h.kind, nx, nz)) continue;
    h.ax = nx; h.az = nz;
    return;
  }
}

/** Step towards a spot; true once you are standing on it. */
function walkTowards(e: Entity, target: [number, number], dt: number, world: TileWorld): boolean {
  const dx = target[0] - e.x, dz = target[1] - e.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.6) return true;
  e.yaw = yawFor(dx, dz);
  e.walk += (1 - e.walk) * Math.min(1, dt * 10);
  e.phase += dt * 8;
  tryMove(world, e, (dx / dist) * e.kind.speed * dt, (dz / dist) * e.kind.speed * dt);
  const gy = groundY(world, e.kind, e.x, e.z);
  if (gy !== null) e.y += (gy - e.y) * Math.min(1, dt * 12);
  return false;
}

/**
 * Throw a blow: whatever shape it is, it starts now.
 *
 * Called from wherever an attack actually lands rather than from the drawing, so a creature that
 * swings and misses still swings, and a blow that kills something still finishes.
 */
export function throwBlow(e: Entity, blow: Blow): void {
  e.blow = blow;
  e.strike = lastsFor(blow);
  if (mirrors(blow)) e.offhandBlow = !e.offhandBlow;
}

/** Turn tail: run directly away from the player for a short while. */
function startFlee(e: Entity, awayX: number, awayZ: number, rng: Rng): void {
  e.state = 'flee';
  e.timer = BEHAVIOUR.FLEE_TIME[0] + rng() * (BEHAVIOUR.FLEE_TIME[1] - BEHAVIOUR.FLEE_TIME[0]);
  const len = Math.hypot(awayX, awayZ) || 1;
  e.fleeX = awayX / len; e.fleeZ = awayZ / len;
  e.headPitch = 0;
}

/** Wander radius per behaviour when picking a new target. */
const WANDER_RADIUS: Record<Behaviour, number> = {
  graze: 4, wander: 4, swim: 4, fly: 4, prowl: 8, travel: 7, hop: 2.5, hunt: 6,
  // sea hunters range wide while nothing afloat is holding their attention
  circle: 16,
};

/**
 * Take a hit: lose hp, stagger, get knocked back a little. Returns true if this killed it.
 * Survivors that can fight back go straight for the hero.
 */
export function damageEntity(e: Entity, damage: number, fromX: number, fromZ: number, world: TileWorld): boolean {
  e.hp -= damage;
  e.hurt = BEHAVIOUR.HURT_TIME;
  const dx = e.x - fromX, dz = e.z - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  tryMove(world, e, (dx / len) * BEHAVIOUR.KNOCKBACK, (dz / len) * BEHAVIOUR.KNOCKBACK);
  if (e.hp <= 0) { e.dead = true; return true; }
  if (e.kind.timid) { startFlee(e, dx, dz, () => 0.5); }
  return false;
}

/** Villagers are out between these times; outside them they head home and stay in. */
export const AWAKE = [0.27, 0.82] as const;

export function isDaytime(time: number): boolean {
  return time >= AWAKE[0] && time < AWAKE[1];
}

export function updateEntity(e: Entity, dt: number, ctx: Ctx): void {
  const k = e.kind;
  const { world } = ctx;
  if (e.role === 'mount') return;   // your horse waits where you left it
  // a body on its way to the ground has nothing left to decide. The countdown itself is kept by
  // the manager, so a creature killed as the hero runs out of range still finishes falling and
  // still leaves the world rather than being left standing for ever in an unwatched field
  if (e.dying > 0) return;
  e.timer -= dt;

  if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
  if (e.strike > 0) e.strike = Math.max(0, e.strike - dt);
  e.attackCooldown -= dt;

  // what this creature does next is decided in behaviours/, by kind or by trade
  ctx.treeFor?.(e)?.({
      dt,
      memory: e.mind,
      world: {
        self: e,
        ground: world,
        playerX: ctx.playerX, playerZ: ctx.playerZ,
        playerAfloat: ctx.playerAfloat === true,
        playerArmed: ctx.playerArmed,
        rng: ctx.rng,
        bite: ctx.onAttack,
        time: ctx.time ?? 0.5,
        quarry: ctx.quarry ?? (() => null),
        remove: ctx.removeEntity ?? (() => {}),
        nearestPerson: ctx.nearestPerson ?? (() => null),
        nearestTrouble: ctx.nearestTrouble ?? (() => null),
        strike: ctx.strike ?? (() => {}),
        worth: ctx.worth ?? (() => 0),
        banked: ctx.banked,
        wanted: ctx.wanted === true,
        arrest: ctx.arrest ?? (() => {}),
      },
  });


  // somebody who has gone inside for the night is not on the street to be moved about
  if (e.indoors) { e.walk = 0; return; }

  const hopper = k.behaviour === 'hop';
  let moving = false;
  let speed = 0;

  switch (e.state) {
    case 'idle':
      e.walk = 0;
      e.headPitch += (0 - e.headPitch) * Math.min(1, dt * 6);
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
        // a creature bearing down on somebody moves at its running speed, not its ambling one
        const chasing = k.behaviour === 'hunt' || e.charging > 0;
        if (chasing && dist > BEHAVIOUR.ARRIVE_DISTANCE) speed = k.runSpeed;
        if (dist < BEHAVIOUR.ARRIVE_DISTANCE || e.timer <= 0) {
          e.state = 'idle'; e.timer = hopper ? 0.4 + ctx.rng() * 1.5 : 1 + ctx.rng() * 3;
          e.bobY = 0;
          break;
        }
        dx /= dist; dz /= dist;
        // only set a pace if the chase above did not already: this line used to run
        // unconditionally and threw the chase away, so nothing in the game had ever pursued
        // anything at its running speed, and a wolf could be walked away from
        if (speed === 0) speed = hopper ? k.runSpeed * 0.8 : k.speed;
      }
      const stepLen = speed * dt;
      const desiredYaw = yawFor(dx, dz);
      e.yaw = turnToward(e.yaw, desiredYaw, dt * BEHAVIOUR.TURN_RATE);
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
    case 'fly':
      // a flier's whole movement is done by its own verbs; the ground-walking rules do not apply
      break;

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

