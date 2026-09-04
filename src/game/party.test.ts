import { describe, expect, it } from 'vitest';
import { Party } from './party';
import type { Presence } from '../../server/protocol';

const presence = (id: string, x: number) =>
  ({ id, name: id, x, z: 0, yaw: 0, walk: 0, gear: [], place: 'surface', riding: 'foot' as const });

describe('a party', () => {
  it('holds the roster the server sends, and forgets it when the party breaks up', () => {
    const party = new Party();
    expect(party.size).toBe(0);
    party.receive([{ id: 'p1', name: 'Rowan' }, { id: 'p2', name: 'Wren' }]);
    expect(party.size).toBe(2);
    expect(party.has('p2')).toBe(true);
    party.receive([]);
    expect(party.has('p2')).toBe(false);
  });

  it('picks its companions out of everyone else in the world', () => {
    const party = new Party();
    party.receive([{ id: 'p1', name: 'Rowan' }, { id: 'p2', name: 'Wren' }]);
    const here = [presence('p2', 4), presence('p3', 9)];
    expect(party.companions(here, 'p1').map((p) => p.id)).toEqual(['p2']);
  });

  it('reads back in a line, however many of you there are', () => {
    const party = new Party();
    expect(party.describe('p1')).toBe('travelling alone');
    party.receive([{ id: 'p1', name: 'Rowan' }, { id: 'p2', name: 'Wren' }]);
    expect(party.describe('p1')).toBe('with Wren');
    party.receive([{ id: 'p1', name: 'Rowan' }, { id: 'p2', name: 'Wren' }, { id: 'p3', name: 'Alder' }]);
    expect(party.describe('p1')).toBe('with Wren and Alder');
  });
});
