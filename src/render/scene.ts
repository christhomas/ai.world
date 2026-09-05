import * as THREE from 'three';
import { CAMERA, WORLD } from '../core/config';
import { WaterMaterial } from './water';

const SKY = 0x8fc1e6;

/**
 * Half the depth of ground the camera covers, as a fraction of the zoom. The frustum is `zoom`
 * tall in screen space, and the camera looks down from CAMERA.HEIGHT over CAMERA.DIST, so the
 * strip of ground it lands on is longer than the screen by one over the sine of that pitch.
 */
const GROUND_DEPTH = 0.5 / Math.sin(Math.atan2(CAMERA.HEIGHT, CAMERA.DIST));

/**
 * How far along the ground a thing appears to be carried by every unit of its own height, away
 * from the camera. One over the tangent of the same pitch: at the forty-five degrees this game
 * looks down from it is exactly one, so a hill ten high shows up where ground ten further off
 * would. It is what lets a question about heights be answered as a question about distances.
 */
const LIFT = CAMERA.DIST / CAMERA.HEIGHT;

/**
 * Slack added to the view radius, in tiles. Two things live just past the edge of the ground in
 * shot and are still seen: something tall enough to show its head over it, and, when the sun is
 * low, something whose shadow reaches back into the picture.
 */
const VIEW_MARGIN = 8;

/**
 * How far past the last thing the picture needs the shadow slab reaches, in tiles.
 *
 * Same slack as the view for the same reason: the fit below is exact arithmetic on where the sun
 * is this frame, and the sun is moved after the camera is, so the fit is always a frame behind
 * what is finally drawn. A margin an eighth of a screen wide swallows that with room to spare.
 */
const SHADOW_MARGIN = 8;

/**
 * How much the shadow box overreaches the ground in shot, as a share of the zoom. Bigger than one
 * because the box is square and the picture is not; the corners of a wide screen need the slack.
 */
const SHADOW_SPREAD = 1.1;

/**
 * How far towards the light a surface is pushed before it asks the shadow map whether it is lit,
 * in world units. Without it a flat field shadows itself in stripes; with too much of it a shadow
 * comes away from the foot of the thing casting it.
 *
 * three.js takes this as a fraction of the shadow camera's depth range rather than as a distance,
 * so it has to be divided by the depth of the slab. That is the whole reason it is a number here
 * rather than a line in `createSceneRig`: the slab is fitted to the sun now and is three times
 * shallower at noon than it was, and a bias left as a fraction would have quietly got three times
 * weaker with it — the same shadows, drawn with stripes through them.
 */
const SHADOW_BIAS = 0.16;

/**
 * Where the camera is looking and how far from that point a thing can still be in shot. The rig
 * writes it on the scene every frame; anything drawing into that scene can read it and skip the
 * work of what nobody can see. Interiors and dungeons have no rig, so their scenes carry none of
 * this and nothing there is culled.
 */
export interface WorldView {
  x: number;
  z: number;
  /** Ground distance from (x, z) past which nothing can appear on screen. */
  radius: number;
}

/** The view the rig last recorded on a scene, or null if no rig ever has. */
export function worldView(scene: THREE.Object3D): WorldView | null {
  return (scene.userData.worldView as WorldView | undefined) ?? null;
}

/**
 * Tell a scene where the camera is looking. Written in place rather than replaced, because this
 * happens every frame and a fresh object every frame is rubbish for the collector to sweep.
 */
export function setWorldView(scene: THREE.Object3D, x: number, z: number, radius: number): void {
  const view = scene.userData.worldView as WorldView | undefined;
  if (view) { view.x = x; view.z = z; view.radius = radius; }
  else scene.userData.worldView = { x, z, radius } satisfies WorldView;
}

