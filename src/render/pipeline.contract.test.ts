import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { RecordingPipeline } from './recording';
import { ThreeFramePipeline, submitGraphFrame } from './pipeline';

describe('engine-owned frame submission', () => {
  it('feeds one neutral frame to recording and the WebGL adapter', () => {
    const graph = new SceneGraph(0x102030);
    graph.add({ kind: 'ambient', colour: 0xaabbcc, intensity: 0.75 });
    graph.camera = {
      projection: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.002, 0, 0, 0, -1, 1],
      world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1],
      orthographic: true,
    };
    const recording = new RecordingPipeline();
    recording.captureNext();
    const render = vi.fn();
    const webgl = new ThreeFramePipeline({ render } as unknown as THREE.WebGLRenderer);

    const frame = submitGraphFrame(graph, [recording, webgl]);

    expect(recording.last).toBe(frame);
    expect(render).toHaveBeenCalledOnce();
    const [scene, camera] = render.mock.calls[0] as [THREE.Scene, THREE.Camera];
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHex()).toBe(0x102030);
    expect(scene.children[0]).toBeInstanceOf(THREE.AmbientLight);
    expect((scene.children[0] as THREE.AmbientLight).intensity).toBe(0.75);
    expect(camera.projectionMatrix.toArray()).toEqual(frame.camera.projection);
    expect(camera.matrixWorld.toArray()).toEqual(frame.camera.world);
  });
});
