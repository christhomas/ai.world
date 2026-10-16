import type { GameInput } from '../core/game-input';
import type { FrameClock } from '../core/loop';
import type { Viewport } from '../core/viewport';
import type { DungeonMap } from '../dungeon/generate';
import type { FrameHost } from '../game/frame-host';
import type { PrayerHost } from '../game/interact/context';
import type { Joining } from '../game/joining';
import type { Screen } from '../game/screen';
import type { Sound } from '../game/audio';
import type { GameState } from '../game/state';
import type { WorldLinkFactory } from '../game/online';
import type { AutoQuality } from '../render/autoquality';
import type { SceneRig } from '../render/scene';
import type { TerrainSampler } from '../world/terrain';
import type { RoadGraph } from '../world/graph';
import type { Hud } from '../ui/hud';
import type { Fog } from '../ui/mapbase';
import type { Minimap } from '../ui/minimap';
import type { WorldMap } from '../ui/worldmap';
import type { KinPanel } from '../ui/kin';
import type { Roster } from '../ui/roster';
import type { DialogueBox } from '../ui/dialogue';
import type { Journal } from '../ui/journal';
import type { Clock } from '../ui/clock';
import type { Compass } from '../ui/compass';
import type { PhotoMode } from '../ui/photo';
import type { Chat } from '../ui/chat';
import type { Rucksack } from '../ui/rucksack';
import type { DungeonMinimap } from '../ui/dungeonmap';
import type { Panels } from '../ui/panels';
import type { installProbes } from '../game/probes';

/**
 * What whoever started this game asked of it, read once by the host rather than from an address.
 *
 * On the page these come from the link (`?server=`, `?x=`/`?z=`, `?t=`, `?cam=free`); an installed
 * app has no address bar and answers them itself.
 */
export interface GameAsks {
  /** The game was opened to join somebody's server rather than play alone. */
  server: boolean;
  /** Where to put the hero, instead of where the save left them. */
  at: { x: number; z: number } | undefined;
  /** The time of day to open at, nought to one. */
  time: number | null;
  freeCamera: boolean;
}

/**
 * Everything the game is drawn on, heard through and played with, supplied by the host it runs in.
 *
 * `composeGame` builds the game itself — the world, the hero, the rules, the save — and asks this for
 * every surface it would otherwise have built out of a browser: the WebGL rig, the panels, the sound,
 * the clock that calls each frame. The page answers with the widgets it always had (`browser-game.ts`);
 * an installed app answers with surfaces of its own. The game reads the same either way, which is
 * what stops the phone becoming a second implementation of it (#560).
 */
export interface GamePlatform {
  readonly asks: GameAsks;
  /** The scene the world is drawn into. */
  rig(): SceneRig;
  /** What the camera frames, in CSS pixels on the page. */
  viewport(): Viewport;
  /** The controls a frame polls, which a host feeds from keys, a mouse, a thumb or a message. */
  input(): GameInput & { dispose(): void };
  /** On-screen controls over that input, if this host draws any. */
  touch(input: GameInput): { dispose(): void };
  hud(rig: SceneRig, seed: number, worldName: string | undefined): Hud;
  /** The corner map, the full map and the fog the hero has lifted off both. */
  maps(graph: RoadGraph, sampler: TerrainSampler): { fog: Fog; minimap: Minimap; worldMap: WorldMap };
  /** The map of a dungeon floor while the hero is on one. */
  floorMap(map: DungeonMap): DungeonMinimap;
  kin(): KinPanel;
  roster(): Roster;
  dialogue(): DialogueBox;
  sound(): Sound;
  journal(): Journal;
  clock(): Clock;
  compass(): Compass;
  photo(): PhotoMode;
  chat(): Chat;
  rucksack(state: GameState): Rucksack;
  /** Which panel has the keys, given the panels; see `ui/panels.ts`. */
  screen(panels: Omit<Panels, 'canvas'>): Screen;
  /** Measures frames and turns the picture down when they are slow, unless the player chose. */
  readonly autoQuality: AutoQuality;
  frameHost(flash: (message: string) => void): FrameHost;
  gameEvents(events: { isLive(): boolean; resize(): void; persist(): void; say(message: string): void }):
    { isLive(): boolean; afterPhotoSaved(name: string): void; dispose(): void };
  prayerHost(isLive: () => boolean): PrayerHost;
  /** How a shared world is reached, and the private one beside it. */
  readonly worldLink: WorldLinkFactory;
  /** Whose world to play in at the start, and how somebody asks for another. */
  join(joining: Omit<Joining, 'url'>): void;
  /** Whether the game is out of sight now; and told whenever that changes, until released. */
  hidden(): boolean;
  visibility(activity: (active: boolean) => void): () => void;
  /** Leave for the title, once the world is saved and released. */
  toTitle(): void;
  /** What calls each frame; the page's animation frames when none is given. */
  readonly frameClock?: FrameClock;
  /**
   * Handles a test harness drives the game by, for hosts that have one. The page installs them in
   * development builds only.
   */
  probes?(handles: Parameters<typeof installProbes>[0]): void;
}
