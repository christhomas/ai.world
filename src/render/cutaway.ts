import * as THREE from 'three';
import { patchShader } from './shaderpatch';

/**
 * Seeing the hero through whatever is standing in front of him.
 *
 * At the angle this game is watched from, a wall hides as many tiles of ground behind it as it is
 * units tall. A terrace is half a unit and hides half a tile; a cottage is three and hides three;
 * a castle's curtain is six and hides half a ward. So the closer the camera gets — which is the
 * whole point of being able to get close — the more of the game is behind something.
 *
 * A fragment is dropped if it is nearer the camera than the hero, within a radius of him on the
 * glass, and standing above the ground he is on. **That third test is the one that earns its
 * place.** Without it the floor goes too: on a forty-five degree view the ground in front of
 * somebody genuinely is nearer the camera than they are, so the naive version punches a hole
 * through the ground at their feet. The proper repair is to build the cutaway volume, intersect it
 * with the terrain and subtract — real geometry every frame — and the cheap one is to notice that
 * the ground in front of you is at your feet and a wall is not.
 *
 * ## Why it is a switch rather than a feature
 *
 * This existed once and was taken out, and the reason it was taken out is worth keeping: it was
 * hiding a collision fault rather than a sight problem — things you could walk into were being
 * quietly made transparent, so nobody could see that they should not have been walked into. It
 * comes back as something a player turns on, which is the honest shape for it: it is an aid, and an
 * aid you can switch off is one nobody is being fooled by.
 *
 * The switch is a *uniform*, not a recompile. `three` caches programs by a key, a material that is
 * patched differently is a different program, and rebuilding shaders as somebody ticks a box is a
 * stutter a player would blame on the game. So the shader is always there and always costs the same
 * three lines; what changes is a number that is nought or one.
 */

/** The hole kept open in front of the hero, in world units. */
export const CUT = {
  /**
   * Wide enough for him, whatever he is riding and the doorway he is walking at — and no wider,
   * because every unit of it is a building the player can no longer see.
   */
  RADIUS: 5.5,
  /**
   * How much of that width is dithered rather than cut.
   *
   * Dithered rather than hard, because a clean circle reads as a hole punched in the picture, and
   * a speckle over the outer half reads as the wall thinning out. It is a fixed hash of the pixel
   * rather than anything animated: a moving fizz is worse than either.
   */
  RIM: 2.5,
  /**
   * How far in front of him the hole starts, and how far it takes to open fully.
   *
   * A margin, so the thing he is standing beside is not cut away with the thing in front of him,
   * and a ramp, so a wall thins as he walks up to it rather than vanishing between two frames.
   */
  STARTS_AT: 1.2,
  /*
   * Four rather than nine, measured by looking: at nine the hole is under two units wide at the
   * distance a cottage actually stands from somebody walking past it, which is a hole you cannot
   * see through. Four has it fully open by the time a wall is five paces in front of him, which is
   * about the distance at which a building starts hiding him.
   */
  OPENS_OVER: 4,
  /**
   * How far above his feet something has to stand before it may be cut at all.
   *
   * The floor test, in one number. Anything at his own height is the ground he is walking on and
   * the step he is about to walk up; anything a metre above it is a wall, a trunk or a roof.
   */
  ABOVE: 1,
} as const;

/**
 * The hole, and the materials it is cut into.
 *
 * One of these for the game, attached to whatever should get out of the way — the props, which is
 * every building, tree, fence and stall in the country. Terrain is deliberately not attached: the
 * ground hides half a tile per terrace, which is nothing, and leaving it whole removes the floor
 * case entirely rather than guarding against it.
 */
export class Cutaway {
  private readonly uniforms = {
    /** Where the hero is standing, in world space. */
    uCutHero: { value: new THREE.Vector3(0, 0, 0) },
    /** The direction the camera looks, normalised: what "in front of him" means. */
    uCutLook: { value: new THREE.Vector3(0, -1, 0) },
    /** Nought or one. The whole of the switch. */
    uCutOn: { value: 0 },
    uCutRadius: { value: CUT.RADIUS },
    uCutRim: { value: CUT.RIM },
    uCutStarts: { value: CUT.STARTS_AT },
    uCutOpens: { value: CUT.OPENS_OVER },
    uCutAbove: { value: CUT.ABOVE },
  };

  /** Whether the hole is being kept open at the moment. */
  get on(): boolean {
    return this.uniforms.uCutOn.value === 1;
  }

  /**
   * Cut this material away in front of the hero.
   *
   * Registered as a named patch rather than assigned, because the season tint edits the same
   * material from somewhere else entirely and `three` gives a material exactly one
   * `onBeforeCompile` — the second assignment wins silently and the first goes on looking as though
   * it were installed. That is not hypothetical: it is how this feature was lost the first time,
   * and it took a screenshot of a hero plainly hidden behind a cottage to find.
   */
  attach(material: THREE.Material): void {
    patchShader(material, 'cutaway', (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vCutWorld;`)
        /*
         * Guarded, because the same material draws instanced props and plain meshes, and
         * `instanceMatrix` does not exist in a shader compiled without instancing — an unguarded
         * reference is a shader that fails to compile and a world with no trees in it. This is the
         * guard `three` itself uses in `worldpos_vertex`.
         */
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 cutPos = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  cutPos = instanceMatrix * cutPos;
#endif
vCutWorld = (modelMatrix * cutPos).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vCutWorld;
uniform vec3 uCutHero;
uniform vec3 uCutLook;
uniform float uCutOn;
uniform float uCutRadius;
uniform float uCutRim;
uniform float uCutStarts;
uniform float uCutOpens;
uniform float uCutAbove;

// a cheap hash of the pixel, so the rim breaks up in a fixed speckle rather than a moving fizz
float cutDither(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453);
}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (uCutOn > 0.5 && vCutWorld.y > uCutHero.y + uCutAbove) {
  vec3 fromHero = vCutWorld - uCutHero;
  float along = dot(fromHero, uCutLook);        // negative: between the camera and the hero
  float across = length(fromHero - along * uCutLook);
  float infront = clamp((-along - uCutStarts) / uCutOpens, 0.0, 1.0);
  if (infront > 0.0) {
    float hole = uCutRadius * infront;
    float edge = smoothstep(hole - uCutRim, hole, across);
    if (edge < cutDither(gl_FragCoord.xy)) discard;
  }
}`);
    });
  }

  /** Tell the hole where the hero is and which way the camera is looking at him. */
  look(hero: THREE.Vector3, camera: THREE.Camera, target: THREE.Vector3): void {
    this.uniforms.uCutHero.value.copy(hero);
    this.uniforms.uCutLook.value.copy(target).sub(camera.position).normalize();
  }

  /** Keep the hole open, or stop. Costs a number, not a recompile. */
  show(on: boolean): void {
    this.uniforms.uCutOn.value = on ? 1 : 0;
  }
}

/** Where the player's choice is kept, so a world opens the way they left it. */
export const CUTAWAY_KEY = 'ai.world/see-through';

/** What they chose last time, or off — which is what it was before anybody asked for it back. */
export function wantsCutaway(store: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return store.getItem(CUTAWAY_KEY) === 'on';
  } catch {
    return false;                                // a browser with storage turned off is not an error
  }
}

/** Remember the choice. A failure here is not worth interrupting a game for. */
export function rememberCutaway(on: boolean, store: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    store.setItem(CUTAWAY_KEY, on ? 'on' : 'off');
  } catch { /* nothing to do */ }
}
