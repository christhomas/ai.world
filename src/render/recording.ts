import * as THREE from 'three';
import type { FrameDescription } from '../core/scene';
export type { FrameDescription } from '../core/scene';

function describeMaterial(material: THREE.Material): NonNullable<FrameDescription['nodes'][number]['material']> {
  const paint = material as THREE.MeshLambertMaterial;
  return {
    intent: material.userData.intent === 'water' ? 'water'
      : material instanceof THREE.PointsMaterial ? 'points'
      : material instanceof THREE.MeshBasicMaterial ? 'unlit' : 'lit',
    colour: paint.color?.getHex() ?? 0xffffff,
    emissive: paint.emissive?.getHex() ?? 0,
    vertexColours: Boolean(paint.vertexColors),
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    side: material.side === THREE.DoubleSide ? 'double' : material.side === THREE.BackSide ? 'back' : 'front',
    effects: [...(material.userData.effects as string[] | undefined ?? [])],
  };
}

/** Snapshot the scene into plain numbers, including geometry, instances, lights and camera. */
export function describeFrame(scene: THREE.Scene, camera: THREE.Camera): FrameDescription {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const nodes: FrameDescription['nodes'] = [];
  const visit = (object: THREE.Object3D, parent: number): void => {
    let kind: FrameDescription['nodes'][number]['kind'] = 'group';
    if (object instanceof THREE.InstancedMesh) kind = 'instances';
    else if (object instanceof THREE.Points) kind = 'points';
    else if (object instanceof THREE.Mesh) kind = 'mesh';
    else if (object instanceof THREE.DirectionalLight) kind = 'directional';
    else if (object instanceof THREE.HemisphereLight) kind = 'hemisphere';
    else if (object instanceof THREE.AmbientLight) kind = 'ambient';
    else if (object instanceof THREE.PointLight) kind = 'point';
    const node: FrameDescription['nodes'][number] = {
      parent, kind, world: object.matrixWorld.toArray(), visible: object.visible,
      castShadow: object.castShadow, receiveShadow: object.receiveShadow,
    };
    if (object instanceof THREE.Light) {
      node.colour = object.color.getHex();
      node.intensity = object.intensity;
      if (object instanceof THREE.HemisphereLight) node.groundColour = object.groundColor.getHex();
      if (object instanceof THREE.PointLight) { node.distance = object.distance; node.decay = object.decay; }
    }
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      node.material = describeMaterial(material);
      const attributes = (object.geometry as THREE.BufferGeometry).attributes;
      node.attributes = Object.fromEntries(Object.entries(attributes).map(([name, attribute]) => {
        const values: number[] = [];
        for (let i = 0; i < attribute.count; i++) {
          for (let component = 0; component < attribute.itemSize; component++) {
            values.push(attribute.getComponent(i, component));
          }
        }
        return [name, { size: attribute.itemSize, values }];
      }));
      if (object.geometry.index) node.indices = Array.from(object.geometry.index.array);
      if (object instanceof THREE.InstancedMesh) {
        node.instanceMatrices = Array.from(object.instanceMatrix.array.slice(0, object.count * 16));
        if (object.instanceColor) node.instanceColours = Array.from(object.instanceColor.array.slice(0, object.count * 3));
      }
    }
    const own = nodes.push(node) - 1;
    for (const child of object.children) visit(child, own);
  };
  visit(scene, -1);
  return {
    camera: {
      projection: camera.projectionMatrix.toArray(), world: camera.matrixWorld.toArray(),
      orthographic: camera instanceof THREE.OrthographicCamera,
    },
    background: scene.background instanceof THREE.Color ? scene.background.getHex() : null,
    fog: scene.fog instanceof THREE.Fog
      ? { colour: scene.fog.color.getHex(), near: scene.fog.near, far: scene.fog.far } : null,
    nodes,
  };
}

/** Draws nothing; its input is a neutral description, requested only for a chosen frame. */
export class RecordingPipeline {
  frames = 0;
  private armed = false;
  last: FrameDescription | null = null;

  captureNext(): void { this.armed = true; }

  draw(describe: () => FrameDescription): void {
    this.frames++;
    if (!this.armed) return;
    this.last = describe();
    this.armed = false;
  }
}
