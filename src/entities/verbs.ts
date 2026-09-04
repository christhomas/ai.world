import { act, type Node, type Tick } from '../core/behaviour';
import type { Params, Vocabulary } from '../core/behaviourFile';
import { BEHAVIOUR, canStand, yawFor, type Entity, type TileWorld } from './entity';
import type { Rng } from '../core/rng';

/**
 * What a behaviour file is allowed to say about a creature.
 *
 * This is the vocabulary: every verb a tree may use, and every question it may ask. The files in
 * `behaviours/` compose these; they cannot invent new ones, which is the point — the tree shape is
 * the designer's, and what a word actually means is the game's.
 *
 * Each verb is small on purpose. `charge` moves toward the hero and says whether it is still
 * going; deciding when to charge belongs in the file, not here.
 */

/** What a creature knows while it is deciding. */
export interface Mind {
  self: Entity;
  /** The world it is standing in, for picking somewhere it could actually go. */
  ground: TileWorld;
  playerX: number;
  playerZ: number;
  /** The hero is on a boat or in the water: what a sea hunter is interested in. */
  playerAfloat: boolean;
  /** The hero has something sharp: what makes an animal think twice. */
  playerArmed: boolean;
  rng: Rng;
  /** Bite the hero for this creature's usual damage. */
  bite: (e: Entity, damage: number) => void;
}

/** Somewhere this creature could stand, within `radius` of its herd's patch. */
function somewhereNear(mind: Mind, radius: number): boolean {
  const { self, ground, rng } = mind;
  const herd = self.herd;
  for (let tries = 0; tries < 8; tries++) {
    const angle = rng() * Math.PI * 2;
    const away = 0.5 + rng() * radius;
    const x = herd.ax + Math.cos(angle) * away;
    const z = herd.az + Math.sin(angle) * away;
    if (!canStand(ground, self.kind, x, z, self.y)) continue;
    self.tx = x;
    self.tz = z;
    return true;
  }
  return false;
}

type CreatureNode = Node<Mind>;
const number = (params: Params, key: string, fallback: number): number =>
  (typeof params[key] === 'number' ? params[key] : fallback);

/** How far the hero is, squared, which is what every question about distance really wants. */
function rangeTo(tick: Tick<Mind>): number {
  const { self, playerX, playerZ } = tick.world;
  return Math.hypot(self.x - playerX, self.z - playerZ);
}

