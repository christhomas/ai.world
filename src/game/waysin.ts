import { createWing } from './gliding';
import { createCraft } from './craft';
import { createShafts, openCountry } from './shafts';
import { createSwallows } from './swallows';
import { liftAt } from '../world/thermals';
import type { ChunkManager } from '../world/chunkManager';
import type { GameState } from './state';
import type { Places } from './places';
import type { Player } from '../entities/player';
import type { Sailing } from './sailing';

/**
 * The three ways out of the ordinary world: the air, the sea and the ground under your feet.
 *
 * They arrived within an hour of each other and they are the same idea told three times — a piece of
 * kit that turns a piece of scenery into a place. A wing turns a hilltop into a way of crossing a
 * county; folded silk turns a hole in a field into a cave; and a whirlpool turns open water into a
 * gamble worth taking. Each is its own file, because a glide is not a drowning; this is where the
 * three of them are handed what they need, and it exists so that `main.ts` says *what the game has*
 * rather than how any of it is put together.
 */
export function createWaysIn(o: {
  seed: number;
  state: GameState;
  places: Places;
  player: Player;
  sailing: Sailing;
  chunks: ChunkManager;
  say: (line: string) => void;
  discover: (name: string) => void;
  knockOut: (cause: string) => void;
}) {
  const { seed, state, places, player, sailing, chunks } = o;

  // the canvas wing: open it in mid-air and the ground stops mattering
  const air = createWing({
    seed, world: () => player.ground, hero: () => player.entity, hasOne: () => state.can('glide'),
    clock: () => ({ day: state.day, time: state.time }),
    lift: (x, z) => liftAt(x, z, seed),
    say: o.say, knockOut: o.knockOut,
  });
  player.carries(air);

  /*
   * And the thing in the crater, which is a place rather than a piece of kit.
   *
   * It borrows the same seam the wing uses — `player.carries` takes whatever is flying — so climbing
   * in is a matter of handing the hero this instead, and climbing out is handing the wing back. Two
   * things can never be open at once, which is right: nobody flies a hang glider out of a cockpit.
   */
  const craft = createCraft({
    world: () => player.ground,
    hero: () => player.entity,
    say: o.say,
    knockOut: o.knockOut,
    onLanded: () => player.carries(air),
  });

  // the holes in the ground, which take anybody carrying silk and nobody else
  const shafts = createShafts({
    seed, state, places,
    hero: () => player,
    outdoors: () => places.underground === null && places.indoors === null,
    couldBe: (x, z) => openCountry(chunks, x, z),
    say: o.say, discover: o.discover,
  });

  // and the water that goes down: what it costs to be taken, and the deck he comes back up onto
  const swallows = createSwallows({
    seed, state, places, sailing,
    hull: () => ({ x: sailing.x, z: sailing.z }),
    say: o.say, knockOut: o.knockOut,
  });

  return { air, craft, shafts, swallows };
}
