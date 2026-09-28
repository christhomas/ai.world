import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { describeFrame, RecordingPipeline } from './recording';

describe('recording pipeline', () => {
  it('receives plain mesh, instance, material, light and camera data', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xabcdef, 0.7));
    const geometry = new THREE.BoxGeometry(1, 2, 3);
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    material.userData.effects = ['season', 'cutaway'];
    const mesh = new THREE.InstancedMesh(geometry, material, 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3, 4, 5));
    mesh.count = 1;
    scene.add(mesh);
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
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
    expect(frame.nodes.find((node) => node.kind === 'ambient')).toMatchObject({ colour: 0xabcdef, intensity: 0.7 });
    const recorded = frame.nodes.find((node) => node.kind === 'instances')!;
    expect(recorded.attributes?.position.size).toBe(3);
    expect(recorded.instanceMatrices).toHaveLength(16);
    expect(recorded.material?.effects).toEqual(['season', 'cutaway']);
    expect(JSON.parse(JSON.stringify(frame)).nodes.some((node: { isObject3D?: boolean }) => node.isObject3D)).toBe(false);
  });
});
