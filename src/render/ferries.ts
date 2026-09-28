import type * as THREE from 'three';
import type { SceneGraph } from '../core/scenegraph';
import { boatRecord, buildBoat } from './boat';

/** The ferry's timetable can move its picture without knowing the scene graph. */
export interface FerryVisual {
  setPose(x: number, y: number, z: number, yaw: number): void;
}

export function putFerriesOut<Line>(
  lines: Line[],
  scene: THREE.Scene,
  graph?: SceneGraph,
): Array<{ line: Line; visual: FerryVisual }> {
  return lines.map((line) => {
    const mesh = buildBoat();
    const record = graph && boatRecord(graph, true, mesh);
    scene.add(mesh);
    return {
      line,
      visual: { setPose(x, y, z, yaw) {
        mesh.position.set(x, y, z);
        mesh.rotation.y = yaw;
        if (record) Object.assign(record.pose, { x, y, z, rot: yaw });
      } },
    };
  });
}
