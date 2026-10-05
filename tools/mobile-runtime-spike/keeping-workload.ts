import { openTheSave } from '../../src/game/keeping';
import { Manifest } from '../../src/world/manifest';
import type { SessionSave, SaveStore } from '../../src/save/store';
import type { Structures } from '../../src/world/structures';

/** Actual production save assembly with injected services; disk acceptance is a separate layer. */
export async function keepingWorkload(): Promise<string> {
  const records = new Map<string, unknown>();
  const store: SaveStore = { load: async <T>(key: string) => records.get(key) as T | undefined,
    save: async (key, value) => { records.set(key, value); }, remove: async key => { records.delete(key); } };
  const structures: Structures = { doors: [], villages: [], pois: [], all: [], piers: [], signposts: [],
    caves: [], wrecks: [], derelicts: [], castles: [] };
  const identity = '00000000-0000-4000-8000-000000000001'; let now = 1000, x = 12;
  const open = (saved?: SessionSave) => openTheSave({ store, slotKey: 'offline', seed: 7, world: 'road',
    saved, structures, manifest: new Manifest(7, saved?.manifest), rng: () => 0.5,
    host: { now: () => now, newPlayerId: () => identity },
    cam: () => ({ x, z: -8, rot: 0.4, zoom: 2 }), at: () => ({ x, z: -8 }), sky: () => null });
  const first = open(); first.state.inventory.gold = 123; first.state.give('sword'); first.state.equip('sword');
  first.state.discovered.add('Ashford'); first.state.day = 12; first.persist();
  now = 2000; x = 18; await first.persistStrict(); await first.saves.close();
  const saved = records.get('offline') as SessionSave;
  if (saved.player?.x !== 18 || saved.player.z !== -8) throw new Error('Native production save lost player position');
  // Position restoration belongs to session/Player construction, not openTheSave.
  // Discard the previous live coordinate so state continuation cannot reuse it.
  x = -999;
  now += 3 * 86400000;
  const continued = open(JSON.parse(JSON.stringify(saved)));
  if (continued.state.playerId !== identity || continued.state.inventory.gold !== 123 ||
      continued.state.worn('hand')?.id !== 'sword' || continued.state.day !== 12 || continued.state.awayFor !== 3 ||
      !continued.state.discovered.has('Ashford')) throw new Error('Native production save lost progress');
  const state = continued.state.toJSON(); await continued.saves.close();
  return JSON.stringify({ saved, continued: state });
}
