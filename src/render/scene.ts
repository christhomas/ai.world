import * as THREE from 'three';
import { WORLD } from '../core/config';
import { WaterMaterial } from './water';

const SKY = 0x8fc1e6;

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
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0004;
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
      const half = zoom * 1.1;
      const cam = sun.shadow.camera;
      if (cam.right !== half) {
        cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
        cam.updateProjectionMatrix();
      }
      water.position.set(x, WORLD.WATER_Y, z);
      deep.position.set(x, -0.03, z);
    },
    resize() {
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
  };
}
