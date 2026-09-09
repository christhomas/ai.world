import { IndexedDbStore } from './save/store';
import type { SessionSave, WorldKind } from './save/store';
import { keepSideways, thisBrowser, whenTurned } from './ui/sideways';
import { LEGACY_KEY, showTitle } from './ui/title';
import { startGame } from './main';

/**
 * Getting from an opened page to a world, which is a different job from playing one.
 *
 * Two ways in and they answer different questions. A share link names a seed and skips the title
 * screen, because somebody following a link has already chosen; anybody else is asked. Both end at
 * `startGame`, which is where this stops and the game begins.
 *
 * Split out of `main.ts` when that file reached the length a person can hold in their head — the
 * seam was already here, and the alternative was shaving comments off the game to make room, which
 * is how a file ends up with none.
 */

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

/** Which way the phone is held, then a world, then the game. */
export async function boot(): Promise<void> {
  // A phone is held sideways to play this, and it says so before anything else is drawn: the
  // title screen is as landscape as the game behind it.
  keepSideways(thisBrowser($('turnPhone')), whenTurned);
  const store = new IndexedDbStore();
  const url = new URL(window.location.href);
  const urlSeed = url.searchParams.get('seed');

  let slotKey: string, saved: SessionSave | undefined, seed: number, world: WorldKind;
  if (urlSeed !== null && /^\d+$/.test(urlSeed)) {
    // share / dev link: play the given seed in a scratch session, skip the title screen
    seed = Number(urlSeed) >>> 0;
    slotKey = LEGACY_KEY;
    saved = await store.load<SessionSave>(LEGACY_KEY);
    if (saved?.seed !== seed) saved = undefined;
    world = worldFromLink(url) ?? saved?.world ?? 'road';
  } else {
    $('loading').style.display = 'none';
    const choice = await showTitle(store);
    slotKey = choice.key; saved = choice.save; seed = choice.seed; world = choice.world;
    $('loading').style.display = 'block';
  }
  startGame(store, slotKey, saved, seed, url, world);
}

/** `?world=mesh` or `?world=road` on a share link, for growing a scratch world of a given kind. */
function worldFromLink(url: URL): WorldKind | null {
  const asked = url.searchParams.get('world');
  return asked === 'mesh' || asked === 'road' ? asked : null;
}

boot().catch((err) => {
  console.error(err);
  const el = $('loading');
  el.style.display = 'block';
  el.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
