import { GameInput } from '../core/game-input';
import type { FrameClock } from '../core/loop';
import type { Viewport } from '../core/viewport';
import type { HostClock } from '../../server/host-clock';
import { Forgetful, type Vault } from '../../server/vault';
import { createSceneRig, type RigHost } from '../render/scene';
import type { FramePipeline, FrameSource } from '../render/pipeline';
import type { FrameDescription } from '../core/scene';
import { ChunkMesher } from '../workers/chunkmesher';
import { LocalWorldHost } from '../workers/local-world-host';
import type { ChunkJobHost } from '../world/chunkjobs';
import { keptInMemory } from '../world/chunkstore';
import { answerCountry } from '../world/country-answer';
import { createCountryGrower, type CountryGrowthJob } from '../world/country-jobs';
import type { CountryReply } from '../world/countrymessages';
import type { WorldLinkFactory } from '../game/online';
import { Conversation } from '../ui/conversation';
import type { Speaker } from '../ui/dialogue';
import { stowWorn, takeFromPack } from '../game/pack';
import { journalView, type JournalView } from '../game/journal-view';
import { doingNear, rosterView, type RosterOrder, type RosterView } from '../game/roster-view';
import { mapPicture, type MapGround, type MapPicture } from '../world/map-ground';
import { mountainAt } from '../world/ranges';
import type { RoadGraph } from '../world/graph';
import type { MapMarker } from '../ui/mapbase';
import type { installProbes } from '../game/probes';
import type {
  ChatSurface, CompanySurfaces, DialogueSurface, GameAsks, GamePlatform, HudSurface, ScreenParts, SoundSurface,
} from './game-platform';

/**
 * What a host with no page tells the game about the world outside it.
 *
 * `headlessGame` is that host; an installed app's engine runs it (#563), with the hero's saves in
 * whatever store it has, `savedInMemory` until there is a durable one (#577).
 */
export interface HeadlessOptions {
  /** The picture the camera frames, in logical pixels. */
  viewport: Viewport;
  /** Timers for the private world, the jobs and the delivery of their replies. */
  clock: HostClock;
  /** A monotonic clock in milliseconds, for the jobs. */
  now(): number;
  random(): number;
  /** Where the private world keeps itself; it is forgotten when the game closes if none is given. */
  vault?: Vault;
  asks?: Partial<GameAsks>;
  /** The name the hero goes by in the world. */
  name?: string;
  /**
   * A shared world to join instead of the one in this thread (#565): its address, and the link the
   * game reaches it by, since a host with no page has no socket of its own.
   */
  server?: { url: string; link: WorldLinkFactory };
  /** The game has asked to leave for the title. */
  leave?(): void;
  /** A prayer has asked for the game to begin again. */
  restart?(): void;
}

/**
 * What the game has said, in the shape a native interface draws it (#562).
 *
 * The page puts these things into its widgets; a host with no page keeps them here for whatever
 * draws its interface to read. Lists keep their newest few.
 */
export interface Presentation {
  toasts: string[];
  loading: string | null;
  area: string;
  /** What the action key would do here, if anything. */
  action: string | null;
  quests: number;
  link: boolean;
  breath: { wind: number; warded: number; arm: number; guarding: boolean };
  hurts: number;
  chat: Array<{ text: string; kind: 'chat' | 'sys' }>;
  /** Who is here, in a line. */
  status: string;
  fight: string | null;
  /** Sounds asked for, by name, for a host that plays them. */
  sounds: string[];
  fishing: string;
  volume: number;
  /** The panel the screen has open, if any; a conversation is `conversation`. */
  panel: string | null;
  hero: Speaker | null;
}

export interface HeadlessGame {
  platform: GamePlatform;
  presentation: Presentation;
  /** Where the conversation is, for a host to show and answer. */
  conversation: Conversation;
  /** The frames the rig drew, for the host's own renderer. */
  recording: FrameCatch;
  /** The controls, which the host feeds from touches or messages. */
  input: GameInput;
  /** Time passing on the display: whatever frame is due is run. */
  frame(ms: number): void;
  /** In sight or not, as an app going to the background is. */
  setVisible(visible: boolean): void;
  /** The pack, as a tap on a row of it answers: the same rules and the same word afterwards as the page's. */
  pack(): { take(id: string): void; stow(slot: string): void };
  /** The journal as the page's journal shows it: what is owed, found and sailing, and nothing undiscovered. */
  journal(): JournalView;
  /** Everybody on the register as the page's roster reads them, in this order (#575). */
  roster(by: RosterOrder): RosterView;
  /**
   * A line typed into the console, as the page's console takes it (#576): `?` asks the game, `/` is
   * a gesture or a command, and anything else is said out loud to whoever is in the world.
   */
  say(text: string): void;
  /** The map's ground and roads, built once from the terrain the page's map is drawn from. */
  mapPicture(): MapPicture;
  /** What the map shows over its picture: the markers, the title, and whether it is fogged at all. */
  mapReading(): { title: string; fogged: boolean; markers: MapMarker[] };
  /** Everything the game was assembled from, once it has been: what a test or an inspector reads. */
  handles(): Parameters<typeof installProbes>[0];
}