export const CREATURE_VERBS: Vocabulary<Mind> = {
  questions: {
    /** Is the hero on the water? */
    afloat: () => (tick) => tick.world.playerAfloat,

    /** Is the hero carrying something sharp? */
    armed: () => (tick) => tick.world.playerArmed,

    /** Is the hero within this many tiles? */
    within: (params) => (tick) => rangeTo(tick) <= number(params, 'tiles', 10),

    /** A roll of the dice, so a file can say "about half the time". */
    chance: (params) => (tick) => tick.world.rng() < number(params, 'p', 0.5),

    /** Is this creature standing about with nothing to do? */
    idle: () => (tick) => tick.world.self.state === 'idle',

    /** Does this kind of creature attack at all? */
    dangerous: () => (tick) => (tick.world.self.kind.dangerous ?? 0) > 0,

    /** Is this creature hurt below a share of its hit points? */
    wounded: (params) => (tick) => {
      const { self } = tick.world;
      const full = self.kind.hp ?? 1;
      return self.hp <= full * number(params, 'share', 0.34);
    },
  },

  actions: {
    /**
     * Hold station on the hero, going round them at `tiles` off.
     *
     * The aiming point is `lead` radians further round the ring rather than where the creature
     * already is, because a target it has effectively arrived at is a target it stops for. Lead
     * it, and the swimming itself becomes the orbit.
     */
    circle: (params) => act(({ world }) => {
      const { self, playerX, playerZ } = world;
      const ring = number(params, 'tiles', 6);
      const ahead = Math.atan2(self.z - playerZ, self.x - playerX) + number(params, 'lead', 0.7);
      self.tx = playerX + Math.cos(ahead) * ring;
      self.tz = playerZ + Math.sin(ahead) * ring;
      // steering is done once per tick, not over time: succeed, so a latch above does not hold on
      // to us and never reconsider what else might be worth doing
      self.state = 'walk';
      self.timer = Math.max(self.timer, 1);
    }),

    /**
     * Straight at the hero, at a run, for as long as the file says. Success when the seconds are
     * up; it is the file's business whether that counts as a hit.
     */
    charge: (params) => {
      const key = Symbol('charge');
      const seconds = number(params, 'seconds', 2.6);
      return (tick) => {
        const { self, playerX, playerZ } = tick.world;
        const left = tick.memory.get(key, seconds) - tick.dt;
        self.tx = playerX;
        self.tz = playerZ;
        self.charging = Math.max(0, left);
        if (self.state !== 'walk') { self.state = 'walk'; self.timer = seconds; }
        if (left > 0) { tick.memory.set(key, left); return 'running'; }
        tick.memory.clear(key);
        self.charging = 0;
        return 'success';
      };
    },

    /** Bite, if the hero is close enough to bite. Fails when they are not. */
    bite: (params) => (tick) => {
      const { self, playerX, playerZ, bite } = tick.world;
      const reach = number(params, 'tiles', BEHAVIOUR.BITE_RANGE);
      if (rangeTo(tick) > reach || self.attackCooldown > 0) return 'failure';
      self.attackCooldown = number(params, 'cooldown', BEHAVIOUR.BITE_COOLDOWN);
      self.yaw = yawFor(playerX - self.x, playerZ - self.z);
      bite(self, self.kind.dangerous ?? 1);
      return 'success';
    },

    /** Turn tail and run, for as long as a fright lasts. */
    flee: (params) => {
      const key = Symbol('flee');
      return (tick) => {
        const { self, playerX, playerZ, rng } = tick.world;
        const seconds = tick.memory.get(key, number(params, 'seconds', 2) + rng()) - tick.dt;
        if (self.state !== 'flee') {
          const dx = self.x - playerX, dz = self.z - playerZ;
          const away = Math.hypot(dx, dz) || 1;
          self.fleeX = dx / away;
          self.fleeZ = dz / away;
          self.state = 'flee';
          self.timer = seconds;
        }
        if (seconds > 0) { tick.memory.set(key, seconds); return 'running'; }
        tick.memory.clear(key);
        return 'success';
      };
    },

    /**
     * Amble somewhere within reach of the herd's patch. Only picks a new spot once it has arrived
     * or given up on the last one, so a creature does not twitch between targets every tick.
     */
    wander: (params) => act(({ world }) => {
      const { self } = world;
      if (self.state === 'walk' || self.state === 'hop') return;
      const hopping = params.gait === 'hop';
      if (!somewhereNear(world, number(params, 'tiles', 5))) {
        self.state = 'idle';
        self.timer = 1;
        return;
      }
      self.state = hopping ? 'hop' : 'walk';
      self.timer = hopping ? 0.5 : 6;
    }),

    /** Head down, and stay down for a while: what a grazing animal does most of the time. */
    graze: (params) => {
      const key = Symbol('graze');
      return (tick) => {
        const { self, rng } = tick.world;
        const left = tick.memory.get(key, number(params, 'seconds', 3) + rng() * number(params, 'spread', 3)) - tick.dt;
        self.state = 'graze';
        if (left > 0) { tick.memory.set(key, left); return 'running'; }
        tick.memory.clear(key);
        self.state = 'idle';
        self.timer = 0.5;
        return 'success';
      };
    },

    /** Walk straight at the hero. What a predator does before it is close enough to bite. */
    stalk: () => act(({ world }) => {
      const { self, playerX, playerZ } = world;
      self.tx = playerX;
      self.tz = playerZ;
      if (self.state !== 'walk') { self.state = 'walk'; self.timer = 4; }
    }),

    /** Round and round above the herd's patch, which is all most birds do. */
    patrol: (params) => act(({ world, dt }) => {
      const { self, ground } = world;
      const herd = self.herd;
      const radius = number(params, 'tiles', 4) + (self.slot % 3) * 1.5;
      herd.angle += dt * (self.kind.speed / radius);
      const around = herd.angle + (self.slot % 3) * 2.1;
      const nx = herd.ax + Math.cos(around) * radius;
      const nz = herd.az + Math.sin(around) * radius;
      self.yaw = yawFor(nx - self.x, nz - self.z);
      self.x = nx;
      self.z = nz;
      self.phase += dt * 5;
      self.flap = 1;
      self.walk = 0;
      self.state = 'fly';
      const ground0 = ground.heightAt(herd.ax, herd.az);
      if (ground0 !== null) herd.baseY = ground0;
      const want = herd.baseY + (self.kind.altitude ?? 7) + Math.sin(self.phase * 0.3) * 0.4;
      self.y += (want - self.y) * Math.min(1, dt * 2);
    }),

    /** Straight down at the hero, wings going: a hostile bird's whole plan. */
    dive: (params) => act(({ world, dt }) => {
      const { self, playerX, playerZ, ground } = world;
      const dx = playerX - self.x, dz = playerZ - self.z;
      const away = Math.hypot(dx, dz) || 1;
      const step = Math.min(away, self.kind.speed * dt);
      self.x += (dx / away) * step;
      self.z += (dz / away) * step;
      self.yaw = yawFor(dx, dz);
      self.phase += dt * 12;
      self.flap = 1;
      self.state = 'fly';
      const under = ground.heightAt(self.x, self.z) ?? self.herd.baseY;
      const close = away < number(params, 'drop', 2);
      const want = under + (self.kind.altitude ?? 2) * (close ? 0.45 : 1);
      self.y += (want - self.y) * Math.min(1, dt * 4);
    }),

    /** Nothing in particular: whatever this creature does when nothing is happening. */
    idle: () => act(({ world }) => {
      const { self } = world;
      if (self.state === 'flee') { self.state = 'idle'; self.timer = 1; }
      self.charging = 0;
    }),
  },
};

/** A range rolled from the world's own generator, so two machines roll the same. */
export const rollSeconds = (tick: Tick<Mind>, low: number, high: number): number =>
  low + tick.world.rng() * (high - low);

export type { CreatureNode };
