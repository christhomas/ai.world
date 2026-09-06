import { EntityManager } from '../src/entities/manager';
import { Roster } from '../src/entities/roster';
import { damageEntity, type Entity } from '../src/entities/entity';
import type { GroundWorld } from '../src/world/groundworld';
import type { CreatureSnap } from './protocol';

/**
 * The creatures of a world, run by the server.
 *
 * This is the same `EntityManager` the game has always used — the same herds, the same trades, the
 * same fights, the same burials — given a list instead of a renderer and the server's own copy of
 * the ground instead of the streamed one. The rules of the world are written once and run wherever
 * the world is being run, which is the whole argument of `docs/server-authority.md`.
 *
 * What it costs is measured rather than assumed: a world's ground is about ninety milliseconds to
 * stand up and a millisecond a chunk, and the creatures near one player are a few hundred entities
 * stepped at whatever rate the simulation ticks. What it buys is that two players standing in the
 * same field are looking at the same deer.
 *
 * It follows one player at a time. The manager spawns and forgets creatures around a single focus,
 * because that is what a game with one hero in it needs; with several players in a world the focus
 * moves between them, so everybody's country is stepped in turn rather than only the first
 * arrival's. Sending what it holds to the right people is the next piece, not this one.
 */
/** How far a player can see a creature, in tiles. Past this, it is somebody else's business. */
export const IN_SIGHT = 60;

export class Wildlife {
  private readonly roster = new Roster();
  private readonly manager: EntityManager;
  private turn = 0;
  /** The number each creature travels under, which is the one thing the wire needs and an Entity lacks. */
  private readonly numbered = new WeakMap<Entity, number>();
  private nextNumber = 1;

  /**
   * No villages are handed over on purpose.
   *
   * The manager spawns village folk when it is told where the villages are, and this must not: who
   * lives in a village is worked out from the seed and the register of who has been killed, so
   * every client already agrees about them. A villager owned by the server would be a villager
   * nobody could talk to, because a conversation is held by the client.
   */
  constructor(seed: number, private readonly ground: GroundWorld) {
    this.manager = new EntityManager(this.roster, ground, ground, seed, []);
  }

  /** How many creatures the server is holding. */
  get count(): number { return this.roster.count; }

  /** Everything alive, for whoever has to tell the players about it. */
  all(): Iterable<Entity> { return this.roster.all(); }

  /**
   * What one player can see, as the wire carries it.
   *
   * Interest management, and the whole of it at this stage: a player is sent what is near them and
   * nothing else. Two hundred creatures stand round somebody in open country, so sending the world
   * would be sending most of it to everybody several times a second — which is the cost this phase
   * has to answer for, and the answer is that nobody is told about country they cannot see.
   */
  inSightOf(x: number, z: number, reach = IN_SIGHT): CreatureSnap[] {
    const seen: CreatureSnap[] = [];
    const r2 = reach * reach;
    for (const e of this.roster.all()) {
      const dx = e.x - x, dz = e.z - z;
      if (dx * dx + dz * dz > r2) continue;
      seen.push({
        id: this.numberOf(e),
        kind: e.kind.id,
        // rounded on the way out: a creature's position is worth a tenth of a tile to look at, and
        // the digits past that are bandwidth spent on nothing anybody can see
        x: round(e.x), z: round(e.z), y: round(e.y),
        yaw: round(e.yaw), walk: round(e.walk),
        state: e.state, hp: e.hp,
      });
    }
    return seen;
  }

  /**
   * Somebody hit one of these. Decide what it did.
   *
   * The one place a blow on a wild animal is resolved, however many people are swinging: the client
   * that threw it has already drawn it landing, and what it was worth is worked out here. Nothing
   * is said back — the creature simply turns up hurt, or stops turning up.
   */
  struck(id: number, damage: number): boolean {
    for (const e of this.roster.all()) {
      if (this.numbered.get(e) !== id) continue;
      // the same rules a blow follows anywhere: the ground decides whether it is thrown back
      const killed = damageEntity(e, Math.max(1, Math.min(damage, MOST_A_BLOW)), e.x, e.z, this.ground);
      if (killed) this.manager.killEntity(e);
      return killed;
    }
    return false;
  }

  /** The number a creature travels under, given the first time anybody asks about it. */
  private numberOf(e: Entity): number {
    const had = this.numbered.get(e);
    if (had !== undefined) return had;
    const fresh = this.nextNumber++;
    this.numbered.set(e, fresh);
    return fresh;
  }

  /**
   * Step the world's creatures, following the players in it.
   *
   * The focus moves one player per step rather than trying to hold everybody at once. A world with
   * four people in it therefore has each of their neighbourhoods stepped every fourth tick, which
   * is the right trade while the manager is built around a single focus: the alternative is four
   * managers and four sets of the same deer.
   */
  step(dt: number, players: ReadonlyArray<{ x: number; z: number }>, time?: number): void {
    if (players.length === 0) return;
    // One of them is followed and the rest are told to the manager, which keeps the country round
    // all of them alive. Following them in turn as well spreads the cost of the one thing that is
    // still per-focus — which chunk the sweep starts from — rather than doing it for everybody
    // every tick.
    const who = players[this.turn % players.length];
    this.turn++;
    this.manager.alsoNear = players.filter((p) => p !== who);
    this.manager.update(dt, who.x, who.z, false, () => {}, time);
  }
}

/**
 * The most one blow may be worth, whatever a client says it threw.
 *
 * A client says how hard it hit, because the hero's strength is the hero's business and lives in
 * their own save. What it may not do is say a number nothing in the game could produce — so the
 * world caps it, which is the difference between trusting a player and taking their word for the
 * shape of the world.
 */
const MOST_A_BLOW = 40;

/** A tenth of a tile, which is as much of a creature's position as anybody can see. */
const round = (v: number): number => Math.round(v * 10) / 10;
