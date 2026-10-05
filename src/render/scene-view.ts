/** Ground footprint visible to creature and scenery buffer producers. */
export interface WorldView {
  x: number;
  z: number;
  radius: number;
}

interface ViewHolder { userData: Record<string, unknown> }

/** Browser scenes retain the same allocation-free view used by portable producers. */
export function worldView(scene: ViewHolder): WorldView | null {
  return (scene.userData.worldView as WorldView | undefined) ?? null;
}

export function setWorldView(scene: ViewHolder, x: number, z: number, radius: number): void {
  const view = worldView(scene);
  if (view) { view.x = x; view.z = z; view.radius = radius; }
  else scene.userData.worldView = { x, z, radius } satisfies WorldView;
}
