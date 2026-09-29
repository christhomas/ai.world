import { describe, expect, it } from 'vitest';
import { SceneGraph } from '../src/core/scenegraph';
import { disposeFlutterFrameGeometry } from '../src/render/flutter-frame';
import { flutterPacket, plainArrays, unsentTo } from './flutter-packet';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * The packet as it is in memory, with its typed arrays turned into plain ones and nothing else.
 *
 * Negative zero is written as zero, because JSON has no way to say it and no renderer draws it
 * differently; box normals are full of them. Every other number has to arrive as itself.
 */
const plain = (value: unknown): unknown => {
  if (ArrayBuffer.isView(value)) return Array.from(value as Float32Array, (n) => (Object.is(n, -0) ? 0 : n));
  if (Object.is(value, -0)) return 0;
  if (Array.isArray(value)) return value.map(plain);
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
};

/** What the phone reads back off the wire. */
const overTheWire = (packet: unknown): unknown => JSON.parse(JSON.stringify(packet, plainArrays));

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

    // The wire is JSON, so the packet has to mean the same once typed arrays are plain ones. A
    // value JSON cannot hold — a NaN, a Map, a hole — comes back as something else and fails here.
    expect(overTheWire(packet)).toEqual(plain(packet));
    disposeFlutterFrameGeometry();
  });

  it('does not say the same thing after JSON when the packet holds a NaN', () => {
    const graph = new SceneGraph(0x204060);
    graph.camera = { orthographic: true, projection: identity, world: identity };
    graph.add({ kind: 'ambient', colour: 0xffffff, intensity: Number.NaN });
    const packet = flutterPacket(graph.frame());
    // JSON writes a NaN as null, so the light the phone reads is not the light that was sent
    expect(Number.isNaN(packet.frame.nodes[0].intensity)).toBe(true);
    expect(overTheWire(packet)).not.toEqual(plain(packet));
    disposeFlutterFrameGeometry();
  });
});
