import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PASSES, presenterFor, worthAComposer } from './secondrig';

/**
 * A second way of drawing the same scene, and when it is worth building one.
 *
 * #288 made this possible by giving the rig a `draw(scene, camera)` — one place a frame is
 * submitted from. A rig that draws through an `EffectComposer` is a rig with a different `draw`,
 * and nothing that asks for a picture has to know which kind it got.
 *
 * ## What protects the old look
 *
 * Not git — git protects the code, and the code was never the risk. The risk #250 names is **shared
 * tuning**: the sun at 2.6, the ambient at 0.45, the shadow bias. Retune any of those for the
 * composer path and the classic path changes without a line of its own being touched.
 *
 * So the answer here is structural rather than disciplined: the composer changes **only `draw`**.
 * Same renderer, same lights, same scene, same constants. There is no composer-side copy of any
 * number, so there is nothing to drift. The strongest version of "do not move shared tuning" is
 * having nowhere to move it to.
 *
 * ## And the cost, which is a real one
 *
 * `antialias: true` on the renderer does nothing once the scene draws into a render target, so the
 * composer path has to bring its own edges. That is what `SMAAPass` is for, and proving the edges
 * are as good as they were is most of the work in this item — which is now checkable, because #295
 * landed a picture comparison.
 */

describe('when a composer is worth building', () => {
  it('is not, when nobody asked for it', () => {
    expect(worthAComposer(false, 'high')).toBe(false);
  });

  it('is, when somebody turned it on', () => {
    expect(worthAComposer(true, 'high')).toBe(true);
    expect(worthAComposer(true, 'medium')).toBe(true);
  });

  it('is never, at low quality, whatever the switch says', () => {
    // #250's own line: low quality never pays for a composer it is not using. Somebody on `low` is
    // there because the machine is struggling, and a second full-screen pass is the last thing it
    // needs — the switch is a preference, and this is the machine's answer to it
    expect(worthAComposer(true, 'low')).toBe(false);
  });
});

describe('what the composer draws through', () => {
  it('is three passes and nothing else, which is assembly rather than authoring', () => {
    expect(PASSES).toEqual(['render', 'smaa', 'output']);
  });

  it('has no bloom, no depth of field, no vignette, and nothing filmic', () => {
    // stated as a test so that reaching for a preset fails here rather than in somebody's opinion.
    // The look is deliberately blocky and loud; a composer is here to make it more itself
    for (const unwanted of ['bloom', 'bokeh', 'dof', 'vignette', 'film', 'aces', 'agx']) {
      expect(PASSES, unwanted).not.toContain(unwanted);
    }
  });

  it('keeps antialiasing, because edge crawl is noise rather than style', () => {
    expect(PASSES).toContain('smaa');
  });
});

/**
 * One presenter per rig, chosen when the rig is built (#249).
 *
 * The rig used to decide between the canvas and the composer inside its draw, on every frame, so
 * the WebGL sink had two submission calls behind an `if`. The choice never changes under a running
 * rig, because the quality it depends on is the one the rig was built with. So it is made once, and
 * the sink hands every frame to the one presenter it got.
 */
describe('how a finished scene reaches the canvas', () => {
  /** Just enough of a renderer to see what was drawn: a composer is never built for these. */
  const aRenderer = () => {
    const drawn: Array<[THREE.Scene, THREE.Camera]> = [];
    const renderer = { render: (scene: THREE.Scene, camera: THREE.Camera) => { drawn.push([scene, camera]); } };
    return { drawn, renderer: renderer as unknown as THREE.WebGLRenderer };
  };

  for (const [asked, quality] of [[false, 'high'], [false, 'medium'], [true, 'low']] as const) {
    it(`draws straight at the canvas when the composer is ${asked ? 'refused at low' : 'not asked for'} (${quality})`, () => {
      const { drawn, renderer } = aRenderer();
      const presenter = presenterFor(renderer, asked, quality);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera();
      presenter.draw(scene, camera);
      presenter.draw(scene, camera);
      expect(drawn, 'each frame is one draw of the scene the sink was handed').toEqual([[scene, camera], [scene, camera]]);
      // and the rig can resize and dispose it without knowing which kind it got
      presenter.resize();
      presenter.dispose();
    });
  }
});
