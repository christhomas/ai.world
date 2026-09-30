import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import type { Wire } from './rooms';
import { WAIT_FOR_THE_WORLD, unpackChunk } from '../src/world/chunkparcel';
import { CHUNKS_AT_ONCE, localHighlands, Simulation, VIEW } from './sim';
import { IN_SIGHT } from './wildlife';
import { Forgetful } from './vault';
import { DAY_LENGTH } from './protocol';
import { homelandsOf } from '../src/entities/homeland';
import { provinceOfHome } from '../src/world/provinces';
import { Manifest } from '../src/world/manifest';
import { baitWouldTake } from './eyries';
import { EYRIE } from '../src/game/eyries';
import { rangesAsMassifs } from '../src/world/ranges';
import { boundsOf, patchOf } from '../src/world/patchwork';
import { endlessStamp } from '../src/world/growworld';
import { generateDungeon } from '../src/dungeon/generate';
import { BIG_CHEST_PRIZES, whatAChestHolds } from '../src/world/chests';
import { CROPS } from '../src/game/farming';
import { DatabaseSync } from 'node:sqlite';
import { migrateDomain } from './durable/db';
import { MINDS_SCHEMA, keepMinds, mindsOf } from './durable/minds';
import type { Person } from '../src/world/people';
import { HoldingBook } from '../src/world/holdingbook';
import { ownedBy, ownerFromSave } from '../src/world/holdings';
import { mountainAnchor, skyEyrieAnchor } from '../src/world/worldediting';
import { Register } from '../src/world/register';
import { cartLoaded, cartPosition } from '../src/world/carrierbook';

describe('private prayer manifests', () => {
  it('keeps long-lived worlds with more than 32 answered prayers joinable', () => {
    const anchors = Array.from({ length: 40 }, (_, i) => ({
      id: `highland:prayer:${i}`, kind: 'highland', x: i, z: 0, seed: i,
      parent: null, version: 1, layer: { reach: 80, lift: 5 },
    }));
    expect(localHighlands(anchors)).toHaveLength(40);
  });
});

describe('authoring an existing named world', () => {
  const draft = { x: 2000, z: 2000, reach: 80, lift: 12, roughness: 0.4, seed: 7 };

  it('writes loaded province state before replacing its terrain samplers', () => {
    const vault = new Forgetful();
    const sim = new Simulation({ vault, dataDir: 'worlds', ground: true });
    const record = sim.rooms.claimWorld('Old Vale', 322, 'endless');
    const room = sim.rooms.open(322, { day: 2, time: 0.4 }, record, 'endless');
    room.world.apply({ kind: 'sow', tile: '2000,2000', crop: 'wheat', day: 2 });
    expect(sim.namedWorldReminders('Old Vale', 2000, 2000, 80).pins)
      .toContainEqual({ x: 2000, z: 2000, label: 'A planted field', footing: 'land' });
    const revision = sim.namedWorldRevision('Old Vale')!;
    sim.authorNamedMountain('Old Vale', revision,
      mountainAnchor(draft, 'highland:edit:00000000-0000-4000-8000-000000000322'));
    expect(sim.rooms.get(322)).toBeUndefined();

    const reopened = sim.rooms.open(322, { day: 1, time: 0.3 }, record, 'endless');
    reopened.world.keepNear([{ x: 2000, z: 2000 }]);
    expect(reopened.world.log).toContainEqual(expect.objectContaining({ kind: 'sow', tile: '2000,2000' }));
    expect(reopened.world.manifest.layers()).toHaveLength(1);
  });

  it('rejects occupied, stale, and malformed edits without changing the manifest', () => {
    const sim = new Simulation({ vault: new Forgetful(), dataDir: 'worlds' });
    const record = sim.rooms.claimWorld('Old Vale', 322, 'endless');
    const revision = sim.namedWorldRevision('Old Vale')!;
    expect(() => sim.authorNamedMountain('Old Vale', revision, { kind: 'highland' })).toThrow('invalid');
    const person = new Pretend(sim).join(322, 'Ada');
    expect(() => sim.authorNamedMountain('Old Vale', revision,
      mountainAnchor(draft, 'highland:edit:00000000-0000-4000-8000-000000000322'))).toThrow('Leave this world');
    person.leave();
    expect(() => sim.authorNamedTerrain('Old Vale', 'stale', { x: 0, z: 0, reach: 60, seed: 1, kind: 'sea' }))
      .toThrow('changed');
    expect(sim.rooms.manifestOf(record.seed).layers()).toHaveLength(0);
  });

  it('reports a failed durable write and rolls the proposed layer back', () => {
    class FailedWorldVault extends Forgetful {
      override write(name: string, text: string): void {
        if (name.endsWith('/322.json')) throw new Error('disk full');
        super.write(name, text);
      }
    }
    const sim = new Simulation({ vault: new FailedWorldVault(), dataDir: 'worlds' });
    const record = sim.rooms.claimWorld('Old Vale', 322, 'endless');
    const revision = sim.namedWorldRevision('Old Vale')!;
    expect(() => sim.authorNamedMountain('Old Vale', revision,
      mountainAnchor(draft, 'highland:edit:00000000-0000-4000-8000-000000000322'))).toThrow('disk full');
    expect(sim.rooms.manifestOf(record.seed).layers()).toHaveLength(0);
    expect(sim.namedWorldRevision('Old Vale')).toBe(revision);
  });

  it('does not discard a loaded field or publish an edit when its province cannot be flushed', () => {
    class FailedProvinceVault extends Forgetful {
      override write(name: string, text: string): void {
        if (name.includes('/322/')) throw new Error('province disk full');
        super.write(name, text);
      }
    }
    const sim = new Simulation({ vault: new FailedProvinceVault(), dataDir: 'worlds' });
    const record = sim.rooms.claimWorld('Old Vale', 322, 'endless');
    const room = sim.rooms.open(322, { day: 2, time: 0.4 }, record, 'endless');
    room.world.apply({ kind: 'sow', tile: '2000,2000', crop: 'wheat', day: 2 });
    const revision = sim.namedWorldRevision('Old Vale')!;
    expect(() => sim.authorNamedMountain('Old Vale', revision,
      mountainAnchor(draft, 'highland:edit:00000000-0000-4000-8000-000000000322'))).toThrow('province disk full');
    expect(sim.rooms.get(322)?.world.log).toContainEqual(expect.objectContaining({ kind: 'sow', tile: '2000,2000' }));
    expect(sim.rooms.manifestOf(322).layers()).toHaveLength(0);
    expect(sim.namedWorldRevision('Old Vale')).toBe(revision);
  });

  it('persists an editor-placed skyward eyrie and offers it on the next named invite', () => {
    const vault = new Forgetful();
    const sim = new Simulation({ vault, dataDir: 'worlds' });
    const record = sim.rooms.claimWorld('Old Vale', 322, 'endless');
    const room = sim.rooms.open(322, { day: 1, time: 0.3 }, record, 'endless');
    const site = room.world.manifest.ensure('sky:256,256', 'skyisle', 256, 256, 'ground:256,256');
    site.skySite = { radius: 22, y: 26 };
    room.world.authorTerrain([]);
    room.world.save(true);
    sim.rooms.close(322);
    const anchor = skyEyrieAnchor(sim.rooms.manifestOf(322), site.id, 300, 256,
      'eyrie:edit:00000000-0000-4000-8000-000000000322')!;
    sim.authorNamedSkyEyrie('Old Vale', sim.namedWorldRevision('Old Vale')!, anchor);
    expect(sim.namedWorldReminders('Old Vale', anchor.x, anchor.z, 20).pins)
      .toContainEqual({ x: anchor.x, z: anchor.z,
        label: `The skyward eyrie at ${Math.round(anchor.x)}, ${Math.round(anchor.z)}`, footing: 'land' });
    const again = new Simulation({ vault, dataDir: 'worlds' });
    expect(again.rooms.invite('Old Vale')).toMatchObject({
      sites: [site], skyEyries: [anchor],
    });
  });
});

/**
 * The simulation on its own, with no sockets and no files anywhere near it.
 *
 * This is the test that says the thing is portable. Everything here drives it through a `Wire` made
 * of an array — which is exactly what a Web Worker's `postMessage` is, once the ceremony is taken
 * off — so if these pass, the same code passes in a browser thread. The websocket server has its own
 * tests over a real socket; between the two, both hosts are covered without either being written
 * twice.
 */

/** A player made of a list: everything the simulation said to them, in order. */
class Pretend {
  readonly heard: ServerMessage[] = [];
  /** Whether the simulation still thinks it can reach them. Closed when it gives up on them. */
  open = true;
  readonly wire: Wire;
  private readonly attached;

  constructor(sim: Simulation) {
    // the wire holds a closure over this player rather than reading `this`, because inside an
    // object literal `this` is the literal, and a getter reading its own name is a stack overflow
    const player = this;
    this.wire = {
      send: (parcel) => {
        // the tests are about what the world says in words; nothing sends bytes yet, and a test
        // that quietly swallowed them would be the wrong place to find that out
        if (typeof parcel !== 'string') throw new Error('the world sent bytes to a test that expects words');
        player.heard.push(JSON.parse(parcel) as ServerMessage);
      },
      get open(): boolean { return player.open; },
      close: () => { player.open = false; },
    };
    this.attached = sim.attach(this.wire);
  }

  join(seed: number, name: string, version = PROTOCOL_VERSION): this {
    this.say({ type: 'join', seed, name, version, day: 2, time: 0.4 });
    return this;
  }

  /**
   * The same, saying where the hero is standing.
   *
   * Apart from `join` above on purpose, because the two are asking the world for different things.
   * A join that says nothing about where it is gets a country grown on demand, which is what every
   * client did before the ground travelled and what an old one still does. A join that says where
   * it is gets that country grown *now* — which costs the world two-thirds of a second, so no test
   * pays for it by accident.
   */
  joinAt(seed: number, name: string, x: number, z: number): this {
    this.say({ type: 'join', seed, name, version: PROTOCOL_VERSION, day: 2, time: 0.4, x, z });
    return this;
  }

  say(message: ClientMessage): void {
    this.attached.receive(JSON.stringify(message));
  }

  leave(): void {
    this.attached.leave();
  }

  /** Every message of a type, which is what a test is usually asking about. */
  of<T extends ServerMessage['type']>(type: T): Array<Extract<ServerMessage, { type: T }>> {
    return this.heard.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

/**
 * A ledge on seed 3 where the world's own bait rule keeps an eagle today (#525).
 *
 * Found rather than written down, because the roll is keyed to the day the room's clock reads: the
 * ranges of the square at the origin, walked in from their skirts, until one tile takes.
 */
function aLedgeThatTakes(sim: Simulation): ReturnType<Manifest['ensure']> {
  const ground = sim.groundOf(3)!;
  const room = sim.rooms.get(3)!;
  const day = Math.floor(room.world.clock.day);
  const country = ground.countryAt(0, 0);
  const { x0, z0, x1, z1 } = boundsOf(patchOf(0, 0));
  const ranges = (country.ranges ? rangesAsMassifs(country.ranges, country.mesh) : country.massifs)
    .filter((massif) => massif.radius >= EYRIE.WORTH_FLYING);
  for (const massif of ranges) {
    for (let share = 0.3; share < 1; share += 0.1) for (let turn = 0; turn < Math.PI * 2; turn += 0.3) {
      const x = Math.round(massif.x + Math.cos(turn) * massif.radius * share);
      const z = Math.round(massif.z + Math.sin(turn) * massif.radius * share);
      if (x < x0 + 8 || z < z0 + 8 || x >= x1 - 8 || z >= z1 - 8) continue;
      const anchor = new Manifest(3).ensure(`eyrie:${x},${z}`, 'eyrie', x, z);
      if (baitWouldTake(room.world.manifest, 3, day, country, anchor)) return anchor;
    }
  }
  throw new Error('no ledge on the square at the origin of seed 3 keeps an eagle today');
}

describe('the simulation, hosted by nothing at all', () => {
  it('welcomes a player, and tells them the world they arrived in', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const rowan = new Pretend(sim).join(7, 'Rowan');

    const [welcome] = rowan.of('welcome');
    expect(welcome).toMatchObject({ seed: 7, clock: { day: 2 } });
    expect(welcome.players).toEqual([]);
    // and the rest of the handshake, which is what a client needs before it can draw anything
    expect(rowan.of('stalls')).toHaveLength(1);
    expect(rowan.of('folk')[0].names).toEqual(['Rowan']);
  });

  it('turns away a client that speaks a different version', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const old = new Pretend(sim).join(7, 'Rowan', PROTOCOL_VERSION - 1);
    expect(old.of('error')).toHaveLength(1);
    expect(old.of('welcome')).toHaveLength(0);
  });

  it('puts two players in one world and lets them hear each other', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    const wren = new Pretend(sim).join(7, 'Wren');

    // she was told he is already here; he was told she arrived
    expect(wren.of('welcome')[0].players.map((p) => p.name)).toEqual(['Rowan']);
    expect(rowan.of('joined').map((m) => m.player.name)).toEqual(['Wren']);

    wren.say({ type: 'say', text: 'is anyone about?' });
    expect(rowan.of('said').map((m) => m.text)).toEqual(['is anyone about?']);
    // and she hears her own line, so the log reads the same for everybody in it
    expect(wren.of('said').map((m) => m.text)).toEqual(['is anyone about?']);
  });

