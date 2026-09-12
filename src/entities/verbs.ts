import { act, type Node, type Tick } from '../core/behaviour';
import { bodyOf } from '../world/health';
import type { Params, Vocabulary } from '../core/behaviourFile';
import { BEHAVIOUR, canStand, throwBlow, yawFor, type Entity, type Post, type TileWorld } from './entity';
import { blowOf, tellOf } from './motion';
import { dig, eatSomething, sell, spend, stalkQuarry, take, tendStock } from './living';
import { loose, takePost } from './posted';
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
  /**
   * The nearest of this village's own beasts, past whatever is already at arm's length.
   *
   * The `beyond` is not a detail — see `nearestStock`. Without it a farmer walks to the nearest
   * cow and stands there all morning, because it goes on being the nearest cow.
   */
  stock: (from: Entity, within: number, beyond: number) => Entity | null;
  /** The nearest wild animal worth taking, for somebody who hunts for a living. */
  quarry: (from: Entity, within: number) => Entity | null;
  /** Take a creature out of the world: a hunter's catch, and nothing else. */
  remove: (prey: Entity) => void;
  /** The nearest person — villager, traveller, anybody with a life to lose — to a point. */
  nearestPerson: (from: Entity, within: number) => Entity | null;
  /** The nearest creature attacking somebody, for anybody whose job is to stop that. */
  nearestTrouble: (from: Entity, within: number) => Entity | null;
  /** And the nearest with teeth that has not started anything yet, for somebody told to fight. */
  foe: (from: Entity, within: number) => Entity | null;
  /** Hurt a creature rather than the hero: a wolf on a farmer, a constable on the wolf. */
  strike: (attacker: Entity, victim: Entity, damage: number) => void;
  /** The law wants the hero: somebody has been killed, and the village has had enough of it. */
  wanted: boolean;
  /** Take the hero in. Where they wake and how long they are held is the game's business. */
  arrest: (constable: Entity) => void;
  /**
   * What something fetches at market. Handed in rather than looked up: what a pelt is worth is
   * the game's business, and a creature's vocabulary has no reason to know the item catalogue.
   */
  worth: (id: string) => number;
  /**
   * A sale, reported upward so it reaches the register.
   *
   * Optional because the dungeon and the tests build a world without one, and nothing down there
   * sells anything.
   */
  banked?: (person: string, coin: number, what: string) => void;
  /**
   * And a purchase, the same way: what was actually paid, and to whom.
   *
   * Hands back what changed hands rather than what was asked for, so the body in the street can
   * move its own purse by the same amount and the two cannot drift apart.
   */
  spends?: (person: string, coin: number, from: string) => number;
  /** And somebody has eaten: the register is what remembers how long it is since they last did. */
  fed?: (person: string) => void;
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
export const number = (params: Params, key: string, fallback: number): number =>
  (typeof params[key] === 'number' ? params[key] : fallback);

/** How far off whatever this creature is interested in is. */
function rangeTo(tick: Tick<Mind>): number {
  const aim = aimOf(tick.world);
  return Math.hypot(tick.world.self.x - aim.x, tick.world.self.z - aim.z);
}

/**
 * Every word a behaviour file may use, and nothing else.
 *
 * The questions are one-liners and live here, where the list of them is the whole story. The
 * actions are the named functions below, so this stays a table of what a creature can be told to
 * do rather than a wall of how each thing is done.
 */
