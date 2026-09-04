import { act, type Node, type Tick } from '../core/behaviour';
import type { Params, Vocabulary } from '../core/behaviourFile';
import { BEHAVIOUR, canStand, yawFor, type Entity, type Post, type TileWorld } from './entity';
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
  /** Fraction of the day, for anybody whose work has hours. */
  time: number;
  /** The nearest wild animal worth taking, for somebody who hunts for a living. */
  quarry: (from: Entity, within: number) => Entity | null;
  /** Take a creature out of the world: a hunter's catch, and nothing else. */
  remove: (prey: Entity) => void;
  /** The nearest person — villager, traveller, anybody with a life to lose — to a point. */
  nearestPerson: (from: Entity, within: number) => Entity | null;
  /** The nearest creature attacking somebody, for anybody whose job is to stop that. */
  nearestTrouble: (from: Entity, within: number) => Entity | null;
  /** Hurt a creature rather than the hero: a wolf on a farmer, a constable on the wolf. */
  strike: (attacker: Entity, victim: Entity, damage: number) => void;
  /**
   * What something fetches at market. Handed in rather than looked up: what a pelt is worth is
   * the game's business, and a creature's vocabulary has no reason to know the item catalogue.
   */
  worth: (id: string) => number;
}

/** Where this creature's attention is: whatever it has marked, or the hero if it has marked nothing. */
function aimOf(mind: Mind): { x: number; z: number; who: Entity | null } {
  const marked = mind.self.target;
  if (marked && !marked.dead) return { x: marked.x, z: marked.z, who: marked };
  return { x: mind.playerX, z: mind.playerZ, who: null };
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

/** How far off whatever this creature is interested in is. */
function rangeTo(tick: Tick<Mind>): number {
  const aim = aimOf(tick.world);
  return Math.hypot(tick.world.self.x - aim.x, tick.world.self.z - aim.z);
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

    /** Is it between these two times of day? Fractions of a day, so 0.5 is noon. */
    hourBetween: (params) => (tick) => {
      const from = number(params, 'from', 0);
      const to = number(params, 'to', 1);
      const now = tick.world.time;
      return from <= to ? now >= from && now < to : now >= from || now < to;
    },

    /** Is somebody nearby being attacked by something? */
    troubleNearby: (params) => (tick) => tick.world.nearestTrouble(tick.world.self, number(params, 'within', 14)) !== null,

    /** Is this villager carrying something to market? */
    carrying: () => (tick) => tick.world.self.carrying !== null,

    /** Has this villager earned at least this much and not yet spent it? */
    purse: (params) => (tick) => tick.world.self.purse >= number(params, 'atLeast', 1),

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
      const { self } = world;
      const aim = aimOf(world);
      const ring = number(params, 'tiles', 6);
      const ahead = Math.atan2(self.z - aim.z, self.x - aim.x) + number(params, 'lead', 0.7);
      self.tx = aim.x + Math.cos(ahead) * ring;
      self.tz = aim.z + Math.sin(ahead) * ring;
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
        const { self } = tick.world;
        const aim = aimOf(tick.world);
        const left = tick.memory.get(key, seconds) - tick.dt;
        self.tx = aim.x;
        self.tz = aim.z;
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
      const { self, bite, strike } = tick.world;
      const aim = aimOf(tick.world);
      const reach = number(params, 'tiles', BEHAVIOUR.BITE_RANGE);
      if (rangeTo(tick) > reach || self.attackCooldown > 0) return 'failure';
      self.attackCooldown = number(params, 'cooldown', BEHAVIOUR.BITE_COOLDOWN);
      self.yaw = yawFor(aim.x - self.x, aim.z - self.z);
      const damage = number(params, 'damage', self.kind.dangerous ?? 1);
      // the hero has hearts and a HUD; anybody else is just another creature to be hurt
      if (aim.who) strike(self, aim.who, damage); else bite(self, damage);
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
      self.indoors = false;
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
      const { self } = world;
      const aim = aimOf(world);
      self.tx = aim.x;
      self.tz = aim.z;
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
      const { self, ground } = world;
      const aim = aimOf(world);
      const dx = aim.x - self.x, dz = aim.z - self.z;
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

    /**
     * Head for one of the places this villager's day sends them. Running while they are still
     * walking, success once they are there, failure if their trade has no such place — a village
     * with no shore has no shore for a sailor to stand on.
     */
    goTo: (params) => (tick) => {
      const { self } = tick.world;
      const post = self.posts[String(params.post ?? 'square') as Post];
      if (!post) return 'failure';
      // the herd anchor is where somebody potters about, so moving it moves their whole day
      self.herd.ax = post[0];
      self.herd.az = post[1];
      // somebody going through their own front door has to reach it; standing about at a post is
      // near enough at a few paces
      const close = number(params, 'within', params.enter === true ? 1.2 : 3);
      const away = Math.hypot(self.x - post[0], self.z - post[1]);
      if (away > close) {
        self.indoors = false;
        self.tx = post[0];
        self.tz = post[1];
        if (self.state !== 'walk') { self.state = 'walk'; self.timer = 8; }
        return 'running';
      }
      // arrived. `enter` is what takes somebody off the street and through their own front door:
      // they step onto the threshold itself, since the next thing they do is stop being drawn
      if (params.enter === true) {
        self.x = post[0];
        self.z = post[1];
        self.indoors = true;
        self.walk = 0;
        // indoors and doing nothing, which is what lets the morning's branch pick them up again
        self.state = 'idle';
        self.timer = 0;
      }
      return 'success';
    },

    /** Range further than anybody sensible would, and keep ranging. */
    roam: (params) => act(({ world }) => {
      const { self } = world;
      self.indoors = false;
      if (self.state === 'walk') return;
      somewhereNear(world, number(params, 'tiles', 20));
      self.state = 'walk';
      self.timer = 12;
    }),

    /** Close on the nearest wild animal. Fails when there is nothing about worth taking. */
    stalkQuarry: (params) => (tick) => {
      const { self, quarry } = tick.world;
      const prey = quarry(self, number(params, 'within', 30));
      if (!prey) return 'failure';
      self.tx = prey.x;
      self.tz = prey.z;
      if (self.state !== 'walk') { self.state = 'walk'; self.timer = 10; }
      return Math.hypot(self.x - prey.x, self.z - prey.z) <= number(params, 'reach', 1.6) ? 'success' : 'running';
    },

    /** Take what has been run down: it leaves the world, and goes on the hunter's shoulder. */
    take: (params) => (tick) => {
      const { self, quarry, remove } = tick.world;
      const prey = quarry(self, number(params, 'reach', 1.8));
      if (!prey) return 'failure';
      remove(prey);
      self.carrying = { id: prey.kind.drop?.id ?? 'meat', count: 1 };
      self.state = 'idle';
      self.timer = 1;
      return 'success';
    },

    /** Hand over what is being carried, and take the coin for it. */
    sell: () => (tick) => {
      const { self } = tick.world;
      if (!self.carrying) return 'failure';
      self.purse += tick.world.worth(self.carrying.id) * self.carrying.count;
      self.carrying = null;
      self.state = 'idle';
      self.timer = 1.5;
      return 'success';
    },

    /** Spend some of what is in the purse, on whatever this trade spends money on. */
    spend: (params) => (tick) => {
      const { self } = tick.world;
      const cost = number(params, 'cost', params.on === 'gear' ? 40 : 6);
      if (self.purse < cost) return 'failure';
      self.purse -= cost;
      self.state = 'idle';
      self.timer = 2;
      return 'success';
    },

    /**
     * Pick out somebody to go after: the nearest person, or the hero if they are nearer. Fails
     * when there is nobody about, which is how a tree says "carry on as you were".
     *
     * Everything that acts on a target — stalk, bite, charge, circle — works on whatever was
     * marked here, so one small vocabulary covers a wolf on a farmer and a wolf on the hero.
     */
    markPrey: (params) => (tick) => {
      const { self, nearestPerson, playerX, playerZ } = tick.world;
      const reach = number(params, 'within', 10);
      const person = nearestPerson(self, reach);
      const toPlayer = Math.hypot(self.x - playerX, self.z - playerZ);
      if (person && Math.hypot(self.x - person.x, self.z - person.z) < Math.min(reach, toPlayer)) {
        self.target = person;
        return 'success';
      }
      self.target = null;
      return toPlayer <= reach ? 'success' : 'failure';
    },

    /** Look for somebody being attacked, and make them your business. What a constable is for. */
    markTrouble: (params) => (tick) => {
      const { self, nearestTrouble } = tick.world;
      const culprit = nearestTrouble(self, number(params, 'within', 14));
      if (!culprit) return 'failure';
      self.target = culprit;
      return 'success';
    },

    /** Forget whoever was marked, and go back to minding the hero like everything else. */
    forget: () => act(({ world }) => { world.self.target = null; }),

    /**
     * Sit still and mend. Paid care is quick; the free kind takes three times as long, which is
     * the whole of the doctor's economy — nobody who asks for help dies, but money buys getting
     * back to work today rather than tomorrow.
     */
    beHealed: (params) => {
      const key = Symbol('healing');
      return (tick) => {
        const { self } = tick.world;
        const fee = number(params, 'fee', 8);
        const paying = self.purse >= fee;
        const takes = number(params, 'seconds', 6) * (paying ? 1 : number(params, 'freeShare', 3));
        const left = tick.memory.get(key, takes) - tick.dt;
        self.state = 'idle';
        self.timer = 1;
        if (left > 0) { tick.memory.set(key, left); return 'running'; }
        tick.memory.clear(key);
        if (paying) self.purse -= fee;
        self.hp = self.kind.hp ?? self.hp;
        return 'success';
      };
    },

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
