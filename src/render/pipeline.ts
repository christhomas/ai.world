import * as THREE from 'three';
import type { FrameDescription } from '../core/scene';
import type { SceneGraph } from '../core/scenegraph';
import { applyGraphMounts } from './graphmount';

export interface FramePipeline { draw(frame: FrameDescription): void }

/** Something WebGL keeps outside any one node and sets from each frame as a whole: a uniform, say. */
export type FrameMount = (frame: FrameDescription) => void;

/** Submit the engine's one description to every mounted pipeline. */
export function submitGraphFrame(graph: SceneGraph, sinks: FramePipeline[]): FrameDescription {
  const frame = graph.frame();
  for (const sink of sinks) sink.draw(frame);
  return frame;
}

/** Retained WebGL mount for the live game while its renderer-owned effects are being migrated. */
export class MountedThreePipeline implements FramePipeline {
  private readonly camera = new THREE.OrthographicCamera();

  constructor(private readonly scene: THREE.Scene,
    private readonly submit: (scene: THREE.Scene, camera: THREE.Camera) => void,
    private readonly graph?: SceneGraph,
    private readonly frameMounts: readonly FrameMount[] = []) {
    this.camera.matrixAutoUpdate = false;
  }

  draw(frame: FrameDescription): void {
    if (!frame.camera.orthographic) throw new Error('the live world needs an orthographic camera');
    this.camera.projectionMatrix.fromArray(frame.camera.projection);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.matrix.fromArray(frame.camera.world);
    this.camera.updateMatrixWorld(true);
    if (frame.background !== null) {
      if (!(this.scene.background instanceof THREE.Color)) this.scene.background = new THREE.Color();
      this.scene.background.setHex(frame.background);
    } else this.scene.background = null;
    if (frame.fog) {
      if (!(this.scene.fog instanceof THREE.Fog)) this.scene.fog = new THREE.Fog(frame.fog.colour, frame.fog.near, frame.fog.far);
      this.scene.fog.color.setHex(frame.fog.colour);
      this.scene.fog.near = frame.fog.near;
      this.scene.fog.far = frame.fog.far;
    } else this.scene.fog = null;
    if (this.graph) applyGraphMounts(this.graph, frame);
    for (const mount of this.frameMounts) mount(frame);
    this.submit(this.scene, this.camera);
  }
}
