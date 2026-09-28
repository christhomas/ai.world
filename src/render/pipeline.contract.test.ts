import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { RecordingPipeline } from './recording';
import { ThreeFramePipeline, submitGraphFrame } from './pipeline';
import { EntityRenderer } from './entities';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { mulberry32 } from '../core/rng';
import { addPropInstances, disposeInstances } from './instancing';
import { PropLibrary } from './props';
import { PropKind } from '../world/biomes';

describe('engine-owned frame submission', () => {
  const camera = {
    projection: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.002, 0, 0, 0, -1, 1],
    world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1],
    orthographic: true,
  };

  it('feeds one neutral frame to recording and the WebGL adapter', () => {
    const graph = new SceneGraph(0x102030);
    graph.add({ kind: 'ambient', colour: 0xaabbcc, intensity: 0.75 });
    graph.camera = camera;
    const recording = new RecordingPipeline();
    recording.captureNext();
    const render = vi.fn();
    const webgl = new ThreeFramePipeline({ render } as unknown as THREE.WebGLRenderer);

    const frame = submitGraphFrame(graph, [recording, webgl]);

    expect(recording.last).toBe(frame);
    expect(render).toHaveBeenCalledOnce();
    const [scene, drawnCamera] = render.mock.calls[0] as [THREE.Scene, THREE.Camera];
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHex()).toBe(0x102030);
    expect(scene.children[0]).toBeInstanceOf(THREE.AmbientLight);
    expect((scene.children[0] as THREE.AmbientLight).intensity).toBe(0.75);
    expect(drawnCamera.projectionMatrix.toArray()).toEqual(frame.camera.projection);
    expect(drawnCamera.matrixWorld.toArray()).toEqual(frame.camera.world);
  });

  it('records and draws the same instanced prop description', () => {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    const parts = [{ shape: 'box' as const, size: [1, 2, 1], offset: [0, 1, 0] as [number, number, number], color: 0x996633 }];
    const placements = [
      { x: 4, y: 0, z: 6, rot: 0, tint: 0.5 },
      { x: 8, y: 0, z: 9, rot: 1, tint: 0.8 },
    ];
    graph.add({ kind: 'prop-batch', parts, placements, castShadow: true, receiveShadow: true });
    const recorder = new RecordingPipeline();
    recorder.captureNext();
    const render = vi.fn();
    const webgl = new ThreeFramePipeline({ render } as unknown as THREE.WebGLRenderer);
    const frame = submitGraphFrame(graph, [recorder, webgl]);
    expect(recorder.last).toBe(frame);
    expect(frame.nodes[0].parts).toBe(parts);
    expect(frame.nodes[0].placements).toBe(placements);
    const [scene] = render.mock.calls[0] as [THREE.Scene, THREE.Camera];
    const mesh = scene.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(2);
    expect(mesh.castShadow).toBe(true);
    const first = new THREE.Matrix4();
    mesh.getMatrixAt(0, first);
    expect(new THREE.Vector3().setFromMatrixPosition(first).toArray()).toEqual([4, 0, 6]);
    webgl.dispose();
  });

  it('uses graph-owned creature instance buffers for the live adapter and recording', () => {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene, graph);
    const kind = KINDS.sheep;
    const sheep = new Entity(kind, 4, 6, new Herd(kind, 4, 6, 4, 6, 0), 'test', mulberry32(2));
    renderer.add(sheep);
    renderer.update();
    const nodes = graph.nodes.filter((node) => node.kind === 'instances');
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      if (node.kind !== 'instances') continue;
      const mesh = scene.children.find((child) => child instanceof THREE.InstancedMesh
        && child.instanceMatrix.array === node.matrices) as THREE.InstancedMesh | undefined;
      expect(mesh).toBeDefined();
      expect(mesh?.count).toBe(node.count);
    }
    const recorder = new RecordingPipeline();
    recorder.captureNext();
    const render = vi.fn();
    const webgl = new ThreeFramePipeline({ render } as unknown as THREE.WebGLRenderer);
    const frame = submitGraphFrame(graph, [recorder, webgl]);
    expect(recorder.last).toBe(frame);
    expect(frame.nodes.filter((node) => node.kind === 'instances')
      .reduce((total, node) => total + (node.instanceMatrices?.length ?? 0) / 16, 0))
      .toBeGreaterThan(0);
    expect(render).toHaveBeenCalledOnce();
    renderer.dispose();
    webgl.dispose();
  });

  it('registers and retires constructed prop batches with their neutral owner', () => {
    const graph = new SceneGraph(0x102030);
    const group = new THREE.Group();
    const props = new PropLibrary();
    const glow = new THREE.MeshBasicMaterial();
    addPropInstances(group, props, [{ kind: PropKind.CropRipe, x: 1, y: 0, z: 2, rot: 0 }], glow, true, graph);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ kind: 'prop-batch', placements: [{ x: 1, z: 2 }] });
    disposeInstances(group);
    expect(graph.nodes).toHaveLength(0);
    props.dispose();
    glow.dispose();
  });
});
