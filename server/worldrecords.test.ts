import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import { Rooms, type Wire } from './rooms';
import { Simulation } from './sim';
import { Forgetful } from './vault';
import { WorldRecordConflict, WorldRecords } from './worldrecords';

class Visitor {
  readonly heard: ServerMessage[] = [];
  open = true;
  private readonly connection;

  constructor(sim: Simulation) {
    const visitor = this;
    const wire: Wire = {
      send(parcel) {
        if (typeof parcel === 'string') visitor.heard.push(JSON.parse(parcel) as ServerMessage);
      },
      get open() { return visitor.open; },
      close() { visitor.open = false; },
    };
    this.connection = sim.attach(wire);
  }

  join(worldName: string, seed: number, x?: number, z?: number): void {
    const message: ClientMessage = {
      type: 'join', worldName, seed, name: 'Rowan',
      version: PROTOCOL_VERSION, day: 1, time: 0.3, x, z,
    };
    this.connection.receive(JSON.stringify(message));
  }
}

describe('named world records', () => {
  it('case-folds and trims one durable record without changing its chosen spelling', () => {
    const vault = new Forgetful();
    const records = new WorldRecords('worlds', vault);
    const made = records.claim('  Chris  ', 77);

    expect(made).toEqual({ name: 'Chris', seed: 77 });
    expect(records.find('CHRIS')).toEqual(made);
    expect(new WorldRecords('worlds', vault).find(' chris ')).toEqual(made);
  });

  it('refuses an existing name presented as a different country', () => {
    const records = new WorldRecords('worlds', new Forgetful());
    records.claim('Chris', 77);

    expect(() => records.claim('chris', 78)).toThrow(WorldRecordConflict);
    expect(() => records.claim('Other', 77)).toThrow('already named “Chris”');
  });

  it('keeps a named road world road across a registry reload and refuses an endless join', () => {
    const vault = new Forgetful();
    const records = new WorldRecords('worlds', vault);
    expect(records.claim('Crossroads', 3, 'road')).toEqual({ name: 'Crossroads', seed: 3, kind: 'road' });
    const restored = new WorldRecords('worlds', vault);
    expect(restored.find('crossroads')?.kind).toBe('road');
    expect(() => restored.claim('Crossroads', 3, 'endless')).toThrow(WorldRecordConflict);
    expect(new Rooms('worlds', vault).invite('Crossroads')?.kind).toBe('road');
  });

  it('keeps pre-name seed files as the state of a world when it gains a name', () => {
    const vault = new Forgetful();
    vault.write('worlds/77.json', JSON.stringify({
      seed: 77, clock: { day: 9, time: 0.5 }, deltas: [{ kind: 'chest', id: 'old-vault' }],
    }));
    const rooms = new Rooms('worlds', vault);
    const record = rooms.claimWorld('Chris', 77);
    const room = rooms.open(77, { day: 1, time: 0.3 }, record);

    expect(room.world.clock.day).toBe(9);
    expect(room.world.log).toContainEqual({ kind: 'chest', id: 'old-vault' });
  });

  it('puts case variants in one multiplayer room and refuses a colliding country', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const first = new Visitor(sim);
    first.join('Chris', 77);
    const second = new Visitor(sim);
    second.join(' chris ', 77, 32.45, 85.05);

    expect(first.heard.find((message) => message.type === 'joined')).toMatchObject({
      player: { name: 'Rowan', x: 32.45, z: 85.05 },
    });
    expect(second.heard.find((message) => message.type === 'welcome')).toMatchObject({
      seed: 77,
      world: { name: 'Chris', seed: 77 },
    });

    const collision = new Visitor(sim);
    collision.join('CHRIS', 78);
    expect(collision.heard.find((message) => message.type === 'error')).toMatchObject({
      reason: '“CHRIS” already names a different world.',
    });
    expect(collision.open).toBe(false);
  });
});
