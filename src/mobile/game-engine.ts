import { engineClock } from './host-globals';
import {
  HOST_CONTRACT_VERSION, RequestGate, parkedInput, type HostResult, type Json, type NormalizedInput,
} from '../../shared/mobile/host-contract';
import { composeGame, type GameHandle } from '../game/compose';
import { PLAYER_ACTION_KEYS, type PlayerAction } from '../game/player-actions';
import { headlessGame, type HeadlessGame } from '../platform/headless-game';
import { savedInMemory } from '../save/memory';
import type { SessionSave } from '../save/store';
import type { WorldKind } from '../world/countries';
import type { Vault } from '../../server/vault';
import { ScenePackets, plainArrays } from './scene-packet';
import { Portraits } from './portraits';
import { ParcelLink } from './parcel-link';
import { WORLD } from '../core/config';
import { PROVINCE, provinceCorner } from '../world/provinces';
import { SEASON_NAMES, seasonOf } from '../game/seasons';
import { packView } from '../game/pack';

/** What an app asks for when it opens a game: which world, which save, and how big the picture is. */
export interface EngineOptions {
  seed: number;
  kind: WorldKind;
  /** The save slot this game is kept in. */
  slot: string;
  name?: string;
  viewport: { width: number; height: number };
  /** What the slot held, to continue from; a new game has none. */
  saved?: SessionSave;
  /** The private world's records as the app last kept them, by name; a new world has none. */
  world?: Record<string, string>;
  /** A shared world's address to join instead of the private one (#565); `start` then says `remote`. */
  server?: string;
}

function optionsFrom(text: string): EngineOptions {
  const value = JSON.parse(text) as Partial<EngineOptions>;
  const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.seed) || (value.kind !== 'road' && value.kind !== 'endless')
    || typeof value.slot !== 'string' || !value.slot || !value.viewport || !positive(value.viewport.width) || !positive(value.viewport.height)
    || (value.name !== undefined && typeof value.name !== 'string')
    || (value.server !== undefined && (typeof value.server !== 'string' || !/^wss?:\/\/[^\s]+$/.test(value.server)))
    || (value.world !== undefined && (typeof value.world !== 'object' || value.world === null
      || Object.values(value.world).some((text) => typeof text !== 'string')))) {
    throw new Error('Invalid game options');
  }
  return value as EngineOptions;
}

/**
 * The private world's records, kept where the app keeps things (#564, #577).
 *
 * The world saves itself through a vault of named strings, synchronously, as it always has. Here the
 * vault starts from what the app kept last time, and everything the world writes is handed back to
 * the app in the next reply for it to keep durably: the world's own records, beside the hero's save.
 */
export class KeptWorld implements Vault {
  private readonly kept: Map<string, string>;
  private readonly changed = new Set<string>();
  constructor(records: Record<string, string> = {}) { this.kept = new Map(Object.entries(records)); }
  read(name: string): string | null { return this.kept.get(name) ?? null; }
  write(name: string, text: string): void {
    if (this.kept.get(name) === text) return;
    this.kept.set(name, text);
    this.changed.add(name);
  }
  list(prefix: string): string[] { return [...this.kept.keys()].filter((name) => name.startsWith(prefix)); }
  /** What has been written since the last time this was asked, or null if nothing has. */
  takeChanges(): Record<string, string> | null {
    if (!this.changed.size) return null;
    const changes: Record<string, string> = {};
    for (const name of this.changed) changes[name] = this.kept.get(name)!;
    this.changed.clear();
    return changes;
  }
}

/** How far a stick must lean before the hero walks: the page's stick's dead zone over its range. */
const DEAD_ZONE = 14 / 54;
const WALK_KEYS = ['w', 'a', 's', 'd'] as const;

/**
 * A stick as the keys the hero walks by: the eight sectors the page's touch stick has, so a thumb on
 * a phone and a thumb on the page are the same press. `move` is right and forward, each -1 to 1.
 */
export function walkKeysFor(move: readonly [number, number]): Set<string> {
  const [right, forward] = move;
  const held = new Set<string>();
  if (Math.hypot(right, forward) <= DEAD_ZONE) return held;
  const sector = Math.round(Math.atan2(right, forward) / (Math.PI / 4));
  if (Math.abs(sector) <= 1) held.add('w');
  if (Math.abs(sector) >= 3) held.add('s');
  if (sector >= 1 && sector <= 3) held.add('d');
  if (sector <= -1 && sector >= -3) held.add('a');
  return held;
}

const json = (value: unknown): Json => JSON.parse(JSON.stringify(value, plainArrays)) as Json;

