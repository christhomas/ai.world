import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MountainMaterial, Mountains, buildMountainMesh } from './mountains';
import type { Ranges } from '../world/ranges';

/**
 * The rock standing in the scene, when which rock that is can change.
 *
 * A bounded world builds its mountains once and leaves them there, and nothing about that needed
 * watching. A country with no edge hands the scene a different range every time the hero crosses a
 * patch, and three things have to happen together every time: the old mesh leaves, its geometry is
 * disposed, and the new one is built. Each of those is a different kind of wrong on its own — a
 * mountain range dragged along behind the hero, a few megabytes leaked per crossing until a long
 * walk kills the tab, or a far country that is flat.
 */

/** A range of the shape `buildMountainMesh` wants: whole triangles, nine numbers apiece. */
function rockAt(x: number, height: number): Ranges {
  const tris = new Float32Array([
    x, 0, 0, x + 4, 0, 0, x + 2, height, 2,
    x, 0, 4, x + 4, 0, 4, x + 2, height, 6,
  ]);
  return {
    peaks: [{ x: x + 2, z: 2, y: height, lift: height * 0.5, range: 0 }],
    tris,
    // flat ground here, so every vertex stands as far above it as it does above the sea
    above: Float32Array.from([0, 0, height, 0, 0, height]),
    // one entry per triangle: which peak it belongs to, which the shading reads for its jitter
    owner: Int32Array.from([0, 0]),
    bowl: null,
    index: { minX: x, minZ: 0, cols: 1, rows: 1, starts: Int32Array.from([0, 2]), ids: Int32Array.from([0, 1]) },
  } as unknown as Ranges;
}

const meshesIn = (scene: THREE.Scene): THREE.Mesh[] =>
  scene.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh === true);

describe('the mountains in the scene', () => {
  it('stands rock up when it is given some', () => {
    const scene = new THREE.Scene();
    const hills = new Mountains(scene, new MountainMaterial().material);
    hills.show(rockAt(0, 40));
    expect(meshesIn(scene).length).toBe(1);
  });

  it('takes the old range away when it is given another', () => {
    // the failure this guards: a hero walks east and the mountains of the province behind him come
    // with him, one range at a time, until the sky is a wall
    const scene = new THREE.Scene();
    const hills = new Mountains(scene, new MountainMaterial().material);
    hills.show(rockAt(0, 40));
    const first = meshesIn(scene)[0];
    hills.show(rockAt(600, 55));
    const now = meshesIn(scene);
    expect(now.length, 'two ranges are standing in the same scene').toBe(1);
    expect(now[0], 'the old range is still the one being drawn').not.toBe(first);
  });

  it('disposes what it takes away, or a long walk kills the tab', () => {
    const scene = new THREE.Scene();
    const hills = new Mountains(scene, new MountainMaterial().material);
    hills.show(rockAt(0, 40));
    const first = meshesIn(scene)[0];
    let disposed = false;
    first.geometry.addEventListener('dispose', () => { disposed = true; });
    hills.show(rockAt(600, 55));
    expect(disposed, 'the geometry of the old range was dropped without being disposed').toBe(true);
  });

  it('does nothing at all when handed the same rock twice', () => {
    /*
     * What makes it safe to call on every crossing without asking first. A hero who walks in and
     * out of the same corner would otherwise rebuild a range every few seconds, which is the most
     * expensive thing in the frame happening for no reason.
     */
    const scene = new THREE.Scene();
    const hills = new Mountains(scene, new MountainMaterial().material);
    const rock = rockAt(0, 40);
    hills.show(rock);
    const first = meshesIn(scene)[0];
    hills.show(rock);
    expect(meshesIn(scene)[0], 'the same range was built twice').toBe(first);
  });

  it('empties the scene for a patch with no mountains in it', () => {
    // most of the country is not mountainous, and walking off a range has to leave the sky empty
    const scene = new THREE.Scene();
    const hills = new Mountains(scene, new MountainMaterial().material);
    hills.show(rockAt(0, 40));
    hills.show(null);
    expect(meshesIn(scene).length).toBe(0);
    expect(hills.ranges).toBeNull();
  });

  it('says what it is showing, so everything that has to agree with it can', () => {
    // the chunk manager walks the hero on this rock and the camera stands back from it: three
    // holders of the same fact, and the other two ask this one
    const scene = new THREE.Scene();
    const hills = new Mountains(scene, new MountainMaterial().material);
    const rock = rockAt(0, 40);
    hills.show(rock);
    expect(hills.ranges).toBe(rock);
  });
});

/**
 * How far up its own mountain a face is, which is what decides whether it is rock or snow.
 *
 * The rock of the endless country stands on high ground — `highland.ts` lifts the whole territory
 * before any peak is put on it — so a triangle's height above the sea and its height above the
 * mountain's own foot are two different numbers, and only the second one means anything here. The
 * shading divided the first by the second: absolute world height over the tallest peak's *lift*,
 * which on measured country (ground 12, peak 21) came out at 1.57 and clamped. Everything above
 * about a unit of rock was at the top of the ramp, so `SNOWLINE` — 0.62 of the way up — sat at the
 * mountain's foot and #308's snow line had nothing left to mark.
 */
describe('how far up a mountain a face is', () => {
  /** Two level slabs of the same mountain: one at its foot, one near its summit. */
  const twoSlabs = (): Ranges => ({
    peaks: [{ face: 0, range: 0, x: 0, z: 0, lift: 20, y: 45 }],
    // the country here stands 25 units up, which is the case the old reading could not tell from
    // a mountain that was 25 units tall
    tris: Float32Array.from([
      0, 25.5, 0, 4, 25.5, 0, 2, 25.5, 3,
      20, 44, 0, 24, 44, 0, 22, 44, 3,
    ]),
    above: Float32Array.from([0.5, 0.5, 0.5, 19, 19, 19]),
    owner: Int32Array.from([0, 0]),
    bowl: null,
    index: { minX: 0, minZ: 0, cols: 1, rows: 1, starts: Int32Array.from([0, 2]), ids: Int32Array.from([0, 1]) },
  } as unknown as Ranges);

  it('reads it from the ground the rock stands on, not from the sea', () => {
    const mesh = buildMountainMesh(twoSlabs(), new MountainMaterial().material);
    expect(mesh, 'there is rock to shade').not.toBeNull();
    const colour = (mesh as THREE.Mesh).geometry.getAttribute('color') as THREE.BufferAttribute;
    // both slabs are dead level, so snow can lie on either: what separates them is only how far up
    const foot = colour.getX(0), summit = colour.getX(3);
    expect(summit, 'the summit is under snow').toBeGreaterThan(0.6);
    expect(foot, 'the foot is bare rock rather than snow').toBeLessThan(summit * 0.6);
  });
});
