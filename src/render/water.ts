import * as THREE from 'three';

/**
 * Water material: a Lambert material with a shader patch and no textures anywhere except one small
 * greyscale picture of where the land is (`coastfield.ts`).
 *
 * The first version of this drew three sine trains at fixed angles across the whole sea. It was the
 * same water everywhere — the same size of wave in a harbour and a mile out, crossing the beach
 * without noticing it was there — and being the same everywhere is exactly what makes a surface
 * read as a repeating texture rather than as water.
 *
 * Real water is not the same everywhere, and the thing that varies it is the bottom. A swell that
 * feels the bottom slows down; the crests behind it catch up, so they bunch; the water piling into
 * shorter waves has to go somewhere, so they stand up; and the end of a crest nearest the shore
 * slows first, which swings the whole wave round until it arrives parallel to the beach however it
 * set out. So the waves here are contour lines of the distance to land, marching inward, packing
 * tighter and rising as they come, and breaking white where the field runs out. One number does
 * all of it, and the coast field is where that number comes from.
 *
 * What the wave field drives is the surface normal rather than the colour, so the light on the
 * water is the game's own sun: the sea goes gold at dusk and dull under cloud without this knowing
 * anything about either. Colour only carries what the light cannot — depth, and foam.
 *
 * Two attributes say which of three kinds of water a face is. `sea` = 1 is the open sea, the only
 * one with a coast to refract against: a river is two tiles wide and every point of it is a pace
 * from the bank, so a shore rule applied there paints the whole river white. Rivers and lakes get a
 * ripple instead. `flow` = 1 is a waterfall, which keeps its scrolling streaks.
 */

/**
 * How a wave's length grows with the water under it. Crests fall `2 * sqrt(distance) / this` apart
 * in world units, so a bigger number is a shorter, choppier sea.
 */
const PACK = 2.2;
/**
 * How steep the surface is taken to be, which is all the light ever sees of it.
 *
 * Nothing here moves a vertex — the sea is one flat plane — so this is not a height so much as how
 * hard the waves lean into the sun. Worth being careful with: a low sun turns a lean of a few
 * degrees into the difference between water and white, so a number that looks mild at noon paves
 * the whole bay with silver at eight in the morning. Which is why it is this small.
 */
const AMP = 0.045;
/** How far apart the samples that measure the surface slope are, in world units. */
const STEP = 1.1;

export class WaterMaterial {
  readonly material: THREE.MeshLambertMaterial;
  readonly uniforms = {
    uTime: { value: 0 },
    uCoast: { value: null as THREE.Texture | null },
    /** Corner of the coast field in world x/z, one over its width, and how far it reaches. */
    uCoastArea: { value: new THREE.Vector4(-1e6, -1e6, 1e-6, 64) },
  };

