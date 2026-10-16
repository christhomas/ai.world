import { createStore, entries, get } from 'idb-keyval';
import { browserWorlds, type BrowserWorldSnapshot } from './worlds';
import { browserWorldSurvey, browserWorldView } from './world-view';
import { terrainPreview } from '../ui/terrainpreview';
import { elevationFor } from '../world/growworld';

async function snapshot(): Promise<BrowserWorldSnapshot> {
  const files = await entries<string, string>(createStore('ai-world-authority', 'files'));
  // Remote named-world saves have other keys. They are caches, never local authorities.
  const slots = await Promise.all(['ai.world/slot/1', 'ai.world/slot/2', 'ai.world/slot/3', 'ai.world/session']
    .map(key => get<unknown>(key)));
  return { files, slots };
}

self.onmessage = async (event: MessageEvent<{ id: number; action: string; key?: string; x?: number; z?: number }>) => {
  const { id, action, key, x = 0, z = 0 } = event.data;
  try {
    const kept = await snapshot();
    const worlds = browserWorlds(kept);
    if (action === 'list') { self.postMessage({ id, value: worlds }); return; }
    const view = browserWorldView(kept, key ?? '');
    const { world, sim } = view;
    if (action === 'survey') {
      const book = browserWorldSurvey(view);
      if (!book || book === 'preparing') throw new Error('The saved world could not be surveyed.');
      self.postMessage({ id, value: { ...book, happened: [], latest: 0, checkpoint: world.checkpoint } });
      return;
    }
    if (action !== 'preview') throw new Error('Unknown tools request.');
    if (world.kind === 'road') throw new Error('This is a road world. Its Domesday Book is available; terrain authoring supports endless worlds.');
    if (![x, z].every(Number.isSafeInteger) || Math.abs(x) > 1_000_000 || Math.abs(z) > 1_000_000)
      throw new Error('The map centre is invalid.');
    const manifest = sim.rooms.manifestOf(world.seed);
    self.postMessage({ id, value: { record: world, revision: null, readOnly: true,
      layers: manifest.layers(), terrain: manifest.terrain, sites: manifest.byKind('skyisle'),
      skyEyries: manifest.byKind('eyrie').filter(a => a.version === 2),
      pixels: Array.from(terrainPreview(world.seed, manifest.terrain, x, z, 64, elevationFor(manifest))),
      centre: { x, z }, span: 512 } });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Browser world storage could not be read.' });
  }
};
