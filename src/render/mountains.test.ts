import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MountainMaterial, Mountains } from './mountains';
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
