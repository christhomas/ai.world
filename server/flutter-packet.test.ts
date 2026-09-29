import { describe, expect, it } from 'vitest';
import { SceneGraph } from '../src/core/scenegraph';
import { disposeFlutterFrameGeometry } from '../src/render/flutter-frame';
import { flutterPacket, plainArrays, unsentTo } from './flutter-packet';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('what the Flutter feed sends', () => {
  it('names each geometry by digest, sends it once per client, and says the same thing after JSON', () => {
    const graph = new SceneGraph(0x204060);
    graph.camera = { orthographic: true, projection: identity, world: identity };
    graph.add({ kind: 'ambient', colour: 0xffffff, intensity: 0.4 });
    graph.add({ kind: 'mesh', material: 'water', geometry: {
      positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1),
      normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
      indices: Uint32Array.of(0, 1, 2),
    }, receiveShadow: true });
    graph.add({ kind: 'prop-batch', parts: [{ shape: 'box', size: [1, 2, 3], offset: [0, 1, 0], color: 0x20a040 }],
      placements: [{ x: 7, y: 1, z: 9, rot: 0, tint: 0.6 }], castShadow: true, receiveShadow: true });
    const packet = flutterPacket(graph.frame());
    const named = packet.frame.nodes.flatMap((node) => (node.geometryId ? [node.geometryId as string] : []));
    expect(named).toHaveLength(2);
    expect(Object.keys(packet.geometries).sort()).toEqual([...named].sort());
    expect(packet.frame.nodes.every((node) => node.attributes === undefined)).toBe(true);

    const known = new Set<string>();
    expect(Object.keys(unsentTo(packet, known).geometries)).toHaveLength(2);
    expect(unsentTo(packet, known).geometries).toEqual({});

    // The wire is JSON, so the packet has to mean the same once typed arrays are plain ones.
    const wire = JSON.stringify(packet, plainArrays);
    expect(JSON.stringify(JSON.parse(wire))).toBe(wire);
    disposeFlutterFrameGeometry();
  });
});
