import { Input } from '../core/input';
import { AutoQuality, everChoseQuality, rememberTheirChoice } from '../render/autoquality';
import { QUALITY, createSceneRig } from '../render/scene';
import { RecordingPipeline } from '../render/recording';
import { mountainAt } from '../world/ranges';
import { Sound } from '../game/audio';
import { whereLineageIsDrawn } from '../game/enquiry';
import { joinAWorld } from '../game/joining';
import { installProbes } from '../game/probes';
import { isOn } from '../ui/switches';
import { $ } from '../ui/dom';
import { TouchControls } from '../ui/touch';
import { Hud } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import { Fog, renderMapBase } from '../ui/mapbase';
import { WorldMap } from '../ui/worldmap';
import { DungeonMinimap } from '../ui/dungeonmap';
import { KinPanel } from '../ui/kin';
import { Roster } from '../ui/roster';
import { DialogueBox } from '../ui/dialogue';
import { Journal } from '../ui/journal';
import { Clock } from '../ui/clock';
import { Compass } from '../ui/compass';
import { PhotoMode } from '../ui/photo';
import { Chat } from '../ui/chat';
import { Rucksack } from '../ui/rucksack';
import { screenOf } from '../ui/panels';
import { browserWorldLink } from './browser-world-link';
import { createPrayerHost, observeVisibility, returnToTitle } from './browser-lifecycle';
import { createBrowserFrameHost } from './browser-frame';
import { createBrowserGameEvents } from './browser-game-events';
import type { GameAsks, GamePlatform } from './game-platform';

/** What the address asks of the game: whose server, where to stand, what time it is, which camera. */
export function asksOf(url: URL): GameAsks {
  const x = url.searchParams.get('x'), z = url.searchParams.get('z'), t = url.searchParams.get('t');
  return {
    server: url.searchParams.has('server'),
    at: x !== null && z !== null ? { x: Number(x) || 0, z: Number(z) || 0 } : undefined,
    time: t === null ? null : Number(t) || 0,
    freeCamera: url.searchParams.get('cam') === 'free',
  };
}

/** The page as a host: the widgets in `index.html`, a WebGL canvas, and the address it was opened at. */
export function browserPlatform(url: URL): GamePlatform {
  // Read the preference before the rig's setQuality writes one, so automatic setup cannot look
  // like a choice.
  const autoQuality = new AutoQuality(everChoseQuality());
  let canvas: HTMLCanvasElement | null = null;
  const drawnOn = (): HTMLCanvasElement => {
    if (!canvas) throw new Error('the page has no rig yet');
    return canvas;
  };
  let input: Input | null = null;
  return {
    asks: asksOf(url),
    autoQuality,
    worldLink: browserWorldLink,
    rig() {
      const flags = new URLSearchParams(location.search);
      const recording = flags.has('record-scene') || flags.has('record-only') ? new RecordingPipeline() : undefined;
      if (recording) (window as Window & { __recording?: RecordingPipeline }).__recording = recording;
      const rig = createSceneRig($('gameContainer'), isOn('composer'), recording);
      canvas = rig.canvas;
      return rig;
    },
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    input: () => (input = new Input(drawnOn())),
    touch: () => {
      if (!input) throw new Error('the page has no input yet');
      return new TouchControls(input);
    },
    hud(rig, seed, worldName) {
      const hud = new Hud(rig, seed, worldName);
      hud.onQualityChange = (level) => {
        // their choice, and it stands: nothing measured afterwards may argue with it
        autoQuality.leaveItAlone();
        rememberTheirChoice();
        rig.setQuality(level);
        hud.flash(`Graphics: ${QUALITY[level].label}`);
      };
      return hud;
    },
    maps(graph, sampler) {
      // the map is drawn from the same terrain the ground is, plus the mountains, which stand on
      // that terrain rather than in it and would otherwise be missing from every map of a polygon world
      const mapBase = renderMapBase(graph, {
        probe: (x, z) => sampler.probe(x, z),
        rock: sampler.ranges ? (x, z) => mountainAt(sampler.ranges!, x, z) ?? 0 : undefined,
      });
      const fog = new Fog(mapBase);
      return { fog, minimap: new Minimap($('minimapCanvas') as HTMLCanvasElement, mapBase, fog), worldMap: new WorldMap(mapBase, fog) };
    },
    floorMap: (map) => new DungeonMinimap($('minimapCanvas') as HTMLCanvasElement, map),
    kin: () => new KinPanel(),
    roster: () => new Roster(),
    dialogue: () => new DialogueBox(),
    sound: () => new Sound(),
    journal: () => new Journal(),
    clock: () => new Clock(),
    compass: () => new Compass(),
    photo: () => new PhotoMode(),
    chat: () => new Chat(),
    rucksack: (state) => new Rucksack(state),
    screen: (panels) => screenOf({ ...panels, canvas: drawnOn() }),
    frameHost: (flash) => createBrowserFrameHost(drawnOn(), $('castbar'), flash),
    gameEvents: createBrowserGameEvents,
    prayerHost: createPrayerHost,
    join: (joining) => joinAWorld({ ...joining, url }),
    hidden: () => document.hidden,
    visibility: observeVisibility,
    toTitle: () => returnToTitle(() => {}, () => {}),
    // stripped from production builds, where `import.meta.env.DEV` is false
    probes: import.meta.env.DEV ? (handles) => {
      whereLineageIsDrawn(handles.drawLineage);
      installProbes(handles);
    } : undefined,
  };
}
