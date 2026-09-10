import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileVault } from './filevault';
import { DAY_LENGTH, SharedWorld, worldPath } from './world';

/** These tests are about a world outliving the thing that held it, so they want real files. */
const kept = new FileVault();
import { describeWorlds } from './worlds';
import { cleanDelta, cleanLetter, cleanStallItem, deltaKey } from './protocol';
import { provinceOf, provincePath } from '../src/world/provinces';

const scratch = () => mkdtempSync(join(tmpdir(), 'aiworld-'));

describe('the shared world', () => {
  it('keeps its own time and rolls over at midnight', () => {
    const dir = scratch();
    try {
      const world = new SharedWorld(1, worldPath(dir, 1), { day: 3, time: 0.9 }, dir);
      world.tick(DAY_LENGTH * 0.05);            // a twentieth of a day
      expect(world.clock.day).toBe(3);
      expect(world.clock.time).toBeCloseTo(0.95);
      world.tick(DAY_LENGTH * 0.1);             // over the end of the day
      expect(world.clock.day).toBe(4);
      expect(world.clock.time).toBeCloseTo(0.05);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('remembers what changed, ignores repeats, and forgets a reaped tile', () => {
    const dir = scratch();
    try {
      const world = new SharedWorld(7, worldPath(dir, 7), { day: 1, time: 0.3 }, dir);
      expect(world.apply({ kind: 'chest', id: 'vault:1:chest:0' })).toBe(true);
      expect(world.apply({ kind: 'chest', id: 'vault:1:chest:0' })).toBe(false);
      expect(world.apply({ kind: 'sow', tile: '4,9', crop: 'wheat', day: 2 })).toBe(true);
      expect(world.log).toHaveLength(2);

      // a tile reaped is simply no longer sown
      expect(world.apply({ kind: 'reap', tile: '4,9' })).toBe(true);
      expect(world.log.map(deltaKey)).toEqual(['chest:vault:1:chest:0']);
      expect(world.apply({ kind: 'reap', tile: '4,9' })).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('survives a restart: the clock and the log come back', () => {
    const dir = scratch();
    try {
      const path = worldPath(dir, 12);
      const first = new SharedWorld(12, path, { day: 1, time: 0.2 }, dir, kept);
      first.tick(DAY_LENGTH * 2.5);
      first.apply({ kind: 'found', name: 'Moonwell Shrine' });
      first.apply({ kind: 'key', id: 'dungeon:Moonwell Shrine:1' });
      first.save();

      const second = new SharedWorld(12, path, { day: 99, time: 0.99 }, dir, kept);
      expect(second.clock.day).toBe(first.clock.day);
      expect(second.clock.time).toBeCloseTo(first.clock.time);
      expect(second.log.map(deltaKey).sort()).toEqual(['found:Moonwell Shrine', 'key:dungeon:Moonwell Shrine:1']);

      // a different seed does not read somebody else's world
      const other = new SharedWorld(13, path, { day: 5, time: 0.5 }, dir, kept);
      expect(other.clock.day).toBe(5);
      expect(other.log).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('market pitches', () => {
  const world = () => { const dir = scratch(); return new SharedWorld(3, worldPath(dir, 3), { day: 2, time: 0.4 }, dir); };

  it('are rented by name, and only by one trader at a time', () => {
    const w = world();
    expect(w.stall('Rowan', { do: 'rent', id: 'Ashford#0', village: 'Ashford' })).toEqual({ ok: true, kind: 'rented' });
    const taken = w.stall('Wren', { do: 'rent', id: 'Ashford#0', village: 'Ashford' });
    expect(taken.ok).toBe(false);
    expect(w.stalls[0].until).toBe(5);                       // day 2 plus the three days of rent
  });

  it('sell a lot at a time, bank the money for the owner, and refuse the owner buying their own', () => {
    const w = world();
    w.stall('Rowan', { do: 'rent', id: 'Ashford#0', village: 'Ashford' });
    w.stall('Rowan', { do: 'stock', id: 'Ashford#0', item: { id: 'apple', price: 10, count: 2 } });
    expect(w.stall('Rowan', { do: 'buy', id: 'Ashford#0', index: 0 }).ok).toBe(false);

    const sale = w.stall('Wren', { do: 'buy', id: 'Ashford#0', index: 0 });
    expect(sale).toEqual({ ok: true, kind: 'bought', item: { id: 'apple', price: 10, count: 1 }, cost: 10 });
    expect(w.stalls[0].items[0].count).toBe(1);
    w.stall('Wren', { do: 'buy', id: 'Ashford#0', index: 0 });
    expect(w.stalls[0].items).toEqual([]);                   // the last one sold clears the lot
    expect(w.stall('Rowan', { do: 'collect', id: 'Ashford#0' })).toEqual({ ok: true, kind: 'collected', gold: 20 });
    expect(w.stall('Rowan', { do: 'collect', id: 'Ashford#0' })).toEqual({ ok: true, kind: 'collected', gold: 0 });
  });

  it('cannot be stocked by anyone but their holder, and are swept when the rent runs out', () => {
    const w = world();
    w.stall('Rowan', { do: 'rent', id: 'Ashford#0', village: 'Ashford' });
    expect(w.stall('Wren', { do: 'stock', id: 'Ashford#0', item: { id: 'apple', price: 10, count: 1 } }).ok).toBe(false);

    expect(w.sweepStalls()).toBe(false);
    w.tick(DAY_LENGTH * 4);
    expect(w.sweepStalls()).toBe(true);
    expect(w.stalls).toEqual([]);
  });

  it('outlive a restart, goods and takings and all', () => {
    const dir = scratch();
    try {
      const path = worldPath(dir, 21);
      const first = new SharedWorld(21, path, { day: 1, time: 0.2 }, dir, kept);
      first.stall('Rowan', { do: 'rent', id: 'Ashford#0', village: 'Ashford' });
      first.stall('Rowan', { do: 'stock', id: 'Ashford#0', item: { id: 'apple', price: 10, count: 2 } });
      first.stall('Wren', { do: 'buy', id: 'Ashford#0', index: 0 });
      first.save();

      const second = new SharedWorld(21, path, { day: 1, time: 0.2 }, dir, kept);
      expect(second.stalls[0].owner).toBe('Rowan');
      expect(second.stalls[0].items).toEqual([{ id: 'apple', price: 10, count: 1 }]);
      expect(second.stalls[0].takings).toBe(10);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the post shelf', () => {
  it('holds a parcel for a name until that name asks for it', () => {
    const shelf = scratch();
    const w = new SharedWorld(4, worldPath(shelf, 4), { day: 6, time: 0.2 }, shelf);
    w.meet('Rowan');
    expect(w.meet('Rowan')).toBe(false);              // the world only meets you once
    w.post({ from: 'Rowan', to: 'Wren', gold: 10, items: [['apple', 1]], day: 6 });
    expect(w.waiting('Wren')).toBe(1);
    expect(w.waiting('Rowan')).toBe(0);

    const collected = w.collect('Wren');
    expect(collected).toHaveLength(1);
    expect(collected[0].items).toEqual([['apple', 1]]);
    expect(w.collect('Wren')).toEqual([]);            // the shelf is empty once it is cleared
  });

  it('remembers parcels and names across a restart', () => {
    const dir = scratch();
    try {
      const path = worldPath(dir, 31);
      const first = new SharedWorld(31, path, { day: 1, time: 0.2 }, dir, kept);
      first.meet('Rowan');
      first.post({ from: 'Rowan', to: 'Wren', gold: 5, items: [], day: 1 });
      first.save();

      const second = new SharedWorld(31, path, { day: 1, time: 0.2 }, dir, kept);
      expect(second.folk).toEqual(['Rowan']);
      expect(second.collect('Wren')[0].gold).toBe(5);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('deltas off the wire', () => {
  it('are cleaned into something the world can trust', () => {
    expect(cleanDelta({ kind: 'chest', id: 'a'.repeat(300) })!.kind).toBe('chest');
    expect((cleanDelta({ kind: 'chest', id: 'a'.repeat(300) }) as { id: string }).id.length).toBe(80);
    expect(cleanDelta({ kind: 'sow', tile: '1,1', crop: 'wheat', day: -5 })).toEqual({ kind: 'sow', tile: '1,1', crop: 'wheat', day: 1 });
    expect(cleanDelta({ kind: 'sow', tile: '1,1', crop: 'wheat', day: Number.NaN })).toBeNull();
    expect(cleanDelta({ kind: 'nonsense' } as never)).toBeNull();
  });

  it('so are the parcels people leave at an inn', () => {
    expect(cleanLetter({ from: 'Rowan', to: 'Wren', gold: 5.9, items: [['apple', 2]], day: 3 }))
      .toEqual({ from: 'Rowan', to: 'Wren', gold: 5, items: [['apple', 2]], day: 3 });
    expect(cleanLetter({ from: 'Rowan', to: 'Wren', gold: 0, items: [], day: 3 })).toBeNull();
    expect(cleanLetter({ from: 'Rowan', to: '', gold: 5, items: [], day: 3 })!.to).toBe('Traveller');
  });

  it('so are the lots people put on a stall', () => {
    expect(cleanStallItem({ id: 'apple', price: 12.7, count: 3.2 })).toEqual({ id: 'apple', price: 12, count: 3 });
    expect(cleanStallItem({ id: 'apple', price: -5, count: 1000 })).toEqual({ id: 'apple', price: 1, count: 99 });
    expect(cleanStallItem({ id: '', price: 1, count: 1 })).toBeNull();
    expect(cleanStallItem({ id: 'apple', price: Number.NaN, count: 1 })).toBeNull();
  });
});

describe('what the server has kept', () => {
  it('reads back one line per world, and says so plainly when there are none', () => {
    const dir = scratch();
    try {
      expect(describeWorlds(dir)[0]).toContain('No worlds saved yet');
      expect(describeWorlds(join(dir, 'nowhere'))[0]).toContain('No worlds saved yet');

      const world = new SharedWorld(5, worldPath(dir, 5), { day: 4, time: 0.5 }, dir, kept);
      world.apply({ kind: 'chest', id: 'vault:1:chest:0' });
      world.meet('Rowan');
      world.stall('Rowan', { do: 'rent', id: 'Ashford#0', village: 'Ashford' });
      world.post({ from: 'Rowan', to: 'Wren', gold: 5, items: [], day: 4 });
      world.save();

      const [line] = describeWorlds(dir);
      expect(line).toContain('seed 5');
      expect(line).toContain('day 4, 12:00');
      expect(line).toContain('1 change');
      expect(line).toContain('1 stall');
      expect(line).toContain('1 parcel');
      expect(line).toContain('visited by Rowan');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

/*
 * The change that lets a world have no edge.
 *
 * What a player leaves behind grows with every acre anybody has walked over, and a world with an
 * edge could hold all of it in one file. There was a cap of four thousand changes here and a rule
 * that threw the oldest sowings away when it was reached — a world quietly destroying somebody's
 * fields because there was nowhere else to put them. A province is somewhere else to put them.
 */
describe('what happened at a place, kept where it happened', () => {
  it('writes a far-off field to its own province, and reads it back when somebody returns', () => {
    const dir = scratch();
    const kept = new FileVault();
    const away = { x: 40_000, z: -25_000 };
    const first = new SharedWorld(21, worldPath(dir, 21), { day: 1, time: 0.2 }, dir, kept);
    first.apply({ kind: 'sow', tile: `${away.x},${away.z}`, crop: 'wheat', day: 1 });
    first.save();

    // a world opened again knows nothing about that country until somebody is near it
    const second = new SharedWorld(21, worldPath(dir, 21), { day: 1, time: 0.2 }, dir, kept);
    expect(second.log.some((d) => d.kind === 'sow'), 'a field on the far side of the world was in memory')
      .toBe(false);

    // and knows all about it the moment they are
    second.keepNear([away]);
    const sown = second.log.find((d) => d.kind === 'sow');
    expect(sown, 'the field was not read back when somebody went to it').toBeTruthy();
    expect((sown as { tile: string }).tile).toBe(`${away.x},${away.z}`);
  });

  it('lets go of a province when the last of them leaves, having written it down', () => {
    const dir = scratch();
    const kept = new FileVault();
    const world = new SharedWorld(22, worldPath(dir, 22), { day: 1, time: 0.2 }, dir, kept);
    world.apply({ kind: 'sow', tile: '2000,2000', crop: 'wheat', day: 1 });
    expect(world.log.some((d) => d.kind === 'sow')).toBe(true);

    // everybody walks a long way off
    world.keepNear([{ x: -90_000, z: 90_000 }]);
    expect(world.log.some((d) => d.kind === 'sow'), 'still carrying country nobody is near').toBe(false);

    // and the field is still there when they come back, because letting go wrote it down
    world.keepNear([{ x: 2000, z: 2000 }]);
    expect(world.log.some((d) => d.kind === 'sow'), 'the field was lost when the world let go of it')
      .toBe(true);
  });

  it('keeps a reaped field reaped, wherever it was', () => {
    const dir = scratch();
    const kept = new FileVault();
    const world = new SharedWorld(23, worldPath(dir, 23), { day: 1, time: 0.2 }, dir, kept);
    world.apply({ kind: 'sow', tile: '5000,5000', crop: 'wheat', day: 1 });
    world.apply({ kind: 'reap', tile: '5000,5000' });
    world.save();

    const again = new SharedWorld(23, worldPath(dir, 23), { day: 1, time: 0.2 }, dir, kept);
    again.keepNear([{ x: 5000, z: 5000 }]);
    expect(again.log.some((d) => d.kind === 'sow'), 'a reaped field came back sown').toBe(false);
  });

  it('still keeps the world its own facts, which belong nowhere in particular', () => {
    const dir = scratch();
    const kept = new FileVault();
    const world = new SharedWorld(24, worldPath(dir, 24), { day: 1, time: 0.2 }, dir, kept);
    world.apply({ kind: 'chest', id: 'barrow:1:3' });
    world.save();

    // a chest is a fact about the world rather than about a spot on it, so it is there from the
    // moment the world is opened, wherever anybody happens to be standing
    const again = new SharedWorld(24, worldPath(dir, 24), { day: 1, time: 0.2 }, dir, kept);
    expect(again.log.some((d) => d.kind === 'chest')).toBe(true);
  });
});

/*
 * How long a province was nobody's business.
 *
 * The one number a province could not previously produce, and the one a coarse tier cannot do
 * without: `catchUp` in `src/entities/unwatched.ts` takes a herd and a stretch of time, and until
 * this the stretch was simply gone — a room closes the moment its last player leaves and takes its
 * ground and its creatures with it, so nothing anywhere remembered when that was.
 */
describe('a province knows how long it was left alone', () => {
  const FAR = { x: -90_000, z: 90_000 };
  const spot = { x: 3000, z: 3000 };
  const there = provinceOf(spot.x, spot.z);

  it('says nought for one nobody has ever walked out of', () => {
    const dir = scratch();
    try {
      const world = new SharedWorld(31, worldPath(dir, 31), { day: 4, time: 0.5 }, dir, kept);
      expect(world.asleep(there), 'a province was asleep before anybody had left it').toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('counts the days between the last of them leaving and the first coming back', () => {
    const dir = scratch();
    try {
      const world = new SharedWorld(32, worldPath(dir, 32), { day: 1, time: 0 }, dir, kept);
      world.apply({ kind: 'sow', tile: `${spot.x},${spot.z}`, crop: 'wheat', day: 1 });
      world.keepNear([FAR]);                       // everybody walks away, and it is written down
      world.tick(DAY_LENGTH * 5);                  // five days of world with nobody there for it
      expect(world.asleep(there)).toBeCloseTo(5 * DAY_LENGTH, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('measures from the last time they left rather than the first', () => {
    const dir = scratch();
    try {
      const world = new SharedWorld(33, worldPath(dir, 33), { day: 1, time: 0 }, dir, kept);
      world.apply({ kind: 'sow', tile: `${spot.x},${spot.z}`, crop: 'wheat', day: 1 });
      world.keepNear([FAR]);
      world.tick(DAY_LENGTH * 5);
      world.keepNear([spot]);                      // somebody walks back through it, changing nothing
      world.tick(DAY_LENGTH * 2);
      world.keepNear([FAR]);                       // and out again, on day eight
      world.tick(DAY_LENGTH);
      // one day rather than eight. The stamp is rewritten on the way out even when the rows are the
      // same rows, which is the whole reason `writeProvince` no longer trusts `dirty` alone.
      expect(world.asleep(there), 'the sleep was measured from the first departure, not the last')
        .toBeCloseTo(DAY_LENGTH, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('stamps a square with nothing in it, because its creatures are not among its leavings', () => {
    const dir = scratch();
    try {
      const world = new SharedWorld(36, worldPath(dir, 36), { day: 1, time: 0 }, dir, kept);
      // nothing sown, nothing dug, nothing opened: open hills, which is most of any world
      world.keepNear([spot]);
      world.keepNear([FAR]);
      world.tick(DAY_LENGTH * 6);

      // Six days rather than nought. A province's animals are re-rolled from the seed every time a
      // chunk is spawned, so they leave no rows behind and a square of empty country has nothing to
      // write but the hour somebody was last near it — and without that hour every deer outside a
      // worked field is handed back standing exactly where it was founded, however long anybody has
      // been gone. The bill is a few dozen bytes a province.
      expect(world.asleep(there), 'a province with no leavings in it forgot when it stopped being anybody\u2019s business, so the country round it would never be caught up')
        .toBeCloseTo(6 * DAY_LENGTH, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reads a province written before there was a stamp, and calls it never away', () => {
    const dir = scratch();
    try {
      // the shape provinces were written in before this: a bare array of rows and nothing else
      const vault = new FileVault();
      vault.write(provincePath(dir, 34, there), JSON.stringify([
        { kind: 'sow', tile: `${spot.x},${spot.z}`, crop: 'wheat', day: 1 },
      ]));
      const world = new SharedWorld(34, worldPath(dir, 34), { day: 40, time: 0.5 }, dir, vault);
      world.keepNear([spot]);
      expect(world.log.some((d) => d.kind === 'sow'), 'an old province file was not read').toBe(true);
      // nought rather than thirty-nine days: the safe wrong answer is to catch nothing up, and not
      // to catch something up by an amount that was never written down
      expect(world.asleep(there), 'a file with no stamp was given one it never had').toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('settles what the villagers recall when a province stops being anybody\'s business', () => {
    const dir = scratch();
    try {
      // C4 left `Register.compact(day)` wanting a caller, and this is the moment it wanted: a
      // province being written with nobody there. Nothing on the server holds a register until C5
      // moves the villagers across, so the hook takes one and this stands in for it.
      const days: number[] = [];
      const world = new SharedWorld(35, worldPath(dir, 35), { day: 1, time: 0 }, dir, kept, {
        compact: (day: number) => days.push(day),
      });
      world.apply({ kind: 'sow', tile: `${spot.x},${spot.z}`, crop: 'wheat', day: 1 });
      world.keepNear([spot]);
      expect(days, 'the register was settled while somebody was still standing there').toEqual([]);

      world.tick(DAY_LENGTH * 2.5);
      world.keepNear([FAR]);
      expect(days, 'the register was not settled when the last of them left').toEqual([3]);

      // and not again for a square that was already let go: there is nothing left to put away
      world.keepNear([FAR]);
      expect(days, 'the register was settled again over an empty world').toEqual([3]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
