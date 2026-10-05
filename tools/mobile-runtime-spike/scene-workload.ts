import { SceneState } from '../../src/render/scene-state';
import { Daylight } from '../../src/render/daylight';
import { seasonTint, Season } from '../../src/game/seasons';
import { IsoCamera } from '../../src/render/camera';

/** Production graph and lighting records; this is CPU evidence, not installed scene acceptance. */
export function sceneWorkload(hash: (text: string) => string): string {
  const state = new SceneState(); let now = 0, shadows = 0;
  state.graph.camera = new IsoCamera(() => ({ width: 750, height: 342 })).frameCamera();
  const daylight = new Daylight({ graph: state.graph, lighting: state.lighting,
    fitShadow() {}, redrawShadows() { shadows++; } }, () => now);
  const snapshots = [];
  for (const time of [0, 0.25, 0.5, 0.73]) {
    now += 101;
    daylight.apply({ time, season: seasonTint(Season.Autumn), wet: 0.5,
      focusX: 4, focusZ: -2, heroX: 1, heroY: 2, heroZ: 3, lanternOn: true });
    state.followWater(4, -2); state.updateWater(now / 1000);
    const nodes = state.graph.frame().nodes.map(({ id: _id, ...node }) => node);
    snapshots.push({ sky: state.graph.background, fog: state.graph.fog, nodes });
  }
  if (state.graph.nodes.length !== 6 || state.waterNode.geometry.indices?.length !== 6 || shadows !== 4) {
    throw new Error('Native production scene geometry or daylight did not advance');
  }
  daylight.dispose(); state.dispose();
  if (state.graph.nodes.length !== 0) throw new Error('Native scene retained retired nodes');
  return hash(JSON.stringify(snapshots, (_key, value) => typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value));
}