/**
 * How far the sun's shadow camera has to see, given where the sun stands over what the camera is
 * looking at. `height` and `flat` are how far up and how far along the ground the sun is from the
 * target, `groundRadius` the half-diagonal of the ground actually in shot, and `half` the
 * half-width of the shadow box.
 *
 * The far plane is a cut straight across the slab, so what it really decides is how far *down-sun*
 * of the target the shadow map still reaches, and down-sun is the cheap direction to give up: a
 * shadow falls away from the sun, so anything standing further down-sun than the picture goes
 * throws its shadow onto ground nobody can see. What must not be given up is a receiver — a piece
 * of ground, or a hillside, that is on screen and has something else's shadow lying across it.
 *
 * So the question is how far down-sun a point can be and still be on screen, and two facts pin
 * it. A thing `h` above the ground appears where ground `LIFT * h` further away would, so nothing
 * on screen is further from the target than `groundRadius + LIFT * h`. And the box is only `half`
 * wide across the sun's line, which caps how high a thing can be and still be inside it at a given
 * distance down-sun. Put together, a point that is both in the box and in the picture is at most
 * `(groundRadius * flat + LIFT * half * L) / (flat + LIFT * up)` down-sun of the target; past that
 * it is either off screen or was never in the shadow map at all.
 *
 * Four hundred, which this replaces, was about two and a half times that at the zoom the game is
 * usually played at, and every extra tile of it is loaded chunks handed to the shadow pass for
 * nothing. The saving is at its largest near dawn and dusk, which is also when the pass is at its
 * most expensive: a low sun rakes the slab out sideways and pulls in three times the ground a
 * midday sun does.
 */
export function shadowFar(height: number, flat: number, groundRadius: number, half: number): number {
  // a sun at or below the ground is not casting anything; treat it as sitting on the horizon
  const up = Math.max(0, height);
  const L = Math.hypot(flat, up);
  if (L === 0) return groundRadius + half + SHADOW_MARGIN;
  const reach = (groundRadius * flat + LIFT * half * L) / (flat + LIFT * up) + SHADOW_MARGIN;
  return L + reach * flat / L;
}

/** Scratch for reading the renderer's size, so `follow` allocates nothing per frame. */
const viewSize = new THREE.Vector2();

/**
 * How hard to work per frame. The costly parts of this world are the shadow pass and the number
 * of pixels, so those are what a level changes; nothing about the world itself is different.
 *
 * `device` means the display's own pixel ratio, which on a Retina screen is four times the
 * fragments of a plain one — worth it on a good GPU, painful on a laptop doing something else.
 */
export type Quality = 'low' | 'medium' | 'high';

export const QUALITY: Record<Quality, { pixels: number; shadows: boolean; shadowMap: number; label: string }> = {
  low:    { pixels: 1,   shadows: false, shadowMap: 1024, label: 'Low — no shadows, plain resolution' },
  medium: { pixels: 1.5, shadows: true,  shadowMap: 1024, label: 'Medium — shadows, some sharpening' },
  high:   { pixels: 2,   shadows: true,  shadowMap: 2048, label: 'High — everything, full resolution' },
};

/**
 * What is actually drawing this, straight from the driver. Worth showing: a browser that has
 * fallen back to software rendering looks like a slow computer, and there is no way to tell the
 * difference from inside the game without asking.
 */
export function describeGpu(renderer: THREE.WebGLRenderer): { name: string; accelerated: boolean } {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = String((info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || 'unknown');
  // the names a software rasteriser goes by in a browser
  const software = /swiftshader|llvmpipe|software|microsoft basic/i.test(raw);
  return { name: chipName(raw), accelerated: !software };
}

/**
 * Browsers report the graphics chip wrapped in the name of the layer that reached it, as in
 * `ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)`. The chip is the part worth showing.
 */
function chipName(raw: string): string {
  const angle = /^ANGLE \((.*)\)$/.exec(raw);
  if (!angle) return raw;
  const parts = angle[1].split(', ');
  // vendor, chip, driver — the middle is the one somebody would recognise
  const chip = parts.length >= 3 ? parts.slice(1, -1).join(', ') : angle[1];
  return chip.replace(/\s*\([^()]*\)\s*$/, '').trim() || raw;
}

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  water: WaterMaterial;
  /** Set true once a DayCycle positions the sun, so follow() stops overriding it. */
  sunDriven: boolean;
  /** Call every frame with the camera target so light, shadows and water travel with the view. */
  follow(x: number, z: number, zoom: number): void;
  /**
   * Fit the shadow slab to where the sun is now. `follow` does this with the sun it can see, which
   * is last frame's when a day cycle is driving it; whatever moves the sun should call this again
   * afterwards so the slab is cut for the light that is about to be drawn.
   */
  fitShadow(): void;
  resize(): void;
  /** How hard to work per frame. Saved, so the choice survives a return to the title. */
  quality: Quality;
  setQuality(level: Quality): void;
}

