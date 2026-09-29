import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { RecordingPipeline } from './recording';
import { MountedThreePipeline, submitGraphFrame } from './pipeline';
import { ThreeFramePipeline } from './three-frame.test.support';
import { EntityRenderer } from './entities';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { mulberry32 } from '../core/rng';
import { PropBatch, addPropInstances, disposeInstances } from './instancing';
import { PropLibrary } from './props';
import { PropKind } from '../world/biomes';
import { applyMeshFrame, bindGraphMount } from './graphmount';
import { ModelGraph } from './modelgraph';

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

    expect(recording.last).toEqual(frame);
    expect(render).toHaveBeenCalledOnce();
    const [scene, drawnCamera] = render.mock.calls[0] as [THREE.Scene, THREE.Camera];
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHex()).toBe(0x102030);
    expect(scene.children[0]).toBeInstanceOf(THREE.AmbientLight);
    expect((scene.children[0] as THREE.AmbientLight).intensity).toBe(0.75);
    expect(drawnCamera.projectionMatrix.toArray()).toEqual(frame.camera.projection);
    expect(drawnCamera.matrixWorld.toArray()).toEqual(frame.camera.world);
  });

  it('passes large geometry through without copying it for each frame', () => {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1);
    graph.add({ kind: 'mesh', material: 'lit-vertex-colours', receiveShadow: true,
      geometry: { positions, normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
        colors: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1) } });
    expect(graph.frame().nodes[0].attributes?.position.values).toBe(positions);
    expect(graph.frame().nodes[0].attributes?.position.values).toBe(positions);
  });

  it('submits the graph frame to the live mount with its numeric camera', () => {
    const graph = new SceneGraph(0x1f3245);
    graph.camera = camera;
    const scene = new THREE.Scene();
    const draw = vi.fn();
    const mounted = new MountedThreePipeline(scene, draw);
    const recording = new RecordingPipeline();
    recording.captureNext();
    const frame = submitGraphFrame(graph, [mounted, recording]);
    const [drawnScene, drawnCamera] = draw.mock.calls[0] as [THREE.Scene, THREE.Camera];
    expect(drawnScene).toBe(scene);
    expect((scene.background as THREE.Color).getHex()).toBe(frame.background);
    expect(drawnCamera.matrixWorld.toArray()).toEqual(frame.camera.world);
    expect(drawnCamera.projectionMatrix.toArray()).toEqual(frame.camera.projection);
    expect(recording.last).toEqual(frame);
  });

  it('lets the neutral frame move and hide a retained WebGL mesh', () => {
    const graph = new SceneGraph(0);
    graph.camera = camera;
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    scene.add(mesh);
    const node = graph.add({ kind: 'mesh', material: 'lit-solid', colour: 0x2277aa,
      geometry: { positions: geometry.getAttribute('position').array as Float32Array,
        normals: geometry.getAttribute('normal').array as Float32Array },
      receiveShadow: true, world: new THREE.Matrix4().makeTranslation(8, 3, -2).toArray(),
      visible: false });
    const detach = bindGraphMount(graph, node, (frameNode) => applyMeshFrame(mesh, frameNode));
    const draw = vi.fn();
    const mounted = new MountedThreePipeline(scene, draw, graph);
    submitGraphFrame(graph, [mounted]);
    expect(mesh.position.toArray()).toEqual([8, 3, -2]);
    expect(mesh.matrixWorld.elements.slice(12, 15)).toEqual([8, 3, -2]);
    expect(mesh.visible).toBe(false);
    expect((mesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0x2277aa);
    expect(draw).toHaveBeenCalledOnce();
    detach();
    geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it('keeps a retained model animated after applying its graph frame', () => {
    const graph = new SceneGraph(0);
    graph.camera = camera;
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.position.x = 5;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());
    mesh.position.x = 1;
    root.add(mesh);
    scene.add(root);
    const model = new ModelGraph(root, graph);
    const mounted = new MountedThreePipeline(scene, () => {}, graph);
    mounted.draw(graph.frame());
    expect(mesh.matrixAutoUpdate).toBe(true);
    mesh.position.x = 3;
    model.sync();
    const node = graph.nodes[0];
    expect(node.kind === 'mesh' && node.world?.[12]).toBe(8);
    model.dispose();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it('records and draws the same instanced prop description', () => {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    const parts = [{ shape: 'box' as const, size: [1, 2, 1], offset: [0, 1, 0] as [number, number, number], color: 0x996633 }];
    const placements = [
      { x: 4, y: 0, z: 6, rot: 0, tint: 0.5 },
      { x: 8, y: 0, z: 9, rot: 1, tint: 0.8 },
    ];
    graph.add({ kind: 'prop-batch', parts, glowParts: parts, glowColour: 0xffaabb,
      placements, castShadow: true, receiveShadow: true });
    const recorder = new RecordingPipeline();
    recorder.captureNext();
    const render = vi.fn();
    const webgl = new ThreeFramePipeline({ render } as unknown as THREE.WebGLRenderer);
    const frame = submitGraphFrame(graph, [recorder, webgl]);
    expect(recorder.last).toEqual(frame);
    expect(frame.nodes[0].parts).toBe(parts);
    expect(frame.nodes[0].placements).toBe(placements);
    const [scene] = render.mock.calls[0] as [THREE.Scene, THREE.Camera];
    const mesh = scene.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(2);
    expect(mesh.castShadow).toBe(true);
    expect((mesh.children[0] as THREE.InstancedMesh).material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(((mesh.children[0] as THREE.InstancedMesh).material as THREE.MeshBasicMaterial).color.getHex())
      .toBe(0xffaabb);
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
    expect(recorder.last).toEqual(frame);
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

  it('re-packs streamed world props from the submitted neutral frame', () => {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    const scene = new THREE.Scene();
    const props = new PropLibrary();
    const glow = new THREE.MeshBasicMaterial();
    const batch = new PropBatch(scene, props, glow, graph);
    batch.set('chunk', [{ kind: PropKind.CropRipe, x: 1, y: 0, z: 2, rot: 0 }]);
    batch.update();
    const node = graph.nodes[0];
    if (node.kind !== 'prop-batch') throw new Error('missing streamed prop node');
    node.placements = [{ x: 8, y: 0, z: 9, rot: 0 }];

    new MountedThreePipeline(scene, () => {}, graph).draw(graph.frame());

    let mesh: THREE.InstancedMesh | undefined;
    scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh && object.geometry === props.geometries.get(PropKind.CropRipe)) mesh = object;
    });
    expect(mesh).toBeDefined();
    const matrix = new THREE.Matrix4();
    mesh!.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([8, 0, 9]);
    batch.dispose();
    props.dispose();
    glow.dispose();
  });

  it('keeps the night glow when a batch with no windows is drawn after the ones that have them', () => {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    const scene = new THREE.Scene();
    const props = new PropLibrary();
    const glow = new THREE.MeshBasicMaterial({ color: 0x9fd4ef });
    const batch = new PropBatch(scene, props, glow, graph);
    // the windows arrive first and the trees after them, both while it is still day
    batch.set('village', [{ kind: PropKind.GreatHearth, x: 1, y: 0, z: 2, rot: 0 }]);
    batch.set('wood', [{ kind: PropKind.Oak, x: 4, y: 0, z: 4, rot: 0 }]);
    batch.update();
    // then night falls, the way the day cycle says it has
    glow.color.setHex(0xffc45a);
    for (const node of graph.nodes) {
      if (node.kind === 'prop-batch' && node.glowParts?.length) node.glowColour = 0xffc45a;
    }
    expect(graph.nodes.filter((node) => node.kind === 'prop-batch')).toHaveLength(2);

    new MountedThreePipeline(scene, () => {}, graph).draw(graph.frame());

    expect(glow.color.getHex()).toBe(0xffc45a);
    batch.dispose();
    props.dispose();
    glow.dispose();
  });

  it('lets the neutral frame recolour retained prop glows', () => {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    const scene = new THREE.Scene();
    const props = new PropLibrary();
    const glow = new THREE.MeshBasicMaterial({ color: 0x335577 });
    addPropInstances(scene, props,
      [{ kind: PropKind.GreatHearth, x: 1, y: 0, z: 2, rot: 0 }], glow, true, graph);
    const node = graph.nodes[0];
    if (node.kind !== 'prop-batch') throw new Error('missing glowing prop node');
    expect(node.glowColour).toBe(0x335577);
    node.glowColour = 0xffaa44;
    new MountedThreePipeline(scene, () => {}, graph).draw(graph.frame());
    expect(glow.color.getHex()).toBe(0xffaa44);
    disposeInstances(scene);
    props.dispose();
    glow.dispose();
  });
});
