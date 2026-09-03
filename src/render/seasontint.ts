import * as THREE from 'three';

/**
 * Season tint for vertex-coloured materials. A multiply alone can only darken or shift hue, so
 * winter also needs to blend toward snow-white: `mix(color * mul, snow, blend)`.
 * One uniforms object is shared by every material that opts in, so a season change is one write.
 */
export class SeasonTintMaterials {
  readonly uniforms = {
    uSeasonMul: { value: new THREE.Vector3(1, 1, 1) },
    uSeasonSnow: { value: new THREE.Color(0xf2f6ff) },
    uSeasonBlend: { value: 0 },
  };

  /** Patch a material so it obeys the season uniforms. Call once per material. */
  attach(material: THREE.Material): void {
    material.customProgramCacheKey = () => 'ai-world-season';
    material.onBeforeCompile = (shader) => {
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
    };
    material.needsUpdate = true;
  }

  set(mul: [number, number, number], blend: number): void {
    this.uniforms.uSeasonMul.value.set(mul[0], mul[1], mul[2]);
    this.uniforms.uSeasonBlend.value = blend;
  }
}