export const CREATURE_VERBS: Vocabulary<Mind> = {
  /** What a branch that claimed the tick is, written onto whoever took it. See `Entity.doing`. */
  doing: (tick, what) => { tick.world.self.doing = what; },
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

    /**
     * Is this one down to their last few hearts, whatever took them?
     *
     * Asked of the body's own hit points rather than of anything about food, because by the time a
     * tree is asking there is no difference worth drawing: a villager who has not eaten in four
     * days and a villager a wolf has had four bites of are the same man in the same trouble, and
     * both should stop what they are doing. `wounded` is the same question as a share of the whole,
     * and this is it as a count — three hearts left means three hearts left whether you are a
     * constable with nine of them or a doctor with five.
     */
    hearts: (params) => (tick) => tick.world.self.hp <= number(params, 'below', 3),

    /** Is the hero wanted badly enough for the law to leave its post over? */
    wanted: () => (tick) => tick.world.wanted,

    /** Is this villager carrying something to market? */
    carrying: () => (tick) => tick.world.self.carrying !== null,

    /**
     * Has whoever is paying this one told them to do this?
     *
     * The one word in the vocabulary that is about being *instructed* rather than about what a
     * creature wants or notices. Everything else a tree asks is a fact about the world — the hour,
     * the weather, whether something with teeth is nearby — and this is a fact about what somebody
     * said, which is the whole difference between a villager and a man in your pay.
     *
     * An empty order matches nothing, so a tree written with these branches falls through to
     * whatever it does unbidden, and a man nobody has told anything behaves exactly as he did
     * before there were orders at all.
     */
    told: (params) => (tick) => tick.world.self.told?.what === String(params.to ?? ''),

    /** Has this villager earned at least this much and not yet spent it? */
    purse: (params) => (tick) => tick.world.self.purse >= number(params, 'atLeast', 1),

    /** Does this kind of creature attack at all? */
    /*
     * Has this one got teeth? The question keeps the name `dangerous` while the number it reads is
     * `damage`, and both are right: what a creature hits for is a quantity and whether it hits at
     * all is a fact about it. The number was called `dangerous` too until a rescale went looking
     * for every damage value in the game, searched for "damage", and found none of the creatures.
     */
    dangerous: () => (tick) => (tick.world.self.kind.damage ?? 0) > 0,

    /** Is this creature hurt below a share of its hit points? */
    wounded: (params) => (tick) => {
      const { self } = tick.world;
      const full = self.kind.hp ?? 1;
      return self.hp <= full * number(params, 'share', 0.34);
    },
  },

  /**
   * The verbs themselves are named functions below, grouped the way this list groups them. A new
   * one is a function of the same shape with its name added here; nothing else has to know.
   */
  actions: {
    // getting about, which is what a creature does with its feet when nothing is after it
    wander, roam, patrol, goTo,

    // picking somebody out, closing on them, and the blow itself
    markPrey, markTrouble, markFoe, forget, stalk, circle, charge, dive, bite, arrest,

    // standing somewhere above the ground, and shooting from it
    takePost, loose,

    // backing off, and getting over it
    flee, graze, idle, waitAt, beHealed,

    // making a living, which is what everybody with a trade is doing all day
    stalkQuarry, take, sell, spend, dig, tendStock, eatSomething,
  },
};

// --- getting about ---

/**
 * Amble somewhere within reach of the herd's patch. Only picks a new spot once it has arrived
 * or given up on the last one, so a creature does not twitch between targets every tick.
 */
function wander(params: Params): CreatureNode {
  return act(({ world }) => {
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
  });
}

/** Range further than anybody sensible would, and keep ranging. */
function roam(params: Params): CreatureNode {
  return act(({ world }) => {
    const { self } = world;
    self.indoors = false;
    if (self.state === 'walk') return;
    somewhereNear(world, number(params, 'tiles', 20));
    self.state = 'walk';
    self.timer = 12;
  });
}

/** Round and round above the herd's patch, which is all most birds do. */
function patrol(params: Params): CreatureNode {
  return act(({ world, dt }) => {
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
  });
}

/**
 * Head for one of the places this villager's day sends them. Running while they are still
 * walking, success once they are there, failure if their trade has no such place — a village
 * with no shore has no shore for a sailor to stand on.
 */
function goTo(params: Params): CreatureNode {
  return (tick) => {
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
    /*
     * Arrived.
     *
     * Somebody who is at a post is out of doors, and that has to be said here rather than only on
     * the walk: a man whose own front door is inside the few paces a post counts as "near enough"
     * never takes a step to reach the square, so the line above that puts him outside never runs —
     * and he spends the whole day indoors because he was already close enough to be on it. Found by
     * the test that watches a villager go in at dusk and come out after dawn, the morning the
     * trade-less were given a day of their own.
     */
    if (params.enter !== true) self.indoors = false;
    // `enter` is what takes somebody off the street and through their own front door: they step
    // onto the threshold itself, since the next thing they do is stop being drawn
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
  };
}

// --- going for somebody ---

/**
 * Pick out somebody to go after: the nearest person, or the hero if they are nearer. Fails
 * when there is nobody about, which is how a tree says "carry on as you were".
 *
 * Everything that acts on a target — stalk, bite, charge, circle — works on whatever was
 * marked here, so one small vocabulary covers a wolf on a farmer and a wolf on the hero.
 */
/**
 * Pick out the nearest thing with teeth, started or not.
 *
 * What somebody told to fight does, and the counterpart of `markTrouble`, which waits for the
 * teeth to be on somebody first. A guard waits; a man told to go in does not.
 */
