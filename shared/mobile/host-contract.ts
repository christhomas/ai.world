/** In-process app ABI. Never use this number as server PROTOCOL_VERSION. */
export const HOST_CONTRACT_VERSION = 1;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** Existing world Link protocol: JSON words and binary terrain parcels. */
export type HostParcel = string | ArrayBuffer;
export type FocusOwner = 'WORLD' | 'BOOK' | 'TYPING';
export type Busy = null | 'reading' | 'talking' | 'framing' | 'typing';
export type FailureCode = 'version' | 'invalid' | 'stale-session' | 'out-of-order' | 'cancelled' | 'disposed' | 'port-failed' | 'resync-required';
export interface NormalizedInput {
  move: [number, number]; look: [number, number];
  held: { guard: boolean; run: boolean }; actions: string[];
  owner: FocusOwner; busy: Busy;
}
export type Request =
  | { type: 'start'; payload: { mode: 'local' | 'remote'; world: string } }
  | { type: 'load'; payload: { key: string } }
  | { type: 'step'; payload: { tick: number; dtSeconds: number; renderTimeMs: number; input: NormalizedInput } }
  | { type: 'action'; payload: { action: string; target: string | null; args: Json } }
  | { type: 'cancel'; payload: { requestId: string } }
  | { type: 'resync'; payload: { reason: string } }
  | { type: 'lifecycle'; payload: { state: 'active' | 'inactive' | 'background'; renderTimeMs: number } }
  | { type: 'dispose'; payload: Record<string, never> };
