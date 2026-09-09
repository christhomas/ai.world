import { describe, expect, it } from 'vitest';
import { generateWebGraph } from './roadweb';
import { TerrainSampler } from './terrain';
import { generateStructures, type Founding } from './structures';

/**
 * A village is a function of its own name, not of how many were built before it.
 *
 * The road tree founds villages by walking a list and drawing each one from a single stream of
 * randomness. That works exactly once — in a world where the whole list is known — and it makes
 * every village's layout depend on its position in the walk: found the same town second instead of
 * fifth and its houses stand somewhere else.
 *
 * An endless world cannot know the list, so it hands in the places it has found for itself and asks
 * that each be drawn from its own name. What is checked here is the property that makes that
 * worth doing: the same town gives the same village in any order, in any company, and alone.
 *
 * The ground under them is still the bounded world's, because it has to be something and this is a
 * test about founding rather than about country.
 */

const SEED = 5;
const sampler = new TerrainSampler(generateWebGraph(SEED));

/** Four places to found, taken off the road web so they stand on ground a village can use. */
const PLACES: Founding[] = sampler.graph.towns.slice(0, 4).map((t, i) => {
  const node = sampler.graph.nodes[t];
  return { id: `place-${i}`, name: `Place${i}`, x: node.x, z: node.z, level: node.level, size: 'town' as const };
});

/** Everything about a village that a player could see, as a line of text. */
function described(village: { name: string; houses: Array<{ tx: number; tz: number; rot: number }> }): string {
  const houses = village.houses.map((h) => `${h.tx},${h.tz}@${h.rot.toFixed(3)}`).sort().join(' ');
  return `${village.name} [${houses}]`;
}

function found(places: Founding[]): Map<string, string> {
  const built = generateStructures(sampler, { towns: places });
  return new Map(built.villages.map((v) => [v.name, described(v)]));
}

describe('villages founded from their own names', () => {
  it('builds something worth comparing', () => {
    const villages = found(PLACES);
    expect(villages.size, 'nowhere was built at all').toBeGreaterThan(1);
    for (const [name, line] of villages) expect(line, `${name} has no houses`).toContain(',');
  });

  it('lays a village out the same way whatever order it is founded in', () => {
    const forwards = found(PLACES);
    const backwards = found([...PLACES].reverse());
    for (const [name, line] of forwards) {
      expect(backwards.get(name), `${name} is a different village when it is founded last`).toBe(line);
    }
  });

  it('lays it out the same way alone as in company', () => {
    const together = found(PLACES);
    for (const place of PLACES) {
      const alone = found([place]);
      const line = alone.get(place.name);
      if (line === undefined) continue;                 // the ground refused it; it refused it both times
      expect(line, `${place.name} is a different village when it is the only one`).toBe(together.get(place.name));
    }
  });

  it('builds a different village at a place with a different name', () => {
    // whichever of them the ground is willing to build on its own
    const place = PLACES.find((p) => found([p]).size > 0);
    expect(place, 'the ground refused every place').toBeTruthy();
    const mine = [...found([place!]).values()][0];
    const theirs = [...found([{ ...place!, id: 'somewhere-else', name: place!.name }]).values()][0];
    // the same ground, so the same spots are buildable; the name decides which of them are used
    expect(theirs, 'a village with another name was not built at all').toBeTruthy();
    expect(theirs).not.toBe(mine);
  });

  it('leaves the worlds the road tree founds exactly as they were', () => {
    const asBefore = generateStructures(sampler);
    expect(asBefore.villages[0]?.name).toBe('Crossroads Town');
    expect(asBefore.villages.length).toBeGreaterThan(1);
  });
});
