import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage } from './protocol';
import { Simulation } from './sim';
import { Forgetful } from './vault';
import { manifestIn, worldPath } from './world';

const anchor = {
  id: 'highland:prayer:Shrine of Echoes:north', kind: 'highland' as const,
  x: 96, z: -96, seed: 0x12345678, parent: null, version: 1,
  layer: { reach: 80, lift: 6 },
};
const join: Extract<ClientMessage, { type: 'join' }> = {
  type: 'join', seed: 9, kind: 'endless', name: 'Maker', version: PROTOCOL_VERSION,
  day: 70, time: 0.3, highlands: [anchor],
};

function enter(sim: Simulation, message: ClientMessage): { closed: boolean } {
  const wire = { open: true, closed: false, send: (_parcel: string | ArrayBuffer) => {}, close() { this.closed = true; } };
  sim.attach(wire).receive(JSON.stringify(message));
  return wire;
}

describe('a prayed-for mountain in the private worker', () => {
  it('imports the saved anchor before country growth and persists it', () => {
    const vault = new Forgetful();
    const sim = new Simulation({ vault, localAuthoring: true });
    expect(enter(sim, join).closed).toBe(false);
    const room = sim.rooms.get(9)!;
    expect(room.world.manifest.layers()).toEqual([anchor]);
    room.world.save();
    expect(manifestIn(vault, worldPath('', 9), 9).layers()).toEqual([anchor]);
  });

  it('ignores a client-supplied mountain on a shared server', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    expect(enter(sim, join).closed).toBe(false);
    expect(sim.rooms.manifestOf(9).layers()).toEqual([]);
  });

  it('rejects malformed and conflicting private anchors', () => {
    const sim = new Simulation({ vault: new Forgetful(), localAuthoring: true });
    expect(enter(sim, { ...join, highlands: [{ ...anchor, layer: { reach: Infinity, lift: 6 } }] }).closed).toBe(true);
    expect(enter(sim, join).closed).toBe(false);
    expect(enter(sim, { ...join, highlands: [{ ...anchor, layer: { reach: 80, lift: 8 } }] }).closed).toBe(true);
    expect(sim.rooms.manifestOf(9).layers()).toEqual([anchor]);
  });
});
