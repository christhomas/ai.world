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
import { OtherBodies, type NamePlate } from '../render/other-bodies';
import { inReachOnScreen, type InReach } from '../render/in-reach';
import { GAMEPLAY } from '../core/config';
import { BEDS, SOUNDS, STRIDE, waterBed, wildlifeCall, windLevel, type SoundVoice } from '../game/sound-recipes';
import { CAVE, MOODS, beat, noteAt, pluck } from '../game/music-score';
import { Biome } from '../world/biomes';
import { doingNear, rosterView, type RosterOrder, type RosterView } from '../game/roster-view';
import { companyView, type CompanyView } from '../game/company-view';
import { kinView, type KinView } from '../game/kin-view';
import { mapPicture, type MapGround, type MapPicture } from '../world/map-ground';
import { FloorSight, floorPicture, type FloorPicture } from '../dungeon/floor-picture';
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
  /**
   * The wall clock, for timing jobs in real milliseconds: an engine's own clock is the step's, which
   * stands still while a job runs. `Date.now` by default, which every engine has.
   */
  realNow?(): number;
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
  /**
   * The beds under every other sound, as loud as they are now (#578): the wind, the water in
   * earshot and the soundtrack's drone, each a voice that never stops and is only turned up and down.
   * Nought while the game is quiet. See `BEDS` in `sound-recipes.ts`.
   */
  beds: { wind: number; water: { gain: number; centre: number; q: number }; drone: { freq: number; gain: number } };
  /** The panel the screen has open, if any; a conversation is `conversation`. */
  panel: string | null;
  hero: Speaker | null;
  /** Other players' names, where they hang over their heads in the viewport (#576). */
  plates: NamePlate[];
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
  /** Real time spent so far on the world, the ground and the country, each its own kind of job. */
  jobTimes(): JobTimes;
  /** The sounds the game has made since this was last asked, each as the voices it is made of (#578). */
  takeSounds(): SoundVoice[][];
  /** How loud the game is, nought to one, as the page's options slider sets it. */
  setVolume(volume: number): void;
  /** Everybody on the register as the page's roster reads them, in this order (#575). */
  roster(by: RosterOrder): RosterView;
  /** Everybody else in this world, nearest first, as the page's travellers list reads them (#576). */
  company(): CompanyView;
  /**
   * The descent a clerk last laid out on the table, and how many times one has been (#575): the
   * count changes each time, so the app opens the page again for a book bought or looked at again.
   */
  kin(): { unrolled: number; view: KinView } | null;
  /**
   * Whoever the action key would talk to, where they stand on the screen (#571): an installed app
   * rings their feet and hangs their name over them, which is how the design says who is in reach.
   */
  subject(): InReach | null;
  /**
   * A line typed into the console, as the page's console takes it (#576): `?` asks the game, `/` is
   * a gesture or a command, and anything else is said out loud to whoever is in the world.
   */
  say(text: string): void;
  /** The map's ground and roads, built once from the terrain the page's map is drawn from. */
  mapPicture(): MapPicture;
  /** What the map shows over its picture: the markers, the title, and whether it is fogged at all. */
  mapReading(): { title: string; fogged: boolean; markers: MapMarker[] };
  /**
   * The floor the hero is on, while he is underground: what changes it (cells seen, chests opened,
   * the doors unlocked), cheaply, and its picture as the page's floor map paints it. Null above ground.
   */
  floor(): { changed: string; picture(): FloorPicture } | null;
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

/** How loud the music is against the game's other sounds, as the page mixes it. */
const MUSIC = 0.5;
const keep = <T>(list: T[], item: T): void => {
  list.push(item);
  if (list.length > KEPT) list.splice(0, list.length - KEPT);
};

/**
 * Real time spent on each kind of job on this host, so a slow phone says what it was slow at (#559):
 * how many runs, how many milliseconds in all, and the longest single run.
 */
export interface JobTimes {
  [kind: string]: { runs: number; ms: number; longest: number };
}

