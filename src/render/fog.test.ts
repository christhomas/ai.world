import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DayCycle } from './daycycle';
import { fogReach, type SceneRig } from './scene';
import { CAMERA, WORLD } from '../core/config';
import { SceneGraph } from '../core/scenegraph';
import { MountedThreePipeline } from './pipeline';

/**
 * Distance reads as distance, which in a terraced country it did not.
 *
 * `scene.background` is a flat sky colour and `scene.fog` did not exist, so a terrace forty tiles
 * away was drawn at exactly the contrast of the one under the hero's feet. A stack of them read as
 * clutter rather than as a view. The only fog anywhere in this codebase was `cartography.ts`'s map
 * fog, which is a different thing entirely — what a player has and has not explored.
 *
 * Aerial perspective rather than haze: far country goes *towards the sky colour*, nothing goes
 * soft and nothing glows. That is also what makes it free — three.js's own linear fog is native to
 * the Lambert materials this world already uses, so there is no composer pass and no per-frame cost
 * on a path that is meant to stay optional.
 *
 * ## Why the reach is a function rather than two numbers
 *
 * The camera is orthographic and stands off its target at `CAMERA.HEIGHT` up and `CAMERA.DIST`
 * along, and fog is measured from the camera rather than from the target. So a fog that begins at
 * "forty tiles" begins at forty tiles *plus the standoff*, and a pair of hand-tuned constants would
 * be wrong the first time either of those moved. Worse, ground is only loaded out to
 * `WORLD.VIEW_RADIUS` chunks, and fog that ends past the loaded edge would leave the edge visible —
 * which is the one thing it is most useful for hiding.
 */

describe('how far the fog reaches', () => {
  const reach = fogReach();

  it('begins past the hero rather than on top of him', () => {
    const standoff = Math.hypot(CAMERA.HEIGHT, CAMERA.DIST);
    expect(reach.near).toBeGreaterThan(standoff);
  });

  it('is thickest before the ground runs out, so the loaded edge is never the thing you see', () => {
    const standoff = Math.hypot(CAMERA.HEIGHT, CAMERA.DIST);
    // ground is kept out to VIEW_RADIUS chunks; along the view, a tile of ground is worth less than
    // a tile of depth, because the camera looks down at it
    const alongView = CAMERA.DIST / standoff;
    const loaded = standoff + WORLD.VIEW_RADIUS * WORLD.CHUNK_SIZE * alongView;
    expect(reach.far).toBeLessThanOrEqual(loaded + 0.001);
  });

  it('has a near before its far, which is the whole of what a linear fog needs', () => {
    expect(reach.near).toBeLessThan(reach.far);
  });

  it('reaches further when more of the world is kept loaded', () => {
    expect(fogReach(WORLD.VIEW_RADIUS + 2).far).toBeGreaterThan(reach.far);
  });

  it('does not reach past the camera\'s own far plane', () => {
    expect(reach.far).toBeLessThan(1000);      // OrthographicCamera(..., 0.1, 1000) in camera.ts
  });
});

/*
 * And the thing the issue actually asks for: that the fog is the colour of its own sky, at every
 * hour. A horizon that seams against a sky it disagrees with is worse than no fog at all.
 */
const rig = (): SceneRig & { scene: THREE.Scene } => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc1e6);
  const graph = new SceneGraph(0x8fc1e6);
  graph.camera = {
    projection: new THREE.Matrix4().identity().toArray(), world: new THREE.Matrix4().identity().toArray(),
    orthographic: true,
  };
  const lighting = {
    sun: graph.add({ kind: 'directional', colour: 0xffffff, intensity: 1, position: [0, 1, 0], target: [0, 0, 0], castShadow: true }),
    hemi: graph.add({ kind: 'hemisphere', sky: 0xffffff, ground: 0x000000, intensity: 1 }),
    ambient: graph.add({ kind: 'ambient', colour: 0xffffff, intensity: 1 }),
    lantern: graph.add({ kind: 'point', colour: 0xffb060, intensity: 0, distance: 9, decay: 1.6, position: [0, 0, 0] }),
  };
  return {
    renderer: {} as THREE.WebGLRenderer,
    scene,
    graph, lighting,
    sun: new THREE.DirectionalLight(),
    hemi: new THREE.HemisphereLight(),
    ambient: new THREE.AmbientLight(),
    water: { uniforms: {} } as never,
    coast: {} as never,
    sunDriven: false,
    follow: () => {},
    seaAround: () => {},
    fitShadow: () => {},
    redrawShadows: () => {},
  } as unknown as SceneRig & { scene: THREE.Scene };
};

const at = (time: number) => ({
  time, focusX: 0, focusZ: 0, heroX: 0, heroY: 0, heroZ: 0,
  lanternOn: false, flame: 0, season: { sky: [1, 1, 1] as [number, number, number] }, wet: 0,
});

describe('the colour of the fog', () => {
  for (const [hour, when] of [[0.5, 'noon'], [0.78, 'dusk'], [0.0, 'night']] as const) {
    it(`is the colour of the sky at ${when}`, () => {
      const one = rig();
      const cycle = new DayCycle(one);
      cycle.apply(at(hour) as never);
      new MountedThreePipeline(one.scene, () => {}, one.graph).draw(one.graph.frame());
      const sky = one.scene.background as THREE.Color;
      expect(one.scene.fog, 'there is no fog at all').toBeTruthy();
      expect((one.scene.fog as THREE.Fog).color.getHex()).toBe(sky.getHex());
      expect(one.graph.background).toBe(sky.getHex());
      expect(one.graph.fog?.colour).toBe((one.scene.fog as THREE.Fog).color.getHex());
      expect(one.lighting.sun.intensity).toBeGreaterThan(0);
      expect(one.lighting.hemi.intensity).toBeGreaterThan(0);
      expect(one.lighting.ambient.intensity).toBeGreaterThan(0);
    });
  }

  it('is a linear fog rather than an exponential one, because this world is blocky', () => {
    const one = rig();
    new DayCycle(one).apply(at(0.5) as never);
    new MountedThreePipeline(one.scene, () => {}, one.graph).draw(one.graph.frame());
    expect((one.scene.fog as THREE.Fog).isFog).toBe(true);
  });
});
