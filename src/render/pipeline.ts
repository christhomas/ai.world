import * as THREE from 'three';
import type { FrameDescription } from '../core/scene';
import type { SceneGraph } from '../core/scenegraph';
import { build } from './geometry';
import { composeInstance, shadeOf } from './instancing';

export interface FramePipeline { draw(frame: FrameDescription): void }

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
    private readonly submit: (scene: THREE.Scene, camera: THREE.Camera) => void) {
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
    }
    if (frame.fog) {
      if (!(this.scene.fog instanceof THREE.Fog)) this.scene.fog = new THREE.Fog(frame.fog.colour, frame.fog.near, frame.fog.far);
      this.scene.fog.color.setHex(frame.fog.colour);
      this.scene.fog.near = frame.fog.near;
      this.scene.fog.far = frame.fog.far;
    }
    this.submit(this.scene, this.camera);
  }
}

/** Three's first consumer of the neutral frame contract. */
export class ThreeFramePipeline implements FramePipeline {
  private resources: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor(private readonly renderer: Pick<THREE.WebGLRenderer, 'render'>) {}

  draw(frame: FrameDescription): void {
    for (const resource of this.resources) resource.dispose();
    this.resources = [];
    const scene = new THREE.Scene();
    if (frame.background !== null) scene.background = new THREE.Color(frame.background);
    if (frame.fog) scene.fog = new THREE.Fog(frame.fog.colour, frame.fog.near, frame.fog.far);
    const camera = frame.camera.orthographic ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera();
    camera.projectionMatrix.fromArray(frame.camera.projection);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.matrixAutoUpdate = false;
    camera.matrix.fromArray(frame.camera.world);
    camera.updateMatrixWorld(true);

    const objects: THREE.Object3D[] = [];
    for (const node of frame.nodes) {
      let object: THREE.Object3D;
      if (node.kind === 'ambient') {
        object = new THREE.AmbientLight(node.colour, node.intensity);
      } else if (node.kind === 'hemisphere') {
        object = new THREE.HemisphereLight(node.colour, node.groundColour, node.intensity);
      } else if (node.kind === 'point') {
        object = new THREE.PointLight(node.colour, node.intensity, node.distance, node.decay);
      } else if (node.kind === 'directional') {
        const directional = new THREE.DirectionalLight(node.colour, node.intensity);
        directional.target.position.set(...(node.target ?? [0, 0, 0]));
        scene.add(directional.target);
        object = directional;
      } else if (node.kind === 'prop-batch') {
        const geometry = build(node.parts ?? []);
        const material = new THREE.MeshLambertMaterial({ vertexColors: true });
        const placements = node.placements ?? [];
        const batch = new THREE.InstancedMesh(geometry, material, placements.length);
        const matrix = new THREE.Matrix4();
        placements.forEach((placement, at) => {
          batch.setMatrixAt(at, composeInstance(placement, matrix));
          batch.setColorAt(at, shadeOf(placement.tint ?? 0.5));
        });
        batch.castShadow = node.castShadow;
        batch.receiveShadow = node.receiveShadow;
        this.resources.push(geometry, material);
        if (node.glowParts?.length) {
          const glowGeometry = build(node.glowParts);
          const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
          const glow = new THREE.InstancedMesh(glowGeometry, glowMaterial, placements.length);
          glow.instanceMatrix.copy(batch.instanceMatrix);
          batch.add(glow);
          this.resources.push(glowGeometry, glowMaterial);
        }
        object = batch;
      } else if (node.kind === 'mesh' || node.kind === 'instances' || node.kind === 'points') {
        const geometry = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(node.attributes ?? {})) {
          geometry.setAttribute(name, new THREE.Float32BufferAttribute(attribute.values, attribute.size));
        }
        if (node.indices) geometry.setIndex(Array.from(node.indices));
        geometry.computeBoundingSphere();
        const paint = node.material;
        const material = paint?.intent === 'points'
          ? new THREE.PointsMaterial({ color: paint.colour, size: paint.size ?? 1,
            transparent: paint.transparent, opacity: paint.opacity })
          : paint?.intent === 'unlit'
            ? new THREE.MeshBasicMaterial({ color: paint.colour, vertexColors: paint.vertexColours, transparent: paint.transparent, opacity: paint.opacity })
            : new THREE.MeshLambertMaterial({ color: paint?.colour ?? 0xffffff, vertexColors: paint?.vertexColours ?? false,
              transparent: paint?.transparent ?? false, opacity: paint?.opacity ?? 1 });
        if (paint) {
          material.depthWrite = paint.depthWrite;
          material.side = paint.side === 'double' ? THREE.DoubleSide : paint.side === 'back' ? THREE.BackSide : THREE.FrontSide;
        }
        this.resources.push(geometry, material);
        if (node.kind === 'points') object = new THREE.Points(geometry, material);
        else if (node.kind === 'instances') {
          const count = (node.instanceMatrices?.length ?? 0) / 16;
          const instances = new THREE.InstancedMesh(geometry, material, count);
          if (node.instanceMatrices) instances.instanceMatrix.array.set(node.instanceMatrices);
          if (node.instanceColours) instances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(node.instanceColours), 3);
          object = instances;
        } else object = new THREE.Mesh(geometry, material);
      } else object = new THREE.Group();
      object.visible = node.visible;
      object.renderOrder = node.renderOrder ?? 0;
      object.castShadow = node.castShadow;
      object.receiveShadow = node.receiveShadow;
      object.matrixAutoUpdate = false;
      object.matrix.fromArray(node.world);
      const parent = node.parent < 0 ? scene : objects[node.parent];
      parent.add(object);
      objects.push(object);
    }
    scene.updateMatrixWorld(true);
    this.renderer.render(scene, camera);
  }

  dispose(): void {
    for (const resource of this.resources) resource.dispose();
    this.resources = [];
  }
}
