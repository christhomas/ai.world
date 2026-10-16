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
import { ScenePackets, plainArrays } from './scene-packet';

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
}

function optionsFrom(text: string): EngineOptions {
  const value = JSON.parse(text) as Partial<EngineOptions>;
  const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.seed) || (value.kind !== 'road' && value.kind !== 'endless')
    || typeof value.slot !== 'string' || !value.slot || !value.viewport || !positive(value.viewport.width) || !positive(value.viewport.height)
    || (value.name !== undefined && typeof value.name !== 'string')) {
    throw new Error('Invalid game options');
  }
  return value as EngineOptions;
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
 * - `action` is a player action by name (`interact`, `attack`, `inventory`…) or `choose` a row of
 *   the conversation by index;
 * - `lifecycle` parks and resumes the game as the app goes to and from the background;
 * - `resync` `scene` asks for the next frame, and `renderer` says the app's renderer has forgotten
 *   everything it was sent;
 * - `dispose` saves nothing more and lets everything go.
 */
export function create(session: string, optionsText: string): { request(text: string): string } {
  const options = optionsFrom(optionsText);
  const gate = new RequestGate(session);
  const store = savedInMemory();
  const packets = new ScenePackets();
  let host: HeadlessGame | null = null;
  let game: GameHandle | null = null;
  let revision = 0;
  let tick = -1;
  let renderTimeMs = 0;
  let wantScene = false;
  let lastSave = '';

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
      } : null),
      hero: json({ x: player.x, z: player.z, hp: state.hp, day: state.day, time: state.time, playerId: state.playerId }),
    };
    if (scene) models.scene = scene;
    // a save the game has written since the last reply, for the app to keep where it keeps things
    const saved = store.read(options.slot);
    if (saved !== undefined && saved !== lastSave) { lastSave = saved; models.save = JSON.parse(saved) as Json; }
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
          if (host || request.payload.mode !== 'local' || request.payload.world !== options.slot) {
            throw new Error('This engine opens one local game, in the slot it was created for');
          }
          host = headlessGame({ viewport: options.viewport, clock: engineClock, now: () => engineClock.now(),
            random: Math.random, name: options.name });
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
            return reply({ state: presentation(frame ? json(packets.packet(frame)) : null) });
          }
          case 'action': {
            const { action, target } = request.payload;
            if (action === 'choose') {
              const row = Number(target);
              if (!Number.isSafeInteger(row) || !host.conversation.isOpen) throw new Error('Nothing to choose from');
              host.conversation.choose(row);
            } else act(action);
            return reply({ state: presentation(null) });
          }
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