/**
 * The whole game, as an installed app's JavaScript engine runs it (#563).
 *
 * The app makes requests in the shared host contract (`shared/mobile/host-contract.ts`) and gets a
 * reply to each; nothing happens between them, and time moves only when a step says it has. Each
 * reply carries what the game has said (the HUD, the conversation, where the hero is) and, when the
 * app asked for one with `resync` `scene`, the next frame drawn with only the geometry the app has
 * not been sent.
 *
 * - `start` opens the game the options named, against the world in this engine;
 * - `step` moves time on by `dtSeconds`, with the stick, the held buttons and any one-shot actions;
 * - `action` is a player action by name (`interact`, `attack`, `inventory`…), `choose` a row of the
 *   conversation by index, `nudge` a row's number (`row:1` or `row:-1`), `say` a line typed into the
 *   console (`args.text`), `take` a carried thing out of the pack by id or `stow` what a slot wears;
 * - `lifecycle` parks and resumes the game as the app goes to and from the background;
 * - `parcel` is what the app's socket to a shared world did: opened, a message, or closed (#565);
 * - `resync` `scene` asks for the next frame, and `renderer` says the app's renderer has forgotten
 *   everything it was sent;
 * - `dispose` saves nothing more and lets everything go.
 */
export function create(session: string, optionsText: string): { request(text: string): string } {
  const options = optionsFrom(optionsText);
  const gate = new RequestGate(session);
  const store = savedInMemory();
  const packets = new ScenePackets();
  const portraits = new Portraits();
  const parcels = new ParcelLink();
  const world = new KeptWorld(options.world);
  let host: HeadlessGame | null = null;
  let game: GameHandle | null = null;
  let revision = 0;
  let tick = -1;
  let renderTimeMs = 0;
  let wantScene = false;
  let lastSave = '';
  let lastJournal = '';
  let mapDrawn = false;
  let lastMap = '';
  let lastMapAt = -Infinity;
  const knownChunks = new Set<string>();
  const knownProvinces = new Set<string>();

  const presentation = (scene: Json | null) => {
    const shown = host!.presentation;
    const talk = host!.conversation;
    const { player, state } = host!.handles();
    const models: Record<string, Json> = {
      hud: json(shown),
      conversation: json(talk.node ? {
        speaker: talk.node.speaker, emoji: talk.node.emoji, shown: talk.shown, done: talk.done,
        page: talk.page, pages: talk.node.pages.length, choice: talk.choice, atChoices: talk.atChoices,
        choices: (talk.node.choices ?? []).map((c) => ({ label: c.label, note: c.note ?? null, adjusts: !!c.adjust })),
        waiting: talk.waiting,
        // drawn faces, by the key `models.portraits` sent them under; no face is the emoji
        face: portraits.name(talk.node.face), heroFace: portraits.name(shown.hero),
      } : null),
      pack: json(packView(state)),
      hero: json({ x: player.x, z: player.z, yaw: player.entity.yaw, hp: state.hp, maxHp: state.maxHpTotal, gold: state.inventory.gold,
        day: state.day, time: state.time, season: SEASON_NAMES[seasonOf(state.day)], playerId: state.playerId }),
    };
    if (scene) models.scene = scene;
    // a shared world's socket: what the app is asked to open or close, and the parcels to send on it
    Object.assign(models, parcels.take());
    const faces = portraits.take();
    if (faces) models.portraits = json(faces);
    // the journal changes when an errand, a find or a tile walked does, and is sent only then
    const journal = JSON.stringify(host!.journal());
    if (journal !== lastJournal) { lastJournal = journal; models.journal = JSON.parse(journal) as Json; }
    // the map over its picture: what has newly been walked or charted, every time; the markers
    // and title when they change, at most once a second, because a ferry's marker moves every step
    // both only ever grow, so the same size is nothing new
    const walked = state.explored.size === knownChunks.size ? [] : [...state.explored].filter((key) => !knownChunks.has(key));
    const charted = state.charted.size === knownProvinces.size ? [] : [...state.charted].filter((id) => !knownProvinces.has(id));
    const reading = JSON.stringify(host!.mapReading());
    if (walked.length > 0 || charted.length > 0 || (reading !== lastMap && renderTimeMs - lastMapAt >= 1000)) {
      for (const key of walked) knownChunks.add(key);
      for (const id of charted) knownProvinces.add(id);
      lastMap = reading;
      lastMapAt = renderTimeMs;
      // a chunk by its key and a province by its corner, with the size of each, so the app can
      // take the dark off them without knowing how either is named
      models.map = json({ ...JSON.parse(reading) as object, chunk: WORLD.CHUNK_SIZE, province: PROVINCE, walked,
        charted: charted.map((id) => { const at = provinceCorner(id); return `${at.x},${at.z}`; }) });
    }
    // a save the game has written since the last reply, for the app to keep where it keeps things
    const saved = store.read(options.slot);
    if (saved !== undefined && saved !== lastSave) { lastSave = saved; models.save = JSON.parse(saved) as Json; }
    // and the world's own records, written since the last reply
    const records = world.takeChanges();
    if (records) models.world = records;
    return {
      revision: ++revision, tick, renderTimeMs,
      owner: talk.isOpen || shown.panel ? 'BOOK' as const : 'WORLD' as const,
      busy: talk.isOpen ? 'talking' as const : shown.panel ? 'reading' as const : null,
      models,
    };
  };

  const steer = (input: NormalizedInput) => {
    const parked = parkedInput(input);
    const walk = walkKeysFor(parked.move);
    for (const key of WALK_KEYS) {
      if (walk.has(key)) host!.input.hold(key);
      else host!.input.release(key);
    }
    if (parked.held.guard) host!.input.hold('c'); else host!.input.release('c');
    if (parked.held.run) host!.input.hold('shift'); else host!.input.release('shift');
    for (const action of parked.actions) act(action);
  };

  const act = (action: string): void => {
    if (!Object.hasOwn(PLAYER_ACTION_KEYS, action)) throw new Error(`No such player action: ${action}`);
    game!.act(action as PlayerAction);
  };

  return {
    request(text) {
      const request = gate.accept(JSON.parse(text));
      const base = { version: HOST_CONTRACT_VERSION, session, sequence: request.sequence, requestId: request.id };
      const reply = (payload: HostResult['payload'], type: 'result' | 'error' = 'result') =>
        JSON.stringify({ ...base, type, payload } satisfies HostResult, plainArrays);
      try {
        if (request.type === 'start') {
          // a private world, or the shared one the options named: the app says which it expects
          if (host || request.payload.mode !== (options.server ? 'remote' : 'local') || request.payload.world !== options.slot) {
            throw new Error('This engine opens one game, in the slot and the world it was created for');
          }
          host = headlessGame({ viewport: options.viewport, clock: engineClock, now: () => engineClock.now(),
            random: Math.random, name: options.name, vault: world,
            server: options.server ? { url: options.server, link: parcels.connect } : undefined });
          game = composeGame({ store, slotKey: options.slot, saved: options.saved, seed: options.seed,
            worldName: undefined, world: options.kind }, host.platform);
          return reply({ full: true, state: presentation(null) });
        }
        if (request.type === 'dispose') {
          game?.dispose();
          game = null;
          host = null;
          return reply({});
        }
        if (!host || !game) throw new Error('Start the game first');
        switch (request.type) {
          case 'step': {
            const p = request.payload;
            steer(p.input);
            tick = p.tick;
            renderTimeMs = p.renderTimeMs;
            const ms = p.dtSeconds * 1000;
            // the world and the jobs first, so what they answered is there for the frame to draw
            engineClock.advanceTo(engineClock.now() + ms);
            const capturing = wantScene;
            if (capturing) host.recording.captureNext();
            host.frame(ms);
            wantScene = false;
            const frame = capturing ? host.recording.last : null;
            const shown = presentation(frame ? json(packets.packet(frame)) : null);
            // the map's picture, once, with the first step: drawn from the terrain, it is the one
            // model too big to send twice
            if (!mapDrawn) { mapDrawn = true; shown.models.mapPicture = json(host.mapPicture()); }
            return reply({ state: shown });
          }
          case 'action': {
            const { action, target } = request.payload;
            if (action === 'choose') {
              const row = Number(target);
              if (!Number.isSafeInteger(row) || !host.conversation.isOpen) throw new Error('Nothing to choose from');
              host.conversation.choose(row);
            } else if (action === 'nudge') {
              // `row:dir`, the − or + on a row that carries a number
              const [row, dir] = String(target).split(':').map(Number);
              if (!Number.isSafeInteger(row) || (dir !== 1 && dir !== -1) || !host.conversation.isOpen) {
                throw new Error('Nothing to change');
              }
              host.conversation.nudgeAt(row, dir);
            } else if (action === 'say') {
              // a line typed into the console: the text is the action's argument
              const text = (request.payload.args as { text?: unknown } | null)?.text;
              if (typeof text !== 'string' || text.length > 500) throw new Error('say needs a line of at most 500 characters');
              host.say(text);
            } else if (action === 'take' || action === 'stow') {
              if (typeof target !== 'string') throw new Error(`${action} needs a thing to ${action}`);
              host.pack()[action](target);
            } else act(action);
            return reply({ state: presentation(null) });
          }
          case 'parcel':
            // what the app's socket to the shared world did; a stale socket's news is dropped
            parcels.deliver(request.payload);
            return reply({ state: presentation(null) });
          case 'lifecycle':
            host.setVisible(request.payload.state === 'active');
            renderTimeMs = request.payload.renderTimeMs;
            return reply({ state: presentation(null) });
          case 'resync':
            if (request.payload.reason === 'scene') wantScene = true;
            else if (request.payload.reason === 'renderer') { packets.forget(); wantScene = true; }
            else if (request.payload.reason === 'save') {
              void game.save().catch((error: unknown) => host?.presentation.toasts.push(`Could not save: ${String(error)}`));
            }
            return reply({ full: true, state: presentation(null) });
          default:
            throw new Error(`${request.type} is not something this engine does`);
        }
      } catch (error) {
        return reply({ code: 'port-failed', message: (error as Error).message }, 'error');
      }
    },
  };
}
