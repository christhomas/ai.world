import type { Entity } from '../entities/entity';
import type { AirBelow, Landing, Steer } from './gliding';

/**
 * The thing in the crater, and what it is like to fly.
 *
 * A wing is a way of spending height you already had: no engine, no climbing, and every second of
 * it costs you some of the altitude you started with. This is the opposite and is deliberately a
 * different verb — it hovers, it has thrust, and it goes where you point it for as long as you
 * care to hold the key.
 *
 * ## Why it drifts
 *
 * Because that is the whole game. This is *Zarch* — Braben, 1988, the one everybody played on an
 * Archimedes and then on an Amiga as `Virus` — and what made flying it memorable was that thrust
 * moved the craft rather than the pilot: you leaned, you built up speed, and then you spent the
 * next two seconds getting rid of it before you hit the hill you were aiming at. A craft that stops
 * the moment you let go is a cursor. So a steer adds to a velocity here, drag takes it away slowly,
 * and arriving anywhere on purpose is a skill.
 *
 * ## Why it hovers rather than climbs
 *
 * It holds `HOVER` above whatever it is over, and the ground decides the rest: cross a ridge and
 * you rise with it, cross a valley and you drop into it. That keeps the one number a pilot has to
 * think about — where the ground is going — and it means the country is what you are flying
 * *through* rather than a texture a long way below. It also costs no extra keys, and the two keys
 * a flier has are the two the walker already uses.
 *
 * ## What stops you
 *
 * A hillside at speed. The rule is the wing's own — anything standing taller than you are high is
 * something you hit — with the difference that a wing clips it and spills the air, while this is
 * going three times as fast and puts you in the ground. The sea is the sea, as ever.
 */

export const CRAFT = {
  /**
   * How high it rides above the ground under it, in world units.
   *
   * Above a house and under the treetops. High enough that the country reads as country and a
   * village is a thing you fly over rather than through; low enough that the ground is plainly the
   * thing you are about to hit, which is what makes the flying a game rather than a map screen.
   */
  HOVER: 4.2,
  /** How hard the engine pushes, in world units a second squared. */
  THRUST: 16,
  /**
   * What the air takes back, as a share of speed a second.
   *
   * The number that decides whether this is a hovercraft or a mouse pointer. At this rate a craft
   * at full speed with the key released is still doing half of it two seconds later, which is long
   * enough to be a mistake you have to fly out of.
   */
  DRAG: 0.55,
  /** The fastest it will go, in world units a second. About four times a running hero. */
  TOP: 21,
  /** How fast it settles onto its hover height when the ground under it changes. */
  SETTLE: 3.4,
  /**
   * How fast you may meet something and still walk away from it, in world units a second.
   *
   * Below this you have merely bumped it and the craft stops. Above it, the ground has you — which
   * is the whole of the risk, and the reason the drag matters.
   */
  SURVIVABLE: 9,
} as const;

/** A craft in the air, or on the ground waiting to be climbed into. */
export class Craft {
  private aloft = false;
  /** Where it is going, in world units a second, as a vector rather than a heading. */
  private vx = 0;
  private vz = 0;
  /** How high it is, in world units. Its own number, because the hero is a passenger. */
  private high = 0;

  get flying(): boolean { return this.aloft; }
  get altitude(): number { return this.high; }
  /** How fast it is going over the ground, which is the readout a pilot actually wants. */
  get speed(): number { return Math.hypot(this.vx, this.vz); }

  /** Climb in. Answers false when there is no ground under it to lift off from. */
  lift(hero: Entity, ground: number): boolean {
    if (this.aloft) return false;
    this.aloft = true;
    this.vx = 0; this.vz = 0;
    this.high = ground + CRAFT.HOVER;
    hero.y = this.high;
    return true;
  }

  /** Set it down, wherever it has got to: a landing, a crash, a doorway, the title screen. */
  land(): void {
    this.aloft = false;
    this.vx = 0; this.vz = 0;
  }

