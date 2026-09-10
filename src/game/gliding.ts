import { bodyBox, type Entity, type TileWorld } from '../entities/entity';
import { JUMP } from '../entities/leap';
import { windAt, windSaid, type Wind } from '../world/wind';

/**
 * A canvas wing, and what the wind does with it.
 *
 * The jump made a hero leave the ground for half a second, and the first thing anybody did with it
 * was ask what would happen off the top of a hill. This is that: buy the glider, jump, and open it
 * while you are still up — from then on you are not walking, you are losing height, and where you
 * end up is a question about how high you started and which way the wind is going.
 *
 * Deliberately not flight. There is no climbing, no thermals and no engine: the altitude you have
 * is all you will ever have, and every second of the glide spends some of it. What that buys is
 * something the game did not have — a way of crossing country that rewards *knowing* the country,
 * because the only way to go a long way is to start somewhere high and have the wind behind you.
 *
 * The rules of the air, all four of them:
 *
 *   you sink, always, at `SINK`;
 *   you go forward at `SPEED` wherever you are pointed, and the wind adds itself to that, so the
 *     ground speed you actually make is anywhere between a crawl and a bolt depending on how you
 *     are set against it;
 *   you pass over anything shorter than you are high, which is the jump's own rule with a bigger
 *     number in it — a house at three units up is under you, and a curtain wall at three units up
 *     is not;
 *   you land where the ground comes up to meet you, and if that is the sea, the sea has you.
 */

export const GLIDE = {
  /**
   * How fast height is lost, in world units a second.
   *
   * The glide ratio falls out of this and `SPEED` together: about six of forward to one of down,
   * which is a real hang glider's and, more to the point, is the number that makes a hilltop worth
   * walking up. From the top of a good rise — six or seven units above the valley — that is forty
   * tiles of country, which is a village and a half.
   */
  SINK: 1.2,

  /**
   * How fast the wing itself goes through the air, in world units a second.
   *
   * Faster than running, because a glider that is slower than walking is a worse way of getting
   * anywhere and nobody would ever buy one. Not much faster: the speed that matters is this plus
   * the wind, and with a good wind behind you that is nearly twice a run.
   */
  SPEED: 7.2,

  /** How fast the wing comes round onto a new heading, in radians a second. */
  TURN: 1.9,

  /**
   * How far above the ground you must be for the canvas to catch, in world units.
   *
   * A hair under the top of a jump, so that opening it at the peak of a standing jump works and
   * opening it on the way down does not. That makes a flat-ground launch a real but brief thing —
   * a second of air and a dozen tiles — and a launch off a hill exactly as much better as the hill
   * is high, which is the whole shape of the feature.
   */
  OPEN_ABOVE: 0.95,

  /** How near the ground counts as landed, in world units. */
  TOUCH: 0.25,

  /**
   * How high a column of warm air may carry you, in world units above the ground under it.
   *
   * The columns are `world/thermals.ts`; this is the glider's own ceiling on them, and it is the
   * same number for the same reason: the sky is worth visiting and is not worth living in.
   */
  CEILING: 40,

  /**
   * How much of the sink a good headwind holds off, at most.
   *
   * Flying into the wind is slower over the ground and gentler on the height, which is the one
   * piece of real soaring in here. It is capped well under `SINK`, so a headwind can never mean
   * flying for ever: it buys a longer glide, not a different game.
   */
  LIFT: 0.45,
} as const;

/** Where a glide can be steered from: the same push a walker uses, in the world's own directions. */
export interface Steer {
  dx: number;
  dz: number;
}

/**
 * What a glide needs from the world it is over.
 *
 * The ground, the water and what is standing up. `waterAt` is what tells the sea from the land, and
 * it matters more here than anywhere else in the game: a hero who lands in a field walks away, and
 * a hero who lands in the sea does not.
 */
export interface AirBelow {
  heightAt(x: number, z: number): number | null;
  waterAt(x: number, z: number): number | null;
  blocked(x: number, z: number, body?: { hw: number; hd: number; rot: number; over?: number }): boolean;
}

export type Landing = 'flying' | 'ground' | 'water' | 'hit';

export class Glider {
  /** Whether the canvas is open. Nothing else about this class means anything while it is false. */
  private open = false;
  /** How high the hero is, in world units — the one number a glide is really about. */
  private high = 0;
  /** Which way the wing is pointed. Steering turns this; the wing always goes where it points. */
  private heading = 0;
  /** What the wind was doing when this glide began, so one flight has one wind. */
  private wind: Wind = { x: 1, z: 0, hard: 0 };
  /** Whether the last frame gained height, so the HUD and the sound know a column has been found. */
  private rising = false;