/**
 * The frame the rig draws next, kept as it was handed over.
 *
 * The page's recorder copies what it keeps, because the graph's buffers move on with the next
 * frame. A host that reads the frame before any other is drawn has no need of a copy, and copying a
 * whole frame every step is time an embedded engine does not have.
 */
export class FrameCatch implements FramePipeline {
  frames = 0;
  last: FrameDescription | null = null;
  private armed = false;
  captureNext(): void { this.armed = true; this.last = null; }
  draw(frame: FrameSource): void {
    this.frames++;
    if (!this.armed) return;
    this.last = typeof frame === 'function' ? frame() : frame;
    this.armed = false;
  }
}

const KEPT = 40;
const keep = <T>(list: T[], item: T): void => {
  list.push(item);
  if (list.length > KEPT) list.splice(0, list.length - KEPT);
};

/** Chunks meshed on the host's own turn, in the order asked, by the mesher the page's workers run. */
export function chunksInProcess(clock: HostClock, now: () => number): ChunkJobHost {
  return {
    concurrency: 1,
    now,
    create(receive) {
      let live = true;
      const mesher = new ChunkMesher((reply) => { clock.after(() => { if (live) receive(reply); }, 0); });
      return {
        postMessage(message) { clock.after(() => { if (live) mesher.receive(message); }, 0); },
        terminate() {
          if (!live) return;
          live = false;
          mesher.dispose();
        },
      };
    },
  };
}

/** The country grown on the host's own turn, answered as the page's country worker answers. */
export function countryInProcess(clock: HostClock, now: () => number): CountryGrowthJob {
  let listening: ((message: CountryReply) => void) | null = null;
  return {
    send(request) {
      clock.after(() => {
        if (!listening) return;
        const reply = answerCountry(request, now);
        if (reply) listening?.(reply);
      }, 0);
    },
    listen(reply) {
      listening = reply;
      return () => { listening = null; };
    },
    stop() { listening = null; },
  };
}

/**
 * The world in the same thread, driven by the same messages a server is: the private world a
 * game always plays against, without a worker to put it in. A shared world needs a socket, which
 * this host does not have yet, so it says there is nobody to connect to.
 */
export function worldInProcess(clock: HostClock, vault: () => Vault): WorldLinkFactory {
  return (url, events) => {
    if (url) return null;
    let up = false;
    let closed = false;
    const later = (job: () => void) => { clock.after(() => { if (!closed) job(); }, 0); };
    const host = new LocalWorldHost({
      vault: vault(), clock,
      post: (parcel) => later(() => events.onMessage(parcel)),
      closed: () => {},
    });
    // announced on a later turn, as a worker's would be: see `workerLink`
    later(() => { up = true; events.onOpen(); });
    return {
      send: (parcel) => later(() => host.receive(parcel)),
      close: () => {
        if (closed) return;
        closed = true;
        up = false;
        host.dispose();
      },
      flush: () => host.persist(),
      get ready() { return up; },
    };
  };
}

/**
 * A host with no page: the same game, with everything it says kept in a `Presentation` and every
 * frame it draws handed to the recorder for something else to draw (#560).
 *
 * This is what an installed app runs inside its JavaScript engine. Nothing here touches a browser
 * global, which `portable-frame-imports.test.ts` holds it to.
 */
