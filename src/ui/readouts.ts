import { compassDir } from '../world/structures';
import { SEASON_NAMES, seasonOf } from '../game/seasons';
import { GAMEPLAY } from '../core/config';
import { worldSeconds, ferryStateAt } from '../game/ferry';
import { villageAt } from '../world/structures';
import { BIOMES, HUB_NAME, SEA_NAME } from '../world/biomes';
import type { CompassTarget } from './compass';
import type { MapMarker } from './mapbase';
import type { Compass } from './compass';
import type { Clock } from './clock';
import type { Hud } from './hud';
import type { GameState } from '../game/state';
import type { Player } from '../entities/player';
import type { Structures } from '../world/structures';
import type { TerrainSampler } from '../world/terrain';
import type { FerryLine } from '../game/ferry';
import type { Quest } from '../game/quests';
import type { Sailing } from '../game/sailing';
import type { Places } from '../game/places';
import type { Rucksack } from './rucksack';

/**
 * What the game says about itself while you play: the marks on both maps, the name of where you
 * are standing, what the compass points at, and the panels along the top of the screen.
 *
 * These are all read-only views of the world. Nothing here changes anything.
 */
export interface ReadoutContext {
  player: Player;
  state: GameState;
  structures: Structures;
  sampler: TerrainSampler;
  discovered: Set<string>;
  questList: Quest[];
  ferries: Array<{ line: FerryLine }>;
  sailing: Sailing;
  places: Places;
  rucksack: Rucksack;
  hud: Hud;
  clock: Clock;
  compass: Compass;
  /** Marks other people put on the map: companions and rally points. */
  companyMarkers: () => MapMarker[];
  /** Whether the fog of war still covers the map. */
  fogged: () => boolean;
  /** Where the camera is looking, which is what the area name follows. */
  cameraTarget: () => { x: number; z: number };
  discover: (name: string) => void;
}

export function createReadouts(ctx: ReadoutContext) {
  const {
    player, state, structures, sampler, discovered, questList, ferries, sailing, places, rucksack,
    hud, clock, compass: compassBar, companyMarkers, fogged, cameraTarget, discover,
  } = ctx;
  let areaLabel = 'The Crossroads';

  const markers = (): MapMarker[] => {
    const out: MapMarker[] = [
      ...structures.villages.map((v) => ({ x: v.x, z: v.z, color: '#ffffff', label: v.name })),
      ...structures.pois.filter((p) => discovered.has(p.name)).map((p) => ({ x: p.x, z: p.z, color: '#f1c40f', label: p.name })),
      ...structures.caves.filter((c) => discovered.has(c.name)).map((c) => ({ x: c.x, z: c.z, color: '#b07fd6', label: c.name })),
      ...structures.wrecks.filter((w) => discovered.has(w.name)).map((w) => ({ x: w.x, z: w.z, color: '#d68f5a', label: w.name })),
      ...ferries.map(({ line }) => {
        const st = ferryStateAt(line, worldSeconds(state.day, state.time));
        return { x: st.x, z: st.z, color: '#6fd3ff', label: st.docked ? 'ferry (docked)' : 'ferry' };
      }),
    ];
    // companions are worth finding across a wide world, so they are always on the map
    out.push(...companyMarkers());
    // active quest targets stand out in green, ringed on the big map
    for (const q of questList) {
      if (state.quests.get(q.id) !== 'active') continue;
      const village = structures.villages.find((v) => v.name === q.village);
      if (village) out.push({ x: village.x, z: village.z, color: '#2ecc71', label: `${q.village} (errand)`, emphasis: true });
      if (q.kind === 'visit') {
        const poi = structures.pois.find((p) => p.name === q.target);
        if (poi) out.push({ x: poi.x, z: poi.z, color: '#2ecc71', label: `${q.target} (errand)`, emphasis: true });
      }
    }
    return out;
  };

  const mapInput = () => ({
    markers: markers(),
    playerX: player.x,
    playerZ: player.z,
    fog: !state.can('map'),
    title: places.underground
      ? `${places.underground.poi.name} Depths`
      : `${areaLabel} · ${state.clock()} · ${SEASON_NAMES[seasonOf(state.day)]}`,
  });

  /** POI > village > biome; discovering a POI flashes a toast. */
  const areaName = (): string => {
    for (const poi of structures.pois) {
      if (Math.hypot(poi.x - player.x, poi.z - player.z) >= GAMEPLAY.POI_DISCOVER_RADIUS) continue;
      discover(poi.name);
      return poi.name;
    }
    const v = villageAt(structures.villages, player.x, player.z);
    if (v) return v.name;
    const target = cameraTarget();
    const p = sampler.probe(target.x, target.z);
    return p.hub ? HUB_NAME : p.land ? BIOMES[p.biome].name : SEA_NAME;
  };

  /** What the compass points at: the errand first, then the nearest town. */
  const compassTargets = (): CompassTarget[] => {
    const targets: CompassTarget[] = [];
    for (const q of questList) {
      if (state.quests.get(q.id) !== 'active') continue;
      const done = q.kind === 'visit' ? state.discovered.has(q.target) : state.count(q.target) >= q.count;
      const village = structures.villages.find((v) => v.name === q.village);
      if (done) {
        if (village) targets.push({ label: `${q.village} (reward)`, x: village.x, z: village.z, primary: true });
      } else if (q.kind === 'visit') {
        const poi = structures.pois.find((p) => p.name === q.target);
        if (poi) targets.push({ label: q.target, x: poi.x, z: poi.z, primary: true });
      } else if (village) {
        targets.push({ label: `${q.village} (errand)`, x: village.x, z: village.z, primary: true });
      }
      if (targets.length >= 2) break;
    }
    let nearest = structures.villages[0];
    for (const v of structures.villages) {
      if (Math.hypot(v.x - player.x, v.z - player.z) < Math.hypot(nearest.x - player.x, nearest.z - player.z)) nearest = v;
    }
    if (nearest && !targets.some((t) => t.label.startsWith(nearest.name))) {
      targets.push({ label: nearest.name, x: nearest.x, z: nearest.z });
    }
    return targets;
  };

  /** The panels that follow the hero everywhere: hearts, clock, errands, area and toasts. */
  const updateHud = (dt: number, area: string, weatherGlyph = ''): void => {
    hud.syncState(state);
    clock.update(state);
    clock.setWeather(weatherGlyph);
    hud.setQuests(questList, state);
    hud.setArea(area);
    hud.tick(dt);
    rucksack.refresh();
    if (places.outdoors) compassBar.update(player.x, player.z, compassTargets());
    else compassBar.update(0, 0, []);
  };

  const journalInput = () => ({
    state, quests: questList, villages: structures.villages, pois: structures.pois,
    ferries: ferries.map((f) => f.line), seconds: worldSeconds(state.day, state.time),
    sites: [...structures.caves, ...structures.wrecks],
    playerX: player.x, playerZ: player.z,
  });

  return { markers, mapInput, areaName, compassTargets, updateHud, journalInput };
}
