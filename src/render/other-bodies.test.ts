import { describe, expect, it } from 'vitest';
import { IsoCamera } from './camera';
import type { EntityRenderer } from './entities';
import { OtherBodies } from './other-bodies';

const player = (id: string, over: Partial<{ name: string; place: string; x: number; z: number }> = {}) =>
  ({ id, name: id, place: 'outdoors', x: 0, z: 0, yaw: 0, walk: 0, ...over });

/** An entity renderer that only counts who it was given to draw. */
function drawing() {
  const drawn = new Set<unknown>();
  return { drawn, renderer: { add: (e: unknown) => drawn.add(e), remove: (e: unknown) => drawn.delete(e) } as unknown as EntityRenderer };
}

/**
 * The other players in a shared world, wherever they are drawn (#576): the page hangs their names as
 * DOM labels, an installed app draws them itself, and both are told the same thing here.
 */
describe('the other players in a shared world', () => {
  it('draws whoever the server says is here, and lets go of whoever has left', () => {
    const { drawn, renderer } = drawing();
    const people = new OtherBodies(renderer);
    people.sync([player('ada'), player('bo')], 'outdoors');
    expect(drawn.size).toBe(2);
    people.sync([player('ada')], 'outdoors');
    expect(drawn.size).toBe(1);
    expect([...people.shown().keys()]).toEqual(['ada']);
    people.clear();
    expect(drawn.size).toBe(0);
  });

  it('puts a gesture after a name for as long as it lasts', () => {
    const { renderer } = drawing();
    const people = new OtherBodies(renderer);
    people.emote('ada', '👋');
    people.sync([player('ada', { name: 'Ada' })], 'outdoors');
    expect(people.shown().get('ada')?.text).toBe('Ada 👋');
    people.age(5);
    expect(people.shown().get('ada')?.text).toBe('Ada');
  });

  it('hangs a name over the head of everybody in this place, and nobody elsewhere', () => {
    const { renderer } = drawing();
    const people = new OtherBodies(renderer);
    const camera = new IsoCamera(() => ({ width: 800, height: 400 }));
    people.sync([player('ada', { x: camera.target.x, z: camera.target.z }), player('bo', { place: 'the general store' })], 'outdoors');
    const plates = people.plates(camera, 800, 400);
    expect(plates.map((p) => p.id), 'somebody indoors elsewhere has no plate out here').toEqual(['ada']);
    expect(plates[0].x).toBeCloseTo(400, -1);
    expect(plates[0].y, 'the name is over the head, above where the feet stand').toBeLessThan(200);
  });
});
