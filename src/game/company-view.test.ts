import { describe, expect, it } from 'vitest';
import type { Presence } from '../../server/protocol';
import { companyView } from './company-view';

const somebody = (id: string, over: Partial<Presence> = {}): Presence =>
  ({ id, name: id, x: 0, z: 0, yaw: 0, walk: 0, gear: [], place: 'surface', riding: 'foot', ...over });

/** The travellers list (#576): what the page's list and an installed app's page both read out. */
describe('everybody else in a shared world', () => {
  it('lists them nearest first, with how far off each is and who travels with you', () => {
    const view = companyView({
      players: [somebody('far', { x: 30, z: 40 }), somebody('near', { x: 3, z: 4, riding: 'horse' })],
      party: new Set(['far']), x: 0, z: 0, place: 'surface', me: 'Ada',
    });
    expect(view.me).toBe('Ada');
    expect(view.where).toBe('out in the world');
    expect(view.travellers.map((p) => [p.id, p.away, p.party, p.riding])).toEqual([
      ['near', 5, false, 'horse'],
      ['far', 50, true, 'foot'],
    ]);
  });

  it('says where each of them is from where you are standing', () => {
    const view = companyView({
      players: [
        somebody('beside', { place: 'the general store' }),
        somebody('below', { place: 'Thornhold:2' }),
        somebody('outside', { place: 'surface' }),
      ],
      party: new Set(), x: 0, z: 0, place: 'the general store', me: 'Ada',
    });
    expect(view.where).toBe('inside the general store');
    expect(Object.fromEntries(view.travellers.map((p) => [p.id, p.where]))).toEqual({
      beside: 'here with you', below: 'underground in Thornhold', outside: 'out in the world',
    });
  });
});
