import { openPlayer, GameInput, IsoCamera } from '../../src/game/portable-player';

/** Actual Player/camera construction and movement, with CPU terrain/render host ports. */
export function playerOpeningWorkload(): string {
  const ground = { heightAt: () => 0.5, waterAt: () => null, blocked: () => false, isRoad: () => true };
  const saved = { cam: { x: 200, z: 300, rot: 0.4, zoom: 20 }, player: { x: 18, z: -8 } };
  const camera = new IsoCamera(() => ({ width: 1600, height: 900 }));
  let mounted = 0;
  const player = openPlayer({ world: ground, renderer: { add: () => { mounted++; return true; } },
    camera, villages: [], saved: JSON.parse(JSON.stringify(saved)) });
  if (Number(mounted) !== 1 || player.x !== 18 || player.z !== -8 || camera.target.x !== 18 ||
      camera.target.z !== -8 || camera.rotation !== 0.4 || camera.zoom !== 20) throw new Error('Saved player opening diverged');
  const input = new GameInput(); input.hold('w');
  for (let tick = 0; tick < 30; tick++) player.update(input, camera, 1 / 60);
  if (Math.hypot(player.x - 18, player.z + 8) < 1) throw new Error('Restored production Player did not walk');
  const position = { x: player.x, z: player.z };
  const restoredCamera = new IsoCamera(() => ({ width: 1600, height: 900 }));
  const restored = openPlayer({ world: ground, renderer: { add: () => { mounted++; return true; } }, camera: restoredCamera,
    villages: [], saved: JSON.parse(JSON.stringify({ cam: saved.cam, player: position })) });
  if (restored.x !== position.x || restored.z !== position.z || restoredCamera.target.x !== position.x ||
      restoredCamera.target.z !== position.z || Number(mounted) !== 2) throw new Error('Reopened Player lost walked coordinates');
  // Camera snapshots name the same physical pose despite harmless cross-engine trig ULPs.
  return JSON.stringify({ initial: saved.player, walked: position, reopened: { x: restored.x, z: restored.z },
    rotation: restoredCamera.rotation, zoom: restoredCamera.zoom, mounted }, (_key, value) =>
    typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value);
}