  /**
   * How hard the air is going up here.
   *
   * Handed in rather than reached for, so that this file knows about wings and not about where the
   * warm air stands — and so a test can fly a glider through a column it invented.
   */
  constructor(private readonly lift: (x: number, z: number) => number = () => 0) {}

  get flying(): boolean { return this.open; }
  get altitude(): number { return this.high; }
  get carrying(): Wind { return this.wind; }
  /** Is he going up? What the readout says, and what tells a pilot he has found something. */
  get climbing(): boolean { return this.rising; }

  /**
   * Open the canvas, if there is anything under the hero to open it over.
   *
   * Answers whether it caught, because the key that asks says something different when it did not:
   * "there is no room for it" is a useful sentence and a silent failure is not.
   */
  catchTheWind(hero: Entity, ground: number, seed: number, day: number, time: number): boolean {
    const up = hero.y + hero.bobY - ground;
    /*
     * Off the ground is the whole of the condition, and a jump counts.
     *
     * It was a height alone, and that made the ordinary way in — jump, then open it — a matter of
     * pressing the second key within about a tenth of a second of the top of the arc. Measured on
     * the real thing: a press a frame early is 0.88 above the ground against a bar of 0.95, and
     * nothing happens, with no way for the player to tell that they were close. Anybody in the air
     * may open it; the height is what lets somebody who has *walked* off a cliff open it too.
     */
    if (this.open || (hero.leap <= 0 && up < GLIDE.OPEN_ABOVE)) return false;
    this.open = true;
    /*
     * The glide starts at the top of the jump, not at the instant the key was pressed.
     *
     * Otherwise it is a reflex test: press it a frame after the take-off and the wing catches at
     * two inches, sinks through the ground on the next frame, and the whole flight is over before
     * the message about it has finished appearing — which is exactly what the first version did.
     * A jump earns `JUMP.RISE` of air; catching the wind during one spends it on the wing.
     */
    const earned = hero.leap > 0 ? ground + JUMP.RISE : hero.y + hero.bobY;
    this.high = Math.max(earned, ground + GLIDE.OPEN_ABOVE);
    hero.leap = 0;
    this.heading = hero.yaw;
    this.wind = windAt(seed, day, time);
    return true;
  }

  /** Put it away, wherever the hero has ended up: a landing, a knockout, a staircase, a teleport. */
  fold(): void {
    this.open = false;
    this.high = 0;
    this.rising = false;
  }

  /**
   * One frame of flight. Moves the hero, and says what happened to him.
   *
   * `ground` and `water` come in already looked up for where he is, because the caller has a world
   * and this has an aeroplane. Everything below is arithmetic on two vectors and a height.
   */
  update(dt: number, steer: Steer, hero: Entity, world: AirBelow): Landing {
    if (!this.open) return 'flying';

    // steering: the wing comes round toward whatever is being asked for, and holds its heading
    // when nothing is
    const want = Math.hypot(steer.dx, steer.dz) > 0 ? Math.atan2(-steer.dz, steer.dx) : this.heading;
    let turn = want - this.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const most = GLIDE.TURN * dt;
    this.heading += Math.max(-most, Math.min(most, turn));
    hero.yaw = this.heading;

    // where the wing is going: its own speed along its heading, and the wind laid on top
    const ax = Math.cos(this.heading), az = -Math.sin(this.heading);
    const vx = ax * GLIDE.SPEED + this.wind.x * this.wind.hard;
    const vz = az * GLIDE.SPEED + this.wind.z * this.wind.hard;

    /*
     * How fast height goes, which is where the one piece of real soaring lives.
     *
     * Pointed into the wind you sink more slowly, and pointed downwind you sink at the full rate
     * and cover ground twice as fast. That is the trade a glider pilot actually makes, and it is
     * one dot product: how much of the wing's heading is against the wind.
     */
    const into = -(ax * this.wind.x + az * this.wind.z);
    let rate = GLIDE.SINK - Math.max(0, into) * GLIDE.LIFT * (this.wind.hard / 2.4);
    /*
     * And the warm air, which is the only thing in the sky that gives height back.
     *
     * Asked at the wing rather than at the ground under it, and capped by how high above that
     * ground he already is: a column carries you up until you are `CEILING` over the land it stands
     * on and then lets you go, so the sky has a lid and the lid follows the country.
     */
    const floor = world.heightAt(hero.x, hero.z);
    const room = floor === null ? GLIDE.CEILING : GLIDE.CEILING - (this.high - floor);
    if (room > 0) rate -= Math.min(this.lift(hero.x, hero.z), rate + GLIDE.SINK) * Math.min(1, room / 4);
    this.high -= rate * dt;
    this.rising = rate < 0;

    const nx = hero.x + vx * dt, nz = hero.z + vz * dt;
    const under = world.heightAt(nx, nz);
    const sea = world.waterAt(nx, nz);

    /*
     * What is standing up in front of him, which is the jump's own rule with a bigger number.
     *
     * How high he is over the ground *below him* rather than his height above the sea: a hillside
     * rising into a glide is what puts a hero into a tree, and the tree is on the hillside.
     */
    const over = under === null ? this.high : this.high - under;
    if (world.blocked(nx, nz, bodyBox(hero.kind, hero.yaw, Math.max(0, over)))) {
      // where he actually is rather than where he was going: a wing stopped by a roof comes down
      // on the near side of it, not inside it
      this.landOn(hero, world.heightAt(hero.x, hero.z) ?? this.high);
      return 'hit';
    }

    hero.x = nx;
    hero.z = nz;

    if (under !== null && this.high <= under + GLIDE.TOUCH) {
      this.landOn(hero, under);
      return 'ground';
    }
    if (under === null && sea !== null && this.high <= sea + GLIDE.TOUCH) {
      this.landOn(hero, sea);
      return 'water';
    }
    hero.y = this.high;
    hero.bobY = 0;
    return 'flying';
  }

