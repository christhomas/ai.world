import type * as THREE from 'three';
import { buildBoat } from './boat';

/** The ferry's timetable can move its picture without knowing the scene graph. */
export interface FerryVisual {
  setPose(x: number, y: number, z: number, yaw: number): void;
}

export function putFerriesOut<Line>(
  lines: Line[],
  scene: THREE.Scene,
): Array<{ line: Line; visual: FerryVisual }> {
  return lines.map((line) => {
    const mesh = buildBoat();
    scene.add(mesh);
    return {
      line,
      visual: { setPose(x, y, z, yaw) {
        mesh.position.set(x, y, z);
        mesh.rotation.y = yaw;
      } },
    };
  });
}
