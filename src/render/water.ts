import * as THREE from 'three';

/**
 * Water material: a Lambert material with a small shader patch. No textures: the surface
 * shows drifting bright caps computed from world position, waterfall faces (attribute `flow` = 1)
 * show streaks scrolling downward. The whole world shares one instance so the time uniform is
 * updated once per frame.
 */
export class WaterMaterial {
  readonly material: THREE.MeshLambertMaterial;
  readonly uniforms = { uTime: { value: 0 } };

  constructor() {
    const m = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    m.customProgramCacheKey = () => 'ai-world-water';
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
attribute float flow;
varying float vFlow;
varying vec3 vWPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vFlow = flow;
transformed.y += (1.0 - flow) * sin(uTime * 1.4 + position.x * 0.8 + position.z * 0.6) * 0.02;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
varying float vFlow;
varying vec3 vWPos;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  // three drifting wave trains at incommensurate angles: thin bright ridges, never a grid
  vec2 p = vWPos.xz * 0.55;
  float a = sin(dot(p, vec2(0.70, 0.90)) * 1.15 + uTime * 0.90);
  float b = sin(dot(p, vec2(-0.80, 0.55)) * 1.65 - uTime * 1.10);
  float c = sin(dot(p, vec2(0.30, -1.00)) * 2.30 + uTime * 0.60);
  float v = (a + b + c) / 3.0;
  // thin contour lines where the wave field crosses a level: reads as drawn wave strokes
  float cap = (1.0 - smoothstep(0.0, 0.045, abs(v - 0.42))) * 0.30;
  // waterfall faces: streaks scrolling downward
  float fall = fract(vWPos.y * 1.6 - uTime * 1.8 + sin((vWPos.x + vWPos.z) * 2.0) * 0.2);
  float streak = smoothstep(0.55, 0.7, fall) * (1.0 - smoothstep(0.85, 1.0, fall));
  float glint = mix(cap, 0.35 + streak * 0.6, vFlow);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.97, 1.0), glint);
}`);
    };
    this.material = m;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.material.dispose();
  }
}
