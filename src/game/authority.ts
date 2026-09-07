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
  /** Which world the hero is in: the surface, a dungeon floor, or a building. */
  placeName: () => string;
  /** Push what the hero was trying to do to the world that is walking him. */
  steer: (seq: number, dx: number, dz: number, pace: number, dt: number) => void;
  /** A creature the world owns has bitten us, and a bite is a bite whoever threw it. */
  bitten: (attacker: Entity, damage: number) => void;
}

export function createAuthority(ctx: Authority) {
  const {
    seed, state, player, chunks, entities, places, sailing, sound, wildlife, floorLife,
    placeName, steer, bitten,
  } = ctx;

  /**
   * The hero's side of a hero the world owns: what we pushed, what is still in flight, and what to
   * do when the answer comes back disagreeing.
   */
  const walked = new Walked((s) => steer(s.seq, s.dx, s.dz, s.pace, s.dt));

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
  const outdoors = (): boolean =>
    places.indoors === null && !places.underground && !sailing.sailing && !player.riding;

  /** Whichever of the world's flocks is the one this message is about, and null when neither is. */
  const theirs = (place: string): Wildlife | null =>
    place === 'surface' ? wildlife : place === placeName() ? floorLife() : null;

  return {
    walked,
    walking,
    outdoors,
    /** The things the world says, and what this side does about each. */
    heeding: {
      // the world's own creatures, in whichever of its worlds they live: drawn as they arrive, and
      // the local ones stand down. A snapshot for a place the hero is not in is not ours to draw —
      // the numbers a floor gives its monsters mean nothing on a hillside.
      onCreatures: (place: string, near: CreatureSnap[], gone: number[]): void => {
        if (place !== 'surface') {
          if (place === placeName()) floorLife()?.apply(near, gone);
          return;
        }
        if (!entities.toldWhatLives) {
          entities.toldWhatLives = true;
          entities.forgetTheWildlife();
        }
        wildlife.apply(near, gone);
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
        if (attacker) bitten(attacker, damage);
      },

      onWorldSilent: (): void => {
        if (!entities.toldWhatLives) return;
        entities.toldWhatLives = false;
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
        const out = walked.toldWhereHeIs(player.entity, chunks, seq, x, z);
        walking.answers++;
        if (out > 0) { walking.corrections++; walking.worst = Math.max(walking.worst, out); }
      },
    },
  };
}
