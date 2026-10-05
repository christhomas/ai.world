import { GameState, type GameStateJson } from './state';
import { SLOTS, type EquipSlot } from './items';
import { RequestGate, HOST_CONTRACT_VERSION, type HostResult, type Json } from '../../shared/mobile/host-contract';

/** Installed hero engine only; the full world/movement/scene session remains separate. */
export function create(session: string, savedHero: string | null = null): { request(text: string): string } {
  const gate = new RequestGate(session);
  let opening: GameState | null = null;
  if (savedHero !== null) {
    const saved = JSON.parse(savedHero) as GameStateJson;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) ||
      ![saved.hp, saved.maxHp, saved.time, saved.day, saved.savedAt].every(n => typeof n === 'number' && Number.isFinite(n)) ||
      typeof saved.playerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(saved.playerId) ||
      !saved.inventory || typeof saved.inventory !== 'object' ||
      ![saved.explored, saved.discovered, saved.opened, saved.keys].every(a => Array.isArray(a) && a.every(v => typeof v === 'string')) ||
      !saved.quests || typeof saved.quests !== 'object' || Array.isArray(saved.quests)) {
      throw new Error('Invalid saved hero');
    }
    // The existing production reader owns inventory, identity, clock and offline-day semantics.
    opening = GameState.from(saved);
  }
  let game: GameState | null = null;
  let active = true;
  let tick = -1;
  let time = 0;
  return { request(text) {
    const request = gate.accept(JSON.parse(text));
    const base = { version: HOST_CONTRACT_VERSION, session, sequence: request.sequence, requestId: request.id };
    try {
      if (request.type === 'start') {
        if (game || request.payload.mode !== 'local') throw new Error('State engine supports one local start');
        game = opening ?? GameState.fresh();
        opening = null;
      } else if (request.type === 'dispose') {
        game = null;
        return JSON.stringify({ ...base, type: 'result', payload: {} } satisfies HostResult);
      } else {
        if (!game) throw new Error('Start the state engine first');
        switch (request.type) {
          case 'step': {
            const p = request.payload;
            if ([...p.input.move, ...p.input.look].some(n => n !== 0) || p.input.actions.length || p.input.held.guard || p.input.held.run) {
              throw new Error('Movement and world input require the complete game session');
            }
            if (active) game.tick(p.dtSeconds);
            tick = p.tick; time = p.renderTimeMs;
            break;
          }
          case 'lifecycle': active = request.payload.state === 'active'; time = request.payload.renderTimeMs; break;
          case 'action': {
            const { action, target, args } = request.payload;
            if (!active) throw new Error('State engine is parked');
            if (args !== null || target === null) throw new Error('Item actions require a target and null arguments');
            if (action === 'equip') game.equip(target);
            else if (action === 'use') game.use(target);
            else if (action === 'unequip' && SLOTS.includes(target as EquipSlot)) game.unequip(target as EquipSlot);
            else throw new Error('Unsupported state action');
            break;
          }
          case 'resync': break;
          default: throw new Error('This request requires storage or world ports');
        }
      }
      return JSON.stringify({ ...base, type: 'result', payload: { full: true, state: {
        revision: game.version, tick, renderTimeMs: time, owner: 'WORLD', busy: null,
        models: { hero: game.toJSON() as unknown as Json },
      } } } satisfies HostResult);
    } catch (error) {
      return JSON.stringify({ ...base, type: 'error', payload: { code: 'port-failed', message: (error as Error).message } } satisfies HostResult);
    }
  } };
}
