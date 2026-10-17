import { ITEMS } from './items';
import type { GameState } from './state';
import type { Quest } from './quests';
import type { Poi, Site, Village } from '../world/structures';
import { formatCountdown, ferryStateAt, type FerryLine } from './ferry';
import { SEASON_NAMES, seasonOf } from './seasons';

/** What the journal reads: the hero, the errands on offer, and the world they were found in. */
export interface JournalReading {
  state: GameState;
  quests: Quest[];
  villages: Village[];
  pois: Poi[];
  /** Caves and wrecks: named once found, like points of interest. */
  sites: Site[];
  ferries: FerryLine[];
  seconds: number;
  playerX: number;
  playerZ: number;
}

/** The journal as a reader sees it: the hero in a line, then what is owed, found and sailing. */
export interface JournalView {
  day: number;
  season: string;
  hp: number;
  maxHp: number;
  attack: number;
  defence: number;
  gold: number;
  placesFound: number;
  errandsDone: number;
  cellsWalked: number;
  /** `at` is where the village that asked stands, for an app's map to be opened on; null if it is not known. */
  errands: Array<{ id: string; done: boolean; what: string; village: string; tiles: number | null; bearing: string | null;
    at: { x: number; z: number } | null }>;
  found: Array<{ name: string; icon: string; tiles: number; bearing: string; at: { x: number; z: number } }>;
  ferries: Array<{ from: string; to: string; where: string; nextArrival: string }>;
}

const compass = (dx: number, dz: number): string => {
  const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  return dirs[Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) & 7];
};

/**
 * The journal, read off the hero and the world (#575). The page's journal draws this and an
 * installed app's journal page shows the same rows, so the two cannot disagree about what is owed,
 * where it is, or what has been found. Nothing undiscovered is in it.
 */
export function journalView(d: JournalReading): JournalView {
  const { state } = d;
  const dist = (x: number, z: number) => Math.round(Math.hypot(x - d.playerX, z - d.playerZ));
  const bearing = (x: number, z: number) => compass(x - d.playerX, z - d.playerZ);
  return {
    day: state.day, season: SEASON_NAMES[seasonOf(state.day)], hp: state.hp, maxHp: state.maxHpTotal,
    attack: state.attack, defence: state.defence, gold: state.inventory.gold,
    placesFound: state.discovered.size,
    errandsDone: d.quests.filter((q) => state.quests.get(q.id) === 'done').length,
    cellsWalked: state.explored.size,
    errands: d.quests.filter((q) => state.quests.get(q.id) === 'active').map((q) => {
      const village = d.villages.find((v) => v.name === q.village);
      return {
        id: q.id,
        done: q.kind === 'visit' ? state.discovered.has(q.target) : state.count(q.target) >= q.count,
        what: q.kind === 'visit' ? `find the ${q.target}` : `bring ${q.count}× ${ITEMS[q.target]?.name ?? q.target}`,
        village: q.village,
        tiles: village ? dist(village.x, village.z) : null,
        bearing: village ? bearing(village.x, village.z) : null,
        at: village ? { x: village.x, z: village.z } : null,
      };
    }),
    found: [
      ...d.pois.filter((p) => state.discovered.has(p.name)).map((p) => ({ name: p.name, x: p.x, z: p.z, icon: '⭐' })),
      // what sort of place it was is read off the front of its id, which is the one thing every
      // site carries — a wreck is the only one of the three with no prefix of its own, so it is
      // what is left over rather than something asked for
      ...d.sites.filter((s) => state.discovered.has(s.name)).map((s) => ({
        name: s.name, x: s.x, z: s.z,
        icon: s.id.startsWith('cave') ? '🕳️' : s.id.startsWith('castle') ? '🏰' : '🚢',
      })),
    ].sort((a, b) => Math.hypot(a.x - d.playerX, a.z - d.playerZ) - Math.hypot(b.x - d.playerX, b.z - d.playerZ))
      .map((p) => ({ name: p.name, icon: p.icon, tiles: dist(p.x, p.z), bearing: bearing(p.x, p.z), at: { x: p.x, z: p.z } })),
    ferries: d.ferries.map((line) => {
      const st = ferryStateAt(line, d.seconds);
      return {
        from: line.fromName, to: line.toName,
        where: st.docked === 'from' ? line.fromName : st.docked === 'to' ? line.toName : 'at sea',
        nextArrival: formatCountdown(Math.min(st.arrivesIn.from, st.arrivesIn.to)),
      };
    }),
  };
}