export function headlessGame(options: HeadlessOptions): HeadlessGame {
  const { viewport, clock, now } = options;
  const shown: Presentation = {
    toasts: [], loading: null, area: '', action: null, quests: 0, link: false,
    breath: { wind: 1, warded: 0, arm: 1, guarding: false }, hurts: 0, chat: [], status: '', fight: null,
    sounds: [], fishing: 'idle', volume: 0.6, panel: null, hero: null,
  };
  const say = (line: string) => keep(shown.toasts, line);
  const cue = (name: string) => keep(shown.sounds, name);
  const recording = new FrameCatch();
  const input = new GameInput();
  const talk = new Conversation();

  // the display: frames run when the host says time has passed, and not otherwise
  let displayed = 0;
  let nextFrame = 1;
  let due = new Map<number, (now: number) => void>();
  const frameClock: FrameClock = {
    now: () => displayed,
    request: (frame) => { const id = nextFrame++; due.set(id, frame); return id; },
    cancel: (id) => { due.delete(id); },
  };

  let visible = true;
  const watching = new Set<(active: boolean) => void>();
  let handles: Parameters<typeof installProbes>[0] | null = null;
  // the name the hero goes by is a remembered setting on the page, so it is one here too
  const remembered = new Map<string, string>(options.name ? [['ai.world/name', options.name]] : []);

  const rigHost: RigHost = {
    container: null,
    canvas: () => null,
    recordOnly: true,
    size: () => ({ width: viewport.width, height: viewport.height }),
    pixelRatio: () => 1,
    remembered: () => 'high',
    remember: () => {},
    presenter: () => { throw new Error('nothing is presented without a page'); },
  };

  const hud: HudSurface = {
    onLightChange: null, onSeeThroughChange: null, onVolumeChange: null, onReturnToTitle: null,
    onOpenRucksack: null, onMapTap: null, onAction: null,
    flash: say,
    hurt: () => { shown.hurts++; },
    setLoading: (text) => { shown.loading = text; },
    hideLoading: () => { shown.loading = null; },
    setSeeThrough: () => {},
    setVolume: (volume) => { shown.volume = volume; },
    setAction: (action) => { shown.action = action; },
    setArea: (name) => { shown.area = name; },
    setQuests: (quests) => { shown.quests = quests.length; },
    syncState: () => {},
    tick: () => {},
    setBreath: (wind, warded, arm = 1, guarding = false) => { shown.breath = { wind, warded, arm, guarding }; },
    setDebug: () => {},
    setLink: (reaching) => { shown.link = reaching; },
  };

  const sound: SoundSurface = {
    volume: shown.volume,
    cave: false,
    setVolume: (volume) => { sound.volume = volume; },
    quiet: () => {},
    dispose: () => {},
    update: () => {},
    setScene: () => {},
    setWater: () => {},
    blip: () => cue('blip'),
    select: () => cue('select'),
    chime: () => cue('chime'),
    jingle: () => cue('jingle'),
    fanfare: () => cue('fanfare'),
    hit: (on) => cue(`hit:${on}`),
    miss: () => cue('miss'),
    thud: () => cue('thud'),
    voice: (weight, dying = false) => cue(dying ? 'voice:dying' : `voice:${weight}`),
    splash: () => cue('splash'),
    whalesong: () => cue('whalesong'),
  };

  const chat: ChatSurface = {
    line: (text, kind = 'chat') => keep(shown.chat, { text, kind }),
    show: () => {},
    hide: () => {},
    dismiss: () => {},
    isTyping: false,
    onSend: null,
  };

  const dialogue: DialogueSurface = Object.assign(talk, {
    setHero: (who: Speaker) => { shown.hero = who; },
  });

  const toggle = (panel: string) => { shown.panel = shown.panel === panel ? null : panel; };
  let pack: ReturnType<HeadlessGame['pack']> | null = null;
  let reading: ScreenParts['journalInput'] | null = null;
  let registered: Parameters<ScreenParts['roster']['reads']> | null = null;
  let charting: ScreenParts['mapInput'] | null = null;
  let mapped: { graph: RoadGraph; ground: MapGround; picture?: MapPicture } | null = null;

  const company: CompanySurfaces = {
    // a shared world's other players arrive with its socket (#565); a private world has none
    others: () => ({ sync() {}, settle() {}, project() {}, age() {}, emote() {}, clear() {} }),
    playerList: () => ({ refresh() {} }),
    status: (text) => { shown.status = text; },
    fight: (readout) => { shown.fight = readout; },
    viewport: () => viewport,
  };

  const alone = worldInProcess(clock, () => options.vault ?? new Forgetful());
  const platform: GamePlatform = {
    asks: { server: false, at: undefined, time: null, freeCamera: false, ...options.asks },
    rig: () => createSceneRig(rigHost, false, recording),
    viewport: () => viewport,
    input: () => input,
    touch: () => ({ dispose() {} }),
    hud: () => hud,
    maps: (graph, sampler) => {
      // kept to draw the map from when it is asked for, from the same terrain and mountains the
      // page's map is drawn from (`browser-game.ts`)
      mapped = { graph, ground: {
        probe: (x, z) => sampler.probe(x, z),
        rock: sampler.ranges ? (x, z) => mountainAt(sampler.ranges!, x, z) ?? 0 : undefined,
      } };
      return {
        fog: { reveal() {} },
        minimap: { draw() {} },
        worldMap: { isOpen: false, pan() {}, draw() {} },
      };
    },
    floorMap: () => ({ reveal() {}, draw() {} }),
    kin: () => ({ show() {} }),
    // what the roster reads, kept for when the app's roster page asks
    roster: () => ({ reads: (...read) => { registered = read; } }),
    dialogue: () => dialogue,
    sound: () => sound,
    journal: () => ({ refresh() {} }),
    clock: () => ({ update() {}, setWeather() {} }),
    compass: () => ({ update() {} }),
    photo: () => ({ toggle: () => false }),
    chat: () => chat,
    rucksack: (state) => {
      // a row taken or a slot stowed says so the way the page's rucksack does: through onChange,
      // which the game points at the HUD, a sound and a save
      const surface = {
        onChange: null as ((message: string) => void) | null,
        refresh() {},
        toggle: () => toggle('rucksack'),
        take(id: string) { const said = takeFromPack(state, id); if (said) surface.onChange?.(said); },
        stow(slot: string) { const said = stowWorn(state, slot); if (said) surface.onChange?.(said); },
      };
      pack = surface;
      return surface;
    },
    screen: (parts) => {
      // what the journal is drawn from, which the engine reads when the app's journal page asks
      reading = parts.journalInput;
      charting = parts.mapInput;
      return {
        busy: () => (talk.isOpen ? 'talking' : shown.panel ? 'reading' : null),
        say,
        toggleJournal: () => toggle('journal'),
        toggleRucksack: () => toggle('rucksack'),
        toggleRoster: () => toggle('roster'),
        toggleOptions: () => toggle('options'),
        toggleMap: () => toggle('map'),
        toggleCompany: () => toggle('company'),
        togglePhoto: () => false,
        toggleSeeThrough: () => {
          const on = !parts.cutaway.on;
          parts.cutaway.show(on);
          return on;
        },
        toggleConsole: () => toggle('console'),
        openChat: () => {},
        closeEverything: () => { talk.close(); shown.panel = null; },
        advanceTalk: () => talk.advance(),
        moveTalk: (by) => talk.move(by),
        nudgeTalk: (by) => talk.nudge(by),
        centreMap: () => {},
        zoomMap: () => {},
        takePhoto: () => '',
      };
    },
    autoQuality: { saw: () => null },
    frameHost: () => ({
      viewport: () => viewport,
      qualityReduced: () => {},
      fishingChanged: (phase) => { shown.fishing = phase; },
    }),
    gameEvents: (events) => ({ isLive: events.isLive, afterPhotoSaved: (name) => say(`Saved ${name}`), dispose() {} }),
    prayerHost: (isLive) => ({
      isLive,
      randomSeed: () => Math.floor(options.random() * 0x1_0000_0000) >>> 0,
      restart: () => options.restart?.(),
    }),
    jobs: {
      chunks: chunksInProcess(clock, now),
      grower: (seed, country) => createCountryGrower(seed, country.store, countryInProcess(clock, now)),
    },
    chunkKeep: keptInMemory,
    settings: {
      getItem: (key) => remembered.get(key) ?? null,
      setItem: (key, value) => { remembered.set(key, value); },
    },
    company: () => company,
    worldLink: (url, events) => (url ? options.server?.link(url, events) ?? null : alone(url, events)),
    // play alone, against the world in this thread, unless a shared world was asked for: what the
    // page does with and without a link that names a server
    join: ({ seed, kind, terrain, highlands, worldName, where, state, online }) => {
      online.connect(options.server?.url ?? '', seed, options.name || 'Traveller', { day: state.day, time: state.time },
        { at: where(), kind, terrain, highlands }, worldName, state.playerId);
    },
    hidden: () => !visible,
    visibility: (activity) => {
      watching.add(activity);
      activity(visible);
      return () => { watching.delete(activity); };
    },
    toTitle: () => options.leave?.(),
    frameClock,
    probes: (assembled) => { handles = assembled; },
  };

  return {
    platform, presentation: shown, conversation: talk, recording, input,
    frame(ms) {
      displayed += ms;
      const ready = due;
      due = new Map();
      for (const frame of ready.values()) frame(displayed);
    },
    handles() {
      if (!handles) throw new Error('the game has not been assembled on this host yet');
      return handles;
    },
    pack() {
      if (!pack) throw new Error('the game has not been assembled on this host yet');
      return pack;
    },
    say(text) {
      const said = text.trim();
      if (said) chat.onSend?.(said);
    },
    roster(by) {
      if (!registered) throw new Error('the game has not been assembled on this host yet');
      const [register, villages, crowd, near] = registered;
      return rosterView(register(), by, villages(), doingNear(crowd, near?.()));
    },
    journal() {
      if (!reading) throw new Error('the game has not been assembled on this host yet');
      return journalView(reading());
    },
    mapPicture() {
      if (!mapped) throw new Error('the game has not been assembled on this host yet');
      mapped.picture ??= mapPicture(mapped.graph, mapped.ground);
      return mapped.picture;
    },
    mapReading() {
      if (!charting) throw new Error('the game has not been assembled on this host yet');
      const { title, fog, markers } = charting();
      return { title, fogged: fog, markers };
    },
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      for (const activity of [...watching]) activity(visible);
    },
  };
}