  it('keeps two seeds apart, however loudly either of them talks', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const here = new Pretend(sim).join(7, 'Rowan');
    const elsewhere = new Pretend(sim).join(8, 'Wren');
    elsewhere.say({ type: 'say', text: 'hello?' });
    expect(here.of('said')).toHaveLength(0);
  });

  it('passes on what one player changed about the world', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    const wren = new Pretend(sim).join(7, 'Wren');
    // a mine somebody has fought through, rather than a chest: a chest has a command of its own now
    // and a page may no longer simply announce one. See `mayReport`
    rowan.say({ type: 'delta', delta: { kind: 'cleared', mine: 'Barrow', many: 4 } });
    expect(wren.of('delta').map((m) => m.delta)).toEqual([{ kind: 'cleared', mine: 'Barrow', many: 4 }]);
  });

  /*
   * A nest is changed from where the world walked the hero, not from where his page says he is:
   * #524. So every nest below is reported by somebody the world has walked, on ground it can walk
   * him on, and the nest is beside where it got him to.
   */
  const onALedge = () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    // a real ledge now, not any spot beside him: the world asks the bait rule itself (#525)
    const ledge = aLedgeThatTakes(sim);
    rowan.say({ type: 'move', x: ledge.x, z: ledge.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const at = rowan.of('youAre').at(-1);
    expect(at, 'the world never walked him, so no nest could be his').toBeDefined();
    expect(Math.hypot(at!.x - ledge.x, at!.z - ledge.z), 'and he stands at the ledge').toBeLessThan(8);
    return { sim, rowan, anchor: ledge };
  };

  it('broadcasts a baited nest and replays its latest state to a joining player', () => {
    const { sim, rowan, anchor } = onALedge();
    const wren = new Pretend(sim).join(3, 'Wren');
    const added = { kind: 'eyrie', anchor, present: true } as const;
    const removed = { kind: 'eyrie', anchor, present: false } as const;

    rowan.say({ type: 'delta', delta: added });
    expect(rowan.of('eyrie-state').at(-1)).toEqual({ type: 'eyrie-state', id: anchor.id, anchor });
    expect(wren.of('delta').map((m) => m.delta)).toEqual([added]);
    expect(new Pretend(sim).join(3, 'Alder').of('welcome')[0].deltas).toContainEqual(added);
    rowan.say({ type: 'delta', delta: added });
    expect(rowan.of('eyrie-state')).toHaveLength(2);
    expect(wren.of('delta')).toHaveLength(1);

    rowan.say({ type: 'delta', delta: removed });
    expect(rowan.of('eyrie-state').at(-1)).toEqual({ type: 'eyrie-state', id: anchor.id, anchor: null });
    expect(wren.of('delta').at(-1)?.delta).toEqual(removed);
    expect(new Pretend(sim).join(3, 'Birch').of('welcome')[0].deltas)
      .toContainEqual(removed);
    rowan.say({ type: 'delta', delta: removed });
    expect(rowan.of('eyrie-state').at(-1)).toEqual({ type: 'eyrie-state', id: anchor.id, anchor: null });
    expect(wren.of('delta')).toHaveLength(2);
  });

  it('corrects refused and malformed nest reports without changing the other player or replay', () => {
    const { sim, rowan, anchor: near } = onALedge();
    const wren = new Pretend(sim).join(3, 'Wren');
    const far = new Manifest(3).ensure('eyrie:100,100', 'eyrie', 100, 100);

    rowan.say({ type: 'delta', delta: { kind: 'eyrie', anchor: far, present: true } });
    expect(rowan.of('eyrie-state')).toEqual([{ type: 'eyrie-state', id: far.id, anchor: null }]);
    expect(wren.of('delta')).toEqual([]);
    expect(new Pretend(sim).join(3, 'Alder').of('welcome')[0].deltas).toEqual([]);

    // A malformed attempt against an existing nest must return that nest, not the bad claim.
    rowan.say({ type: 'delta', delta: { kind: 'eyrie', anchor: near, present: true } });
    rowan.say({ type: 'delta', delta: { kind: 'eyrie', anchor: { ...near, seed: -1 }, present: false } });
    expect(rowan.of('eyrie-state').at(-1)).toEqual({ type: 'eyrie-state', id: near.id, anchor: near });
    expect(wren.of('delta').map((m) => m.delta)).toEqual([{ kind: 'eyrie', anchor: near, present: true }]);
    expect(new Pretend(sim).join(3, 'Birch').of('welcome')[0].deltas)
      .toContainEqual({ kind: 'eyrie', anchor: near, present: true });
  });

  it('will not take a nest from a page the world has never walked, however near it says it is', () => {
    // #524: the guard used to fall back to the page's own presence until the first steer, and a
    // join or a move is all it takes to set that anywhere in the world
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const wren = new Pretend(sim).join(3, 'Wren');
    const anchor = aLedgeThatTakes(sim);
    const nest = { kind: 'eyrie', anchor, present: true } as const;
    rowan.say({ type: 'move', x: anchor.x, z: anchor.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    const room = sim.rooms.get(3)!;
    const rowansPresence = [...room.clients].find((c) => c.presence.name === 'Rowan')!.presence;
    expect(Math.hypot(rowansPresence.x - anchor.x, rowansPresence.z - anchor.z), 'his page puts him beside it')
      .toBeLessThan(2);

    rowan.say({ type: 'delta', delta: nest });
    expect(rowan.of('eyrie-state')).toEqual([{ type: 'eyrie-state', id: anchor.id, anchor: null }]);
    expect(room.world.manifest.get(anchor.id), 'a nest the world never walked him to').toBeUndefined();
    expect(wren.of('delta')).toEqual([]);

    // and the same report from the same spot is taken once the world has walked him there, so what
    // refused it above was the walking rather than the nest
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    rowan.say({ type: 'delta', delta: nest });
    expect(rowan.of('eyrie-state').at(-1)).toEqual({ type: 'eyrie-state', id: anchor.id, anchor });
    expect(wren.of('delta').map((m) => m.delta)).toEqual([nest]);
  });

  it('will not take a nest the bait would not have kept, however well he stands (#525)', () => {
    const { sim, rowan } = onALedge();
    const wren = new Pretend(sim).join(3, 'Wren');
    const room = sim.rooms.get(3)!;
    const ground = sim.groundOf(3)!;
    const day = Math.floor(room.world.clock.day);
    const at = rowan.of('youAre').at(-1)!;
    // a spot beside him the rule turns down, whatever the reason: the page says it took
    let refused: ReturnType<Manifest['ensure']> | null = null;
    for (let dz = -6; dz <= 6 && !refused; dz++) for (let dx = -6; dx <= 6 && !refused; dx++) {
      const x = Math.round(at.x) + dx, z = Math.round(at.z) + dz;
      if (ground.heightAt(x, z) === null) continue;
      const anchor = new Manifest(3).ensure(`eyrie:${x},${z}`, 'eyrie', x, z);
      if (!baitWouldTake(room.world.manifest, 3, day, ground.countryAt(x, z), anchor)) refused = anchor;
    }
    expect(refused, 'some tile near a ledge fails the roll or the footing').not.toBeNull();
    rowan.say({ type: 'delta', delta: { kind: 'eyrie', anchor: refused!, present: true } });
    expect(rowan.of('eyrie-state')).toEqual([{ type: 'eyrie-state', id: refused!.id, anchor: null }]);
    expect(room.world.manifest.get(refused!.id)).toBeUndefined();
    expect(wren.of('delta')).toEqual([]);
  });

  it('corrects a refused report about an editor-placed sky eyrie too', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    const manifest = sim.rooms.get(7)!.world.manifest;
    const site = manifest.ensure('sky:0,0', 'skyisle', 0, 0, null);
    site.skySite = { radius: 22, y: 26 };
    const placed = skyEyrieAnchor(manifest, site.id, 4, 0, 'eyrie:edit:00000000-0000-4000-8000-000000000322')!;
    manifest.anchors.set(placed.id, placed);
    expect(manifest.get(placed.id)).toEqual(placed);

    // an older page that took this one down as if it were baited: the server keeps it, and says so
    rowan.say({ type: 'delta', delta: { kind: 'eyrie', anchor: placed, present: false } });
    expect(rowan.of('eyrie-state')).toEqual([{ type: 'eyrie-state', id: placed.id, anchor: placed }]);
    expect(manifest.get(placed.id)).toEqual(placed);

    // and any other eyrie id it cannot place is answered as absent rather than ignored
    rowan.say({ type: 'delta', delta: { kind: 'eyrie', anchor: { ...placed, id: 'eyrie:elsewhere' }, present: true } });
    expect(rowan.of('eyrie-state').at(-1)).toEqual({ type: 'eyrie-state', id: 'eyrie:elsewhere', anchor: null });
  });

  /*
   * A joining page replays every village it grows from the founding, and that replay is the book —
   * so the server's copy, sent in every welcome, was replaced by the page's own the moment it settled
   * anywhere, and was 2 MB of welcome after a year. #484. What a welcome must not carry is the
   * thing that grows with every morning the world has lived.
   */
  it('sends a joining player no holding daybook, however much the server has written in it', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    new Pretend(sim).join(7, 'Rowan');
    const book = new HoldingBook();
    book.stood('Ashford', 5, [{ day: 5, holding: 'yard-1', kind: 'crew', who: 'Bob',
      funder: ownerFromSave('Rich'), wage: 12, paid: 12 }], new Map());
    book.earned('Ashford', [{ type: 'income', day: 5, holding: 'farm-1',
      owner: ownerFromSave('Rich'), cattle: 2.16, crop: 1.24 }]);
    expect(book.facts(), 'the server had nothing to send').toBeGreaterThan(0);
    const register = { compact: () => {}, holdingsBook: book };
    sim.rooms.get(7)!.world.keepsTheRegister(register);
    const welcome = new Pretend(sim).join(7, 'Wren').of('welcome')[0];
    expect(welcome, 'nobody was welcomed').toBeDefined();
    expect(Object.keys(welcome)).not.toContain('holdingDays');
  });

  it('moves the clock and tells everybody where everybody is', () => {
    // a patient world, because stepping a minute forward would otherwise drop both of them for
    // having said nothing in thirty seconds — which is the next test, not this one
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    new Pretend(sim).join(7, 'Wren');
    const started = sim.rooms.get(7)!.world.clock.time;

    // an hour of a world is five minutes of ours, so a minute of stepping is plainly visible
    sim.tick(Date.now() + 60_000);
    expect(sim.rooms.get(7)!.world.clock.time).toBeGreaterThan(started);
    expect(rowan.of('presence').at(-1)?.players.map((p) => p.name)).toEqual(['Wren']);
  });

  it('drops somebody it has not heard from, and closes the world they were alone in', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 1_000 });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    const from = Date.now();
    expect(sim.rooms.playerCount).toBe(1);

    // a tenth of a second at a time, the way a server that is actually running does it. Jumping the
    // clock in one tick used to work here and deliberately does not any more: see `HEARD_AT_MOST`,
    // because a jump and a held event loop are the same thing seen from inside `tick`.
    for (let at = 100; at <= 2_000; at += 100) sim.tick(from + at);
    expect(rowan.open, 'the wire was closed on them').toBe(false);
    expect(sim.rooms.playerCount).toBe(0);
    // and the room went with them: an empty world is not worth ticking
    sim.tick(from + 2_100);
    expect(sim.rooms.worldCount).toBe(0);
  });

  it('does not drop somebody for a silence it spent itself', () => {
    // The tick that comes out of a long hold used to read the whole gap off the clock and conclude
    // the player had sat there saying nothing. They had not been given the chance: founding a world
    // is synchronous, and on this four-core box a join measured 50817ms, 62642ms and 58701ms, all
    // of it inside one `receive` with nothing else running — not the tick, not the socket.
    //
    // So the reward for opening a world was being thrown out of it the moment it was ready, which
    // is what `operate.test.ts` reported as `expected +0 to be 2` and what failed the 0.100.1
    // release. A thirty-second patience is the real one; the hold is twice it.
    const sim = new Simulation({ vault: new Forgetful(), timeout: 30_000 });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    expect(sim.rooms.playerCount, 'they got in').toBe(1);

    sim.tick(Date.now() + 60_000);

    expect(rowan.open, 'the wire was closed on them for the server\'s own minute').toBe(true);
    expect(sim.rooms.playerCount).toBe(1);
  });

  it('gives a world back to whoever opens it next, out of whatever it was kept in', () => {
    const vault = new Forgetful();
    const first = new Simulation({ vault, dataDir: 'worlds' });
    // a mine that has been told about, rather than a key: a key is a chest's second half and the
    // world writes it itself now, so a page announcing one is refused. See `mayReport`
    new Pretend(first).join(7, 'Rowan').say({ type: 'delta', delta: { kind: 'told', mine: 'Barrow' } });
    first.stop();

    const second = new Simulation({ vault, dataDir: 'worlds' });
    const later = new Pretend(second).join(7, 'Wren');
    expect(later.of('welcome')[0].deltas).toEqual([{ kind: 'told', mine: 'Barrow' }]);
    expect(later.of('folk')[0].names, 'and who it has met').toEqual(['Rowan', 'Wren']);
  });

  it('says nothing to somebody who never said who they are', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const stranger = new Pretend(sim);
    stranger.say({ type: 'say', text: 'let me in' });
    expect(stranger.heard).toEqual([]);
    expect(sim.rooms.playerCount).toBe(0);
  });
});

