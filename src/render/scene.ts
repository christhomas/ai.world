import * as THREE from 'three';
import { WORLD } from '../core/config';
import { WaterMaterial } from './water';

const SKY = 0x8fc1e6;

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
}

export function createSceneRig(container: HTMLElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
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

  return {
    renderer, scene, sun, hemi, ambient, water: waterMat, sunDriven: false,
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
