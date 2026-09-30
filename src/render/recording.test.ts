import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RecordingPipeline } from './recording';
import { describeFrame } from './recording.test.support';
import { ThreeFramePipeline } from './three-frame.test.support';

describe('recording pipeline', () => {
  it('receives plain mesh, instance, material, light and camera data', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xabcdef, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(4, 8, 2);
    sun.target.position.set(-2, 0, 3);
    scene.add(sun, sun.target);
    const geometry = new THREE.BoxGeometry(1, 2, 3);
    geometry.clearGroups();
    geometry.addGroup(0, 18, 0);
    geometry.addGroup(18, 18, 1);
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    material.userData.effects = ['season', 'cutaway'];
    const material2 = new THREE.MeshLambertMaterial({ color: 0x123456 });
    const mesh = new THREE.InstancedMesh(geometry, [material, material2], 2);
    mesh.layers.set(1);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3, 4, 5));
    mesh.count = 1;
    scene.add(mesh);
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    camera.layers.set(1);
    camera.position.set(5, 10, 5);
    camera.lookAt(0, 0, 0);

    const pipeline = new RecordingPipeline();
    pipeline.draw(() => describeFrame(scene, camera));
    expect(pipeline.frames).toBe(1);
    expect(pipeline.last).toBeNull();
    pipeline.captureNext();
    pipeline.draw(() => describeFrame(scene, camera));
    const frame = pipeline.last!;
    expect(frame.camera.orthographic).toBe(true);
    expect(frame.camera.layers).toBe(2);
    expect(frame.nodes.find((node) => node.kind === 'ambient')).toMatchObject({ colour: 0xabcdef, intensity: 0.7 });
    expect(frame.nodes.find((node) => node.kind === 'directional')?.target).toEqual([-2, 0, 3]);
    const recorded = frame.nodes.find((node) => node.kind === 'instances')!;
    expect(recorded.attributes?.position.size).toBe(3);
    expect(recorded.instanceMatrices).toHaveLength(16);
    expect(recorded.material?.effects).toEqual(['season', 'cutaway']);
    expect(recorded.layers).toBe(2);
    expect(recorded.materials).toHaveLength(2);
    expect(recorded.groups).toEqual([{ start: 0, count: 18, materialIndex: 0 }, { start: 18, count: 18, materialIndex: 1 }]);
    expect(JSON.parse(JSON.stringify(frame)).nodes.some((node: { isObject3D?: boolean }) => node.isObject3D)).toBe(false);
  });

  /**
   * The recorder and a renderer have to agree on which field says where the sun points. They once
   * did not: the recorder wrote a field no renderer read, and a recorded sun came back aimed at the
   * origin (#521).
   */
  it('hands a renderer a sun that still points where it pointed', () => {
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(4, 8, 2);
    sun.target.position.set(-2, 0, 3);
    scene.add(sun, sun.target);
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    const render = vi.fn();

    new ThreeFramePipeline({ render } as unknown as THREE.WebGLRenderer).draw(() => describeFrame(scene, camera));

    const [drawn] = render.mock.calls[0] as [THREE.Scene];
    let mounted: THREE.DirectionalLight | undefined;
    drawn.traverse((object) => { if (object instanceof THREE.DirectionalLight) mounted = object; });
    expect(mounted, 'the recorded sun was mounted').toBeInstanceOf(THREE.DirectionalLight);
    expect(mounted!.target.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([-2, 0, 3]);
  });
});
