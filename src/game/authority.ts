import type { CreatureSnap } from '../../server/protocol';
import type { Entity } from '../entities/entity';
import type { EntityManager } from '../entities/manager';
import type { Player } from '../entities/player';
import type { ChunkManager } from '../world/chunkManager';
import type { Sound } from './audio';
import { spoils } from './combat';
import type { Places } from './places';
import type { Sailing } from './sailing';
import type { GameState } from './state';
import { Walked } from './walked';
import type { Wildlife } from './wildlife';

/**
 * Which half of the game is in charge, and what this half does when the other one speaks.
 *
 * There is always a world running — a server, or the simulation in the thread next door — and out
 * of doors it owns the creatures and it owns the hero's own feet. This side keeps walking him
 * anyway, because a step that waited for a round trip would not feel like a step, and then puts
 * him right when the answer comes back. Everywhere the world has no ground to walk him on —
 * indoors, underground, on a horse, at sea — the client stays the authority and none of this
 * applies. `docs/server-authority.md` is the long version.
 */
export interface Authority {
  seed: number;
  state: GameState;
  player: Player;
  chunks: ChunkManager;
  entities: EntityManager;
  places: Places;
  sailing: Sailing;
  sound: Sound;
  /** The world's creatures above ground. */
  wildlife: Wildlife;
  /** And on whatever floor the hero is standing on, when he is standing on one. */
  floorLife: () => Wildlife | null;
  /** Whether the hero is up on a sky island, which is a world the server has never grown. */
  aloft: () => boolean;
  /** Which world the hero is in: the surface, a dungeon floor, or a building. */
  placeName: () => string;
  /** Push what the hero was trying to do to the world that is walking him. */
  steer: (seq: number, dx: number, dz: number, pace: number, dt: number) => void;
  /** A creature the world owns has bitten us, and a bite is a bite whoever threw it. */
  bitten: (attacker: Entity, damage: number) => void;
  /**
   * A constable the world owns has taken us in, and being taken in is what it always was.
   *
   * The village decided it; the hours, the fine and the cell are worked out on this side, on the
   * save that holds all three. Exactly the division a bite already has.
   */
  arrested: (by: Entity) => void;
  /**
   * Somebody who lived in a village has been killed by something.
   *
   * The world buries him — he is off its register and everybody is told — and this is what each
   * player's own game makes of it: a pack left where he fell, a bargain ended, and a line on the
   * screen of anybody near enough to have heard it. All three are that player's own.
   */
  fallen: (who: Entity) => void;
}