  private landOn(hero: Entity, y: number): void {
    hero.y = y;
    hero.bobY = 0;
    this.fold();
  }
}

/**
 * The wing as the rest of the game meets it: something to open, something that flies the hero, and
 * an ending.
 *
 * `Glider` above is the aerodynamics and knows nothing about hearts, journals or the sea being
 * fatal. This is the seam: it opens the canvas when there is room, hands the glide to whoever is
 * updating the hero, and turns the three ways a flight can end into the three things the game does
 * about them.
 */
export function createWing(o: {
  seed: number;
  /** The world under him, which changes when he steps into a building or a cave. */
  world: () => TileWorld;
  hero: () => Entity;
  /** The day and the fraction of it, for the wind that this flight will be flown in. */
  clock: () => { day: number; time: number };
  /** Whether he is carrying one at all. */
  hasOne: () => boolean;
  /** How hard the air is going up at a point, so a test can fly through a column it invented. */
  lift: (x: number, z: number) => number;
  say: (line: string) => void;
  /** The sea, or a hillside met at speed. Same door the wolves use. */
  knockOut: (cause: string) => void;
}) {
  const glider = new Glider(o.lift);
  return {
    /** Whether the canvas is open, which is what the walker asks before it does anything at all. */
    get flying(): boolean { return glider.flying; },
    get altitude(): number { return glider.altitude; },
    get climbing(): boolean { return glider.climbing; },
    get wind(): Wind { return glider.carrying; },

    /**
     * Open it, if he has one and there is air under him.
     *
     * Answers whether it caught. Silence is the wrong reply to a key that did nothing: a player who
     * presses it standing in a field deserves to be told that this is a thing you do off a height.
     */
    open(): boolean {
      if (glider.flying || !o.hasOne()) return false;
      const hero = o.hero();
      const ground = o.world().heightAt(hero.x, hero.z);
      if (ground === null) return false;
      const { day, time } = o.clock();
      if (!glider.catchTheWind(hero, ground, o.seed, day, time)) {
        // and nothing said when he is plainly standing on the ground: the same key jumps, so the
        // jump is the answer. The sentence is for somebody who *is* in the air and too low for it,
        // which is a thing worth being told about
        if (hero.leap > 0 || hero.y + hero.bobY - ground > 0.2) {
          o.say('Not enough air under you. Open it from something higher.');
        }
        return false;
      }
      o.say(`The canvas cracks open and the wind takes you, out of the ${windSaid(glider.carrying)}.`);
      return true;
    },

    /** Put it away, wherever he has ended up: a knockout, a doorway, a teleport, the title screen. */
    fold(): void { glider.fold(); },

    /** One frame of flight, and whatever the game owes the player about how it ended. */
    update(dt: number, steer: Steer, hero: Entity, world: TileWorld): Landing {
      const how = glider.update(dt, steer, hero, world);
      if (how === 'ground') o.say('You put your feet down and run out the last of it.');
      /*
       * Meeting something in the air puts you down beside it rather than putting you out.
       *
       * It was a knockout, on the grounds that canvas and ash meeting a wall is not a landing, and
       * that is true of a cliff at speed and nonsense everywhere else: the first flight this was
       * tested on opened over a village and was knocked out on the first frame by the roof of a
       * well it had not even reached. A wing is easy to fly badly; being sent to the nearest town
       * for brushing a roof is not a consequence, it is a punishment for using the thing at all.
       */
      if (how === 'hit') o.say('You clip it, spill the air, and come down.');
      if (how === 'water') o.knockOut('The sea');
      return how;
    },
  };
}
