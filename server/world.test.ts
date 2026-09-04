import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DAY_LENGTH, SharedWorld, worldPath } from './world';
import { cleanDelta, deltaKey } from './protocol';

const scratch = () => mkdtempSync(join(tmpdir(), 'aiworld-'));

describe('the shared world', () => {
  it('keeps its own time and rolls over at midnight', () => {
    const dir = scratch();
    try {
      const world = new SharedWorld(1, worldPath(dir, 1), { day: 3, time: 0.9 });
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
      const world = new SharedWorld(7, worldPath(dir, 7), { day: 1, time: 0.3 });
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
      const first = new SharedWorld(12, path, { day: 1, time: 0.2 });
      first.tick(DAY_LENGTH * 2.5);
      first.apply({ kind: 'found', name: 'Moonwell Shrine' });
      first.apply({ kind: 'key', id: 'dungeon:Moonwell Shrine:1' });
      first.save();

      const second = new SharedWorld(12, path, { day: 99, time: 0.99 });
      expect(second.clock.day).toBe(first.clock.day);
      expect(second.clock.time).toBeCloseTo(first.clock.time);
      expect(second.log.map(deltaKey).sort()).toEqual(['found:Moonwell Shrine', 'key:dungeon:Moonwell Shrine:1']);

      // a different seed does not read somebody else's world
      const other = new SharedWorld(13, path, { day: 5, time: 0.5 });
      expect(other.clock.day).toBe(5);
      expect(other.log).toEqual([]);
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
});
