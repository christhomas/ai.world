import { describe, expect, it } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { expandForFlutter, disposeFlutterFrameGeometry } from './flutter-frame';

describe('Flutter frame adapter', () => {
  it('expands a live graph prop batch into neutral instance geometry without dropping light, coast or cutaway', () => {
    const graph = new SceneGraph(0x204060);
    graph.camera = { orthographic: true,
      projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    graph.coast = { x0: -2, z0: 3, span: 4, size: 2, values: Uint8Array.of(0, 64, 128, 255) };
    graph.cutaway = { enabled: true, hero: [4, 5, 6] };
    graph.add({ kind: 'ambient', colour: 0xffffff, intensity: 0.4 });
    graph.add({ kind: 'prop-batch', parts: [{ shape: 'box', size: [1, 2, 3], offset: [0, 1, 0], color: 0x20a040 }],
      glowParts: [{ shape: 'box', size: [0.2, 0.2, 0.2], offset: [0, 2, 0], color: 0xffffff }],
      glowColour: 0xffcc88, placements: [{ x: 7, y: 1, z: 9, rot: 0, tint: 0.6 }],
      castShadow: true, receiveShadow: true });
    const source = graph.frame();
    const frame = expandForFlutter(source);
    expect(source.nodes[1].kind).toBe('prop-batch');
    expect(frame.nodes.map((node) => node.kind)).toEqual(['ambient', 'instances', 'instances']);
    expect(frame.nodes[1].attributes?.position.values.length).toBeGreaterThan(0);
    expect(frame.nodes[1].instanceMatrices?.length).toBe(16);
    expect(frame.nodes[1].material?.effects).toContain('cutaway');
    expect(frame.nodes[2].material).toMatchObject({ intent: 'unlit', colour: 0xffcc88 });
    expect(frame.coast?.values).toEqual(Uint8Array.of(0, 64, 128, 255));
    expect(frame.cutaway).toEqual({ enabled: true, hero: [4, 5, 6] });
    disposeFlutterFrameGeometry();
  });
});
