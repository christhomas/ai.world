import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneState } from './scene-state';
import { Daylight } from './daylight';
import { DayCycle } from './daycycle';
import type { SceneRig } from './scene';
import { ThreeGraphBridge } from './scenegraph';
import { IsoCamera } from './camera';
import { Season, seasonTint } from '../game/seasons';
import { WORLD } from '../core/config';

function lit() {
  let now = 0;
  const state = new SceneState();
  state.graph.camera = new IsoCamera(() => ({ width: 750, height: 342 })).frameCamera();
  const shadow = vi.fn(), fit = vi.fn();
  const rig = { graph: state.graph, lighting: state.lighting, fitShadow: fit, redrawShadows: shadow };
  const daylight = new Daylight(rig, () => now);
  const input = { time: 0.5, focusX: 4, focusZ: -2, heroX: 1, heroY: 2, heroZ: 3,
    lanternOn: false, season: seasonTint(Season.Autumn), wet: 0 };
  return { state, rig, daylight, input, shadow, fit, time: (value: number) => { now = value; } };
}

describe('production scene state without a browser or GPU', () => {
  it('builds populated water and depth geometry beside the production lights and fog', () => {
    const state = new SceneState();
    expect(state.graph.nodes.map(node => node.kind)).toEqual(['ambient', 'hemisphere', 'directional', 'point', 'mesh', 'mesh']);
    expect(state.graph.fog?.far).toBeGreaterThan(state.graph.fog!.near);
    const expected = new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2);
    for (const node of [state.waterNode, state.deepNode]) {
      expect(node.geometry.positions).toEqual(expected.attributes.position.array);
      expect(node.geometry.normals).toEqual(expected.attributes.normal.array);
      expect(node.geometry.indices).toEqual(expected.index!.array);
    }
    expect(state.waterNode.geometry.sea).toEqual(new Float32Array(4).fill(1));
    expect(state.waterNode.geometry.flow).toEqual(new Float32Array(4));
    expect(state.waterNode.geometry.colors?.length).toBe(12);
    state.followWater(12, -8); state.updateWater(2.5);
    expect(state.waterNode.world?.slice(12, 15)).toEqual([12, WORLD.WATER_Y, -8]);
    expect(state.deepNode.world?.slice(12, 15)).toEqual([12, -0.03, -8]);
    expect(state.graph.renderTimeMs).toBe(2500);
    state.dispose(); state.followWater(99, 99); state.updateWater(10);
    expect(state.graph.nodes).toHaveLength(0);
    expect(state.waterNode.world?.slice(12, 15)).toEqual([12, WORLD.WATER_Y, -8]);
    expect(state.graph.renderTimeMs).toBe(2500);
    expected.dispose();
  });

  it('mounts retained graph nodes once, preserving their frame IDs', () => {
    const state = new SceneState(), scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial();
    state.graph.camera = new IsoCamera(() => ({ width: 750, height: 342 })).frameCamera();
    const bridge = new ThreeGraphBridge(state.graph, scene, material, material, material);
    const before = state.graph.frame().nodes.map(node => node.id);
    bridge.add(state.waterNode, true); bridge.add(state.deepNode, true);
    expect(state.graph.frame().nodes.map(node => node.id)).toEqual(before);
    expect(state.graph.nodes).toHaveLength(6);
    expect(() => bridge.add(state.waterNode, true)).toThrow('already mounted');
    expect(() => bridge.add({ ...state.deepNode }, true)).toThrow('not owned');
    bridge.dispose(); material.dispose(); state.dispose();
  });

  it('uses host time for shadow refresh and retains unclamped autumn light', () => {
    const test = lit();
    expect(test.daylight.apply(test.input)).toBe(0);
    expect((test.state.lighting.sun.colour as number[])[0]).toBeGreaterThan(1);
    expect(test.shadow).toHaveBeenCalledTimes(1);
    test.time(99); test.daylight.apply(test.input);
    expect(test.shadow).toHaveBeenCalledTimes(1);
    test.time(100); test.daylight.apply(test.input);
    expect(test.shadow).toHaveBeenCalledTimes(2);
    expect(test.state.graph.fog?.colour).toBe(test.state.graph.background);
    expect(test.fit).toHaveBeenCalledTimes(3);
  });

  it('shares exact linear window color with the browser material adapter across seasons and weather', () => {
    const pure = lit(), browser = lit();
    const cycle = new DayCycle(browser.rig as SceneRig, () => 0);
    for (const season of [Season.Spring, Season.Summer, Season.Autumn, Season.Winter]) {
      for (const time of [0, 0.25, 0.4, 0.5, 0.73, 0.95]) for (const wet of [0, 1]) {
        const input = { ...pure.input, season: seasonTint(season), time, wet, flame: { x: 2, y: 3, z: 4 } };
        expect(cycle.apply(input)).toBe(pure.daylight.apply(input));
        expect(cycle.glowMaterial.color.toArray()).toEqual(pure.daylight.glowLinear);
        expect(browser.state.lighting).toEqual(pure.state.lighting);
        expect(browser.state.graph.background).toBe(pure.state.graph.background);
      }
    }
    cycle.dispose();
  });

  it('releases the browser glow material once and fences its retired callbacks', () => {
    const test = lit(), cycle = new DayCycle(test.rig as SceneRig, () => 0);
    const release = vi.fn(); cycle.glowMaterial.addEventListener('dispose', release);
    cycle.apply(test.input);
    const before = cycle.glowMaterial.color.toArray();
    cycle.dispose(); cycle.dispose();
    cycle.apply({ ...test.input, time: 0 });
    expect(release).toHaveBeenCalledTimes(1);
    expect(cycle.glowMaterial.color.toArray()).toEqual(before);
    expect(test.fit).toHaveBeenCalledTimes(1);
  });

  it('retired daylight cannot mutate its scene or call retained host callbacks', () => {
    const test = lit(); test.daylight.apply(test.input);
    const before = JSON.stringify(test.state.graph.frame());
    test.daylight.dispose(); test.time(1000);
    test.daylight.setDayIntensities(200, 200);
    test.daylight.apply({ ...test.input, time: 0, focusX: 900 });
    expect(JSON.stringify(test.state.graph.frame())).toBe(before);
    expect(test.shadow).toHaveBeenCalledTimes(1);
    expect(test.fit).toHaveBeenCalledTimes(1);
  });
});
