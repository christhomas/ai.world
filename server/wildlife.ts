import { EntityManager } from '../src/entities/manager';
import { Roster } from '../src/entities/roster';
import type { Entity } from '../src/entities/entity';
import type { GroundWorld } from '../src/world/groundworld';
import type { Village } from '../src/world/structures';

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
export class Wildlife {
  private readonly roster = new Roster();
  private readonly manager: EntityManager;
  private turn = 0;

  constructor(seed: number, private readonly ground: GroundWorld, villages: Village[] = []) {
    this.manager = new EntityManager(this.roster, ground, ground, seed, villages);
  }

  /** How many creatures the server is holding. */
  get count(): number { return this.roster.count; }

  /** Everything alive, for whoever has to tell the players about it. */
  all(): Iterable<Entity> { return this.roster.all(); }

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
    const who = players[this.turn % players.length];
    this.turn++;
    this.manager.update(dt, who.x, who.z, false, () => {}, time);
  }
}
