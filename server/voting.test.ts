import { describe, expect, it, vi } from 'vitest';
import { Biome } from '../src/world/biomes';
import { bodyOfTheHall } from '../src/world/hall';
import { Register } from '../src/world/register';
import { doorTile, StructureKind, type Structure, type Village } from '../src/world/structures';
import { callTownVote } from './voting';

const trades = ['farmer', 'seller', 'hunter', 'soldier'];

function house(at: number): Structure {
  return {
    kind: StructureKind.House,
    tx: at * 4,
    tz: 0,
    hw: 1,
    hd: 1,
    level: 0,
    rot: 0,
    biome: Biome.Plains,
    path: [[at * 4, -2]],
  };
}

function eligibleVillage(): { register: Register; village: Village; door: [number, number] } {
  const houses = Array.from({ length: 16 }, (_, at) => house(at));
  const hallBuilding: Structure = {
    kind: StructureKind.TownHall,
    tx: 10,
    tz: 10,
    hw: 1,
    hd: 1,
    level: 0,
    rot: 0,
    biome: Biome.Plains,
    path: [[10, 8]],
  };
  const village = {
    name: 'Testing', x: 0, z: 0, radius: 80, level: 0, biome: Biome.Plains,
    houses, spare: [], shops: [], pub: null, station: null, stable: null,
    church: null, churchDoor: null,
    hall: { building: hallBuilding, door: [10, 8] },
    watchHouse: null, board: null, stalls: [],
  } as Village;
  const register = new Register(17, 77);
  register.settle(village.name, houses.length, trades);
  register.hallOf(village.name)!.purse = 5000;
  const body = bodyOfTheHall(register.hallOf(village.name), houses, register.living(village.name), hallBuilding);
  if (!body) throw new Error('the eligible village has no acting hall');
  return { register, village, door: doorTile(body) };
}

describe('an authoritative civic vote', () => {
  it('accepts only beside the current hall and derives rank and day from the world', () => {
    const { register, village, door } = eligibleVillage();
    const commit = vi.fn(() => true);

    expect(callTownVote({ register, village, hero: { x: door[0] + 20, z: door[1] }, day: 77, commit })).toBeNull();
    expect(commit).not.toHaveBeenCalled();

    const vote = callTownVote({ register, village, hero: { x: door[0], z: door[1] }, day: 77.9, commit });
    expect(vote).toEqual({ kind: 'voted', village: 'Testing', rank: 'town', day: 77 });
    expect(commit).toHaveBeenCalledWith(vote);
    expect(register.rankOf('Testing')).toBe('town');
    expect(register.hallOf('Testing')?.purse).toBe(0);
  });
});
