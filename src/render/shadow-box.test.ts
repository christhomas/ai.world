import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CAMERA } from '../core/config';
import { createSceneRig, shadowFar, type RigHost } from './scene';

/**
 * The native bridges used to cast the sun's shadow through a fixed window of their own, 64 units
 * across and centred thirty units in front of the camera. Close in, or with the hero high on a sky
 * island, that window missed what the web shadows (#512). Now the web rig hands the box its own
 * shadow camera was fitted to over with the sun, and both bridges cast through it.
 */

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A rig with no WebGL, as the headless game builds one: everything but the renderer. */
const host: RigHost = {
  container: null,
  canvas: () => null,
  recordOnly: true,
  size: () => ({ width: 1200, height: 540 }),
  pixelRatio: () => 1,
  remembered: () => 'high',
  remember: () => {},
  presenter: () => { throw new Error('nothing is presented without a page'); },
};

/** The half-diagonal of the ground in shot, as `follow` measures it for this host. */
const groundRadius = (zoom: number) =>
  Math.hypot(zoom * (1200 / 540) / 2, zoom * 0.5 / Math.sin(Math.atan2(CAMERA.HEIGHT, CAMERA.DIST)));

describe('the shadow box a frame carries with the sun', () => {
  it('is the box the web fitted its shadow camera to, and follows the view and the sun', () => {
    const rig = createSceneRig(host);
    try {
      rig.graph.camera = { orthographic: true, projection: identity, world: identity };
      const sun = () => rig.graph.frame().nodes.find((node) => node.kind === 'directional')!;

      rig.follow(10, 20, 10);
      const close = sun();
      // the rig's own sun, hung over the view at its fixed offset until a day cycle drives it
      expect(close.world.slice(12, 15)).toEqual([48, 72, 42]);
      expect(close.target).toEqual([10, 0, 20]);
      expect(close.shadow).toMatchObject({ left: -11, right: 11, top: 11, bottom: -11, near: 1 });
      expect(close.shadow!.far).toBeCloseTo(shadowFar(72, Math.hypot(38, 22), groundRadius(10), 11), 4);
      // an unchanged view is an unchanged entry, so the packet does not resend the light
      expect(sun()).toBe(close);

      rig.follow(10, 20, 30);
      const far = sun();
      expect(far.shadow).toMatchObject({ left: -33, right: 33, top: 33, bottom: -33, near: 1 });
      expect(far.shadow!.far).toBeGreaterThan(close.shadow!.far);

      // a low sun rakes the slab out sideways, and the frame has the deeper slab
      rig.sunDriven = true;
      rig.lighting.sun.position = [10 + 60, 24, 20 + 26];
      rig.fitShadow();
      const low = sun();
      expect(low.shadow!.far).toBeCloseTo(shadowFar(24, Math.hypot(60, 26), groundRadius(30), 33), 4);
      expect(low.shadow!.far).not.toBeCloseTo(far.shadow!.far, 0);
    } finally {
      rig.dispose();
    }
  });
});

const android = readFileSync('client/flutter/android/app/src/main/kotlin/world/ai/ai_world_flutter/WorldRendererBridge.kt', 'utf8');
const ios = readFileSync('client/flutter/ios/Runner/WorldRendererBridge.swift', 'utf8');

describe('both native bridges cast the sun\'s shadow as the web does', () => {
  it('read the box from the shadow-casting light, with that light\'s position and target', () => {
    expect(android).toContain('shadowCamera = ShadowCamera.of(sun["shadow"], matrix, point)');
    expect(android).toContain('floatArrayOf(world[12], world[13], world[14]), floatArrayOf(point[0], point[1], point[2])');
    expect(ios).toContain('shadowCamera = ShadowCamera.of(sun["shadow"],');
    expect(ios).toContain('eye: SIMD3(matrix[12].floatValue, matrix[13].floatValue, matrix[14].floatValue)');
    expect(ios).toContain('target: SIMD3(point[0].floatValue, point[1].floatValue, point[2].floatValue))');
    for (const [name, source, shadowed] of [['GLES', android, 'if (index == shadowed) {'], ['Metal', ios, 'if index == shadowed {']]) {
      // only for the light the shadow map belongs to, and forgotten by a frame that sends none
      expect(source.indexOf(shadowed), name).toBeGreaterThan(0);
      expect(source.indexOf('shadowCamera = ShadowCamera.of(', source.indexOf(shadowed)), name).toBeGreaterThan(0);
      expect(source, name).toMatch(/sunCastsShadow = false\s+shadowCamera = (null|nil)/);
    }
  });

  it('stand the shadow camera at the light, look at its target and project through the box', () => {
    expect(android).toContain('Matrix.setLookAtM(lightView, 0, sunCamera.eye[0], sunCamera.eye[1], sunCamera.eye[2],\n'
      + '                sunCamera.target[0], sunCamera.target[1], sunCamera.target[2], 0f, 1f, 0f)');
    // Android's orthoM takes bottom before top; three.js's camera holds them the other way round
    expect(android).toContain('Matrix.orthoM(lightProjection, 0, sunCamera.left, sunCamera.right, sunCamera.bottom, sunCamera.top, sunCamera.near, sunCamera.far)');
    expect(ios).toContain('orthographic(left: left, right: right, bottom: bottom, top: top, near: near, far: far) *\n'
      + '      lookAt(eye: eye, center: target, up: SIMD3(0,1,0))');
    expect(ios).toContain('let light = shadowCamera?.matrix');
  });

  it('keep the old fixed window only for a frame that sends no box', () => {
    expect(android.match(/orthoM\(lightProjection,0,-32f,32f,-32f,32f,\.1f,120f\)/g)).toHaveLength(1);
    expect(android.indexOf('orthoM(lightProjection,0,-32f')).toBeGreaterThan(android.indexOf('if (sunCamera != null) {'));
    expect(ios).toContain('?? orthographic(left:-32,right:32,bottom:-32,top:32,near:0.1,far:120)');
  });
});