function markFoe(params: Params): CreatureNode {
  return (tick) => {
    const { self, foe } = tick.world;
    const found = foe(self, number(params, 'within', 18));
    self.target = found;
    return found ? 'success' : 'failure';
  };
}

function markPrey(params: Params): CreatureNode {
  return (tick) => {
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
  };
}

/** Look for somebody being attacked, and make them your business. What a constable is for. */
function markTrouble(params: Params): CreatureNode {
  return (tick) => {
    const { self, nearestTrouble } = tick.world;
    const culprit = nearestTrouble(self, number(params, 'within', 14));
    if (!culprit) return 'failure';
    self.target = culprit;
    return 'success';
  };
}

/** Forget whoever was marked, and go back to minding the hero like everything else. */
function forget(): CreatureNode {
  return act(({ world }) => { world.self.target = null; });
}

/** Walk straight at the hero. What a predator does before it is close enough to bite. */
function stalk(): CreatureNode {
  return act(({ world }) => {
    const { self } = world;
    const aim = aimOf(world);
    self.tx = aim.x;
    self.tz = aim.z;
    if (self.state !== 'walk') { self.state = 'walk'; self.timer = 4; }
  });
}

/**
 * Hold station on the hero, going round them at `tiles` off.
 *
 * The aiming point is `lead` radians further round the ring rather than where the creature
 * already is, because a target it has effectively arrived at is a target it stops for. Lead
 * it, and the swimming itself becomes the orbit.
 */
function circle(params: Params): CreatureNode {
  return act(({ world }) => {
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
  });
}

/**
 * Straight at the hero, at a run, for as long as the file says. Success when the seconds are
 * up; it is the file's business whether that counts as a hit.
 */
function charge(params: Params): CreatureNode {
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
}

/** Straight down at the hero, wings going: a hostile bird's whole plan. */
function dive(params: Params): CreatureNode {
  return act(({ world, dt }) => {
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
  });
}

/**
 * Bite, if the hero is close enough to bite. Fails when they are not.
 *
 * A bite is two moments, not one: the creature commits and rears back, and then, a fraction of
 * a second later, the blow lands. It used to be a single instant — throw the animation and
 * take the hearts off in the same tick — which meant the swing you could see was the report of
 * damage you had already taken. Nothing on screen ever preceded anything, so there was nothing
 * to react to, and jamming the attack button was not the laziest way to fight but the only
 * one there was.
 *
 * Splitting it costs one field and buys the whole of the defensive game: a wind-up you can
 * read, a moment where stepping back actually works, and a window a guard can be timed to.
 * The creature commits at the start of it — it does not re-aim while it swings — so backing
 * off during the wind-up beats a blow that was already thrown, which is the deal.
 */
function bite(params: Params): CreatureNode {
  return (tick) => {
    const { self, strike } = tick.world;
    const aim = aimOf(tick.world);
    const reach = number(params, 'tiles', BEHAVIOUR.BITE_RANGE);

    // the wind-up lives on the creature rather than in this node's memory, so that a blow which
    // is interrupted — the thing is frightened off, or killed mid-swing — is over the moment the
    // creature stops being able to throw it, rather than waiting in a tree to be resumed
    if (self.winding <= 0) {
      if (rangeTo(tick) > reach || self.attackCooldown > 0) return 'failure';
      self.attackCooldown = number(params, 'cooldown', BEHAVIOUR.BITE_COOLDOWN);
      self.yaw = yawFor(aim.x - self.x, aim.z - self.z);
      // every creature in the game attacks through this one verb, so it is the only place a
      // blow has to be thrown for wolves, bears, constables and hired swords all to swing
      const shape = blowOf(self.kind);
      throwBlow(self, shape);
      // how much warning this particular blow gives, which is the blow's own business: a bear's
      // rear is slow and readable, a shark's lunge is barely there at all
      self.winding = tellOf(shape, BEHAVIOUR.WIND_UP);
      return 'running';
    }

    self.winding = Math.max(0, self.winding - tick.dt);
    if (self.winding > 0) return 'running';

    // it lands where the creature is now, against wherever the target has got to. A step back
    // during the wind-up is a step out of it, which is the only defence that needs no button.
    if (rangeTo(tick) > reach + BEHAVIOUR.BITE_SLIP) return 'failure';
    const damage = number(params, 'damage', self.kind.damage ?? 1);
    // the hero has hearts and a HUD; anybody else is just another creature to be hurt
    if (aim.who) strike(self, aim.who, damage); else tick.world.bite(self, damage);
    return 'success';
  };
}