  constructor() {
    const m = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    m.customProgramCacheKey = () => 'ai-world-water-2';
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uCoast = this.uniforms.uCoast;
      shader.uniforms.uCoastArea = this.uniforms.uCoastArea;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute float flow;
attribute float sea;
varying float vFlow;
varying float vSea;
varying vec3 vWPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vFlow = flow;
vSea = sea;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform sampler2D uCoast;
uniform vec4 uCoastArea;
varying float vFlow;
varying float vSea;
varying vec3 vWPos;

// worked out once for the fragment, and wanted at two different points in three's own shader
vec3 gWave;
float gCrest;
float gShore;

/** How far this point is from the nearest land, in world units. Off the field is open sea. */
float shoreAt(vec2 w) {
  vec2 uv = (w - uCoastArea.xy) * uCoastArea.z;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float d = texture2D(uCoast, clamp(uv, 0.0, 1.0)).r * uCoastArea.w;
  return mix(uCoastArea.w, d, inside);
}

/** Standing water: no swell, no shore, just the wind moving over it. Rivers and lakes. */
float rippleAt(vec2 w, float t) {
  return sin(dot(w, vec2(0.77, 0.64)) * 1.9 + t * 1.3) * 0.5
    + sin(dot(w, vec2(-0.6, 0.8)) * 2.7 - t * 0.9) * 0.3;
}

/** The surface, in world units above the flat plane, at a point whose depth is already known. */
float waveAt(vec2 w, float d, float t) {
  // Two trains, because one is a corrugated roof. Out where the bottom is too deep to matter they
  // run whichever way the weather sent them and cross each other; as they come in, the shore turns
  // both until they are running along it. That turn is the whole trick, and it is also what keeps
  // the open sea from pulsing all at once: a swell with no direction left is a heartbeat.
  float shoreward = sqrt(max(d, 0.0)) * ${PACK.toFixed(3)};
  float refract = 1.0 - smoothstep(uCoastArea.w * 0.4, uCoastArea.w * 0.95, d);
  float p1 = mix(dot(w, vec2(0.80, 0.60)) / 23.0, shoreward, refract);
  float p2 = mix(dot(w, vec2(-0.55, 0.84)) / 16.0, shoreward * 0.61, refract);
  // a slow wander so a coastline does not come out as a set of perfect parallel rings
  float wob = sin(w.x * 0.021 + t * 0.11) + sin(w.y * 0.017 - t * 0.09);
  float a = sin((p1 + t * 0.30) * PI2 + wob * 0.9);
  float b = sin((p2 + t * 0.19) * PI2 + wob * 1.5 + 2.1);
  float swell = a * 0.62 + b * 0.38;
  // a wave dies as it runs out onto the sand, and stands up in the shallows just before it
  float shoal = smoothstep(0.0, 2.6, d) * mix(2.4, 1.0, smoothstep(0.0, 34.0, d));
  return swell * shoal;
}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float t = uTime;
  vec2 alongX = vec2(${STEP.toFixed(2)}, 0.0);
  vec2 alongZ = vec2(0.0, ${STEP.toFixed(2)});
  gShore = mix(uCoastArea.w, shoreAt(vWPos.xz), vSea);
  float h0 = mix(rippleAt(vWPos.xz, t), waveAt(vWPos.xz, gShore, t), vSea);
  float hx = mix(rippleAt(vWPos.xz + alongX, t),
    waveAt(vWPos.xz + alongX, shoreAt(vWPos.xz + alongX), t), vSea);
  float hz = mix(rippleAt(vWPos.xz + alongZ, t),
    waveAt(vWPos.xz + alongZ, shoreAt(vWPos.xz + alongZ), t), vSea);
  gCrest = h0;
  gWave = normalize(vec3((h0 - hx) * ${AMP.toFixed(3)}, ${STEP.toFixed(2)}, (h0 - hz) * ${AMP.toFixed(3)}));

  // depth, as the eye reads it: green and clear over sand, blue and solid over nothing
  float deep = smoothstep(1.5, uCoastArea.w * 0.45, gShore);
  diffuseColor.rgb *= mix(vec3(0.72, 1.18, 1.06), vec3(0.86, 0.94, 1.10), deep);
  diffuseColor.a = mix(0.60, 0.88, deep);

  // white water: crests toppling in the shallows, and the line of surf at the water's edge, whose
  // own edge runs up the sand and back down with the swell rather than sitting still
  float breaker = smoothstep(1.6, 2.3, h0) * smoothstep(14.0, 2.0, gShore);
  float wash = 1.0 - smoothstep(0.0, 1.1 + h0 * 0.55, gShore);
  float glint = smoothstep(1.0, 1.7, h0) * 0.09;
  float foam = clamp(breaker * 0.45 + wash * 0.7 + glint, 0.0, 1.0) * vSea;

  // waterfall faces: streaks scrolling downward, as before — a fall has no coast to refract on
  float fall = fract(vWPos.y * 1.6 - t * 1.8 + sin((vWPos.x + vWPos.z) * 2.0) * 0.2);
  float streak = smoothstep(0.55, 0.7, fall) * (1.0 - smoothstep(0.85, 1.0, fall));
  float white = mix(foam, 0.35 + streak * 0.6, vFlow);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.98, 1.0), white);
  diffuseColor.a = mix(mix(diffuseColor.a, 0.94, foam), 0.9, vFlow);
}`)
        // the sun has to land on the waves, not on the flat plane they are drawn over: three has
        // just worked out the geometry's own normal in view space, and this is the surface's
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{
  vec3 lit = normalize((viewMatrix * vec4(gWave, 0.0)).xyz) * faceDirection;
  normal = normalize(mix(lit, normal, vFlow));
}`);
    };
    this.material = m;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  /** Point the material at the coast measured around the camera. */
  setCoast(texture: THREE.Texture, area: THREE.Vector4): void {
    this.uniforms.uCoast.value = texture;
    this.uniforms.uCoastArea.value.copy(area);
  }

  dispose(): void {
    this.material.dispose();
  }
}
