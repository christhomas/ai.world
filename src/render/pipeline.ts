import * as THREE from 'three';
import type { FrameDescription } from '../core/scene';
import type { SceneGraph } from '../core/scenegraph';
import { applyGraphMounts } from './graphmount';

/** A frame, or the way to describe it for a sink that only sometimes wants one. */
export type FrameSource = FrameDescription | (() => FrameDescription);

export interface FramePipeline { draw(frame: FrameSource): void }

/** The description a sink was handed, worked out now if it was handed the way to work it out. */
const frameOf = (source: FrameSource): FrameDescription =>
  typeof source === 'function' ? source() : source;

/**
 * Submit the engine's one description to every mounted pipeline.
 *
 * It is described when the first sink asks and never otherwise, and every sink that asks gets
 * that one description. A recorder waiting to be armed does not ask, so a record-only frame nobody
 * captures builds nothing. The live mount does ask, every frame.
 *
 * @returns the description, or null when no sink wanted one
 */
export function submitGraphFrame(graph: SceneGraph, sinks: FramePipeline[]): FrameDescription | null {
  let frame: FrameDescription | null = null;
  const describe = (): FrameDescription => (frame ??= graph.frame());
  for (const sink of sinks) sink.draw(describe);
  return frame;
}

/** Retained WebGL mount for the live game while its renderer-owned effects are being migrated. */
export class MountedThreePipeline implements FramePipeline {
  private readonly camera = new THREE.OrthographicCamera();

  constructor(private readonly scene: THREE.Scene,
    private readonly submit: (scene: THREE.Scene, camera: THREE.Camera) => void,
    private readonly graph?: SceneGraph) {
    this.camera.matrixAutoUpdate = false;
  }

  draw(source: FrameSource): void {
    const frame = frameOf(source);
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
    this.submit(this.scene, this.camera);
  }
}
