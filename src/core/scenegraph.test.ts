import { describe, expect, it } from 'vitest';
import { SceneGraph, type SceneNode } from './scenegraph';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const triangle = (): SceneNode => ({ kind: 'mesh', material: 'lit-solid', receiveShadow: false, geometry: {
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1),
  normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
} });

/*
 * A native renderer keeps what it has baked under the node's id. When that id was the node's place
 * in the frame, a chunk unloading from the middle renamed everything after it and every later mesh
 * was baked and sent again (#490). The id is the node's own, from the moment it is added.
 */
describe('scene node ids', () => {
  it('names each node once, keeps the name while others come and go, and never hands one out twice', () => {
    const graph = new SceneGraph(0);
    graph.camera = { orthographic: true, projection: identity, world: identity };
    const nodes = [graph.add({ kind: 'ambient', colour: 0xffffff, intensity: 1 }), graph.add(triangle()),
      graph.add(triangle()), graph.add(triangle())];
    const first = graph.frame().nodes.map((node) => node.id);
    expect(new Set(first).size).toBe(4);
    expect(graph.frame().nodes.map((node) => node.id)).toEqual(first);

    // the middle goes, as a chunk unloading does: what follows it keeps its name
    graph.remove(nodes[1]);
    expect(graph.frame().nodes.map((node) => node.id)).toEqual([first[0], first[2], first[3]]);

    // and whatever arrives next is new, even where the one that left used to be
    graph.add(triangle());
    const later = graph.frame().nodes.map((node) => node.id);
    expect(later.slice(0, 3)).toEqual([first[0], first[2], first[3]]);
    expect(first).not.toContain(later[3]);

    // a second graph — an interior beside the country — does not reuse the country's names
    const other = new SceneGraph(0);
    other.camera = graph.camera;
    other.add(triangle());
    expect(later).not.toContain(other.frame().nodes[0].id);
  });

  it('refuses a node put into the list without being added, which would have no name', () => {
    const graph = new SceneGraph(0);
    graph.camera = { orthographic: true, projection: identity, world: identity };
    graph.nodes.push(triangle());
    expect(() => graph.frame()).toThrow(/SceneGraph\.add/);
  });
});