  /**
   * One frame of flight.
   *
   * The same shape as a glide — a steer in, a landing out — so that the player's own `carries`
   * seam takes either without knowing which it has. What differs is everything between.
   */
  update(dt: number, steer: Steer, hero: Entity, world: AirBelow): Landing {
    if (!this.aloft) return 'ground';

    // thrust where the keys point, which is camera-relative and already what a walker gets
    const len = Math.hypot(steer.dx, steer.dz);
    if (len > 0) {
      this.vx += (steer.dx / len) * CRAFT.THRUST * dt;
      this.vz += (steer.dz / len) * CRAFT.THRUST * dt;
    }
    // and the air takes some of it back, whether or not anybody is pushing
    const kept = Math.max(0, 1 - CRAFT.DRAG * dt);
    this.vx *= kept; this.vz *= kept;
    const going = Math.hypot(this.vx, this.vz);
    if (going > CRAFT.TOP) {
      this.vx = (this.vx / going) * CRAFT.TOP;
      this.vz = (this.vz / going) * CRAFT.TOP;
    }

    const wasX = hero.x, wasZ = hero.z;
    hero.x += this.vx * dt;
    hero.z += this.vz * dt;
    // pointed where it is actually going rather than where it was asked to go, which is what makes
    // a drifting craft read as drifting rather than as a model sliding sideways
    if (going > 0.2) hero.yaw = Math.atan2(-this.vz, this.vx);

    const under = world.heightAt(hero.x, hero.z);
    const water = world.waterAt(hero.x, hero.z);
    if (under === null && water !== null) {
      // the sea does not care what you are flying
      hero.x = wasX; hero.z = wasZ;
      this.land();
      return 'water';
    }

    /*
     * Anything standing taller than you are high is something you hit.
     *
     * The wing's rule, with the wing's own `blocked` question. What differs is the speed: a glider
     * brushing a roof spills the air and comes down beside it, and this arrives at twenty units a
     * second. Under `SURVIVABLE` it is a bump and the craft stops dead; above it, it is a crash.
     */
    const over = this.high - (under ?? 0);
    if (world.blocked(hero.x, hero.z, { hw: 0.8, hd: 0.8, rot: hero.yaw, over })) {
      hero.x = wasX; hero.z = wasZ;
      const hard = going;
      this.vx = 0; this.vz = 0;
      if (hard > CRAFT.SURVIVABLE) { this.land(); return 'hit'; }
      return 'flying';
    }

    // and it rides the country: over a ridge it rises, into a valley it falls
    const want = (under ?? water ?? 0) + CRAFT.HOVER;
    this.high += (want - this.high) * Math.min(1, dt * CRAFT.SETTLE);
    hero.y = this.high;
    return 'flying';
  }
}

/**
 * The craft as the rest of the game meets it: something to climb into, and something to climb out of.
 *
 * The same shape `createWing` has, because the hero's `carries` seam takes either without knowing
 * which it holds — a thing that is flying, told each frame which way the keys are pointing. What
 * differs is everything inside it, and one thing outside: a wing is kit you bought and can open
 * anywhere there is air, and this is a place. You find it, you get in, and when you get out you are
 * standing wherever you put it down.
 */
export function createCraft(o: {
  world: () => AirBelow;
  hero: () => Entity;
  say: (line: string) => void;
  /** The sea, or a hillside met at speed. The same door the wolves use. */
  knockOut: (cause: string) => void;
  /** Whatever else the hero was carrying, handed back when he climbs out. */
  onLanded: () => void;
}) {
  const craft = new Craft();
  return {
    get flying(): boolean { return craft.flying; },
    get altitude(): number { return craft.altitude; },
    get speed(): number { return craft.speed; },

    /** Climb in, if there is ground under it to lift off from. */
    lift(): boolean {
      const hero = o.hero();
      const ground = o.world().heightAt(hero.x, hero.z);
      if (ground === null || !craft.lift(hero, ground)) return false;
      o.say('Something under the hull answers you, and the ground lets go.');
      return true;
    },

    /** Set it down where it is. Answers false when it was never up. */
    land(): boolean {
      if (!craft.flying) return false;
      craft.land();
      o.say('You set it down and the humming stops.');
      o.onLanded();
      return true;
    },

    /** Put it away without a word: a knockout, a doorway, a teleport, the title screen. */
    fold(): void { craft.land(); },

    update(dt: number, steer: Steer, hero: Entity, world: AirBelow): Landing {
      const how = craft.update(dt, steer, hero, world);
      if (how === 'water') { o.knockOut('The sea'); o.onLanded(); }
      if (how === 'hit') { o.say('You put it into the hillside.'); o.knockOut('The ground'); o.onLanded(); }
      return how;
    },
  };
}

export type Flier = ReturnType<typeof createCraft>;