export type HostRequest = Request & { version: number; session: string; sequence: number; id: string };
export interface Presentation {
  revision: number; tick: number; renderTimeMs: number; owner: FocusOwner; busy: Busy;
  /** Stable IDs and explicit domain models; no DOM, callbacks or untranslated game rules. */
  models: Record<string, Json>;
}
export interface HostResult {
  version: number; session: string; sequence: number; requestId: string;
  type: 'result' | 'error';
  payload: { state?: Presentation; code?: FailureCode; message?: string; full?: boolean };
}
export interface SceneSubmission {
  session: string; revision: number; baseRevision: number | null; renderTimeMs: number;
  /** Ownership passes to scene.submit until its Promise resolves, including rejection. */
  buffers: readonly ArrayBuffer[]; removedEntities: readonly string[];
}
export interface HostPorts {
  clock: { nowMs(): number };
  lifecycle: { subscribe(listener: (state: 'active' | 'inactive' | 'background') => void): () => void };
  storage: { load(key: string): Promise<Json | null>; commit(key: string, value: Json): Promise<void>; remove(key: string): Promise<void> };
  assets: { readBundled(path: string): Promise<ArrayBuffer> };
  audio: { play(cue: string, gain: number): void; mute(muted: boolean): void; dispose(): void };
  capture: { save(session: string, revision: number): Promise<string> };
  scene: { submit(scene: SceneSubmission): Promise<void>; reset(session: string): Promise<void> };
  localWorld: { send(message: HostParcel): Promise<void>; subscribe(listener: (message: HostParcel) => void): () => void; dispose(): Promise<void> };
  remoteWorld: { connect(url: string): Promise<void>; send(message: HostParcel): Promise<void>; subscribe(listener: (message: HostParcel) => void): () => void; dispose(): Promise<void> };
}
export interface GameHostSession {
  request(request: HostRequest): Promise<HostResult>;
  subscribe(listener: (state: Presentation) => void): () => void;
}
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]): boolean => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(n => finite(n) && n >= -1 && n <= 1);
const json = (v: unknown, depth = 0): boolean => depth <= 32 && (v === null || typeof v === 'string' || typeof v === 'boolean' || finite(v) || (Array.isArray(v) ? v.every(x => json(x, depth + 1)) : record(v) && Object.values(v).every(x => json(x, depth + 1))));
export function validateRequest(value: unknown): HostRequest {
  if (!record(value) || !exact(value, ['version', 'session', 'sequence', 'id', 'type', 'payload'])) throw new Error('invalid');
  if (value.version !== HOST_CONTRACT_VERSION) throw new Error('version');
  if (!id(value.session) || !integer(value.sequence) || !id(value.id) || !record(value.payload)) throw new Error('invalid');
  const p = value.payload;
  let valid = false;
  switch (value.type) {
    case 'start': valid = exact(p, ['mode', 'world']) && ['local', 'remote'].includes(p.mode as string) && id(p.world); break;
    case 'load': valid = exact(p, ['key']) && id(p.key); break;
    case 'action': valid = exact(p, ['action', 'target', 'args']) && id(p.action) && (p.target === null || id(p.target)) && json(p.args); break;
    case 'cancel': valid = exact(p, ['requestId']) && id(p.requestId); break;
    case 'resync': valid = exact(p, ['reason']) && id(p.reason); break;
    case 'dispose': valid = exact(p, []); break;
    case 'lifecycle': valid = exact(p, ['state', 'renderTimeMs']) && ['active', 'inactive', 'background'].includes(p.state as string) && finite(p.renderTimeMs) && p.renderTimeMs >= 0; break;
    case 'step': {
      const i = p.input;
      valid = exact(p, ['tick', 'dtSeconds', 'renderTimeMs', 'input']) && integer(p.tick) && finite(p.dtSeconds) && p.dtSeconds > 0 && p.dtSeconds <= 0.1 && finite(p.renderTimeMs) && p.renderTimeMs >= 0 && record(i) && exact(i, ['move', 'look', 'held', 'actions', 'owner', 'busy']) && pair(i.move) && pair(i.look) && record(i.held) && exact(i.held, ['guard', 'run']) && typeof i.held.guard === 'boolean' && typeof i.held.run === 'boolean' && Array.isArray(i.actions) && i.actions.every(id) && new Set(i.actions).size === i.actions.length && ['WORLD', 'BOOK', 'TYPING'].includes(i.owner as string) && [null, 'reading', 'talking', 'framing', 'typing'].includes(i.busy as Busy);
      break;
    }
  }
  if (!valid) throw new Error('invalid');
  return value as unknown as HostRequest;
}
/** Host-neutral gate: rejected messages never advance sequence/tick/time. */
export class RequestGate {
  private sequence = 0;
  private tick = -1;
  private time = 0;
  private disposed = false;
  private readonly ids = new Set<string>();
  constructor(readonly session: string) { if (!id(session)) throw new Error('invalid'); }
  accept(value: unknown): HostRequest {
    const r = validateRequest(value);
    if (r.session !== this.session) throw new Error('stale-session');
    if (this.disposed) throw new Error('disposed');
    if (r.sequence !== this.sequence || this.ids.has(r.id)) throw new Error('out-of-order');
    if (r.type === 'step' && (r.payload.tick !== this.tick + 1 || r.payload.renderTimeMs < this.time)) throw new Error('out-of-order');
    if (r.type === 'lifecycle' && r.payload.renderTimeMs < this.time) throw new Error('out-of-order');
    if (r.type === 'step') { this.tick = r.payload.tick; this.time = r.payload.renderTimeMs; }
    if (r.type === 'lifecycle') this.time = r.payload.renderTimeMs;
    this.ids.add(r.id); this.sequence++;
    // Sequence rejects lifetime replays; only recent ID collisions need retained history.
    if (this.ids.size > 4096) this.ids.delete(this.ids.values().next().value!);
    if (r.type === 'dispose') this.disposed = true;
    return r;
  }
}
/** Presentation retains talking/framing: owner alone must never erase existing gameplay modes. */
export function parkedInput(input: NormalizedInput): NormalizedInput {
  if (input.owner === 'WORLD' && input.busy === null) return input;
  return { ...input, move: [0, 0], look: [0, 0], held: { guard: false, run: false }, actions: [] };
}