/**
 * Ground in the world of seed 3 that is land, is clear of everything, and has a run to the east.
 *
 * It used to be the origin, which is the middle of Crossroads Town — and the middle of a town in
 * the road world has a well in it. The polygon world had open grass there, so every walking test in
 * this file was quietly relying on the country that has since been taken out. Named once here so
 * the next person to move it only has to move it once.
 */
const CLEAR_RUN = { x: 0.5, z: -13.5 };

/** The same, a long way off: where a teleport can put a hero and have him walk on from there. */
const FAR_CLEAR = { x: 340.5, z: -139.5 };

describe('the simulation holding the ground itself', () => {

  const mindBook = (): DatabaseSync => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE IF NOT EXISTS schema (domain TEXT PRIMARY KEY, version INTEGER NOT NULL)');
    migrateDomain(db, 'register', MINDS_SCHEMA);
    return db;
  };

  const meetAVillager = (sim: Simulation, player: Pretend): Person => {
    const square = sim.groundOf(3)!.villages[0];
    expect(square, 'seed 3 must put a village in the first grown country').toBeDefined();
    player.say({
      type: 'move', x: square.x, z: square.z, yaw: 0, walk: 0,
      place: 'surface', riding: 'foot', gear: [],
    });
    const from = Date.now();
    for (let at = 100; at <= 2_000; at += 100) sim.tick(from + at);
    const introduced = player.of('creatures').flatMap((message) => message.near)
      .find((creature) => creature.who?.person);
    expect(introduced, 'the village must introduce a resident for this test to measure a mind').toBeDefined();
    const person = sim.livesIn(3)!.register!.find(introduced!.who!.person);
    expect(person, 'the introduced resident must be on the live register').toBeDefined();
    return person!;
  };

  it('restores already-settled minds before the joining client can act', () => {
    const db = mindBook();
    const first = new Simulation({ vault: new Forgetful(), ground: true });
    const earlier = new Pretend(first).join(3, 'Earlier');
    const person = meetAVillager(first, earlier);
    keepMinds(db, 3, [{ ...person, memories: [{ what: 'given', who: 'Earlier', day: 2 }] }]);

    const restored = new Simulation({ vault: new Forgetful(), ground: true, minds: db });
    const later = new Pretend(restored).join(3, 'Later');
    const remembered = meetAVillager(restored, later);
    expect(remembered.id, 'the same seed must first introduce the same villager').toBe(person.id);
    const introduced = later.of('creatures').flatMap((message) => message.near)
      .find((creature) => creature.who?.person === person.id);
    expect(introduced!.who!.mind.memories[0]?.who,
      'the persisted mind must be present the first time the client can learn the id').toBe('Earlier');
  });

  it('writes current minds before final-client teardown forgets the live register', () => {
    const db = mindBook();
    const sim = new Simulation({ vault: new Forgetful(), ground: true, minds: db, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const person = meetAVillager(sim, rowan);
    rowan.say({ type: 'recall', who: person.id, what: 'given', about: 'Rowan' });
    expect(sim.livesIn(3)!.register!.find(person.id)?.memories[0]?.who,
      'the client action must reach the live register before teardown').toBe('Rowan');
    expect(mindsOf(db, 3).minds.has(person.id), 'nothing has asked for a save yet').toBe(false);

    rowan.leave();
    expect(mindsOf(db, 3).minds.get(person.id)?.memories[0]?.who,
      'the orderly leave closes the room immediately, so the save must precede it').toBe('Rowan');
  });

  it('keeps a named village mind when an empty room is closed for an edit', () => {
    const db = mindBook();
    const vault = new Forgetful();
    const sim = new Simulation({ vault, dataDir: 'worlds', ground: true, minds: db,
      timeout: 10 * 60_000 });
    const record = sim.rooms.claimWorld('Memory Vale', 3, 'endless');
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const person = meetAVillager(sim, rowan);
    rowan.leave();
    expect(sim.rooms.get(3)).toBeUndefined();
    // The register remains live until the next tick's ordinary teardown. The edit must keep it first.
    person.memories.push({ what: 'given', who: 'After leave', day: 3 });
    sim.authorNamedMountain(record.name, sim.namedWorldRevision(record.name)!, mountainAnchor(
      { x: 2000, z: 2000, reach: 80, lift: 12, roughness: 0.4, seed: 7 },
      'highland:edit:00000000-0000-4000-8000-000000000003'));
    expect(mindsOf(db, 3).minds.get(person.id)?.memories.at(-1)?.who).toBe('After leave');
    expect(sim.rooms.get(3)).toBeUndefined();
    expect(sim.rooms.open(3, { day: 1, time: 0.3 }, record, 'endless').world.manifest.layers())
      .toHaveLength(1);
  });

  it('refuses a named edit when a live village mind cannot be written', () => {
    const db = mindBook();
    const sim = new Simulation({ vault: new Forgetful(), dataDir: 'worlds', ground: true, minds: db });
    const record = sim.rooms.claimWorld('Memory Vale', 3, 'endless');
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const person = meetAVillager(sim, rowan);
    rowan.leave();
    person.memories.push({ what: 'given', who: 'After leave', day: 3 });
    const revision = sim.namedWorldRevision(record.name)!;
    db.exec('DROP TABLE mind');
    expect(() => sim.authorNamedMountain(record.name, revision, mountainAnchor(
      { x: 2000, z: 2000, reach: 80, lift: 12, roughness: 0.4, seed: 7 },
      'highland:edit:00000000-0000-4000-8000-000000000004'))).toThrow();
    expect(sim.rooms.manifestOf(3).layers()).toHaveLength(0);
    expect(sim.namedWorldRevision(record.name)).toBe(revision);
    expect(sim.livesIn(3)?.register?.find(person.id)?.memories.at(-1)?.who).toBe('After leave');
  });

  it('deletes a durable mind when a recorded death removes its owner', () => {
    const db = mindBook();
    const sim = new Simulation({ vault: new Forgetful(), ground: true, minds: db });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const person = meetAVillager(sim, rowan);
    rowan.say({ type: 'recall', who: person.id, what: 'given', about: 'Rowan' });
    sim.keepTheMinds();
    expect(mindsOf(db, 3).minds.has(person.id), 'the row must exist before deletion is meaningful').toBe(true);

    rowan.say({ type: 'delta', delta: { kind: 'died', who: person.id, village: person.village, day: 2 } });
    expect(sim.livesIn(3)!.register!.find(person.id)).toBeUndefined();
    expect(mindsOf(db, 3).minds.has(person.id)).toBe(false);
  });

  it('grows a world when somebody stands in it, and only where they are standing', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    expect(sim.groundOf(3)!.held, 'nothing until somebody is there').toBe(0);

    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    // five by five chunks round one player
    expect(sim.groundOf(3)!.held).toBe(25);
  });

  it('follows a player, and forgets the country behind them', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 1, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    const first = sim.groundOf(3)!.held;
    expect(first).toBe(9);

    // a long way off: the ground there is made, and the ground they left is dropped
    rowan.say({ type: 'move', x: 900, z: 900, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 200);
    expect(sim.groundOf(3)!.held).toBe(9);
    expect(sim.groundOf(3)!.heightAt(0.5, 0.5), 'where they were is gone').toBeNull();
  });

  it('lets go of a world\'s ground when the last player leaves it', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 1, timeout: 1_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    const from = Date.now();
    sim.tick(from + 100);
    expect(sim.groundOf(3)!.held).toBeGreaterThan(0);

    // ticked rather than jumped, for the reason given in `HEARD_AT_MOST`: long enough that they are
    // dropped for silence, and then one more so the empty room is closed
    for (let at = 200; at <= 2_100; at += 100) sim.tick(from + at);
    expect(sim.groundOf(3)!.held, 'a fresh world, not the old one').toBe(0);
  });

  it('walks the hero itself, and says where he got to', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    // the first move is a placing rather than a walk: nothing has walked him anywhere yet
    rowan.say({ type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);

    // push east for a fifth of a second, which at the hero's pace is about a tile
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const [first] = rowan.of('youAre');
    expect(first.seq).toBe(1);
    expect(first.x).toBeCloseTo(CLEAR_RUN.x + 1.1, 1);
    expect(first.z).toBeCloseTo(CLEAR_RUN.z, 5);
    // and the ground he is standing on came with it
    expect(first.y).toBe(sim.groundOf(3)!.heightAt(first.x, first.z));

    // a steer that arrives after a newer one is dropped rather than walked backwards
    rowan.say({ type: 'steer', seq: 3, dx: 1, dz: 0, pace: 1, ms: 200 });
    rowan.say({ type: 'steer', seq: 2, dx: -1, dz: 0, pace: 1, ms: 200 });
    const said = rowan.of('youAre');
    expect(said).toHaveLength(2);
    expect(said[1]).toMatchObject({ seq: 3 });
    expect(said[1].x).toBeGreaterThan(first.x);
  });

  it('will not be told where the hero is standing by the machine drawing him', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);        // the ground grows round him before anything can walk on it
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const walked = rowan.of('youAre')[0].x;

    // a client claiming a couple of tiles it did not walk is ignored: the server has its own hero
    rowan.say({ type: 'move', x: 3, z: 0, yaw: 0, walk: 1, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    const bystander = new Pretend(sim).join(3, 'Ash');
    expect(bystander.of('welcome')[0].players[0].x).toBeCloseTo(walked, 5);

    // and a move saying he is somewhere else entirely is still only a move: the world is walking
    // him, so it knows where he is and this is not news
    rowan.say({ type: 'move', x: 400, z: -120, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    rowan.say({ type: 'steer', seq: 2, dx: 0, dz: 1, pace: 1, ms: 200 });
    expect(rowan.of('youAre').at(-1)!.x, 'nowhere near where it claimed').toBeCloseTo(walked, 1);
  });

  it('takes a jump when it is told it was a jump, and says where that leaves him', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });

    // a teleport, a staircase, a gangplank: the one kind of move a walk cannot account for
    rowan.say({ type: 'stood', x: CLEAR_RUN.x, z: CLEAR_RUN.z, why: 'teleport' });
    const put = rowan.of('youAre').at(-1)!;
    expect(put.x).toBe(CLEAR_RUN.x);
    expect(put.z).toBe(CLEAR_RUN.z);

    // and he walks on from there rather than from where he was
    sim.tick(Date.now() + 200);
    rowan.say({ type: 'steer', seq: 2, dx: 1, dz: 0, pace: 1, ms: 200 });
    const after = rowan.of('youAre').at(-1)!;
    expect(after.x).toBeGreaterThan(CLEAR_RUN.x);
    expect(after.z).toBeCloseTo(CLEAR_RUN.z, 5);
  });

  it('does not let horse coordinates become a verified foot position', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const walkedX = rowan.of('youAre').at(-1)!.x;
    rowan.say({ type: 'move', x: 1000, z: 1000, yaw: 0, walk: 0, place: 'surface', riding: 'horse', gear: [] });
    rowan.say({ type: 'move', x: 1000, z: 1000, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 200);
    rowan.say({ type: 'steer', seq: 2, dx: 1, dz: 0, pace: 1, ms: 200 });
    expect(rowan.of('youAre').at(-1)!.x).toBeCloseTo(walkedX, 1);
  });

  /*
   * #524. A `move` into somewhere the world does not own used to carry the world's own hero to
   * wherever the page said, with none of the door's checks: say you are in an inn by the cart, say
   * you are back outside, take one step, and the world has walked you to the cart. What it walks
   * him from now is where it last had him, and the only ways off the surface and back are `stood`.
   */
  const CART_FROM = 'Bramgate';
  const CART_TO = 'Stonedale';

  /**
   * A loaded cart on the road between two of seed 3's villages, and the book it is written in.
   *
   * The book is laid in rather than lived into: the world only founds a village when somebody walks
   * into it, and no cart leaves one until days later. The villages and the road are the world's own
   * — Bramgate to Stonedale is one of the pairs of seed 3 joined by a road — so where the cart is
   * standing is the world's answer, not the test's.
   */
  const aCartOnTheRoad = (sim: Simulation) => {
    const alive = sim.livesIn(3)!;
    const room = sim.rooms.get(3)!;
    const day = Math.floor(room.world.clock.day);
    const book = new Register(3, day - 1, () => {}, 'journaled');
    book.settle(CART_FROM, 6, ['farmer', 'seller', 'builder', 'innkeeper']);
    book.settle(CART_TO, 6, ['builder', 'seller', 'innkeeper', 'doctor']);
    const seller = book.living(CART_FROM)[0];
    const buyer = [...book.living(CART_TO)].sort((a, b) => b.purse - a.purse)[0];
    const load = cartLoaded(day, { from: CART_FROM, to: CART_TO, meals: 1, price: 0.01,
      paying: new Map([[ownedBy(buyer), -0.01]]), paid: new Map([[ownedBy(seller), 0.01]]) });
    expect(book.recordCarrier(load)).toBe(true);
    book.advance(day);
    vi.spyOn(alive, 'register', 'get').mockReturnValue(book);
    // where the world will judge a robbery against: the same road, the same clock, and none of the
    // ground under it needing to have been grown yet
    const from = alive.villages.find((village) => village.name === CART_FROM)!;
    const road = sim.groundOf(3)!.roadGraphAt(from.x, from.z);
    const at = () => cartPosition(load, room.world.clock.time, alive.villages, road);
    expect(at(), 'no road between the two villages for a cart to be on').not.toBeNull();
    return { book, day, at: () => at()! };
  };

  it('will not let a doorway nobody walked through carry the hero to a cart', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    let now = Date.now();
    sim.tick(now += 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const walked = rowan.of('youAre').at(-1)!;
    const cart = aCartOnTheRoad(sim);
    const there = cart.at();
    expect(Math.hypot(there.x - walked.x, there.z - walked.z), 'the cart is a long walk away').toBeGreaterThan(100);

    // into an inn beside the cart, by the page's word alone, and straight back out of it
    rowan.say({ type: 'move', x: there.x, z: there.z, yaw: 0, walk: 0, place: 'the inn', riding: 'foot', gear: [] });
    rowan.say({ type: 'move', x: there.x, z: there.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(now += 100);
    rowan.say({ type: 'steer', seq: 2, dx: 1, dz: 0, pace: 1, ms: 200 });

    const after = rowan.of('youAre').at(-1)!;
    expect(Math.hypot(after.x - walked.x, after.z - walked.z), 'walked on from where the world had him').toBeLessThan(2);
    const client = [...sim.rooms.get(3)!.clients].find((c) => c.presence.name === 'Rowan')!;
    expect(client.serverFootAt, 'a foot position the world walked him to').not.toBeNull();
    expect(Math.hypot(client.serverFootAt!.x - walked.x, client.serverFootAt!.z - walked.z)).toBeLessThan(2);

    rowan.say({ type: 'rob-cart', loadedOn: cart.day });
    expect(rowan.of('cart-robbed')).toEqual([{ type: 'cart-robbed', loadedOn: cart.day, ok: false }]);
    expect(cart.book.carrierFacts().filter((fact) => fact.kind === 'cart-finished')).toEqual([]);

    // and somebody the world has walked to the cart does rob it, so what refused Rowan was where
    // he stood and not the cart. A join's position is still the page's word — #432 took that
    // knowingly, and it is not what this is about
    const now2 = cart.at();
    const wren = new Pretend(sim).joinAt(3, 'Wren', now2.x, now2.z);
    sim.tick(now += 100);
    wren.say({ type: 'steer', seq: 1, dx: 0, dz: 0, pace: 0, ms: 100 });
    expect(wren.of('youAre'), 'the world never walked Wren beside the cart').not.toHaveLength(0);
    wren.say({ type: 'rob-cart', loadedOn: cart.day });
    expect(wren.of('cart-robbed')).toEqual([{ type: 'cart-robbed', loadedOn: cart.day, ok: true }]);
  });

  it('lets nobody out of a door the world never saw him go in by', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    let now = Date.now();
    sim.tick(now += 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const walked = rowan.of('youAre').at(-1)!;

    // indoors by the page's word, with no step through any door, and then a step out of that
    // "door" at the far side of the county
    rowan.say({ type: 'move', ...FAR_CLEAR, yaw: 0, walk: 0, place: 'the inn', riding: 'foot', gear: [] });
    rowan.say({ type: 'stood', ...FAR_CLEAR, why: 'place' });
    const out = rowan.of('youAre').at(-1)!;
    expect(Math.hypot(out.x - walked.x, out.z - walked.z), 'came out where the world had him').toBeLessThan(0.01);

    rowan.say({ type: 'move', ...FAR_CLEAR, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(now += 100);
    rowan.say({ type: 'steer', seq: 2, dx: 1, dz: 0, pace: 1, ms: 200 });
    const after = rowan.of('youAre').at(-1)!;
    expect(after.seq).toBe(2);
    expect(Math.hypot(after.x - walked.x, after.z - walked.z)).toBeLessThan(2);
  });

  it('will not let a boat nobody boarded carry the hero to a cart', () => {
    // the same hop by the water: say you are aboard a boat beside the cart, and the boat the world
    // sails from that moment used to be moored wherever the page said, with the hero riding on it
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    let now = Date.now();
    sim.tick(now += 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const walked = rowan.of('youAre').at(-1)!;
    const cart = aCartOnTheRoad(sim);
    const there = cart.at();
    expect(Math.hypot(there.x - walked.x, there.z - walked.z), 'the cart is a long walk away').toBeGreaterThan(100);

    rowan.say({ type: 'move', x: there.x, z: there.z, yaw: 0, walk: 0, place: 'surface', riding: 'boat', gear: [] });
    rowan.say({ type: 'helm', seq: 2, forward: 0, turn: 0, ms: 100 });
    rowan.say({ type: 'move', x: there.x, z: there.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(now += 100);
    rowan.say({ type: 'steer', seq: 3, dx: 1, dz: 0, pace: 1, ms: 200 });

    const after = rowan.of('youAre').at(-1)!;
    expect(after.seq, 'the world walked him').toBe(3);
    expect(Math.hypot(after.x - walked.x, after.z - walked.z), 'walked on from where the world had him').toBeLessThan(2);
    rowan.say({ type: 'rob-cart', loadedOn: cart.day });
    expect(rowan.of('cart-robbed')).toEqual([{ type: 'cart-robbed', loadedOn: cart.day, ok: false }]);
    expect(cart.book.carrierFacts().filter((fact) => fact.kind === 'cart-finished')).toEqual([]);
  });

  it('does not keep an old door to let him out of a later one he never went in by', () => {
    // alone, so a teleport is his to take: it is only a way of getting a long way from the door
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    let now = Date.now();
    sim.tick(now += 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const door = rowan.of('youAre').at(-1)!;
    // an honest visit: in by a door, out by it, back on the street
    rowan.say({ type: 'stood', x: 5, z: 5, why: 'place' });
    rowan.say({ type: 'move', x: 5, z: 5, yaw: 0, walk: 0, place: 'the shop', riding: 'foot', gear: [] });
    rowan.say({ type: 'stood', x: door.x, z: door.z, why: 'place' });
    rowan.say({ type: 'move', x: door.x, z: door.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });

    rowan.say({ type: 'stood', ...FAR_CLEAR, why: 'teleport' });
    sim.tick(now += 100);
    rowan.say({ type: 'steer', seq: 2, dx: 1, dz: 0, pace: 1, ms: 200 });
    const away = rowan.of('youAre').at(-1)!;
    expect(Math.hypot(away.x - FAR_CLEAR.x, away.z - FAR_CLEAR.z)).toBeLessThan(2);

    // indoors by the page's word alone, and out at the shop door he used an hour ago
    rowan.say({ type: 'move', x: 5, z: 5, yaw: 0, walk: 0, place: 'the shop', riding: 'foot', gear: [] });
    rowan.say({ type: 'stood', x: door.x, z: door.z, why: 'place' });
    const out = rowan.of('youAre').at(-1)!;
    expect(Math.hypot(out.x - away.x, out.z - away.z), 'carried back to an old door').toBeLessThan(0.01);
  });

  it('keeps the hero at the door while he is somewhere it does not own', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const door = rowan.of('youAre').at(-1)!;

    // down the stairs: the world says nothing, because it does not own what is down there
    const said = rowan.of('youAre').length;
    rowan.say({ type: 'stood', x: 12, z: 40, why: 'place' });
    rowan.say({ type: 'move', x: 12, z: 40, yaw: 0, walk: 0, place: 'Barrow:1', riding: 'foot', gear: [] });
    expect(rowan.of('youAre')).toHaveLength(said);

    // and back out of it, a long way from the door he went in by: he is put back at the door
    rowan.say({ type: 'stood', x: 300, z: -200, why: 'place' });
    const back = rowan.of('youAre').at(-1)!;
    expect(back.x).toBeCloseTo(door.x, 5);
    expect(back.z).toBeCloseTo(door.z, 5);
  });

  it('lets a door let him out where it let him in', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const door = rowan.of('youAre').at(-1)!;

    rowan.say({ type: 'stood', x: 12, z: 40, why: 'place' });
    rowan.say({ type: 'move', x: 12, z: 40, yaw: 0, walk: 0, place: 'Barrow:1', riding: 'foot', gear: [] });
    // a couple of paces from where he went in, which is what a cave mouth is
    rowan.say({ type: 'stood', x: door.x + 2.5, z: door.z, why: 'place' });
    expect(rowan.of('youAre').at(-1)!.x).toBeCloseTo(door.x + 2.5, 5);
  });

  it('will not let one player wind another\'s world about', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    new Pretend(sim).join(3, 'Wren');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const walked = rowan.of('youAre').at(-1)!.x;

    // a teleport is a console act, and a shared world's console is the operator's door
    rowan.say({ type: 'stood', x: 400, z: -120, why: 'teleport' });
    expect(rowan.of('youAre').at(-1)!.x, 'exactly where he walked to').toBeCloseTo(walked, 5);
  });

  it('sails the boat itself, and puts a hero back on it who steps off somewhere else', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    // out on open water, aboard: where a boat is moored is the client's word, and the only one
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'boat', gear: [] });
    sim.tick(Date.now() + 100);
    const ground = sim.groundOf(3)!;
    let water: { x: number; z: number } | null = null;
    for (let z = -40; z <= 40 && !water; z++) {
      for (let x = -40; x <= 37; x++) {
        /*
         * Every tile of the run, not only its two ends.
         *
         * `helm()` stops the boat on `heightAt()` along the whole path, so a run whose ends are
         * water and whose middle is a sandbank is a run the boat never finishes. The assertion
         * below only asks that the bow moved east, and a boat that moved one tile and struck land
         * satisfies that — so the search was free to choose the very starting points that make
         * this test unable to fail. Ask for the whole run and the movement means something.
         */
        if ([0, 1, 2, 3].every((dx) => ground.waterAt(x + dx, z) !== null)) {
          water = { x, z };
          break;
        }
      }
    }
    expect(water, 'the fixture has no three-tile run of water to sail').not.toBeNull();
    rowan.say({ type: 'move', x: water!.x, z: water!.z, yaw: 0, walk: 0, place: 'surface', riding: 'boat', gear: [] });
    sim.tick(Date.now() + 200);

    // a second of sailing west, which the world works out for itself
    for (let pull = 1; pull <= 10; pull++) {
      rowan.say({ type: 'helm', seq: pull, forward: 1, turn: 0, ms: 100 });
    }
    const sailed = rowan.of('youAre').at(-1)!;
    expect(sailed.seq).toBe(10);
    expect(sailed.x, 'the bow was pointing east, so east it went').toBeGreaterThan(water!.x);

    // and stepping off a boat happens beside the boat, not half a county away
    rowan.say({ type: 'stood', x: 200, z: 200, why: 'ride' });
    const ashore = rowan.of('youAre').at(-1)!;
    expect(ashore.x).toBeCloseTo(sailed.x, 5);
    expect(ashore.z).toBeCloseTo(sailed.z, 5);
  });

  it('lets a ferry put somebody down at a pier, and nowhere else', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const walked = rowan.of('youAre').at(-1)!;

    // a crossing that lands nowhere near anything a boat could tie up to is not a crossing
    rowan.say({ type: 'stood', x: 250, z: 250, why: 'ride' });
    expect(rowan.of('youAre').at(-1)!.x, 'left where the world had him').toBeCloseTo(walked.x, 5);

    // and one that lands at the end of a pier is exactly what a ferry does
    const pier = sim.groundOf(3)!.piers[0];
    const [ex, ez] = pier.tiles[pier.tiles.length - 1];
    const said = rowan.of('youAre').length;
    rowan.say({ type: 'stood', x: ex + 0.5, z: ez + 0.5, why: 'ride' });
    expect(rowan.of('youAre'), 'taken without a word, because it is where a ferry lands')
      .toHaveLength(said);
    const bystander = new Pretend(sim).join(3, 'Ash');
    expect(bystander.of('welcome')[0].players[0].x).toBeCloseTo(ex + 0.5, 5);
  });

  it('leaves the client its own authority in a world with no ground', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 12, z: 8, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    expect(rowan.of('youAre')).toHaveLength(0);
    const bystander = new Pretend(sim).join(3, 'Ash');
    expect(bystander.of('welcome')[0].players[0]).toMatchObject({ x: 12, z: 8 });
  });

  it('grows nothing at all when it was not asked to', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    expect(sim.groundOf(3)).toBeNull();
  });
});

