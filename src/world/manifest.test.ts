import { describe, expect, it } from 'vitest';
import { Manifest } from './manifest';

describe('Manifest', () => {
  it('derives the same seeds from the same root, independent of creation order', () => {
    const a = new Manifest(42);
    const b = new Manifest(42);
    a.ensure('island:0', 'island', 500, 0);
    a.ensure('island:1', 'island', 0, 500);
    b.ensure('island:1', 'island', 0, 500);
    b.ensure('island:0', 'island', 500, 0);
    expect(a.get('island:0')!.seed).toBe(b.get('island:0')!.seed);
    expect(a.get('island:1')!.seed).toBe(b.get('island:1')!.seed);
    expect(a.get('island:0')!.seed).not.toBe(a.get('island:1')!.seed);
    expect(new Manifest(43).ensure('island:0', 'island', 500, 0).seed).not.toBe(a.get('island:0')!.seed);
  });

  it('children derive from the parent seed, so overriding a parent changes only its subtree', () => {
    const m = new Manifest(7);
    const isl = m.ensure('island:0', 'island', 500, 0);
    const d0 = m.ensure('dungeon:island:0:0', 'dungeon', 510, 5, isl.id);
    const other = m.ensure('dungeon:main:0', 'dungeon', 10, 10);
    const m2 = new Manifest(7);
    m2.ensure('island:0', 'island', 500, 0);
    m2.override('island:0', 12345);
    const d0b = m2.ensure('dungeon:island:0:0', 'dungeon', 510, 5, 'island:0');
    const otherB = m2.ensure('dungeon:main:0', 'dungeon', 10, 10);
    expect(d0b.seed).not.toBe(d0.seed);
    expect(otherB.seed).toBe(other.seed);
  });

  it('round-trips through JSON and keeps stored anchors over derivation', () => {
    const m = new Manifest(9);
    m.ensure('island:0', 'island', 1, 2);
    m.override('island:0', 999);
    const back = new Manifest(9, JSON.parse(JSON.stringify(m.toJSON())));
    expect(back.ensure('island:0', 'island', 1, 2).seed).toBe(999);
    // a different root ignores the saved anchors
    expect(new Manifest(10, m.toJSON()).anchors.size).toBe(0);
  });
});
