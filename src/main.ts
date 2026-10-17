import type { SaveStore, SessionSave, WorldKind } from './save/store';
import type { GrownPatch } from './game/country';
import { composeGame } from './game/compose';
import { browserPlatform } from './platform/browser-game';

/**
 * The game on the page.
 *
 * `boot.ts` decides which save and which seed; the game itself is assembled in `game/compose.ts`,
 * out of the surfaces the page supplies (`platform/browser-game.ts`) and what the address asked for.
 * An installed app assembles the same game out of its own.
 */
export function startGame(
  store: SaveStore, slotKey: string, saved: SessionSave | undefined, seed: number,
  worldName: string | undefined, url: URL, world: WorldKind, home?: GrownPatch,
): void {
  composeGame({ store, slotKey, saved, seed, worldName, world, home }, browserPlatform(url));
}