/**
 * Lay hands on the hero. Fails while they are out of reach, which is this file's way of
 * saying keep coming. Measured to the hero rather than to whatever is marked, because an
 * arrest is only ever of the hero, and the cooldown is what stops one constable taking them
 * in twice over while the game is still deciding what that means.
 */
function arrest(params: Params): CreatureNode {
  return (tick) => {
    const { self, playerX, playerZ } = tick.world;
    if (self.attackCooldown > 0) return 'failure';
    if (Math.hypot(self.x - playerX, self.z - playerZ) > number(params, 'tiles', 1.8)) return 'failure';
    self.attackCooldown = number(params, 'cooldown', 3);
    throwBlow(self, blowOf(self.kind));
    self.yaw = yawFor(playerX - self.x, playerZ - self.z);
    tick.world.arrest(self);
    return 'success';
  };
}

// --- backing off, and getting over it ---

/** Turn tail and run, for as long as a fright lasts. */
function flee(params: Params): CreatureNode {
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
}

/** Head down, and stay down for a while: what a grazing animal does most of the time. */
function graze(params: Params): CreatureNode {
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
}

/**
 * Stand where you were told to stand, and walk back to it if anything shoves you off.
 *
 * The first order with an argument, and what it is for. "Wait" and "wait *there*" are different
 * instructions and the second is the one anybody means: without a spot, a man told to hold drifts
 * wherever the separation sweep and his own idling take him, and comes back to a player who left
 * him at a bridge standing somewhere else entirely.
 *
 * Falls back to standing still when there is no spot in the order, so it is safe on an instruction
 * that never carried one.
 */
function waitAt(params: Params): CreatureNode {
  return act(({ world }) => {
    const { self } = world;
    const spot = self.told?.at;
    if (!spot) { self.charging = 0; return; }
    const off = Math.hypot(self.x - spot.x, self.z - spot.z);
    if (off > number(params, 'within', 2)) {
      self.tx = spot.x;
      self.tz = spot.z;
      if (self.state !== 'walk') { self.state = 'walk'; self.timer = 4; }
      return;
    }
    // near enough: stop, and stop aiming at anything
    self.tx = self.x;
    self.tz = self.z;
    self.charging = 0;
    if (self.state === 'walk') { self.state = 'idle'; self.timer = 1; }
  });
}

/** Nothing in particular: whatever this creature does when nothing is happening. */
function idle(): CreatureNode {
  return act(({ world }) => {
    const { self } = world;
    if (self.state === 'flee') { self.state = 'idle'; self.timer = 1; }
    self.charging = 0;
  });
}

/**
 * Sit still and mend. Paid care is quick; the free kind takes three times as long, which is
 * the whole of the doctor's economy — nobody who asks for help dies, but money buys getting
 * back to work today rather than tomorrow.
 */
function beHealed(params: Params): CreatureNode {
  const key = Symbol('healing');
  return (tick) => {
    const { self, spends } = tick.world;
    const fee = number(params, 'fee', 8);
    const paying = self.purse >= fee;
    const takes = number(params, 'seconds', 6) * (paying ? 1 : number(params, 'freeShare', 3));
    const left = tick.memory.get(key, takes) - tick.dt;
    self.state = 'idle';
    self.timer = 1;
    if (left > 0) { tick.memory.set(key, left); return 'running'; }
    tick.memory.clear(key);
    /*
     * And the doctor is paid, out of one purse and into another.
     *
     * It was `self.purse -= fee`, which is two faults in the way `spend` was: `self` is the body in
     * the street and it is destroyed the moment a player walks away, so the fee never reached the
     * register and a villager was as rich the next morning as before he was stitched up; and the
     * coin went nowhere, in a village where the doctor is one of the three trades that live on
     * other people's money.
     */
    if (paying) {
      const paid = spends?.(self.person, fee, 'doctor') ?? fee;
      self.purse -= paid;
    }
    bodyOf(self).mend(self.kind.hp ?? 0);
    return 'success';
  };
}

/** A range rolled from the world's own generator, so two machines roll the same. */
export const rollSeconds = (tick: Tick<Mind>, low: number, high: number): number =>
  low + tick.world.rng() * (high - low);

export type { CreatureNode };