export function createSceneRig(container: HTMLElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    // photo mode reads the canvas back after a frame, which needs the buffer kept
    preserveDrawingBuffer: true,
    // on a machine with two graphics chips, ask for the quick one
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);

  const ambient = new THREE.AmbientLight(0xc9dcff, 0.45);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6f8f4f, 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  // the slab and its bias are refitted by `fitShadow` as soon as the camera says where it is
  // looking; this is only what the sun casts through until it does
  sun.shadow.camera.far = sun.shadow.camera.near + 100;
  sun.shadow.bias = -SHADOW_BIAS / 100;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // Water: one big translucent plane that follows the camera. Seabed shows through near the coast,
  // the dark "deep" plane underneath makes open water read as depth.
  const waterMat = new WaterMaterial();
  const seaGeo = new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2);
  {
    const c = new THREE.Color(0x2f86bf);
    const n = seaGeo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    seaGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    seaGeo.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(n), 1));
  }
  const water = new THREE.Mesh(seaGeo, waterMat.material);
  water.position.y = WORLD.WATER_Y;
  water.renderOrder = 1;
  scene.add(water);

  const deep = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshLambertMaterial({ color: 0x1d4f78 }),
  );
  deep.rotation.x = -Math.PI / 2;
  deep.position.y = -0.03;
  deep.receiveShadow = true;
  scene.add(deep);

  const SUN_OFFSET = new THREE.Vector3(38, 72, 22);

  /** What `follow` last measured, so the shadow can be refitted when only the sun has moved. */
  let groundRadius = 0;
  let shadowHalf = 0;

  /** The level chosen last time, if the player has ever chosen one. */
  const remembered = ((): Quality => {
    try {
      const saved = localStorage.getItem('ai.world/quality');
      if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
    } catch { /* private browsing: the default will do */ }
    return 'high';
  })();

  return {
    renderer, scene, sun, hemi, ambient, water: waterMat, sunDriven: false,
    quality: remembered,
    setQuality(level: Quality) {
      const want = QUALITY[level];
      this.quality = level;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, want.pixels));
      renderer.shadowMap.enabled = want.shadows;
      sun.castShadow = want.shadows;
      if (sun.shadow.mapSize.x !== want.shadowMap) {
        sun.shadow.mapSize.set(want.shadowMap, want.shadowMap);
        // the old shadow map is the wrong size now; three builds a new one when this is dropped
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      // every material has to be told, because whether it reads a shadow map is compiled into it
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material) material.needsUpdate = true;
        }
      });
      try { localStorage.setItem('ai.world/quality', level); } catch { /* nothing to do */ }
    },
    follow(x, z, zoom) {
      sun.target.position.set(x, 0, z);
      if (!this.sunDriven) sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
      const half = zoom * SHADOW_SPREAD;
      const cam = sun.shadow.camera;
      if (cam.right !== half) {
        cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
        cam.updateProjectionMatrix();
      }
      shadowHalf = half;
      water.position.set(x, WORLD.WATER_Y, z);
      deep.position.set(x, -0.03, z);
      // the ground in shot is a rectangle zoom*aspect across by zoom*GROUND_DEPTH*2 deep, centred
      // on the target; nothing past its half-diagonal can be seen, so nothing there need be drawn
      const size = renderer.getSize(viewSize);
      const aspect = size.x / Math.max(1, size.y);
      groundRadius = Math.hypot(zoom * aspect / 2, zoom * GROUND_DEPTH);
      setWorldView(scene, x, z, groundRadius + VIEW_MARGIN);
      this.fitShadow();
    },
    fitShadow() {
      // nothing has said where the camera is looking yet, so there is no picture to fit to
      if (shadowHalf === 0) return;
      const cam = sun.shadow.camera;
      const flat = Math.hypot(sun.position.x - sun.target.position.x, sun.position.z - sun.target.position.z);
      const far = shadowFar(sun.position.y - sun.target.position.y, flat, groundRadius, shadowHalf);
      // the sun crawls and the margin is eight tiles wide, so a slab that has barely moved is not
      // worth rebuilding a projection matrix for
      if (Math.abs(cam.far - far) < 1) return;
      cam.far = far;
      sun.shadow.bias = -SHADOW_BIAS / (far - cam.near);
      cam.updateProjectionMatrix();
    },
    resize() {
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
  };
}
