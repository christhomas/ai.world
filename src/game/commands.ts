import type { CommandBus } from '../core/commandbus';
import { helpText } from '../core/commandbus';

/**
 * What the game's commands actually do.
 *
 * The vocabulary is in `server/commands.ts` and the bus that routes them is in
 * `src/core/commandbus.ts`; this is the third piece — the part that knows this is a game with a
 * hero in it. It is kept apart from both so that the vocabulary can be shared with the server and
 * the bus can stay ignorant of what a command means.
 *
 * Everything here is expressed against the small interface below rather than against the game's
 * insides. That is not ceremony: when the simulation moves to the server, most of these stop being
 * things the client does and start being requests it sends, and the ones that remain — the camera,
 * the console — should not have to be untangled from the ones that leave.
 */

/** The few things the game must be able to do for a command to mean anything. */
export interface CommandWorld {
  teleport(x: number, z: number): void;
  descend(): void;
  climbOut(): void;
  enterShrine(): unknown;
  enterInn(): unknown;
  standAtCounter(): unknown;
  spawn(kind: string, away: number): unknown;
  sow(x: number, z: number): unknown;
  drop(): unknown;
  discover(place: string): unknown;
  thin(village: string, many: number): unknown;
  hire(many: number): unknown;
  setTime(fraction: number): unknown;
  setDay(day: number): unknown;
  where(): unknown;
  peaks(): unknown;
  entities(): unknown;
}

/**
 * Say what each command does, on this bus, for this game.
 *
 * Arguments arrive already read and already the right kind — the vocabulary saw to that — so these
 * are one line each. Anything a handler returns is what the asker is told, which is why the ones
 * that only look at the world return the thing they looked at.
 */
export function registerCommands(bus: CommandBus, world: CommandWorld): void {
  bus.define('teleport', ([x, z]) => world.teleport(x as number, z as number));
  bus.define('descend', () => world.descend());
  bus.define('climb-out', () => world.climbOut());
  bus.define('enter-shrine', () => world.enterShrine());
  bus.define('enter-inn', () => world.enterInn());
  bus.define('stand-at-counter', () => world.standAtCounter());

  // `away` is a distance from the hero rather than a place, which is the one thing about spawning
  // that everybody gets wrong the first time they use it
  bus.define('spawn', ([kind, away]) => world.spawn(kind as string, (away as number) ?? 2));
  bus.define('sow', ([x, z]) => world.sow(x as number, z as number));
  bus.define('drop', () => world.drop());
  bus.define('discover', ([place]) => world.discover(place as string));
  bus.define('thin', ([village, many]) => world.thin(village as string, many as number));
  bus.define('hire', ([many]) => world.hire(many as number));

  bus.define('time', ([fraction]) => world.setTime(fraction as number));
  bus.define('day', ([day]) => world.setDay(day as number));

  bus.define('where', () => world.where());
  bus.define('peaks', () => world.peaks());
  bus.define('entities', () => world.entities());
  bus.define('help', ([name]) => helpText(bus, name as string | undefined));
}