describe('the world alive on the server', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };

  it('puts creatures in the country a player is standing in', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    expect(sim.livesIn(3)!.count, 'an empty world before anybody is in it').toBe(0);

    sim.tick(Date.now() + 100);
    expect(sim.livesIn(3)!.count, 'a countryside with things living in it').toBeGreaterThan(20);
  });

  it('lets them live: they move about on their own', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    sim.tick(Date.now() + 100);

    const before = [...sim.livesIn(3)!.all()].map((e) => ({ e, x: e.x, z: e.z }));
    let now = Date.now() + 100;
    for (let i = 0; i < 60; i++) sim.tick(now += 100);
    const moved = before.filter(({ e, x, z }) => Math.hypot(e.x - x, e.z - z) > 0.2);
    expect(moved.length, 'some of them went somewhere').toBeGreaterThan(0);
  });

  it('does not turn a delayed server tick into a creature teleport', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    const began = Date.now();
    sim.tick(began + 100);

    const alive = sim.livesIn(3)!;
    const beforeBodies = new Set(alive.all());
    alive.put('goat', 3, 3, 841);
    const goat = [...alive.all()].find((body) => !beforeBodies.has(body) && body.kind.id === 'goat');
    expect(goat, 'the test placed a goat in the watched country').toBeDefined();
    goat!.state = 'flee';
    goat!.fleeX = 1;
    goat!.fleeZ = 0;
    goat!.timer = 30;
    const x = goat!.x, z = goat!.z;
    const clock = { ...sim.rooms.get(3)!.world.clock };

    // The room clock must catch up with real elapsed time, but a body gets only its ordinary
    // 100ms movement step when the event loop finally wakes up.
    sim.tick(began + 5_100);

    expect(Math.hypot(goat!.x - x, goat!.z - z), 'movement is bounded to one ordinary step')
      .toBeLessThanOrEqual(Math.max(goat!.kind.speed, goat!.kind.runSpeed) * 0.1 + 0.05);
    const after = sim.rooms.get(3)!.world.clock;
    expect(after.day > clock.day || after.time > clock.time, 'the world clock still accounts for the delay').toBe(true);
  });

  /**
   * C2's coarse tier, end to end and through the real objects.
   *
   * The three pieces it is made of are each somebody else's — `catchUp` is a closed form in
   * `unwatched.ts`, `provinceOfHome` is C3's one rule, and `SharedWorld.asleep` is a stamp on a
   * file — and none of them knows about the other two. This is the wire between them, which is one
   * line in `Simulation.groundOf`, and the thing that can go wrong with it is that it is never
   * asked or asks the wrong question. `src/entities/tiers.test.ts` holds the other end: what the
   * manager does with the answer.
   */
  it('tells its creatures how long the ground they were grown on had been nobody\u2019s business', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    sim.tick(Date.now() + 100);

    const alive = sim.livesIn(3)!;
    const herds = [...homelandsOf(alive.crowd.filed).values()].flat();
    expect(herds.length, 'the country grew no herds, so there is nothing to ask about').toBeGreaterThan(0);
    const herd = herds[0];
    expect(alive.crowd.sleptFor(herd), 'a world nobody has walked out of yet claims its country has been asleep').toBe(0);

    // everybody walks a very long way off, a week passes, and they come back
    const world = sim.rooms.get(3)!.world;
    world.keepNear([{ x: -90_000, z: 90_000 }]);
    world.tick(DAY_LENGTH * 7);
    world.keepNear([{ x: 0, z: 0 }]);

    expect(alive.crowd.sleptFor(herd), 'the week the province spent as nobody\u2019s business never reached the creatures that live in it')
      .toBeCloseTo(7 * DAY_LENGTH, 0);
    expect(alive.crowd.sleptFor(herd), 'the manager was told something other than what the province itself says')
      .toBe(world.asleep(provinceOfHome(herd)));
  });

  it('has nothing alive in a world it is not holding the ground of', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    sim.tick(Date.now() + 100);
    expect(sim.livesIn(3)).toBeNull();
  });
});

