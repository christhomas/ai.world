import { Simulation } from '../../server/sim';
import { browserWorlds, snapshotVault, type BrowserWorldSnapshot } from './worlds';
import { postsOf } from '../entities/villagers';
import { tradesFor } from '../entities/trades';

/** Open a detached saved world. Never start its clocks or hand it a writable browser adapter. */
export function browserWorldView(snapshot: BrowserWorldSnapshot, key: string) {
  const world = browserWorlds(snapshot).find(row => row.key === key);
  if (!world) throw new Error('This browser no longer holds that world.');
  const sim = new Simulation({ vault: snapshotVault(snapshot), dataDir: 'worlds', ground: true });
  const room = sim.rooms.open(world.seed, { day: 1, time: 0 }, undefined, world.kind);
  // Village deaths and declarations can live in provinces rather than the seed snapshot.
  // Hydrate those recorded facts before groundOf replays them into the detached register.
  for (const [path] of snapshot.files) {
    const match = new RegExp(`^worlds/${world.seed}/(-?\\d+)_(-?\\d+)\\.json$`).exec(path);
    if (match) room.world.asleep(`${Number(match[1])}:${Number(match[2])}`);
  }
  return { world, sim };
}

/** Re-found only villages the checkpoint already records as visited, using the game's trades. */
export function browserWorldSurvey(view: ReturnType<typeof browserWorldView>) {
  const { world, sim } = view;
  const room = sim.rooms.get(world.seed)!;
  const remembered = new Set(room.world.holdingVillages);
  const ground = sim.groundOf(world.seed);
  const alive = sim.livesIn(world.seed);
  if (ground && alive?.register) {
    for (const village of alive.villages) {
      if (!remembered.has(village.name)) continue;
      const trades = tradesFor(postsOf(village, ground)).map(trade => trade.id);
      alive.register.settle(village.name, village.houses.length, trades);
    }
  }
  return sim.surveyOf(world.seed);
}
