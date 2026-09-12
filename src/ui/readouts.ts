import { compassDir } from '../world/structures';
import { SEASON_NAMES, seasonOf } from '../game/seasons';
import { GAMEPLAY } from '../core/config';
import { worldSeconds, ferryStateAt } from '../game/ferry';
import { VILLAGE_REACH, villageAt } from '../world/structures';
import { BIOMES, HUB_NAME, SEA_NAME } from '../world/biomes';
import type { CompassTarget } from './compass';
import type { MapMarker } from './mapbase';
import type { Compass } from './compass';
import type { Clock } from './clock';
import type { Hud } from './hud';
import type { GameState } from '../game/state';
import type { Player } from '../entities/player';
import type { Structures } from '../world/structures';
import type { Around } from '../world/around';
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
  /**
   * Everything this world holds, for the readouts that are about the world rather than about where
   * the hero is standing: the marks on the big map, the journal's list of where he has been, and
   * finding the village an errand names by its name.
   */
  structures: Structures;
  /**
   * And what is near him, for the ones that are. See `world/around.ts` — a country grown a square
   * at a time cannot answer "the nearest village" off a list, because the list is only ever the
   * squares somebody has walked into.
   */
  around: Around;
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
  /**
   * Where the player has asked to be pointed, if anywhere: what `/nav` set.
   *
   * The compass already points at the errand and the nearest town, so a place somebody asked to be
   * shown is one more thing in that list rather than a second piece of screen furniture.
   */
  bound: () => { name: string; x: number; z: number } | null;
  discover: (name: string) => void;
}

/** How far these readouts are willing to look for something. Distances in tiles. */
const READOUT = {
  /**
   * How far the compass will look for a town to point at.
   *
   * Villages stand some eighty tiles apart, so three of those is far enough that there is nearly
   * always one to point at in settled country and short enough to be honest out at sea, where the
   * right answer is no arrow rather than an arrow at a place a day's sail away. It was unbounded
   * before, which in a bounded world means "the whole map" and in an endless one means "whichever
   * square happened to be grown" — the second of those points the needle at nothing in particular.
   */
  TOWN_REACH: 240,
} as const;

export function createReadouts(ctx: ReadoutContext) {
  const {
    player, state, structures, around, sampler, discovered, questList, ferries, sailing, places,
    rucksack, hud, clock, compass: compassBar, companyMarkers, fogged, cameraTarget, discover, bound,
  } = ctx;
  let areaLabel = 'The Crossroads';

  /**
   * Everything the big map shows, which is a question about the world rather than about here.
   *
   * Left on the whole list on purpose. A map is the one readout whose subject is *not* the hero's
   * surroundings — you open it to find somewhere you are not — so bounding it by a reach would be
   * drawing less map than the game has. In an endless country the list a patch holds is already the
   * country that has been grown, which is exactly what a map of a world with no edge can honestly
   * show: what you have been to, and no further.
   */
  const markers = (): MapMarker[] => {
    const out: MapMarker[] = [
      ...structures.villages.map((v) => ({ x: v.x, z: v.z, color: '#ffffff', label: v.name })),
      // Castles are on the map before you have been to one, which caves and wrecks are not. A cave
      // is a hole somebody has to find; a castle is twenty-two tiles of stone with a flag on it,
      // and the whole country knows where it is. It is also the thing you steer a long ride by,
      // which only works if it is there before you set off.
      ...structures.castles.map((c) => ({ x: c.x, z: c.z, color: '#efe6d0', label: c.name, icon: 'castle' as const })),
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
    const asked = bound();
    if (asked) out.push({ x: asked.x, z: asked.z, color: '#ff7a1a', label: asked.name, emphasis: true });
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
    // so the full map answers "which way am I pointing" as well as "where am I"
    facing: player.entity.yaw,
    markers: markers(),
    playerX: player.x,
    playerZ: player.z,
    fog: !state.can('map'),
    title: places.underground
      ? `${places.underground.poi.name} Depths`
      : `${areaLabel} · ${state.clock()} · ${SEASON_NAMES[seasonOf(state.day)]}`,
  });

  /**
   * POI > village > biome; discovering a POI flashes a toast.
   *
   * The landmark loop is deliberately still the whole list, and it is the one site in this file
   * that could not simply be moved across. `Around.places` lumps caves and wrecks in with landmarks
   * — rightly, since "what is near here" does not care which — and routing this through it would
   * make standing seven tiles from a cave mouth name the area after it and mark it found. That may
   * well be the better game; it is a decision about what discovers a cave rather than about how far
   * a question reaches, and it is not one to make quietly while moving a call site. The reach is
   * already written down, so it is one line on the day somebody decides.
   */
  const areaName = (): string => {
    for (const poi of structures.pois) {
      if (Math.hypot(poi.x - player.x, poi.z - player.z) >= GAMEPLAY.POI_DISCOVER_RADIUS) continue;
      discover(poi.name);
      return poi.name;
    }
    // the villages whose edge could possibly be under him, and then which of them he is inside:
    // `VILLAGE_REACH` is the widest a village ever gets, so a village he is standing in cannot be
    // outside it. `pois` above is still the whole list on purpose — see the note on it below.
    const v = villageAt(around.villages(player.x, player.z, VILLAGE_REACH), player.x, player.z);
    if (v) return v.name;
    const target = cameraTarget();
    const p = sampler.probe(target.x, target.z);
    return p.hub ? HUB_NAME : p.land ? BIOMES[p.biome].name : SEA_NAME;
  };

  /** What the compass points at: the errand first, then the nearest town. */
  const compassTargets = (): CompassTarget[] => {
    const targets: CompassTarget[] = [];
    // what the player asked for comes first: they asked for it, and the errand did not
    const asked = bound();
    if (asked) targets.push({ label: asked.name, x: asked.x, z: asked.z, primary: true });
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
    const nearest = around.nearestVillage(player.x, player.z, READOUT.TOWN_REACH);
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

  /**
   * The journal, which is a record rather than a neighbourhood.
   *
   * It lists where the hero has *been*, and where he has been is not a thing that can be asked of
   * the ground around him — a village he walked through last month is not near him now and still
   * belongs in the book. So this keeps the whole list too, for the same reason the map does.
   */
  const journalInput = () => ({
    state, quests: questList, villages: structures.villages, pois: structures.pois,
    ferries: ferries.map((f) => f.line), seconds: worldSeconds(state.day, state.time),
    // castles among them, because the journal is the list of places you have been to and a castle
    // is the most memorable of them — it is on the map before you find one, but being *there* is
    // still a thing that happened, and the journal is the only place that says so
    sites: [...structures.caves, ...structures.wrecks, ...structures.castles],
    playerX: player.x, playerZ: player.z,
  });

  return { markers, mapInput, areaName, compassTargets, updateHud, journalInput };
}