describe('telling players what is alive near them', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };
  /** Enough ticks for the creatures to go out, which they do rarer than presence. */
  const tickFor = (sim: Simulation, ms: number, from = Date.now()): void => {
    for (let at = 100; at <= ms; at += 100) sim.tick(from + at);
  };

  it('sends a player the creatures they can see, and nothing further off', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);

    const told = rowan.of('creatures').at(-1);
    expect(told, 'they were told about the country round them').toBeDefined();
    expect(told!.near.length).toBeGreaterThan(0);
    for (const c of told!.near) {
      expect(Math.hypot(c.x, c.z), `${c.kind} at ${c.x},${c.z}`).toBeLessThanOrEqual(IN_SIGHT + 1);
      expect(c.kind.length, 'it says what it is').toBeGreaterThan(0);
    }
  });

  it('says what has gone out of sight, once, and then stops mentioning it', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    const from = Date.now();
    tickFor(sim, 600, from);
    const first = rowan.of('creatures').at(-1)!;
    expect(first.near.length).toBeGreaterThan(0);
    const beforeLeaving = rowan.of('creatures').length;

    // a long walk: everything they could see is behind them now
    rowan.say({ type: 'stood', x: 4_000, z: 4_000, why: 'teleport' });
    walkAbout(rowan, 4_000, 4_000);
    tickFor(sim, 600, from + 1_000);
    const updates = rowan.of('creatures').slice(beforeLeaving);
    const after = updates.at(-1)!;
    expect(updates.flatMap((message) => message.gone).length,
      'the country they left is taken off their screen').toBeGreaterThan(0);
    /*
     * Somebody has to be there for the distances to be about anything.
     *
     * `every` is `true` of an empty array, so the claim below — that nothing on their screen is
     * still back where they came from — is satisfied by a screen with nothing on it at all. That
     * is the failure this test would be most likely to see: a teleport four thousand tiles out
     * that lands somewhere the world has not grown any creatures into. The vacuous pass reads
     * exactly like a correct one.
     */
    expect(after.near.length, 'the new country introduced no nearby creatures').toBeGreaterThan(0);
    expect(after.near.every((creature) => Math.hypot(creature.x, creature.z) > 3_000),
      'the new country was confused with the one left behind').toBe(true);
  });

  it('tells two players in one field about the same creatures', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const wren = new Pretend(sim).join(3, 'Wren');
    walkAbout(rowan, 0, 0);
    walkAbout(wren, 4, 4);
    tickFor(sim, 900);

    const his = new Set(rowan.of('creatures').at(-1)!.near.map((c) => c.id));
    const hers = wren.of('creatures').at(-1)!.near.map((c) => c.id);
    expect(hers.length).toBeGreaterThan(0);
    // standing four tiles apart, they are looking at the same animals — which is the whole point
    expect(hers.filter((id) => his.has(id)).length).toBeGreaterThan(hers.length / 2);
  });

  /**
   * The people of a village, which travel differently from the deer in the field behind them.
   *
   * A creature is a position and a kind, and both are different every third of a second. A villager
   * is also a name, a trade, a village and everything he holds — none of which changes for days. Sent
   * at the rate of his footsteps he would cost more on the wire than the herd he lives beside and say
   * nothing new in any of it, so he is described once and then only when something about him is
   * actually different.
   */
  const villagersTold = (who: Pretend): Array<{ id: number; person: string }> =>
    who.of('creatures').flatMap((m) => m.near)
      .filter((c) => c.who && c.who.person !== '')
      .map((c) => ({ id: c.id, person: c.who!.person }));

  it('tells a player who a villager is once, and does not go on repeating his name', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const square = sim.groundOf(3)!.villages[0];
    walkAbout(rowan, square.x, square.z);
    tickFor(sim, 3_000);

    const named = villagersTold(rowan);
    expect(named.length, 'nobody at all was standing in the village square').toBeGreaterThan(0);
    const times = new Map<number, number>();
    for (const one of named) times.set(one.id, (times.get(one.id) ?? 0) + 1);
    expect([...times.values()].filter((n) => n > 1), 'a villager was introduced more than once, so his name and his whole memory are going out at the rate of his footsteps')
      .toEqual([]);

    // and they were still being drawn the whole time, which is what makes the above a saving rather
    // than a villager who stopped being described at all
    const drawn = rowan.of('creatures').flatMap((m) => m.near).filter((c) => times.has(c.id)).length;
    expect(drawn, 'the villagers were named and then never mentioned again, which is not a saving, it is a bug')
      .toBeGreaterThan(times.size);
  });

  it('says his name again the moment something happens to him that he will not forget', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const square = sim.groundOf(3)!.villages[0];
    walkAbout(rowan, square.x, square.z);
    tickFor(sim, 2_000);
    const [first] = villagersTold(rowan);
    expect(first, 'nobody was standing in the village square').toBeDefined();

    // the whole of C5 in one round trip: a kindness done on this screen, taken by the world, and
    // handed back to everybody who can see the man it was done to
    rowan.say({ type: 'recall', who: first.person, what: 'given', about: 'Rowan' });
    tickFor(sim, 2_000, Date.now() + 3_000);
    const held = rowan.of('creatures').flatMap((m) => m.near)
      .filter((c) => c.who?.person === first.person)
      .at(-1)?.who?.mind;
    expect(held?.memories[0]?.what, 'the world took the memory and never told anybody the man was holding it').toBe('given');
    expect(held?.opinions[0]?.who, 'and the view he formed of whoever did it never travelled either').toBe('Rowan');
  });

  it('takes a villager off its own street when a client reports his death', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const square = sim.groundOf(3)!.villages[0];
    walkAbout(rowan, square.x, square.z);
    tickFor(sim, 2_000);
    const [dead] = villagersTold(rowan);
    expect(dead, 'nobody was standing in the village square').toBeDefined();

    // a roaming band on somebody's screen, which is the one thing about a village nothing here
    // could have worked out — and the world holds the book that decides who is put out at the well
    rowan.say({ type: 'delta', delta: { kind: 'died', who: dead.person, village: '', day: 2 } });
    tickFor(sim, 4_000, Date.now() + 3_000);
    const still = rowan.of('creatures').flatMap((m) => m.near)
      .filter((c) => c.who?.person === dead.person && c.who!.name !== '');
    // he may be described again for a moment while the street is re-seated, but the man the world
    // was told is dead must not be somebody it is still handing out as one of the living
    expect(sim.livesIn(3)!.register!.find(dead.person), 'the world went on holding a man a client had buried')
      .toBeUndefined();
    expect(still.every((c) => c.id === still[0].id), 'and it never introduced him again as somebody new').toBe(true);
  });

  it('costs what it was measured to cost, per player per second', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 3_000);

    const messages = rowan.of('creatures');
    const bytes = messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
    // three seconds of standing in open country: this is the number that decides whether a
    // domestic router and a Raspberry Pi can carry a world, so it is written down rather than felt
    expect(messages.length, 'about three a second').toBeGreaterThan(5);
    expect(bytes / 3, 'bytes a second, one player').toBeLessThan(40_000);
  });

  it('and costs about the same standing in a village, where everybody has a name', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const square = sim.groundOf(3)!.villages[0];
    walkAbout(rowan, square.x, square.z);
    tickFor(sim, 3_000);

    const bytes = rowan.of('creatures').reduce((n, m) => n + JSON.stringify(m).length, 0);
    // The number the whole of C5 is affordable or not on. A villager is a name, a trade, a village,
    // the list of trades that village was founded on and everything he holds — several times what a
    // deer costs — and there are twenty of him in a square. Sent at the rate of his footsteps that
    // would be most of the wire; sent once and then only when he changes, a square full of people
    // costs about what an empty field does.
    expect(bytes / 3, 'bytes a second standing in a village square, one player').toBeLessThan(40_000);
  });
});

