import * as THREE from 'three';
import type { SeasonLook } from '../core/scene';
import { patchShader } from './shaderpatch';

/**
 * Season tint for vertex-coloured materials. A multiply alone can only darken or shift hue, so
 * winter also needs to blend toward snow-white: `mix(color * mul, snow, blend)`.
 * One uniforms object is shared by every material that opts in, so a season change is one write.
 *
 * WebGL's way of drawing the frame's `season` intent, and only that: the game says what the season
 * looks like on the scene graph, every frame drawn carries it, and `show` is handed it from there.
 * The Dart renderer is handed the same description and bakes it into the colours it uploads.
 */
export class SeasonTintMaterials {
  readonly uniforms = {
    uSeasonMul: { value: new THREE.Vector3(1, 1, 1) },
    /** Read only in proportion to the frost, which always arrives with a snow to blend toward. */
    uSeasonSnow: { value: new THREE.Color(0xffffff) },
    uSeasonBlend: { value: 0 },
  };

  /**
   * Patch a material so it obeys the season uniforms.
   *
   * Registered rather than assigned, because a material may carry more than one shader edit and
   * `three` gives it exactly one `onBeforeCompile`: whichever assigned second used to erase the
   * other without a word. See `shaderpatch.ts`.
   */
  attach(material: THREE.Material): void {
    patchShader(material, 'season', (shader) => {
      shader.uniforms.uSeasonMul = this.uniforms.uSeasonMul;
      shader.uniforms.uSeasonSnow = this.uniforms.uSeasonSnow;
      shader.uniforms.uSeasonBlend = this.uniforms.uSeasonBlend;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uSeasonMul;
uniform vec3 uSeasonSnow;
uniform float uSeasonBlend;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb * uSeasonMul, uSeasonSnow, uSeasonBlend);`);
    });
  }

  /** Draw the season a frame describes; none is the world untinted. */
  show(season: SeasonLook | null | undefined): void {
    const mul = season?.multiply ?? [1, 1, 1];
    this.uniforms.uSeasonMul.value.set(mul[0], mul[1], mul[2]);
    if (season) this.uniforms.uSeasonSnow.value.setHex(season.snow);
    this.uniforms.uSeasonBlend.value = season?.frost ?? 0;
  }
}
