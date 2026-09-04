import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from '../world/graph';
import { TerrainSampler } from '../world/terrain';
import { Biome } from '../world/biomes';
import type { Structures, Village } from '../world/structures';
import { ITEMS } from './items';
import { errandDone, pubTalk } from './pub';

const world = (seed: number): Structures => new TerrainSampler(generateRoadGraph(seed)).structures;

/** Every village in a world that keeps a pub. */
const drinking = (structures: Structures): Village[] => structures.villages.filter((v) => v.pub !== null);

/** The same village, moved to another climate, so only the biome can explain a difference. */
const inBiome = (v: Village, biome: Biome): Village => ({ ...v, biome });

/** Every place in a world that has a name you could go and stand in. */
const named = (structures: Structures): Set<string> =>
  new Set([...structures.pois, ...structures.caves, ...structures.wrecks].map((p) => p.name));

/**
 * A pub is worth having only if what you hear in it is worth hearing, and it is only worth
 * hearing if it is true of this world and the same for everybody in it. So what is tested is
 * that the room is fixed by the seed, that no two rooms are the same room, and that the errand
 * you leave with is something the game can settle without anybody's word for it.
 */
describe('what you find out in the pub', () => {
  it('tells everyone who walks in the same thing, in the same order', () => {
    const structures = world(1);
    const village = drinking(structures)[0];
    expect(pubTalk(village, structures, 1)).toEqual(pubTalk(village, structures, 1));
    expect(pubTalk(village, structures, 1)!.rumours.length).toBeGreaterThan(1);
  });

  it('gives every village its own room, and nobody else’s talk', () => {
    const structures = world(1);
    const rooms = drinking(structures).map((v) => pubTalk(v, structures, 1)!);
    expect(rooms.length).toBeGreaterThan(4);
    expect(new Set(rooms.map((r) => r.rumours.join('|'))).size).toBe(rooms.length);
  });

  it('says something different in the snow than it says in the desert', () => {
    const structures = world(1);
    const village = drinking(structures)[0];
    const snow = pubTalk(inBiome(village, Biome.Snow), structures, 1)!;
    const desert = pubTalk(inBiome(village, Biome.Desert), structures, 1)!;

    expect(snow.name).not.toBe(desert.name);
    expect(snow.room).not.toBe(desert.room);
    // the local worry is the last thing said; the rest is geography, which does not care about weather
    expect(snow.rumours[snow.rumours.length - 1]).not.toBe(desert.rumours[desert.rumours.length - 1]);
    expect(snow.errand!.intro.join(' ')).not.toBe(desert.errand!.intro.join(' '));
  });

  it('names the neighbours down the road, since that is what a stranger is for', () => {
    const structures = world(2);
    const village = drinking(structures)[0];
    const said = pubTalk(village, structures, 2)!.rumours.join(' ');
    const neighbours = structures.villages.filter((v) => v.name !== village.name);
    expect(neighbours.some((v) => said.includes(v.name))).toBe(true);
  });

  it('keeps a pub only once a village has houses to spare', () => {
    for (const seed of [1, 2, 3]) {
      for (const village of world(seed).villages) {
        expect(village.pub === null, `${village.name} has ${village.houses.length} houses`)
          .toBe(village.houses.length < 4);
        if (village.pub) expect(village.houses).toContain(village.pub.house);
      }
    }
    expect(pubTalk({ ...world(1).villages[0], pub: null }, world(1), 1)).toBeNull();
  });

  it('only ever asks for something the game can check on its own', () => {
    for (const seed of [1, 2, 3]) {
      const structures = world(seed);
      const places = named(structures);
      for (const village of drinking(structures)) {
        const errand = pubTalk(village, structures, seed)!.errand!;
        expect(errand.id).toBe(`pub:${village.name}`);
        expect(errand.reward).toBeGreaterThan(0);
        expect(errand.count).toBeGreaterThan(0);
        if (errand.kind === 'visit') expect(places, `${village.name} sent you to ${errand.target}`).toContain(errand.target);
        else expect(ITEMS[errand.target], `${village.name} wants ${errand.target}`).toBeDefined();
      }
    }
  });

  it('counts an errand done when the world says so and not when you say so', () => {
    const structures = world(1);
    const rooms = drinking(structures).map((v) => pubTalk(v, structures, 1)!.errand!);
    const visit = rooms.find((e) => e.kind === 'visit')!;
    const fetch = rooms.find((e) => e.kind === 'fetch')!;
    const nothing = () => 0;

    expect(errandDone(visit, new Set<string>(), nothing)).toBe(false);
    expect(errandDone(visit, new Set(['somewhere else']), nothing)).toBe(false);
    expect(errandDone(visit, new Set([visit.target]), nothing)).toBe(true);

    expect(errandDone(fetch, new Set<string>(), nothing)).toBe(false);
    expect(errandDone(fetch, new Set<string>(), (id) => (id === fetch.target ? fetch.count - 1 : 99))).toBe(false);
    expect(errandDone(fetch, new Set<string>(), (id) => (id === fetch.target ? fetch.count : 0))).toBe(true);
  });

  it('asks for both kinds of favour: somewhere to go and something to bring', () => {
    const structures = world(1);
    const kinds = new Set(drinking(structures).map((v) => pubTalk(v, structures, 1)!.errand!.kind));
    expect([...kinds].sort()).toEqual(['fetch', 'visit']);
  });
});