describe('hunting something the world owns', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };
  const tickFor = (sim: Simulation, ms: number, from = Date.now()): void => {
    for (let at = 100; at <= ms; at += 100) sim.tick(from + at);
  };

  /** Face a hero at something and put him on his feet, which is what makes a swing land. */
  const faceAt = (who: Pretend, seq: number, x: number, z: number, at: { x: number; z: number }): void => {
    who.say({ type: 'steer', seq, dx: at.x - x, dz: at.z - z, pace: 1, ms: 20 });
  };
  /** Everything in front of the hero, out to a bowshot: what a wide swing reaches. */
  const wide = { place: 'surface', damage: 20, reach: 15, arc: 1.4, one: false } as const;

  it('works out for itself what a blow reached, and says who killed what', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);

    const prey = rowan.of('creatures').at(-1)!.near[0];
    expect(prey, 'there is something to hunt').toBeDefined();

    // face it and swing until whatever is over there stops being there. The client says how hard
    // it hit and how far it reached, and nothing at all about what it hit.
    for (let blow = 0; blow < 30; blow++) {
      faceAt(rowan, blow + 1, 0, 0, prey);
      rowan.say({ type: 'swing', ...wide });
    }
    const killed = rowan.of('killed');
    expect(killed.length, 'the world says something died').toBeGreaterThan(0);
    expect(killed[0].by, 'and who did it, so they take what was on it').toBe(rowan.of('welcome')[0].id);
  });

  it('throws a blow in its own direction instead of the preceding movement frame', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);

    const prey = rowan.of('creatures').at(-1)!.near[0];
    const yaw = Math.atan2(-prey.z, prey.x);
    // Presence still faces exactly away. Turning and attacking inside one render frame must not use it.
    rowan.say({ type: 'move', x: 0, z: 0, yaw: yaw + Math.PI, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    for (let blow = 0; blow < 30; blow++) rowan.say({ type: 'swing', ...wide, yaw });

    expect(rowan.of('killed').map((k) => k.id)).toContain(prey.id);
  });

  it('reaches nothing at all behind the hero', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);
    const prey = rowan.of('creatures').at(-1)!.near[0];

    // faced the other way, and swinging with everything: an arc is an arc
    for (let blow = 0; blow < 30; blow++) {
      faceAt(rowan, blow + 1, 0, 0, { x: -prey.x, z: -prey.z });
      rowan.say({ type: 'swing', ...wide, arc: 0.6 });
    }
    expect(rowan.of('killed').map((k) => k.id)).not.toContain(prey.id);
  });

  it('tells everybody in the world, not only whoever swung', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const wren = new Pretend(sim).join(3, 'Wren');
    walkAbout(rowan, 0, 0);
    walkAbout(wren, 3, 3);
    tickFor(sim, 900);

    const prey = rowan.of('creatures').at(-1)!.near[0];
    for (let blow = 0; blow < 30; blow++) {
      faceAt(rowan, blow + 1, 0, 0, prey);
      rowan.say({ type: 'swing', ...wide });
    }
    expect(wren.of('killed').length, 'the body falls on her screen too').toBeGreaterThan(0);
    expect(wren.of('killed')[0].by, 'and it was not her').not.toBe(wren.of('welcome')[0].id);
  });

  it('will not take a client\'s word for how hard it hit', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);

    // something with enough hearts that one honest blow could not do it
    const near = rowan.of('creatures').at(-1)!.near;
    const stout = near.reduce((a, b) => (a.hp > b.hp ? a : b));
    faceAt(rowan, 1, 0, 0, stout);
    rowan.say({ type: 'swing', ...wide, damage: 1e9 });
    tickFor(sim, 400, Date.now() + 600);

    // one blow may be worth a great deal and still not be worth a number nothing could produce
    if (stout.hp > 40) {
      expect(rowan.of('killed').map((k) => k.id), 'a made-up number does not kill it').not.toContain(stout.id);
    }
  });

  it('is thrown from where a hero says he is, until the world has walked him', () => {
    /*
     * This test used to say the opposite, and the opposite made the game unplayable.
     *
     * The rule was: no hero of the world's own, no blow. It reads as good sense — a client should
     * not swing from a place it merely claims — and it cost every player who stood still and hit
     * something, which is the most ordinary act in the game and the first one after a reconnect.
     * Nothing was hurt, nothing died, nothing could be skinned, and the world said nothing about
     * why.
     *
     * What is given up by trusting the presence here is small. It is only ever consulted before the
     * first steer, because from then on the world walks the hero and a `move` from an outside hero
     * is ignored rather than believed. The world already throws every blow struck indoors and
     * underground from exactly this number.
     */
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, CLEAR_RUN.x, CLEAR_RUN.z);
    tickFor(sim, 600);
    const prey = rowan.of('creatures').at(-1)!.near[0];
    expect(prey, 'there is something to hunt').toBeDefined();
    rowan.say({
      type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z,
      yaw: Math.atan2(-(prey.z - CLEAR_RUN.z), prey.x - CLEAR_RUN.x),
      walk: 0, place: 'surface', riding: 'foot', gear: [],
    });
    for (let blow = 0; blow < 30; blow++) rowan.say({ type: 'swing', ...wide });
    expect(rowan.of('killed').length, 'a hero the world had never walked could not hit anything').toBeGreaterThan(0);
  });
});

describe('a floor under the world', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };
  const tickFor = (sim: Simulation, ms: number, from = Date.now()): void => {
    for (let at = 100; at <= ms; at += 100) sim.tick(from + at);
  };
  const goDown = (who: Pretend, place: string): void => {
    who.say({ type: 'floor', place, anchor: 'dungeon:Barrow', kind: 'dungeon', floor: 1 });
    who.say({ type: 'move', x: 4, z: 4, yaw: 0, walk: 0, place, riding: 'foot', gear: [] });
  };

  it('grows the floor somebody walks into, and tells them what is down there', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 300);
    goDown(rowan, 'Barrow:1');
    tickFor(sim, 900, Date.now() + 300);

    const below = rowan.of('creatures').filter((c) => c.place === 'Barrow:1');
    expect(below.length, 'the world describes the floor').toBeGreaterThan(0);
    expect(below[0].near.length, 'and there is something in it').toBeGreaterThan(0);
  });

  it('keeps a floor and a hillside apart, however alike their numbers are', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const wren = new Pretend(sim).join(3, 'Wren');
    walkAbout(rowan, 0, 0);
    walkAbout(wren, 0, 0);
    tickFor(sim, 300);
    goDown(wren, 'Barrow:1');
    // from here on she is underground; what she was told while she was standing on the hillside was
    // about the hillside, and rightly so
    const sinceSheWentDown = wren.heard.length;
    tickFor(sim, 900, Date.now() + 300);

    // she is underground and hears about the floor; he is above and hears about the country
    const hersBelow = wren.heard.slice(sinceSheWentDown).filter((m) => m.type === 'creatures');
    expect(hersBelow.length, 'she was told nothing at all about where she is').toBeGreaterThan(0);
    expect(hersBelow.every((c) => c.place === 'Barrow:1')).toBe(true);
    expect(rowan.of('creatures').every((c) => c.place === 'surface')).toBe(true);
  });

  it('lets go of a floor when the last person climbs out of it', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 300);
    goDown(rowan, 'Barrow:1');
    tickFor(sim, 600, Date.now() + 300);
    const heard = rowan.of('creatures').filter((c) => c.place === 'Barrow:1').length;
    expect(heard).toBeGreaterThan(0);

    // back up the stairs, and the floor is nobody's any more
    walkAbout(rowan, 0, 0);
    tickFor(sim, 900, Date.now() + 900);
    expect(rowan.of('creatures').filter((c) => c.place === 'Barrow:1')).toHaveLength(heard);
  });

  it('will not let a blow thrown on a floor reach a deer in a field', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 20 });
    goDown(rowan, 'Barrow:1');
    tickFor(sim, 400, Date.now() + 600);

    // swinging underground, and claiming to be swinging up in the daylight
    for (let blow = 0; blow < 20; blow++) {
      rowan.say({ type: 'swing', place: 'surface', damage: 40, reach: 15, arc: 3, one: false });
    }
    expect(rowan.of('killed').filter((k) => k.place === 'surface')).toHaveLength(0);
  });
});

describe('a world with several people in it', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };
  const tickFor = (sim: Simulation, ms: number, from = Date.now()): void => {
    for (let at = 100; at <= ms; at += 100) sim.tick(from + at);
  };

  /**
   * The failure this exists to prevent, found by putting four players on a server and looking:
   * the creature manager followed one hero, so the country round everybody else was spawned and
   * then thrown away as the focus moved on. Three of the four stood in an empty world.
   */
  it('keeps the country alive round everybody, not only round whoever is followed', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const apart = [
      { who: new Pretend(sim).join(3, 'Rowan'), x: 0, z: 0 },
      { who: new Pretend(sim).join(3, 'Wren'), x: 220, z: 40 },
      { who: new Pretend(sim).join(3, 'Bram'), x: -140, z: 180 },
    ];
    for (const { who, x, z } of apart) walkAbout(who, x, z);
    tickFor(sim, 1_500);

    for (const { who } of apart) {
      const told = who.of('creatures').at(-1);
      expect(told?.near.length ?? 0, `${who.of('welcome')[0].id} has a world round them`).toBeGreaterThan(0);
    }
  });
});

