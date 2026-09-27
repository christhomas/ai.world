import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage } from './protocol';
import { Simulation } from './sim';
import { Forgetful } from './vault';
import { manifestIn, worldPath } from './world';

const terrain = [{ x: 128, z: -64, reach: 75, seed: 42, kind: 'land' as const }];
const join: Extract<ClientMessage, { type: 'join' }> = {
  type: 'join', seed: 9, kind: 'endless', name: 'Maker', version: PROTOCOL_VERSION,
  day: 1, time: 0.3, terrain,
};

function enter(sim: Simulation, message: ClientMessage): { closed: boolean } {
  const wire = { open: true, closed: false, send: (_parcel: string | ArrayBuffer) => {}, close() { this.closed = true; } };
  sim.attach(wire).receive(JSON.stringify(message));
  return wire;
}

describe('terrain authored before a private world opens', () => {
  it('persists the page list into the private worker world before ground is grown', () => {
    const vault = new Forgetful();
    const sim = new Simulation({ vault, localAuthoring: true });
    expect(enter(sim, join).closed).toBe(false);
    const room = sim.rooms.get(9)!;
    expect(room.world.manifest.terrain).toEqual(terrain);
    room.world.save();
    expect(manifestIn(vault, worldPath('', 9), 9).terrain).toEqual(terrain);
  });

  it('does not let a remote client replace the server manifest', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    enter(sim, join);
    expect(sim.rooms.manifestOf(9).terrain).toEqual([]);
  });

  it('rejects malformed layer lists before accepting a private join', () => {
    const sim = new Simulation({ vault: new Forgetful(), localAuthoring: true });
    const bad = { ...join, terrain: [{ ...terrain[0], reach: Infinity }] };
    expect(enter(sim, bad).closed).toBe(true);
  });
});
