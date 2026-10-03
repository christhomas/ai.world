import { describe, expect, it } from 'vitest';
import { RequestGate, parkedInput, validateRequest } from '../../shared/mobile/host-contract';
import { decodeScalars, encodeScalars } from '../../shared/mobile/binary';
import fixture from '../../shared/mobile/fixtures/session-v1.json';

describe('portable host contract v1', () => {
  it('consumes the shared fixture without host globals', () => {
    const gate = new RequestGate('fixture:1');
    expect(gate.accept(fixture.start).type).toBe('start');
    const step = gate.accept(fixture.step);
    expect(step.type).toBe('step');
    if (step.type !== 'step') throw new Error('fixture must contain a step');
    expect(step.payload.input.actions).toEqual(['interact']);
  });
  it('rejects version, stale generation, unknown payload and unsafe ordering', () => {
    expect(() => validateRequest({ ...fixture.start, version: 25 })).toThrow('version');
    expect(() => validateRequest({ ...fixture.start, type: 'wat' })).toThrow('invalid');
    expect(() => validateRequest({ ...fixture.start, payload: { ...fixture.start.payload, extra: true } })).toThrow('invalid');
    const gate = new RequestGate('fixture:1');
    expect(() => gate.accept({ ...fixture.start, session: 'fixture:0' })).toThrow('stale-session');
    expect(() => gate.accept(fixture.step)).toThrow('out-of-order');
    expect(gate.accept(fixture.start).id).toBe('start:0');
    gate.accept(fixture.step);
    expect(() => gate.accept(fixture.step)).toThrow('out-of-order');
    expect(() => gate.accept({ ...fixture.step, id: 'next', sequence: 2, payload: { ...fixture.step.payload, tick: 1, renderTimeMs: 1 } })).toThrow('out-of-order');
  });
  it('rejects nonfinite input and disposes a generation permanently', () => {
    expect(() => validateRequest({ ...fixture.step, payload: { ...fixture.step.payload, dtSeconds: NaN } })).toThrow('invalid');
    const gate = new RequestGate('fixture:1'); gate.accept(fixture.start);
    gate.accept({ ...fixture.start, id: 'dispose', sequence: 1, type: 'dispose', payload: {} });
    expect(() => gate.accept(fixture.step)).toThrow('disposed');
  });
  it('parks world input for every overlay and text owner', () => {
    const r = validateRequest(fixture.step); if (r.type !== 'step') throw new Error('step');
    for (const busy of ['reading', 'talking', 'framing', 'typing'] as const) {
      expect(parkedInput({ ...r.payload.input, busy }).actions).toEqual([]);
      expect(parkedInput({ ...r.payload.input, busy }).move).toEqual([0, 0]);
    }
    expect(parkedInput({ ...r.payload.input, owner: 'BOOK' }).held.guard).toBe(false);
    expect(parkedInput(r.payload.input).actions).toEqual(['interact']);
  });
  it('round trips Float64 precision and rejects malformed binary lengths', () => {
    expect(decodeScalars(encodeScalars(fixture.scalars))).toEqual(fixture.scalars);
    const bytes = encodeScalars(fixture.scalars);
    expect(new DataView(bytes).getUint32(8, true)).toBe(5);
    expect(() => decodeScalars(bytes.slice(0, -1))).toThrow('invalid');
    expect(() => encodeScalars([Infinity])).toThrow('invalid');
    new DataView(bytes).setUint16(4, 25, true);
    expect(() => decodeScalars(bytes)).toThrow('invalid');
  });
});
