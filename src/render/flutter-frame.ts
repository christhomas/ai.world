import * as THREE from 'three';
import type { FrameDescription } from '../core/scene';
import { build } from './geometry';
import { composeInstance, shadeOf } from './instancing';

/** Expand the game-owned prop catalogue into geometry/instance primitives for Flutter. */
const cache = new Map<string, THREE.BufferGeometry>();
export function disposeFlutterFrameGeometry(): void {
  for (const shape of cache.values()) shape.dispose();
  cache.clear();
}
function geometry(parts: NonNullable<FrameDescription['nodes'][number]['parts']>): THREE.BufferGeometry {
  const key = JSON.stringify(parts);
  let value = cache.get(key);
  if (!value) { value = build(parts); cache.set(key, value); }
  return value;
}

/** What WebGL does to the one prop material every prop batch is drawn with unless it says otherwise. */
const PROP_MATERIAL_EFFECTS = ['cutaway', 'season'];

export function expandForFlutter(frame: FrameDescription): FrameDescription {
  const nodes: FrameDescription['nodes'] = [];
  const remap: number[] = [];
  for (const [at, node] of frame.nodes.entries()) {
    const parent = node.parent < 0 ? -1 : remap[node.parent];
    if (parent === undefined) throw new Error('scene parent must precede its child');
    remap[at] = nodes.length;
    if (node.kind !== 'prop-batch') { nodes.push({ ...node, parent }); continue; }
    const placements = node.placements ?? [];
    const parts = [node.parts ?? [], node.glowParts ?? []] as const;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      if (!parts[partIndex].length || !placements.length) continue;
      const shape = geometry(parts[partIndex]);
      const positions = shape.getAttribute('position');
      const normals = shape.getAttribute('normal');
      const colors = shape.getAttribute('color');
      const matrices = new Float32Array(placements.length * 16);
      const instanceColours = new Float32Array(placements.length * 3);
      placements.forEach((placement, index) => {
        matrices.set(composeInstance(placement, new THREE.Matrix4()).elements, index * 16);
        const shade = partIndex === 0 ? shadeOf(placement.tint ?? 0.5) : new THREE.Color(0xffffff);
        instanceColours.set([shade.r, shade.g, shade.b], index * 3);
      });
      nodes.push({
        id: node.id, part: partIndex, parent, kind: 'instances', world: node.world, visible: node.visible,
        castShadow: partIndex === 0 && node.castShadow,
        receiveShadow: partIndex === 0 && node.receiveShadow,
        material: {
          intent: partIndex === 0 ? 'lit' : 'unlit', colour: partIndex === 0 ? 0xffffff : node.glowColour ?? 0xffffff,
          emissive: 0, vertexColours: true, transparent: false, opacity: 1,
          // the body takes whatever its WebGL material takes (the prop material's, unless it says); the glow nothing
          depthWrite: true, side: 'front', effects: partIndex === 0 ? [...(node.effects ?? PROP_MATERIAL_EFFECTS)] : [],
        },
        attributes: {
          position: { size: 3, values: positions.array as Float32Array },
          normal: { size: 3, values: normals.array as Float32Array },
          color: { size: 3, values: colors.array as Float32Array },
        },
        indices: shape.index?.array as Uint16Array | Uint32Array | undefined,
        instanceMatrices: matrices, instanceColours,
      });
    }
    if (nodes.length === remap[at]) nodes.push({
      id: node.id, parent, kind: 'group', world: node.world, visible: node.visible,
      castShadow: false, receiveShadow: false,
    });
  }
  return { ...frame, nodes };
}
