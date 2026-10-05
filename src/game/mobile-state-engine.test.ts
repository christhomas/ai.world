import { describe, expect, it } from 'vitest';
import { create } from './mobile-state-engine';

function client(session = 'installed') {
  const engine = create(session);
  let sequence = 0;
  return (type: string, payload: unknown) => JSON.parse(engine.request(JSON.stringify({
    version: 1, session, sequence, id: `r:${sequence++}`, type, payload,
  })));
}
const input = { move: [0, 0], look: [0, 0], held: { guard: false, run: false }, actions: [], owner: 'WORLD', busy: null };
const hero = (result: ReturnType<ReturnType<typeof client>>) => result.payload.state.models.hero;

describe('installed hero state engine', () => {
  it('changes the actual starting kit through unequip/equip and isolates a fresh VM session', () => {
    const first = client();
    expect(hero(first('start', { mode: 'local', world: 'local' })).inventory.equipped.hand).toBe('stick');
    const off = hero(first('action', { action: 'unequip', target: 'hand', args: null }));
    expect(off.inventory.equipped.hand).toBeUndefined();
    expect(hero(first('action', { action: 'equip', target: 'stick', args: null })).inventory.equipped.hand).toBe('stick');
    expect(hero(first('action', { action: 'unequip', target: 'hand', args: null })).inventory.equipped.hand).toBeUndefined();
    const second = client('fresh');
    expect(hero(second('start', { mode: 'local', world: 'local' })).inventory.equipped.hand).toBe('stick');
  });
  it('parks the real clock, then resumes it once active', () => {
    const request = client();
    const start = hero(request('start', { mode: 'local', world: 'local' }));
    request('lifecycle', { state: 'background', renderTimeMs: 0 });
    expect(hero(request('step', { tick: 0, dtSeconds: 0.1, renderTimeMs: 100, input })).time).toBe(start.time);
    expect(request('action', { action: 'unequip', target: 'hand', args: null }).type).toBe('error');
    request('lifecycle', { state: 'active', renderTimeMs: 100 });
    expect(hero(request('step', { tick: 1, dtSeconds: 0.1, renderTimeMs: 200, input })).time).toBeGreaterThan(start.time);
  });
  it('refuses unavailable world/load operations and never invents movement', () => {
    const request = client();
    request('start', { mode: 'local', world: 'local' });
    expect(request('load', { key: 'save' }).payload.code).toBe('port-failed');
    expect(request('step', { tick: 0, dtSeconds: 0.1, renderTimeMs: 100, input: { ...input, move: [1, 0] } }).type).toBe('error');
    expect(request('resync', { reason: 'full' }).type).toBe('result');
  });
  it('rejects stale identities, replay and calls after disposal at the shared contract gate', () => {
    const engine = create('owned');
    const start = { version: 1, session: 'owned', sequence: 0, id: 'start', type: 'start', payload: { mode: 'local', world: 'local' } };
    expect(() => engine.request(JSON.stringify({ ...start, session: 'stale' }))).toThrow('stale-session');
    engine.request(JSON.stringify(start));
    expect(() => engine.request(JSON.stringify(start))).toThrow('out-of-order');
    engine.request(JSON.stringify({ ...start, sequence: 1, id: 'dispose', type: 'dispose', payload: {} }));
    expect(() => engine.request(JSON.stringify({ ...start, sequence: 2, id: 'late' }))).toThrow('disposed');
  });
  it('restores a changed hero through the production reader instead of reapplying the starting kit', () => {
    const first = client();
    const initial = hero(first('start', { mode: 'local', world: 'local' }));
    const saved = hero(first('action', { action: 'unequip', target: 'hand', args: null }));
    saved.hp = 73; saved.day = 8; saved.time = 0.7;
    saved.inventory.gold = 17;
    const reopened = create('continued', JSON.stringify(saved));
    const result = JSON.parse(reopened.request(JSON.stringify({ version: 1, session: 'continued',
      sequence: 0, id: 'start', type: 'start', payload: { mode: 'local', world: 'local' } })));
    const restored = hero(result);
    expect(restored.playerId).toBe(initial.playerId);
    expect(restored.inventory.equipped.hand).toBeUndefined();
    expect(restored.inventory.gold).toBe(17);
    expect([restored.hp, restored.day, restored.time]).toEqual([73, 8, 0.7]);
    expect(initial.inventory.equipped.hand).toBe('stick');
  });
  it('rejects malformed saved heroes before exposing a VM owner', () => {
    for (const value of ['null', '[]', '{}', '{', JSON.stringify({ hp: 1, inventory: {} })]) {
      expect(() => create('corrupt', value)).toThrow();
    }
  });
});
