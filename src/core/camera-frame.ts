import type { FrameDescription } from './scene';

/** The camera's engine-owned pose and lens, before any graphics API receives it. */
export interface OrthographicView {
  x: number; y: number; z: number;
  targetX: number; targetY: number; targetZ: number;
  width: number; height: number; near: number; far: number;
}

export function orthographicFrame(view: OrthographicView): FrameDescription['camera'] {
  const dx = view.x - view.targetX;
  const dy = view.y - view.targetY;
  const dz = view.z - view.targetZ;
  const distance = Math.hypot(dx, dy, dz);
  if (!(distance > 0) || !(view.width > 0) || !(view.height > 0) || !(view.far > view.near)) {
    throw new Error('invalid orthographic camera view');
  }
  const bx = dx / distance, by = dy / distance, bz = dz / distance;
  const horizontal = Math.hypot(bx, bz);
  if (!(horizontal > 0)) throw new Error('camera is directly above its target');
  const rx = bz / horizontal, rz = -bx / horizontal;
  const ux = by * rz, uy = horizontal, uz = -by * rx;
  const depth = view.far - view.near;
  return {
    orthographic: true,
    projection: [
      2 / view.width, 0, 0, 0,
      0, 2 / view.height, 0, 0,
      0, 0, -2 / depth, 0,
      0, 0, -(view.far + view.near) / depth, 1,
    ],
    world: [rx, 0, rz, 0, ux, uy, uz, 0, bx, by, bz, 0, view.x, view.y, view.z, 1],
  };
}