/*
 * The fault this was written for, and the worst one of the lot: the server grew the polygon world
 * for everybody, whatever world the player was actually in. A seed grows two different countries —
 * in a slab of seed 3 the polygon world has eight cottages and the road world has none — so a road
 * world's player was walked about on land he could not see. His own game stopped him at a wall; the
 * server, which owns where he is standing, had open ground there and corrected him through it. He
 * was a ghost in his own village, bitten by wolves that were not there, swinging at animals that
 * were somewhere else.
 */
/*
 * Waking up somewhere, which the world has to be told about or it drags you back.
 *
 * A hero who goes down is carried to the nearest village and set down in the square. Hearts live in
 * a player's own save, so the world is not the one who decides he went down — and until it was
 * told, it went on holding him where he fell and its next word hauled him out of the village and
 * back to the wolf. Reported exactly that way: "it briefly puts me in the local village, before
 * restoring my location to where I was killed".
 */
/**
 * Going somewhere the world does not own, and coming back out of it.
 *
 * A door lets you out where it let you in, so the world remembers the doorway a hero left the
 * surface by and puts him back at it if he reappears somewhere else. It remembered the wrong one
 * whenever something other than walking had moved him — a teleport, a staircase, a gangplank —
 * because it recorded where *it* had the hero rather than where the message said he was, and those
 * two come apart for exactly one frame. Reported as: "when I try to move, it sends me back to where
 * I teleported from".
 */
describe('a doorway the world was told about', () => {
  const walkTo = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };

  it('is the one the hero says he went in by, not the one the world last saw him at', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkTo(rowan, CLEAR_RUN.x, CLEAR_RUN.z);
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 100 });

    // carried a long way off by something the world is not walking him with, and *then* he steps
    // through a door there — which is a teleport followed by a doorstep, in that order
    const far = { x: FAR_CLEAR.x, z: FAR_CLEAR.z };
    rowan.say({ type: 'stood', x: far.x, z: far.z, why: 'teleport' });
    rowan.say({ type: 'stood', x: far.x, z: far.z, why: 'place' });
    rowan.say({ type: 'move', x: 4, z: 4, yaw: 0, walk: 0, place: 'Kestrelmarch:1', riding: 'foot', gear: [] });
    // the world says nothing about a hero it is not walking
    expect(rowan.of('youAre').at(-1)!.x, 'the world followed him inside').toBeCloseTo(far.x, 1);

    // and comes back out at the door he went in by. `stood` first and the `move` after it, which is
    // the order the client sends them in — the place it is *leaving* is what makes this the way out
    rowan.say({ type: 'stood', x: far.x, z: far.z, why: 'place' });
    rowan.say({ type: 'move', x: far.x, z: far.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    const out = rowan.of('youAre').at(-1)!;
    expect(Math.hypot(out.x - far.x, out.z - far.z), 'dragged back to where he was before the jump')
      .toBeLessThan(2);

    // and a step from there stays there rather than being answered from the old place
    rowan.say({ type: 'steer', seq: 2, dx: 1, dz: 0, pace: 1, ms: 100 });
    const after = rowan.of('youAre').at(-1)!;
    expect(Math.hypot(after.x - far.x, after.z - far.z), 'the next step hauled him across the county')
      .toBeLessThan(3);
  });
});

describe('a hero carried home after a knock on the head', () => {
  /**
   * Somewhere in this world that is actually ground.
   *
   * It was 130, 60, which is a field in the polygon world and open sea in the road one — so when
   * the polygon world went, these tests started walking a hero about on water and reporting that
   * the world had not moved him. The middle of the first village is ground by construction, in
   * every world, for ever.
   */
  const ON_LAND = CLEAR_RUN;

  const walkTo = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };

  it('is left where he was put, and the world agrees he is there', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkTo(rowan, ON_LAND.x, ON_LAND.z);
    sim.tick(Date.now() + 100);
    // a steer, so the world has a hero of its own to hold
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 100 });
    const felled = rowan.of('youAre').at(-1)!;

    const village = sim.groundOf(3)!.villages[0];
    expect(village, 'a world with no villages to be carried to').toBeTruthy();
    rowan.say({ type: 'stood', x: village.x + 2, z: village.z + 2, why: 'carried' });

    const woke = rowan.of('youAre').at(-1)!;
    expect(Math.hypot(woke.x - village.x, woke.z - village.z), 'not put down in the village at all')
      .toBeLessThan(6);
    expect(Math.hypot(woke.x - felled.x, woke.z - felled.z), 'left where he fell').toBeGreaterThan(5);

    // and it stays: the next thing the world says about him is the village, not the wolf
    rowan.say({ type: 'steer', seq: 2, dx: 1, dz: 0, pace: 1, ms: 100 });
    const after = rowan.of('youAre').at(-1)!;
    expect(Math.hypot(after.x - village.x, after.z - village.z), 'dragged back out of the village')
      .toBeLessThan(7);
  });

  it('and cannot be used to stand anywhere that is not a village', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkTo(rowan, ON_LAND.x, ON_LAND.z);
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 100 });
    const before = rowan.of('youAre').at(-1)!;

    // the middle of nowhere, claimed as a village square
    rowan.say({ type: 'stood', x: before.x + 400, z: before.z + 400, why: 'carried' });
    rowan.say({ type: 'steer', seq: 2, dx: 1, dz: 0, pace: 1, ms: 100 });
    const after = rowan.of('youAre').at(-1)!;
    expect(Math.hypot(after.x - before.x, after.z - before.z), 'carried four hundred tiles by a message')
      .toBeLessThan(2);
  });
});

/*
 * The world handing over pieces of itself.
 *
 * Both halves grow the country from the seed, which is why they can be in different ones. The cure
 * is for the world to grow it and the page to be told — so a page asks for the chunks it does not
 * have, and what comes back is bytes rather than words, because a chunk written out as text is four
 * times the size and slower to read than to make again.
 */
describe('a page asking the world for country', () => {
  it('is answered with the ground it asked for, and nothing it did not', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim);
    const heard: ArrayBuffer[] = [];
    // the wire this test listens on: words to the usual place, bytes kept here
    (rowan as unknown as { wire: { send: (parcel: string | ArrayBuffer) => void } }).wire.send = (parcel) => {
      if (typeof parcel === 'string') rowan.heard.push(JSON.parse(parcel) as never);
      else heard.push(parcel);
    };
    rowan.join(3, 'Rowan');
    sim.tick(Date.now() + 100);

    rowan.say({ type: 'want-chunks', chunks: [[8, 4], [8, 5]] });
    expect(heard.length, 'the world sent no country at all').toBe(2);

    const first = unpackChunk(heard[0]);
    expect(first, 'what came back was not a chunk').toBeTruthy();
    expect([first!.cx, first!.cz]).toEqual([8, 4]);
    // and it is the world's own ground rather than something made up for the wire
    const mine = sim.groundOf(3)!.parcelOf(8, 4);
    expect([...first!.height]).toEqual([...mine.height]);
    expect([...first!.prop]).toEqual([...mine.prop]);
  });

  it('will not be talked into handing over the whole world at once', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim);
    let sent = 0;
    (rowan as unknown as { wire: { send: (parcel: string | ArrayBuffer) => void } }).wire.send = (parcel) => {
      if (typeof parcel === 'string') rowan.heard.push(JSON.parse(parcel) as never);
      else sent++;
    };
    rowan.join(3, 'Rowan');
    sim.tick(Date.now() + 100);

    const greedy: Array<[number, number]> = [];
    for (let i = 0; i < 5_000; i++) greedy.push([i, 0]);
    rowan.say({ type: 'want-chunks', chunks: greedy });
    expect(sent, 'a client asked for five thousand chunks and got them').toBeLessThanOrEqual(CHUNKS_AT_ONCE);
    expect(sent, 'and got none at all').toBeGreaterThan(0);
  });

  it('has a joining player\'s first view grown before they ask for a chunk of it', () => {
    /*
     * The last of the streaming, and the one that was pure arithmetic.
     *
     * A page waits a fifth of a second for the world and then draws the ground itself, because a
     * page that waited would stare at nothing every time a socket hiccupped. A world with nobody in
     * it has no country at all: asked for its first chunk it stands a terrain sampler up — about a
     * third of a second — and then grows a hundred and twenty-one chunks at two and a half
     * milliseconds each. Two-thirds of a second against a fifth, so the guard written for a hiccup
     * fired on every new world and the opening view of every new country was the page's own guess.
     *
     * Nothing is faster now. It happens earlier: the join says where the hero is standing and the
     * world grows that view while it is still saying hello. Nothing has been asked for here and
     * nothing has ticked.
     */
    const sim = new Simulation({ vault: new Forgetful(), ground: true, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).joinAt(31, 'Rowan', 400, 400);

    const view = (VIEW * 2 + 1) ** 2;
    expect(sim.groundOf(31)!.standingBy, 'the world waited to be asked before growing anything')
      .toBeGreaterThanOrEqual(view);
    // and it said so, which is the page's cue to stop drawing ground it is about to be sent
    const [country] = rowan.of('country');
    expect(country, 'the world never told the page its country was grown').toBeTruthy();
    // and what it said about the country it grew: the seed and the list it was authored with,
    // which is what is whole-country about a world that has no whole country. See `endlessStamp`.
    expect(country.stamp, 'an endless country said nothing about itself').toBe(endlessStamp(31, []));
  });

  it('and answers the whole of it inside the time a page will wait', () => {
    /*
     * The same thing measured from the other end, because "grown beforehand" is only worth
     * anything if the answering is then quick. What is left to do when the asking arrives is
     * packing bytes the world already has: eleven kilobytes a chunk, a hundred and twenty-one of
     * them, no generation at all.
     *
     * The ceiling is the page's own patience — the one number both halves read out of
     * `chunkparcel.ts` — so a change that pushes this over it is a change that puts the opening
     * view of every new country back on the page's own generator. What it actually took is printed,
     * because a ceiling with no measurement under it is a ceiling nobody can move on evidence.
     */
    const sim = new Simulation({ vault: new Forgetful(), ground: true, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim);
    let sent = 0;
    (rowan as unknown as { wire: { send: (parcel: string | ArrayBuffer) => void } }).wire.send = (parcel) => {
      if (typeof parcel === 'string') rowan.heard.push(JSON.parse(parcel) as never);
      else sent++;
    };
    rowan.joinAt(32, 'Rowan', 400, 400);

    const CS = 16;
    const cx = Math.floor(400 / CS), cz = Math.floor(400 / CS);
    const view: Array<[number, number]> = [];
    for (let dz = -VIEW; dz <= VIEW; dz++) for (let dx = -VIEW; dx <= VIEW; dx++) view.push([cx + dx, cz + dz]);

    const started = performance.now();
    rowan.say({ type: 'want-chunks', chunks: view });
    const took = performance.now() - started;

    expect(sent, 'the world did not hand over the view it was asked for').toBe(view.length);
    console.log(`  a first view of ${view.length} chunks answered in ${took.toFixed(1)}ms (a page waits ${WAIT_FOR_THE_WORLD}ms)`);
    expect(took, `${view.length} chunks took ${took.toFixed(1)}ms, and a page gives the world ${WAIT_FOR_THE_WORLD}ms`)
      .toBeLessThan(WAIT_FOR_THE_WORLD);
  });

  it('says nothing to a page whose world has no ground grown for it', () => {
    const sim = new Simulation({ vault: new Forgetful() });        // no ground in this one
    const rowan = new Pretend(sim);
    let sent = 0;
    (rowan as unknown as { wire: { send: (parcel: string | ArrayBuffer) => void } }).wire.send = (parcel) => {
      if (typeof parcel === 'string') rowan.heard.push(JSON.parse(parcel) as never);
      else sent++;
    };
    rowan.join(3, 'Rowan');
    rowan.say({ type: 'want-chunks', chunks: [[0, 0]] });
    expect(sent).toBe(0);
  });
});