/** A clock whose callbacks are timed, in real milliseconds, under one kind of job. */
function timedClock(clock: HostClock, kind: string, times: JobTimes, real: () => number): HostClock {
  const timed = (callback: () => void) => () => {
    const began = real();
    try {
      callback();
    } finally {
      const took = real() - began;
      const t = (times[kind] ??= { runs: 0, ms: 0, longest: 0 });
      t.runs++;
      t.ms += took;
      if (took > t.longest) t.longest = took;
    }
  };
  return {
    now: () => clock.now(),
    yield: () => clock.yield(),
    after: (callback, milliseconds) => clock.after(timed(callback), milliseconds),
    every: (callback, milliseconds) => clock.every(timed(callback), milliseconds),
  };
}

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
    sounds: [], fishing: 'idle', volume: 0.6, panel: null, hero: null, plates: [],
    beds: { wind: 0, water: waterBed(0, 0, false), drone: { freq: MOODS[Biome.Plains].root / 2, gain: 0 } },
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

  // what the game sounded, as the voices `sound-recipes.ts` makes each of, for the app to play (#578);
  // footsteps fall on the page's stride while the hero walks, and nothing sounds while it is quiet
  const heard: SoundVoice[][] = [];
  let hushed = false;
  let stride = 0;
  // the soundtrack's notes, on the game's own time: the page's music, without its drone
  let biome = Biome.Plains;
  let night = 0;
  let playing = 0;
  let nextNote = 0.5;
  let step = 0;
  // the beds' wind, eased toward the place's as the page's is, the water last heard, and the next call
  let wind = 0;
  let water = { nearness: 0, drop: 0 };
  let nextCall = 2;
  const play = (name: string, voices: SoundVoice[]) => {
    cue(name);
    if (!hushed) heard.push(voices);
  };
  const sound: SoundSurface = {
    volume: shown.volume,
    cave: false,
    setVolume: (volume) => { sound.volume = volume; shown.volume = volume; },
    // quiet, the beds fall silent at once rather than on the next frame, which a paused game has not got
    quiet: (on) => { hushed = on; if (on) shown.beds = { ...shown.beds, wind: 0, water: waterBed(0, 0, false), drone: { ...shown.beds.drone, gain: 0 } }; },
    dispose: () => { heard.length = 0; sound.quiet(true); },
    update: (dt, walking, onRoad) => {
      stride -= dt;
      if (walking && stride <= 0) { stride = STRIDE; play('footstep', SOUNDS.footstep(onRoad)); }
      playing += dt;
      const mood = sound.cave ? CAVE : MOODS[biome];
      // notes due within the next quarter second go now, each saying how far ahead it starts
      while (nextNote < playing + 0.25) {
        if (!hushed) heard.push([pluck(noteAt(step, mood, night), MUSIC, Math.max(0, nextNote - playing))]);
        step++;
        nextNote += beat(mood, night);
      }
      // the creatures of the place, one call at a time, and the beds under everything
      nextCall -= dt;
      if (nextCall <= 0) {
        const call = wildlifeCall(biome, night, sound.cave);
        nextCall = call.next;
        if (!hushed && call.voices.length > 0) play('wildlife', call.voices);
      }
      wind += (windLevel(biome, night, sound.cave) - wind) * Math.min(1, dt * 0.5);
      const drone = shown.beds.drone.freq;
      shown.beds = {
        wind: hushed ? 0 : wind,
        water: waterBed(hushed ? 0 : water.nearness, water.drop, sound.cave),
        // the drone glides to a new mood's root over a second and a half, as the page's does
        drone: { freq: drone + (mood.root / 2 - drone) * Math.min(1, dt / 1.5), gain: hushed ? 0 : BEDS.DRONE_GAIN * MUSIC },
      };
    },
    setScene: (where, dark) => { biome = where; night = dark; },
    setWater: (nearness, drop) => { water = { nearness, drop }; },
    blip: () => play('blip', SOUNDS.blip()),
    select: () => play('select', SOUNDS.select()),
    chime: () => play('chime', SOUNDS.chime()),
    jingle: () => play('jingle', SOUNDS.jingle()),
    fanfare: () => play('fanfare', SOUNDS.fanfare()),
    hit: (on) => play(`hit:${on}`, SOUNDS.hit(on)),
    miss: () => play('miss', SOUNDS.miss()),
    thud: () => play('thud', SOUNDS.thud()),
    voice: (weight, dying = false) => play(dying ? 'voice:dying' : `voice:${weight}`, SOUNDS.voice(weight, dying)),
    splash: () => play('splash', SOUNDS.splash()),
    whalesong: () => play('whalesong', SOUNDS.whalesong()),
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
  let travelling: ScreenParts['companyInput'] | null = null;
  let lineage: { unrolled: number; view: KinView } | null = null;
  let mapped: { graph: RoadGraph; ground: MapGround; picture?: MapPicture } | null = null;
  let below: { sight: FloorSight; opened: (i: number) => boolean; unlocked: boolean } | null = null;

  const company: CompanySurfaces = {
    // a shared world's other players, arriving with its socket (#565): drawn by the same entity
    // renderer as everybody, with their names kept for the app to hang over their heads
    others: (renderer) => {
      const people = new OtherBodies(renderer);
      return {
        sync: (players, place) => people.sync(players, place),
        settle: (heightAt) => people.settle(heightAt),
        project: (camera, width, height) => { shown.plates = people.plates(camera, width, height); },
        age: (dt) => people.age(dt),
        emote: (id, emoji) => people.emote(id, emoji),
        clear: () => { people.clear(); shown.plates = []; },
      };
    },
    playerList: () => ({ refresh() {} }),
    status: (text) => { shown.status = text; },
    fight: (readout) => { shown.fight = readout; },
    viewport: () => viewport,
  };

  // the world, the ground and the country each run on a clock that times them (#559)
  const jobTimes: JobTimes = {};
  const real = options.realNow ?? (() => Date.now());
  const alone = worldInProcess(timedClock(clock, 'world', jobTimes, real), () => options.vault ?? new Forgetful());
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
    // a floor's map, kept as the page's floor map keeps it, for when the app's map asks
    floorMap: (map) => {
      const floor = { sight: new FloorSight(map), opened: (_i: number) => false, unlocked: false };
      below = floor;
      return {
        reveal: (x, z, radius) => floor.sight.reveal(x, z, radius),
        draw: (_x, _z, opened, chestId, unlocked) => {
          floor.opened = (i) => opened.has(chestId(i));
          floor.unlocked = unlocked;
        },
      };
    },
    // the descent a clerk unrolls, kept for the app's kin page, which opens when it changes
    kin: () => ({ show: (tree, placed) => { lineage = { unrolled: (lineage?.unrolled ?? 0) + 1, view: kinView(tree, placed) }; } }),
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
      travelling = parts.companyInput;
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
      chunks: chunksInProcess(timedClock(clock, 'chunks', jobTimes, real), now),
      grower: (seed, country) => createCountryGrower(seed, country.store,
        countryInProcess(timedClock(clock, 'country', jobTimes, real), now)),
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
    jobTimes: () => jobTimes,
    takeSounds: () => heard.splice(0),
    setVolume: (volume) => sound.setVolume(Math.max(0, Math.min(1, volume))),
    say(text) {
      const said = text.trim();
      if (said) chat.onSend?.(said);
    },
    roster(by) {
      if (!registered) throw new Error('the game has not been assembled on this host yet');
      const [register, villages, crowd, near] = registered;
      return rosterView(register(), by, villages(), doingNear(crowd, near?.()));
    },
    company() {
      if (!travelling) throw new Error('the game has not been assembled on this host yet');
      return companyView(travelling()());
    },
    kin: () => lineage,
    subject() {
      const said = shown.action;
      if (!handles || !said?.startsWith('Talk to ')) return null;
      const { entities, player, iso } = handles;
      // the person the interaction chain would talk to: the nearest in talking range, by that name
      const who = entities.nearest(player.x, player.z, GAMEPLAY.TALK_RANGE);
      return who && `Talk to ${who.name}` === said ? inReachOnScreen(iso, who, viewport.width, viewport.height) : null;
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
    floor() {
      const floor = below;
      if (!floor || !handles?.places.underground) return null;
      const opened = floor.sight.map.chests.filter((_c, i) => floor.opened(i)).length;
      return {
        changed: `${floor.sight.map.floor}:${floor.sight.known}:${opened}:${floor.unlocked}`,
        picture: () => floorPicture(floor.sight, floor.opened, floor.unlocked),
      };
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
