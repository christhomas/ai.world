import { Simulation } from '../../server/sim';
import { browserWorlds, snapshotVault, type BrowserWorldSnapshot } from './worlds';

/** Open a detached saved world. Never start its clocks or hand it a writable browser adapter. */
export function browserWorldView(snapshot: BrowserWorldSnapshot, key: string) {
  const world = browserWorlds(snapshot).find(row => row.key === key);
  if (!world) throw new Error('This browser no longer holds that world.');
  const sim = new Simulation({ vault: snapshotVault(snapshot), dataDir: 'worlds', ground: true });
  sim.rooms.open(world.seed, { day: 1, time: 0 }, undefined, world.kind);
  return { world, sim };
}
