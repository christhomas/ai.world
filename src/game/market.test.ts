import { describe, expect, it } from 'vitest';
import { Market, askingPrice, lotLine, pitchId } from './market';
import { STALL_RENT } from '../../server/protocol';
import type { Stall } from '../../server/protocol';
import type { Village } from '../world/structures';

const village = (name: string, x: number, z: number, pitches: Array<[number, number]>) =>
  ({ name, x, z, radius: 20, stalls: pitches } as unknown as Village);

const stall = (id: string, owner: string, items: Stall['items'] = []): Stall =>
  ({ id, village: id.split('#')[0], owner, items, takings: 0, until: 9 });

describe('the market', () => {
  it('lays a pitch over every stall the village built, rented or not', () => {
    const market = new Market();
    const square = village('Ashford', 10, 10, [[9, 10], [11, 10]]);
    market.receive([stall(pitchId('Ashford', 1), 'Rowan')]);

    const pitches = market.pitchesOf(square);
    expect(pitches.map((p) => p.id)).toEqual(['Ashford#0', 'Ashford#1']);
    expect(pitches[0].stall).toBeNull();
    expect(pitches[1].stall?.owner).toBe('Rowan');
  });

  it('finds the pitch you are standing at, and none when you are not', () => {
    const market = new Market();
    const square = village('Ashford', 10, 10, [[9, 10], [30, 30]]);
    expect(market.nearest([square], 9.4, 10.2)?.id).toBe('Ashford#0');
    expect(market.nearest([square], 20, 20)).toBeNull();
  });

  it('knows which pitches are yours, wherever they are', () => {
    const market = new Market();
    market.receive([stall('Ashford#0', 'Rowan'), stall('Brightmoor#2', 'Rowan'), stall('Ashford#1', 'Wren')]);
    expect(market.mine('Rowan').map((s) => s.id)).toEqual(['Ashford#0', 'Brightmoor#2']);
    expect(market.mine('Nobody')).toEqual([]);
  });

  it('asks a round price above the shop price, and reads a lot back plainly', () => {
    expect(askingPrice('apple') % 5).toBe(0);
    expect(askingPrice('apple')).toBeGreaterThan(0);
    expect(lotLine({ id: 'apple', price: 15, count: 3 })).toContain('×3');
    expect(lotLine({ id: 'apple', price: 15, count: 3 })).toContain('15g');
    expect(STALL_RENT).toBeGreaterThan(0);
  });
});
