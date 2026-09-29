import * as THREE from 'three';
import type { FrameDescription } from '../core/scene';
import type { LightColour, SceneGraph, SceneNode } from '../core/scenegraph';

type FrameNode = FrameDescription['nodes'][number];
type Mount = (frame: FrameNode) => void;
const mounts = new WeakMap<SceneGraph, Map<SceneNode, Mount>>();
const parentInverse = new THREE.Matrix4();

/** Keep each retained WebGL object attached to the neutral node that owns its next frame. */
export function bindGraphMount(graph: SceneGraph, node: SceneNode, apply: Mount): () => void {
  let mounted = mounts.get(graph);
  if (!mounted) { mounted = new Map(); mounts.set(graph, mounted); }
  if (mounted.has(node)) throw new Error('neutral node already has a WebGL mount');
  mounted.set(node, apply);
  return () => { if (mounted?.get(node) === apply) mounted.delete(node); };
}

/** Apply exactly the frame submitted to recording before issuing the live WebGL draw. */
export function applyGraphMounts(graph: SceneGraph, frame: FrameDescription): void {
  const mounted = mounts.get(graph);
  if (!mounted) return;
  if (graph.nodes.length !== frame.nodes.length) throw new Error('graph changed during frame submission');
  graph.nodes.forEach((node, at) => mounted.get(node)?.(frame.nodes[at]));
}

/** A light colour as three.js holds it: a hex is sRGB, a triple is already linear and unclamped. */
export function lightColourOf(colour: LightColour, into = new THREE.Color()): THREE.Color {
  return typeof colour === 'number' ? into.setHex(colour) : into.setRGB(colour[0], colour[1], colour[2]);
}

type LightNode = Extract<SceneNode, { kind: 'ambient' | 'hemisphere' | 'point' | 'directional' }>;

/**
 * Keep a retained WebGL light on its neutral node.
 *
 * The frame's linear channels are preferred to its hex: the hex is clamped, and a computed light —
 * the seasonal sun — can be warmer than a hex can say.
 */
export function bindLightMount(graph: SceneGraph, node: LightNode, light: THREE.Light): () => void {
  return bindGraphMount(graph, node, (frame) => {
    lightColourOf(frame.linearColour ?? frame.colour ?? 0xffffff, light.color);
    light.intensity = frame.intensity ?? 0;
    if (light instanceof THREE.HemisphereLight) {
      lightColourOf(frame.linearGroundColour ?? frame.groundColour ?? 0xffffff, light.groundColor);
    }
    if (light instanceof THREE.PointLight) {
      light.distance = frame.distance ?? 0;
      light.decay = frame.decay ?? 2;
    }
    if (light instanceof THREE.PointLight || light instanceof THREE.DirectionalLight) {
      light.position.set(frame.world[12], frame.world[13], frame.world[14]);
    }
    if (light instanceof THREE.DirectionalLight) {
      light.target.position.set(...(frame.target ?? [0, 0, 0]));
      light.castShadow = frame.castShadow;
    }
  });
}

/** Whether everything the object hangs from is shown. */
function shownAbove(object: THREE.Object3D): boolean {
  for (let parent = object.parent; parent; parent = parent.parent) if (!parent.visible) return false;
  return true;
}

export function applyMeshFrame(mesh: THREE.Mesh, frame: FrameNode): void {
  // The frame says whether the mesh is drawn at all, parents included. Under a hidden parent it is
  // not drawn whatever its own flag says, so that flag is left as its producer set it — the same
  // way the pose below is taken back relative to the parent. Writing the composed answer into it
  // kept every pooled camp's tent hidden after the camp itself was shown again.
  if (frame.visible || shownAbove(mesh)) mesh.visible = frame.visible;
  mesh.castShadow = frame.castShadow;
  mesh.receiveShadow = frame.receiveShadow;
  mesh.renderOrder = frame.renderOrder ?? 0;
  const authoredPose = mesh.matrixAutoUpdate;
  mesh.matrix.fromArray(frame.world);
  if (mesh.parent) {
    mesh.parent.updateWorldMatrix(true, false);
    parentInverse.copy(mesh.parent.matrixWorld).invert();
    mesh.matrix.premultiply(parentInverse);
  }
  // Retained producers that animate position/rotation/scale need those values updated as well;
  // forcing matrixAutoUpdate off would freeze their next pose before it reached the graph.
  if (authoredPose) mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.updateMatrixWorld(true);
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const paint = frame.material;
  if (!paint || !(material instanceof THREE.MeshBasicMaterial || material instanceof THREE.MeshLambertMaterial)) return;
  material.color.setHex(paint.colour);
  material.transparent = paint.transparent;
  material.opacity = paint.opacity;
  material.depthWrite = paint.depthWrite;
  material.depthTest = paint.depthTest ?? true;
  material.toneMapped = paint.toneMapped ?? true;
  material.side = paint.side === 'double' ? THREE.DoubleSide : paint.side === 'back' ? THREE.BackSide : THREE.FrontSide;
  material.blending = paint.effects.includes('additive-blending') ? THREE.AdditiveBlending : THREE.NormalBlending;
  if (material instanceof THREE.MeshLambertMaterial) {
    material.flatShading = paint.effects.includes('flat-shading');
    material.emissive.setHex(paint.emissive);
  }
}

/**
 * Whether a frame's instance values are already in the attribute: a view of its own array.
 *
 * The frame carries `subarray` views, which are never the attribute's array object however much
 * of it they share. Compared by identity, every pool was marked for upload on every draw — and an
 * empty pool, with no update ranges, sends its whole buffer.
 */
function alreadyIn(values: ArrayLike<number>, attribute: THREE.BufferAttribute): boolean {
  const own = attribute.array;
  return ArrayBuffer.isView(values) && values.buffer === own.buffer && values.byteOffset === own.byteOffset;
}

export function applyInstanceFrame(mesh: THREE.InstancedMesh, frame: FrameNode): void {
  applyMeshFrame(mesh, frame);
  const matrices = frame.instanceMatrices;
  mesh.count = (matrices?.length ?? 0) / 16;
  if (matrices && !alreadyIn(matrices, mesh.instanceMatrix)) {
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;
  }
  if (frame.instanceColours && mesh.instanceColor && !alreadyIn(frame.instanceColours, mesh.instanceColor)) {
    mesh.instanceColor.array.set(frame.instanceColours);
    mesh.instanceColor.needsUpdate = true;
  }
}
