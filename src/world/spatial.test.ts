import { describe, expect, it } from 'vitest';
import { CellIndex, cellKey, chunkKey, parseChunkKey } from './spatial';

describe('spatial', () => {
  it('keys round-trip and differ per cell', () => {
    expect(parseChunkKey(chunkKey(-3, 7))).toEqual([-3, 7]);
    expect(cellKey(0, 0)).not.toBe(cellKey(1, 0));
    expect(cellKey(0, 0)).not.toBe(cellKey(0, 1));
    expect(cellKey(-1, 5)).toBe(cellKey(-1, 5));
  });

  it('CellIndex returns each overlapping id once', () => {
    const idx = new CellIndex(10, 4);
    idx.insert(0, 0, 0, 25, 5);      // spans three cells in x
    idx.insert(1, 100, 100, 105, 105);
    idx.insert(2, -5, -5, 5, 5);
    const hits = idx.query(0, 0, 30, 10).sort();
    expect(hits).toEqual([0, 2]);
    expect(idx.query(200, 200, 210, 210)).toEqual([]);
    expect(idx.query(101, 101, 102, 102)).toEqual([1]);
  });
});
