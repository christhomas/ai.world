import * as THREE from 'three';
import { buildChunkMesh } from '../world/mesher';
import type { PropLibrary } from '../render/props';
import type { DungeonWorld } from './world';

const MAX_TORCH_LIGHTS = 10;

/** Builds and owns the three.js scene for one dungeon visit. */
export class DungeonScene {
  readonly scene = new THREE.Scene();
  readonly heroLight = new THREE.PointLight(0xffc080, 3, 7, 1.6);
  private readonly terrain: THREE.Mesh[] = [];
  private propMeshes: THREE.Object3D[] = [];
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffb040 });

  constructor(private readonly world: DungeonWorld, private readonly props: PropLibrary, waterMaterial: THREE.Material, seed: number, opened: Set<string>) {
    this.scene.background = new THREE.Color(0x05060c);
    this.scene.add(new THREE.AmbientLight(0x3a4260, 0.75));
    const hemi = new THREE.HemisphereLight(0x384060, 0x14141c, 0.7);
    this.scene.add(hemi);
    this.scene.add(this.heroLight);

    const landMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const per = world.chunksPerSide;
    for (let cz = 0; cz < per; cz++) {
      for (let cx = 0; cx < per; cx++) {
        const chunk = world.chunkData(cx, cz);
        if (chunk.empty) continue;
        const meshes = buildChunkMesh(chunk, seed);
        if (meshes.land) this.terrain.push(this.addMesh(meshes.land, landMat, true));
        if (meshes.water) {
          const m = this.addMesh(meshes.water, waterMaterial, false);
          m.renderOrder = 2;
        }
      }
    }
    // a few torches carry real point lights; the rest just glow
    const torches = world.map.torches;
    const step = Math.max(1, Math.ceil(torches.length / MAX_TORCH_LIGHTS));
    for (let i = 0; i < torches.length; i += step) {
      const t = torches[i];
      const light = new THREE.PointLight(0xffa040, 5, 11, 1.5);
      light.position.set(t.x + 0.5 + Math.cos(t.rot) * 0.8, 2.0, t.z + 0.5 - Math.sin(t.rot) * 0.8);
      this.scene.add(light);
    }
    this.rebuildProps(opened);
  }

  private addMesh(data: { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array; flow?: Float32Array }, material: THREE.Material, shadows: boolean): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    if (data.flow) geo.setAttribute('flow', new THREE.BufferAttribute(data.flow, 1));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    this.scene.add(mesh);
    return mesh;
  }

  /** Instanced torches, stairs and chests; called again when a chest opens. */
  rebuildProps(opened: Set<string>): void {
    for (const m of this.propMeshes) { this.scene.remove(m); if (m instanceof THREE.InstancedMesh) m.dispose(); }
    this.propMeshes = [];
    const byKind = new Map<number, Array<{ x: number; y: number; z: number; rot: number }>>();
    for (const p of this.world.props(opened)) {
      let list = byKind.get(p.kind);
      if (!list) { list = []; byKind.set(p.kind, list); }
      list.push(p);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const [kind, list] of byKind) {
      const geo = this.props.geometries.get(kind);
      if (!geo) continue;
      const inst = new THREE.InstancedMesh(geo, this.props.material, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, one);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      this.scene.add(inst);
      this.propMeshes.push(inst);
      const glowGeo = this.props.glows.get(kind);
      if (glowGeo) {
        const glow = new THREE.InstancedMesh(glowGeo, this.glowMaterial, list.length);
        glow.instanceMatrix.copy(inst.instanceMatrix);
        glow.instanceMatrix.needsUpdate = true;
        this.scene.add(glow);
        this.propMeshes.push(glow);
      }
    }
  }

  dispose(): void {
    for (const t of this.terrain) t.geometry.dispose();
    for (const m of this.propMeshes) if (m instanceof THREE.InstancedMesh) m.dispose();
    this.glowMaterial.dispose();
  }
}