describe('a chest, and whether it was yours to open', () => {
  /*
   * The first thing a page asks the world rather than telling it.
   *
   * What is inside is not in question — both halves work it out from the vault's seed, and
   * `src/world/chests.test.ts` holds that rule on its own. What the world decides is whether this
   * hero could have opened it: standing on that floor, within reach, and first.
   */
  const seedOf = (root: number): number => new Manifest(root).deriveSeed('dungeon:Barrow', 'dungeon', null);
  const chestsOf = (root: number) => generateDungeon(seedOf(root), 'vault', 1).chests;

  const goDown = (who: Pretend, place: string, x: number, z: number): void => {
    who.say({ type: 'floor', place, anchor: 'dungeon:Barrow', kind: 'dungeon', floor: 1 });
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place, riding: 'foot', gear: [] });
  };

  const world = (): Simulation => new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });

  it('says what was in it, and the same as the page would have said', () => {
    const sim = world();
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const chests = chestsOf(3);
    goDown(rowan, 'Barrow:1', chests[0].x + 0.5, chests[0].z + 0.5);
    rowan.say({ type: 'open', seq: 1, place: 'Barrow:1', index: 0, owns: [] });

    const [answer] = rowan.of('opened');
    expect(answer).toMatchObject({ seq: 1, ok: true, index: 0 });
    expect(answer.gold).toBe(whatAChestHolds(seedOf(3), 0, chests[0], () => false).gold);
  });

  it('opens one for a hero the world walks up top, from where he stands on the floor', () => {
    // the world's hero stays at the stairhead while he is down there (#524), so the reach is
    // measured from where his page says he is on the floor, as it is for everybody down there
    const sim = world();
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    expect(rowan.of('youAre'), 'the world never walked him').not.toHaveLength(0);
    const chests = chestsOf(3);
    rowan.say({ type: 'stood', x: chests[0].x + 0.5, z: chests[0].z + 0.5, why: 'place' });
    goDown(rowan, 'Barrow:1', chests[0].x + 0.5, chests[0].z + 0.5);
    rowan.say({ type: 'open', seq: 1, place: 'Barrow:1', index: 0, owns: [] });
    expect(rowan.of('opened')[0]).toMatchObject({ seq: 1, ok: true, index: 0 });
  });

  it('refuses a chest across the room', () => {
    const sim = world();
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const chests = chestsOf(3);
    goDown(rowan, 'Barrow:1', chests[0].x + 40, chests[0].z + 40);
    rowan.say({ type: 'open', seq: 1, place: 'Barrow:1', index: 0, owns: [] });
    expect(rowan.of('opened')[0]).toMatchObject({ ok: false, gold: 0 });
  });

  it('refuses a floor the hero is not standing on', () => {
    const sim = world();
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const chests = chestsOf(3);
    goDown(rowan, 'Barrow:1', chests[0].x + 0.5, chests[0].z + 0.5);
    rowan.say({ type: 'open', seq: 1, place: 'Barrow:2', index: 0, owns: [] });
    expect(rowan.of('opened')[0]).toMatchObject({ ok: false });
  });

  it('gives the chest to whoever asked first, and tells the other one no', () => {
    const sim = world();
    const chests = chestsOf(3);
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const wren = new Pretend(sim).join(3, 'Wren');
    goDown(rowan, 'Barrow:1', chests[0].x + 0.5, chests[0].z + 0.5);
    goDown(wren, 'Barrow:1', chests[0].x + 0.5, chests[0].z + 0.5);

    rowan.say({ type: 'open', seq: 1, place: 'Barrow:1', index: 0, owns: [] });
    wren.say({ type: 'open', seq: 1, place: 'Barrow:1', index: 0, owns: [] });

    expect(rowan.of('opened')[0].ok, 'the first one through the lid was refused').toBe(true);
    expect(wren.of('opened')[0].ok, 'one chest paid out twice').toBe(false);
    // and the one who lost it still learns the chest is open, so it is drawn open on his screen
    expect(wren.of('delta').map((d) => d.delta)).toContainEqual({ kind: 'chest', id: 'Barrow:1:chest:0' });
  });

  it('does not hand over a second of something already carried', () => {
    const sim = world();
    const chests = chestsOf(3);
    const big = chests.findIndex((c) => c.big);
    expect(big, 'this vault has no big chest to try it on').toBeGreaterThanOrEqual(0);
    const rowan = new Pretend(sim).join(3, 'Rowan');
    goDown(rowan, 'Barrow:1', chests[big].x + 0.5, chests[big].z + 0.5);
    const carrying = BIG_CHEST_PRIZES.filter((item) => item !== 'potion' && item !== 'gem');
    rowan.say({ type: 'open', seq: 1, place: 'Barrow:1', index: big, owns: carrying });
    const [answer] = rowan.of('opened');
    expect(answer.ok).toBe(true);
    expect(['potion', 'gem']).toContain(answer.prize);
  });
});

describe('a crop, and whether it was there to lift', () => {
  /*
   * The second thing a page asks. What comes up is not in question — a crop yields what a crop
   * yields — but whether it was ripe is arithmetic the world is in a better position to do, because
   * a page can be wound forward and a world with other people in it cannot.
   */
  const stand = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };
  const world = (): Simulation => new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });

  it('hands over what was sown, once it is ripe', () => {
    const sim = world();
    const rowan = new Pretend(sim).join(5, 'Rowan');
    stand(rowan, 12.5, 44.5);
    rowan.say({ type: 'delta', delta: { kind: 'sow', tile: '12,44', crop: 'wheat', day: 1 } });
    rowan.say({ type: 'setclock', day: 40, time: 0.5 });
    rowan.say({ type: 'harvest', seq: 1, tile: '12,44' });

    const [answer] = rowan.of('harvested');
    expect(answer).toMatchObject({ seq: 1, tile: '12,44', ok: true, crop: 'wheat' });
    expect(answer.amount).toBe(CROPS.wheat.yield);
  });

  it('refuses a crop that is not ripe yet, by its own clock', () => {
    const sim = world();
    const rowan = new Pretend(sim).join(5, 'Rowan');
    stand(rowan, 12.5, 44.5);
    rowan.say({ type: 'delta', delta: { kind: 'sow', tile: '12,44', crop: 'wheat', day: 2 } });
    rowan.say({ type: 'harvest', seq: 1, tile: '12,44' });
    expect(rowan.of('harvested')[0]).toMatchObject({ ok: false, amount: 0 });
  });

  it('refuses bare ground', () => {
    const sim = world();
    const rowan = new Pretend(sim).join(5, 'Rowan');
    stand(rowan, 12.5, 44.5);
    rowan.say({ type: 'harvest', seq: 1, tile: '12,44' });
    expect(rowan.of('harvested')[0]).toMatchObject({ ok: false });
  });

  it('refuses a field the hero is not standing in', () => {
    const sim = world();
    const rowan = new Pretend(sim).join(5, 'Rowan');
    stand(rowan, 80.5, 80.5);
    rowan.say({ type: 'delta', delta: { kind: 'sow', tile: '12,44', crop: 'wheat', day: 1 } });
    rowan.say({ type: 'setclock', day: 40, time: 0.5 });
    rowan.say({ type: 'harvest', seq: 1, tile: '12,44' });
    expect(rowan.of('harvested')[0]).toMatchObject({ ok: false });
  });

  it('gives it to whoever asked first, and tells the other one no', () => {
    const sim = world();
    const rowan = new Pretend(sim).join(5, 'Rowan');
    stand(rowan, 12.5, 44.5);
    rowan.say({ type: 'delta', delta: { kind: 'sow', tile: '12,44', crop: 'wheat', day: 1 } });
    // wound on while he is the only one here: a world with two people in it does not take its time
    // of day from either of them
    rowan.say({ type: 'setclock', day: 40, time: 0.5 });

    const wren = new Pretend(sim).join(5, 'Wren');
    stand(wren, 12.5, 44.5);
    rowan.say({ type: 'harvest', seq: 1, tile: '12,44' });
    wren.say({ type: 'harvest', seq: 1, tile: '12,44' });

    expect(rowan.of('harvested')[0].ok, 'the one who got there first was refused').toBe(true);
    expect(wren.of('harvested')[0].ok, 'one field paid out twice').toBe(false);
    // and the one who lost it is told the field is bare, so it is drawn bare on his screen
    expect(wren.of('delta').map((d) => d.delta)).toContainEqual({ kind: 'reap', tile: '12,44' });
  });
});

describe('a seed, and whether the ground will take it', () => {
  /*
   * One test for the wiring only. `server/farming.test.ts` drives the rule itself with a fake field,
   * which is where the seasons and the ground and the races are settled; all this says is that a
   * `sow` message reaches it and an answer comes back.
   */
  it('answers a page that says it has sown something', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(9, 'Rowan');
    rowan.say({ type: 'move', x: 12.5, z: 44.5, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    rowan.say({ type: 'sow', seq: 1, tile: '12,44', crop: 'wheat' });
    // refused, because this world grows no ground at all: nothing is plantable in a world with no
    // tiles in it, which is exactly the answer a page should get rather than silence
    expect(rowan.of('sown')[0]).toMatchObject({ seq: 1, tile: '12,44', ok: false });
  });
});

describe('what a page may no longer simply announce', () => {
  /*
   * A command that can be bypassed is not a check, it is a suggestion.
   *
   * Every kind of change began as a page deciding something and reporting it, because that was the
   * only shape available while the world had no opinion about anything. Two of them have a command
   * of their own now — `open` for a chest, `harvest` for a crop — and the reporting door has to
   * close behind them or a client can simply walk round the check.
   */
  it('refuses a chest a page says it has opened', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(21, 'Rowan');
    const wren = new Pretend(sim).join(21, 'Wren');
    rowan.say({ type: 'delta', delta: { kind: 'chest', id: 'Barrow:1:chest:0' } });
    expect(wren.of('delta'), 'a chest was opened by saying so').toEqual([]);
  });

  it('refuses a key, a reaping and a civic vote reported as facts', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(22, 'Rowan');
    const wren = new Pretend(sim).join(22, 'Wren');
    rowan.say({ type: 'delta', delta: { kind: 'key', id: 'Barrow:1' } });
    rowan.say({ type: 'delta', delta: { kind: 'reap', tile: '4,4' } });
    rowan.say({ type: 'delta', delta: { kind: 'voted', village: 'Anywhere', rank: 'city', day: 2 } });
    expect(wren.of('delta')).toEqual([]);
  });

  it('still takes the changes that have no command of their own', () => {
    // sowing spends a seed to claim a tile rather than handing anything over, and the debug console
    // can sow across the map — so it stays a report until every way of doing it is a hero in a field
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(23, 'Rowan');
    const wren = new Pretend(sim).join(23, 'Wren');
    rowan.say({ type: 'delta', delta: { kind: 'sow', tile: '4,4', crop: 'wheat', day: 2 } });
    rowan.say({ type: 'delta', delta: { kind: 'told', mine: 'Barrow' } });
    expect(wren.of('delta').map((d) => d.delta.kind)).toEqual(['sow', 'told']);
  });

  it('still tells everybody about a chest the world itself opened', () => {
    // the change travels outward exactly as it always did: what is gone is a client writing one
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const chests = generateDungeon(new Manifest(3).deriveSeed('dungeon:Barrow', 'dungeon', null), 'vault', 1).chests;
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const wren = new Pretend(sim).join(3, 'Wren');
    for (const who of [rowan, wren]) {
      who.say({ type: 'floor', place: 'Barrow:1', anchor: 'dungeon:Barrow', kind: 'dungeon', floor: 1 });
      who.say({
        type: 'move', x: chests[0].x + 0.5, z: chests[0].z + 0.5, yaw: 0, walk: 0,
        place: 'Barrow:1', riding: 'foot', gear: [],
      });
    }
    rowan.say({ type: 'open', seq: 1, place: 'Barrow:1', index: 0, owns: [] });
    expect(wren.of('delta').map((d) => d.delta)).toContainEqual({ kind: 'chest', id: 'Barrow:1:chest:0' });
  });
});
