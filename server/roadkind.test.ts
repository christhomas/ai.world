import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/config';
import { countryStamp, growWorld } from '../src/world/growworld';
import { TerrainSampler } from '../src/world/terrain';
import { tilesOf } from '../src/world/tiles';
import { PROTOCOL_VERSION, type ServerMessage } from './protocol';
import { Simulation } from './sim';

describe('joining a road world', () => {
  it('grows the road country for its creatures and sends the page a matching stamp', () => {
    const seed = 3;
    const sim = new Simulation({ ground: true });
    const surveyed = sim.groundOf(seed);
    expect(surveyed, 'a survey grew provisional ground before the first join').not.toBeNull();
    const heard: ServerMessage[] = [];
    const player = sim.attach({
      open: true,
      send: (parcel) => { if (typeof parcel === 'string') heard.push(JSON.parse(parcel) as ServerMessage); },
      close: () => {},
    });
    player.receive(JSON.stringify({
      type: 'join', seed, kind: 'road', name: 'Rowan', version: PROTOCOL_VERSION,
      day: 1, time: 0.3, x: 0, z: 0,
    }));

    const room = sim.rooms.get(seed);
    expect(room?.kind).toBe('road');
    const country = heard.find((message) => message.type === 'country');
    expect(country).toMatchObject({ type: 'country', kind: 'road', stamp: countryStamp(growWorld(seed)) });

    const server = sim.groundOf(seed);
    expect(server).not.toBeNull();
    expect(server).not.toBe(surveyed);
    const page = new TerrainSampler(growWorld(seed));
    const cx = 0, cz = 0;
    const expected = tilesOf(page.generateChunk(cx, cz));
    const actual = tilesOf(server!.parcelOf(cx, cz));
    expect(actual.types).toEqual(expected.types);
    expect(actual.heights).toEqual(expected.heights);
    expect(actual.types.length).toBe(WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE);
  });
});