export function createAuthority(ctx: Authority) {
  const {
    seed, state, player, chunks, entities, places, sailing, sound, wildlife, floorLife, aloft,
    placeName, steer, bitten, arrested, fallen,
  } = ctx;

  /**
   * The hero's side of a hero the world owns: what we pushed, what is still in flight, and what to
   * do when the answer comes back disagreeing.
   */
  const walked = new Walked((s) => steer(s.seq, s.dx, s.dz, s.pace, s.dt));
  /** What has bitten the hero lately, and whether anything was drawn where the bite came from. */
  const bites: Array<{ at: number; id: number; damage: number; away: number | null }> = [];

  /**
   * How the two halves are getting on, for `window.__walking` and for nothing else.
   *
   * Worth having a number for: the whole design rests on the client's guess and the world's answer
   * being the same arithmetic, and the only honest way to know whether that is true is to walk
   * about and read how often it is not.
   */
  const walking = { answers: 0, corrections: 0, worst: 0 };

  /**
   * Is the hero somewhere the world can see him?
   *
   * The server walks him and throws his blows for him out of doors, on his own feet, on ground it
   * has grown. Indoors, underground, on a horse and at sea it has nothing to walk him on and no
   * creatures of its own there, so the client stays the authority — and asking it to swing would
   * be asking it to swing at whatever happens to stand near the last field he was in.
   */
  /*
   * Whether the world is the one walking the hero at this moment.
   *
   * It walks him out of doors, on his own feet, on ground it has grown. Not indoors, not down a
   * staircase, not on a boat, not on a ferry — and not on an island in the sky, which was missing
   * and is the same fault as the rest: the sky islands are the client's own world, drawn above a
   * countryside the server is still walking a hero across, so every step taken up there was
   * answered with a position down on the ground and the player was dragged about an island by a
   * hero standing in a field.
   */
  const outdoors = (): boolean =>
    places.indoors === null && !places.underground && !sailing.sailing && !player.riding && !aloft();

  /** Whichever of the world's flocks is the one this message is about, and null when neither is. */
  const theirs = (place: string): Wildlife | null =>
    place === 'surface' ? wildlife : place === placeName() ? floorLife() : null;

  return {
    walked,
    walking,
    outdoors,
    /** The last few bites the world reported, and how far off the biter was drawn. */
    bites,
    /** The things the world says, and what this side does about each. */
    heeding: {
      // the world's own creatures, in whichever of its worlds they live: drawn as they arrive, and
      // the local ones stand down. A snapshot for a place the hero is not in is not ours to draw —
      // the numbers a floor gives its monsters mean nothing on a hillside.
      onCreatures: (place: string, near: CreatureSnap[], gone: number[]): void => {
        if (place !== 'surface') {
          if (place === placeName()) floorLife()?.apply(near, gone, player.entity);
          return;
        }
        if (!entities.toldWhatLives) {
          entities.toldWhatLives = true;
          entities.forgetWhatWeInvented();
        }
        wildlife.apply(near, gone, player.entity);
      },

      /**
       * One of the world's creatures died.
       *
       * Everybody drops it from their screen; whoever landed the blow takes what was on it. What a
       * pelt is worth is decided here rather than by the world, because a purse and a rucksack live
       * in a player's own save and never travel — the world's business is that the creature is dead.
       */
      onCreatureKilled: (place: string, id: number, mine: boolean): void => {
        const alive = theirs(place);
        if (!alive) return;
        const body = alive.find(id);
        // A person rather than an animal, and that is a different kind of news. The world has
        // already taken him off its register and told everybody so; what each player's own game
        // does about it — the pack in the grass, the bargain that ends, the shout in the middle
        // distance — is theirs, and it is the same `fallen` that has always done it.
        if (body && body.person !== '') fallen(body);
        if (body && mine) {
          const won = spoils(state, body, seed);
          if (won.gold > 0) { state.inventory.gold += won.gold; state.version++; }
          for (const item of won.loot) state.give(item, 1);
          if (won.gold > 0 || won.loot.length > 0) sound.chime();
        }
        alive.apply([], [id]);
      },

      // A creature the world owns has bitten us. The world decided that it happened and how hard;
      // everything after that — the guard, the parry, the knockback, the hearts — is the same code a
      // bite has always gone through, because it is the client that holds all of it.
      onBitten: (place: string, id: number, damage: number): void => {
        const attacker = theirs(place)?.find(id);
        // kept whether or not there is anybody to blame it on: "something bit me and there was
        // nothing there" is a report, and it needs a number behind it
        bites.push({
          at: Math.round(performance.now()),
          id, damage,
          away: attacker ? Math.hypot(attacker.x - player.entity.x, attacker.z - player.entity.z) : null,
        });
        if (bites.length > 30) bites.shift();
        if (attacker) bitten(attacker, damage);
      },

      /**
       * A constable has caught up with us.
       *
       * Nothing happens if he is not on this screen, which is not a case worth guarding against so
       * much as one worth being honest about: an arrest is a man laying a hand on you, and if there
       * is nobody drawn there then this client has not been told about him and has no name to put
       * in the sentence.
       */
      onArrested: (id: number): void => {
        const constable = wildlife.find(id);
        if (constable) arrested(constable);
      },

      onWorldSilent: (): void => {
        if (!entities.toldWhatLives) return;
        entities.toldWhatLives = false;
        // and the country this page has been standing in is forgotten, so that it is rolled again
        // from the seed rather than left as the empty squares the world's arrival made of it. It is
        // the same call the handover used on the way in, which is the point: whichever half is
        // deciding, it starts from ground nobody has already populated.
        entities.forgetWhatWeInvented();
        wildlife.clear();
        walked.reset();
      },

      // The world has walked our own hero. Almost always this agrees with where we already drew him,
      // because both halves walk with the same `stride` over the same ground; where it does not, the
      // world is right and the hero is moved — a lean for a small gap, at once for a large one.
      onWhereYouAre: (seq: number, x: number, z: number): void => {
        // under sail the answer is about the boat rather than about the hero, and the boat is what
        // the camera and the hero both follow — so this is where a boat is put right
        if (sailing.sailing) {
          walking.answers++;
          const out = Math.hypot(x - sailing.x, z - sailing.z);
          if (out > 0.05) { walking.corrections++; walking.worst = Math.max(walking.worst, out); }
          sailing.putAt(x, z);
          return;
        }
        if (!outdoors()) return;
        // the crowd too, so replaying a steer cannot push the hero through somebody
        const out = walked.toldWhereHeIs(player.entity, chunks, seq, x, z, entities);
        walking.answers++;
        if (out > 0) { walking.corrections++; walking.worst = Math.max(walking.worst, out); }
      },
    },
  };
}
