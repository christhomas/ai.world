import * as THREE from 'three';
import { patchShader } from './shaderpatch';

/**
 * Seeing the hero through whatever is standing in front of him.
 *
 * The camera looks down at forty-five degrees, and at that angle a wall hides as many tiles of
 * ground behind it as it is units tall. A terrace is half a unit and hides half a tile, which is
 * nothing. A castle's curtain wall is 6.1 and hides six — half a ward. So the moment you are close
 * enough for a courtyard to be a place rather than a diagram, the wall you just walked through is
 * between you and yourself.
 *
 * What this does is cut a hole in whatever is in the way, anchored to where the hero is on the
 * glass: a fragment is discarded if it is nearer the camera than he is, within a radius of him on
 * the screen, and standing above the ground he is standing on.
 *
 * **The third test is the one that matters**, and it is what makes this cheap. The naive version —
 * cut everything nearer than the hero — takes the ground with it, because on a forty-five degree
 * view the ground in front of somebody genuinely *is* nearer the camera than they are, so you punch
 * a hole through the floor at their feet. The obvious repair is to work out the cutaway volume,
 * intersect it with the ground and cut the intersection away, which is real geometry every frame.
 * The cheap repair is to notice that **the ground in front of you is at your feet and a wall is
 * not**: test the fragment's own height against the hero's boots and the floor survives untouched
 * while anything standing up is cut.
 *
 * Deliberately not applied to the terrain. It is not needed — half a tile of hiding per terrace is
 * not worth a shader — and leaving it out means there is no case at all where the ground can be
 * eaten, including the awkward one where a hero on a steep slope has ground *behind* him that is
 * above his feet.
 */

/**
 * How wide the hole is, in world units of radius.
 *
 * In world units rather than pixels so that it stays the same size relative to the man rather than
 * to the screen: a hole of eighty pixels is a porthole when you are zoomed out and swallows the
 * room when you are close. Two units is a little wider than the hero is tall, which is enough to
 * see him and what he is standing next to without dissolving the wall he is beside.
 */
const RADIUS = 2.0;

/**
 * How much nearer than the hero a thing must be before it is cut, in world units.
 *
 * Without it the hero cuts *himself*: his own front faces are fractionally nearer the camera than
 * his middle, and so is anything standing beside him. Six tenths is a little over the depth of his
 * own body, so he and whoever he is talking to are never dissolved and the wall behind them is.
 */
const INFRONT = 0.6;

/**
 * Where the dissolve begins, as a share of the radius.
 *
 * A hard circle reads as a hole punched in the picture and draws the eye to itself. Dithering the
 * outer half turns it into the wall thinning out, which nobody looks at twice.
 */
const SOFT = 0.55;

/**
 * The one set of numbers every patched material shares.
 *
 * One object rather than one per material, so `aim` writes the hero's position once a frame and
 * every material that draws something which could be in the way sees it. `three` only reads these
 * at draw time, so sharing the object is what keeps the update to three assignments.
 */
interface Aimed {
  /** Where the hero is on the glass, in framebuffer pixels, and how deep he is in view space. */
  at: { value: THREE.Vector3 };
  /** The height of the ground under his boots: nothing at or below this is ever cut. */
  foot: { value: number };
  /** The radius of the hole in framebuffer pixels. Nought turns the whole thing off. */
  radius: { value: number };
}

const aimed: Aimed = {
  at: { value: new THREE.Vector3() },
  foot: { value: 0 },
  radius: { value: 0 },
};

const HERE = new THREE.Vector3();

/**
 * Held off, rather than turned off.
 *
 * A latch and not a one-shot, because `aimCutaway` runs every frame and would simply turn it back
 * on: telling it once that a photograph is being taken has to keep being true until the
 * photograph is over.
 */
let held = false;

/**
 * Teach a material to get out of the way.
 *
 * Applied to the materials that draw things which stand up — props and the creatures — and not to
 * the ground. Works through instancing unchanged, because the decision is made per fragment and a
 * fragment does not know or care how its vertices were placed.
 */
export function cutAwayFor(material: THREE.Material): void {
  patchShader(material, 'cutaway', (shader) => {
    shader.uniforms.cutAt = aimed.at;
    shader.uniforms.cutFoot = aimed.foot;
    shader.uniforms.cutRadius = aimed.radius;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying float vCutDepth;
        varying vec3 vCutWorld;`)
      // after `project_vertex`, because that is where `mvPosition` exists and where three has
      // already applied the instance matrix if there is one
      .replace('#include <project_vertex>', `#include <project_vertex>
        vCutDepth = -mvPosition.z;
        vec4 cutWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cutWorld = instanceMatrix * cutWorld;
        #endif
        vCutWorld = (modelMatrix * cutWorld).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vCutDepth;
        varying vec3 vCutWorld;
        uniform vec3 cutAt;
        uniform float cutFoot;
        uniform float cutRadius;
        // an ordered dither, arithmetic rather than a table, so nothing has to be indexed
        float cutBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
        float cutBayer4(vec2 a) { return cutBayer2(0.5 * a) * 0.25 + cutBayer2(a); }`)
      // first thing in the body, so a discarded fragment costs nothing else
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (cutRadius > 0.0 && vCutDepth < cutAt.z && vCutWorld.y > cutFoot) {
          float near = length(gl_FragCoord.xy - cutAt.xy) / cutRadius;
          if (near < 1.0 && cutBayer4(gl_FragCoord.xy) > smoothstep(${SOFT.toFixed(2)}, 1.0, near)) discard;
        }`);
  });
}

/**
 * Point the hole at the hero, once a frame.
 *
 * Everything here is in framebuffer pixels rather than CSS pixels, because `gl_FragCoord` is, and
 * on a sharp screen the two differ by the device ratio — a hole worked out in CSS pixels comes out
 * half the size it should be on exactly the machines somebody would notice.
 */
export function aimCutaway(
  renderer: THREE.WebGLRenderer, camera: THREE.OrthographicCamera,
  hero: { x: number; y: number; z: number } | null,
): void {
  if (!hero || held) { aimed.radius.value = 0; return; }
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());

  HERE.set(hero.x, hero.y + 1, hero.z);
  // his chest rather than his boots: projecting the point his feet are on puts the hole's middle
  // at the bottom of him, and the half of him above it is the half you are trying to see
  const ndc = HERE.clone().project(camera);
  aimed.at.value.set(
    (ndc.x * 0.5 + 0.5) * size.x,
    (ndc.y * 0.5 + 0.5) * size.y,
    -HERE.clone().applyMatrix4(camera.matrixWorldInverse).z - INFRONT,
  );
  aimed.foot.value = hero.y;
  // exact for an orthographic camera: the frustum is a known number of world units tall, so a
  // world unit is a known number of pixels and the hole keeps its size against the man
  const perUnit = size.y / Math.max(1e-6, camera.top - camera.bottom);
  aimed.radius.value = RADIUS * perUnit;
}

/** Put the hole away, or let it come back — photo mode, and anywhere else he is not the subject. */
export function holdCutaway(off: boolean): void {
  held = off;
  if (off) aimed.radius.value = 0;
}
