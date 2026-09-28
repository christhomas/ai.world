import type * as THREE from 'three';
import { makeFerryLines, type FerryLine } from '../game/ferry';
import type { Structures } from '../world/structures';
import { buildBoat } from './boat';

/** The ferry's timetable can move its picture without knowing the scene graph. */
export interface FerryVisual {
  setPose(x: number, y: number, z: number, yaw: number): void;
}

export function putFerriesOut(
  structures: Structures,
  islands: Array<{ x: number; z: number; radius: number }>,
  scene: THREE.Scene,
): Array<{ line: FerryLine; visual: FerryVisual }> {
  return makeFerryLines(structures, structures.villages, islands).map((line) => {
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
