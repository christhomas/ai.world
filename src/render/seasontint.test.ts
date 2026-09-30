import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { Season, SEASON_SNOW, seasonLook } from '../game/seasons';
import { Biome } from '../world/biomes';
import { MountedThreePipeline, submitGraphFrame } from './pipeline';
import { RecordingPipeline } from './recording';
import { SeasonTintMaterials } from './seasontint';

const camera = {
  projection: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.002, 0, 0, 0, -1, 1],
  world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1],
  orthographic: true,
};

/** One frame of `graph` through the recording and a live WebGL mount whose tint follows frames. */
function submit(graph: SceneGraph, tint: SeasonTintMaterials) {
  const recording = new RecordingPipeline();
  recording.captureNext();
  const mounted = new MountedThreePipeline(new THREE.Scene(), () => {}, graph,
    [(frame) => tint.show(frame.season)]);
  submitGraphFrame(graph, [recording, mounted]);
  if (!recording.last) throw new Error('nothing was recorded');
  return JSON.parse(JSON.stringify(recording.last)) as typeof recording.last;
}

describe('the season as an intent in the frame', () => {
  it('records autumn and winter in the frame and takes the WebGL uniforms from it', () => {
    const graph = new SceneGraph(0x8fc1e6);
    graph.camera = camera;
    const tint = new SeasonTintMaterials();

    graph.season = seasonLook(Season.Autumn, Biome.Forest);
    const autumn = submit(graph, tint);
    expect(autumn.season).toEqual({ multiply: [1.35, 0.82, 0.42], frost: 0, snow: SEASON_SNOW });
    expect(tint.uniforms.uSeasonMul.value.toArray()).toEqual([1.35, 0.82, 0.42]);
    expect(tint.uniforms.uSeasonBlend.value).toBe(0);

    graph.season = seasonLook(Season.Winter, Biome.Plains);
    const winter = submit(graph, tint);
    expect(winter.season).toEqual({ multiply: [0.88, 0.94, 1.06], frost: 0.5, snow: SEASON_SNOW });
    expect(tint.uniforms.uSeasonMul.value.toArray()).toEqual([0.88, 0.94, 1.06]);
    expect(tint.uniforms.uSeasonBlend.value).toBe(0.5);
    // the same conversion the uniform was always built with: an sRGB hex, taken to linear
    expect(tint.uniforms.uSeasonSnow.value.equals(new THREE.Color(SEASON_SNOW))).toBe(true);
  });

  it('records no tint where the season does not reach, and the uniforms go back to none', () => {
    const graph = new SceneGraph(0x8fc1e6);
    graph.camera = camera;
    const tint = new SeasonTintMaterials();
    expect(submit(graph, tint).season).toBeNull();   // before the game has said

    graph.season = seasonLook(Season.Winter, Biome.Plains);
    submit(graph, tint);
    graph.season = seasonLook(Season.Winter, Biome.Desert);
    expect(submit(graph, tint).season).toBeNull();
    expect(tint.uniforms.uSeasonMul.value.toArray()).toEqual([1, 1, 1]);
    expect(tint.uniforms.uSeasonBlend.value).toBe(0);
  });

  it('draws the tint with the uniforms the frame sets, under the effect the frame names', () => {
    const tint = new SeasonTintMaterials();
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    tint.attach(material);
    expect(material.userData.effects).toEqual(['season']);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: '#include <common>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uSeasonMul).toBe(tint.uniforms.uSeasonMul);
    expect(shader.uniforms.uSeasonBlend).toBe(tint.uniforms.uSeasonBlend);
    expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb * uSeasonMul, uSeasonSnow, uSeasonBlend)');
    material.dispose();
  });
});
