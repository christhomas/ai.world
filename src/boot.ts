import { IndexedDbStore, kindOf } from './save/store';
import type { SessionSave, WorldKind } from './save/store';
import type { WorldRecord } from '../server/protocol';
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
  const named = await namedWorldFromLink(url);

  let slotKey: string, saved: SessionSave | undefined, seed: number, world: WorldKind;
  let worldName: string | undefined;
  if (named) {
    seed = named.seed;
    world = named.kind;
    worldName = named.name;
    slotKey = `ai.world/named/${named.name.toLocaleLowerCase('en-US')}`;
    saved = await store.load<SessionSave>(slotKey);
    if (saved?.seed !== seed) saved = undefined;
    const localAnchors = saved?.manifest?.anchors.filter((anchor) => anchor.kind !== 'island') ?? [];
    saved = {
      ...(saved ?? { seed, cam: { x: 0, z: 0, rot: 0, zoom: 1 } }),
      seed, world, worldName,
      manifest: { rootSeed: seed, anchors: [...named.manifest, ...localAnchors] },
    };
  } else if (urlSeed !== null && /^\d+$/.test(urlSeed)) {
    // Old seed links and saves remain valid: a name is an added handle, not a new generator.
    seed = Number(urlSeed) >>> 0;
    slotKey = LEGACY_KEY;
    saved = await store.load<SessionSave>(LEGACY_KEY);
    if (saved?.seed !== seed) saved = undefined;
    world = worldFromLink(url) ?? saved?.world ?? 'road';
    worldName = saved?.worldName;
  } else {
    $('loading').style.display = 'none';
    const choice = await showTitle(store);
    slotKey = choice.key; saved = choice.save; seed = choice.seed; world = choice.world;
    worldName = choice.worldName;
    $('loading').style.display = 'block';
  }
  startGame(store, slotKey, saved, seed, worldName, url, world);
}

/**
 * `?world=endless` or `?world=road` on a link, for growing a scratch world of a given kind.
 *
 * A link can ask, and a save cannot be overruled by one: `boot` takes the link's answer only when
 * there is no save to contradict it. That is what stops a shared link opening somebody's own world
 * as the wrong country and moving the ground out from under everything they have built.
 */
function worldFromLink(url: URL): WorldKind | null {
  const asked = url.searchParams.get('world');
  return asked ? kindOf(asked) : null;
}
/** Resolve a named invite before any country is grown. */
export async function namedWorldFromLink(
  url: URL,
  request: typeof fetch = fetch,
): Promise<WorldRecord | null> {
  if (url.searchParams.has('seed')) return null;
  const name = url.searchParams.get('world');
  const server = url.searchParams.get('server');
  if (!name || !server || name === 'road' || name === 'endless') return null;

  const endpoint = new URL(server);
  endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
  endpoint.pathname = '/world';
  endpoint.search = '';
  endpoint.searchParams.set('name', name);
  const response = await request(endpoint);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Could not open world “${name}”.`);
  }
  return await response.json() as WorldRecord;
}

boot().catch((err) => {
  console.error(err);
  const el = $('loading');
  el.style.display = 'block';
  el.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
