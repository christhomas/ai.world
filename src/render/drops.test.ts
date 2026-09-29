import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DropField, dropsFor } from './drops';
import { SceneGraph } from '../core/scenegraph';

/**
 * What you can see is what you would pick up.
 *
 * Everything lying in the grass used to be the same rolled bundle: a dead deer with its hide still
 * on, a purse of coin and a hunter's pack were one brown object, and the only way to find out which
 * was to walk over and press a key. In a game played by looking, that is the world lying about
 * itself.
 */
describe('what is lying in the grass', () => {
  it('draws a body as a body, in the colour of what fell', () => {
    const [drop] = dropsFor([{ x: 3, z: 4, kind: 'fox' }], []);
    expect(drop).toEqual({ x: 3, z: 4, kind: 'carcass', of: 'fox' });
  });

  it('draws a purse as coin, and a pack with things in it as a pack', () => {
    const drops = dropsFor([], [
      { x: 0, z: 0, gold: 40, items: [] },
      { x: 1, z: 1, gold: 4, items: ['bread', 'rope'] },
    ]);
    expect(drops.map((d) => d.kind)).toEqual(['gold', 'pack']);
  });

  it('draws a pack carrying a pelt as a hide, which is the thing worth walking over for', () => {
    const drops = dropsFor([], [{ x: 2, z: 2, gold: 0, items: ['pelt'] }]);
    expect(drops[0].kind).toBe('hide');
  });

  it('has nothing to say about an empty field', () => {
    expect(dropsFor([], [])).toEqual([]);
  });

  it('publishes pooled drop geometry, poses, visibility, and fur colour to the neutral graph', () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraph(0);
    const field = new DropField(scene, graph);
    const meshes = graph.nodes.filter((node) => node.kind === 'mesh');
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((node) => node.kind === 'mesh' && node.visible === false)).toBe(true);

    field.update([{ x: 3, z: 4, kind: 'carcass', of: 'fox' }], () => 2);
    const active = graph.nodes.filter((node) => node.kind === 'mesh' && node.visible);
    expect(active.length).toBeGreaterThan(0);
    expect(active[0]).toMatchObject({ kind: 'mesh' });
    if (active[0].kind === 'mesh') {
      expect(active[0].world?.[12]).toBeCloseTo(3);
      expect(active[0].world?.[13]).toBeCloseTo(2.26);
      expect(active[0].world?.[14]).toBeCloseTo(4);
    }
    expect(active.some((node) => node.kind === 'mesh' && node.colour === 0xb4622c)).toBe(true);

    field.update([], () => 0);
    expect(graph.nodes.filter((node) => node.kind === 'mesh' && node.visible)).toHaveLength(0);
    field.dispose();
    expect(graph.nodes).toHaveLength(0);
  });
});
