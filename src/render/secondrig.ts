import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from './scene';

/**
 * A second way of drawing the same scene: through an `EffectComposer` rather than straight at the
 * canvas.
 *
 * #288 is what made this a small change. It gave the rig `draw(scene, camera)` — one place a frame
 * is submitted from — so a composer rig is a rig with a different `draw`, and nothing that asks for
 * a picture has to know which kind it got.
 *
 * ## What protects the old look
 *
 * Not git. Git protects the code and the code was never the risk. The risk #250 names is **shared
 * tuning**: the sun at 2.6, the ambient at 0.45, the shadow bias. Retune one of those for this path
 * and the classic path changes without a line of its own being touched.
 *
 * The answer here is structural rather than a promise to be careful: **this changes only `draw`**.
 * Same renderer, same lights, same scene, same constants. There is no composer-side copy of any
 * number anywhere in this file, so there is nothing that can drift. The strongest form of "do not
 * move shared tuning" is having nowhere to move it to.
 *
 * ## Keep it blocky
 *
 * Three passes and nothing else, all of them shipped with three — this is assembly, not authoring.
 * No bloom, no depth of field, no vignette, nothing filmic. ACES and AgX both pull toward cinematic
 * desaturation and this world's flat colours should stay flat and loud. `OutputPass` is here to
 * write the buffer back out, not to grade it.
 *
 * Antialiasing stays, and it has to be asked for explicitly: `antialias: true` on the renderer does
 * *nothing* once the scene draws into a render target, so without `SMAAPass` this path would ship
 * worse edges than the one it is offered as an alternative to. Edge crawl is noise rather than
 * style.
 */
export const PASSES = ['render', 'smaa', 'output'] as const;

/**
 * Whether to build one at all.
 *
 * A switch is a preference and this is the machine's answer to it. Somebody on `low` is there
 * because the machine is struggling, and a second full-screen pass every frame is the last thing it
 * needs — #250 says it in as many words: low quality never pays for a composer it is not using.
 */
export function worthAComposer(asked: boolean, quality: Quality): boolean {
  return asked && quality !== 'low';
}

/**
 * The composer itself, and the `draw` that goes through it.
 *
 * Sized to the renderer rather than to the window, so the pixel ratio a quality level sets is the
 * ratio the passes work at. Resizing is the caller's, for the same reason the rig owns `resize`.
 */
export function composerFor(renderer: THREE.WebGLRenderer): {
  draw(scene: THREE.Scene, camera: THREE.Camera): void;
  resize(): void;
  dispose(): void;
} {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);
  // built once and re-aimed per frame: the scene and camera change between the surface, a room and
  // a floor underground, and rebuilding a composer three times a frame would cost more than the
  // pass saves
  const render = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  // built from `PASSES` rather than beside it, so the list is the thing that decides rather than a
  // description of what somebody wrote underneath it — a list beside a list falls out of step
  const make = { render: () => render, smaa: () => new SMAAPass(), output: () => new OutputPass() };
  for (const pass of PASSES) composer.addPass(make[pass]());

  return {
    draw(scene, camera) {
      render.scene = scene;
      render.camera = camera;
      composer.render();
    },
    resize() {
      const now = renderer.getSize(new THREE.Vector2());
      composer.setSize(now.x, now.y);
    },
    dispose() {
      composer.dispose();
    },
  };
}
