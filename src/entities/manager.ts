import type * as THREE from 'three';
import { WORLD } from '../core/config';
import { hash3, mulberry32, type Rng } from '../core/rng';
import type { Biome } from '../world/biomes';
import { TileType } from '../world/terrain';
import { BIOME_ANIMALS, KINDS, WATER_ANIMALS, pickKind } from './animals';
import { Entity, Herd, canStand, updateEntity, updateHerd, type TileWorld } from './entity';
import type { EntityRenderer } from './pool';
import type { Village } from '../world/structures';

/** Per-chunk tile arrays the manager needs for spawning; provided by ChunkManager. */
export interface ChunkTiles {
  cx: number;
  cz: number;
  types: Uint8Array;
  heights: Float32Array;
  waters: Float32Array;
  blocked: Uint8Array;
  biomes: Uint8Array;
}

export interface ChunkSource {
  getTiles(cx: number, cz: number): ChunkTiles | null;
}

const SPAWN_RADIUS = 4;      // chunks around the player that get creatures
const ACTIVE_RANGE = 44;     // tiles; beyond this creatures freeze

/**
 * Spawns herds per chunk (deterministically from the seed), despawns them when the player
 * moves away, and ticks behaviour for creatures near the player.
 */
export class EntityManager {
  private readonly spawned = new Map<string, Entity[]>();
  private readonly herds = new Set<Herd>();
  private readonly rng: Rng;
  private focusCx = Number.NaN;
  private focusCz = Number.NaN;

  constructor(
    private readonly renderer: EntityRenderer,
    private readonly world: TileWorld,
    private readonly chunks: ChunkSource,
    private readonly seed: number,
    private readonly villages: Village[] = [],
  ) {
    this.rng = mulberry32((seed ^ 0xbeef) >>> 0);
  }

  get count(): number { return this.renderer.count; }

  update(dt: number, playerX: number, playerZ: number): void {
    const CS = WORLD.CHUNK_SIZE;
    const cx = Math.floor(playerX / CS), cz = Math.floor(playerZ / CS);
    if (cx !== this.focusCx || cz !== this.focusCz) {
      this.focusCx = cx; this.focusCz = cz;
      for (const [key, list] of this.spawned) {
        const [kx, kz] = key.split(',').map(Number);
        if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) > SPAWN_RADIUS + 1) this.despawn(key, list);
      }
    }
    // chunks arrive asynchronously, so keep polling the spawn window
    for (let dz = -SPAWN_RADIUS; dz <= SPAWN_RADIUS; dz++) {
      for (let dx = -SPAWN_RADIUS; dx <= SPAWN_RADIUS; dx++) {
        const key = `${cx + dx},${cz + dz}`;
        if (this.spawned.has(key)) continue;
        const tiles = this.chunks.getTiles(cx + dx, cz + dz);
        if (!tiles) continue;
        this.spawned.set(key, this.spawnChunk(tiles, key));
      }
    }

    const ctx = { world: this.world, rng: this.rng, playerX, playerZ };
    for (const h of this.herds) updateHerd(h, dt, ctx);
    const r2 = ACTIVE_RANGE * ACTIVE_RANGE;
    for (const list of this.spawned.values()) {
      for (const e of list) {
        const dx = e.x - playerX, dz = e.z - playerZ;
        if (dx * dx + dz * dz > r2) continue;
        updateEntity(e, dt, ctx);
      }
    }
  }

  /** Closest creature within `r` tiles of a point. */
  nearest(x: number, z: number, r: number): Entity | null {
    let best: Entity | null = null, bestD = r * r;
    for (const list of this.spawned.values()) {
      for (const e of list) {
        const d = (e.x - x) ** 2 + (e.z - z) ** 2;
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  pick(raycaster: THREE.Raycaster): Entity | null {
    const hits = raycaster.intersectObjects(this.renderer.pickables(), false);
    for (const h of hits) {
      const e = this.renderer.entityAt(h);
      if (e) return e;
    }
    return null;
  }

  private despawn(key: string, list: Entity[]): void {
    for (const e of list) {
      this.renderer.remove(e);
      const h = e.herd;
      const i = h.members.indexOf(e);
      if (i >= 0) h.members.splice(i, 1);
      if (h.members.length === 0) this.herds.delete(h);
    }
    this.spawned.delete(key);
  }

  private spawnChunk(tiles: ChunkTiles, key: string): Entity[] {
    const CS = WORLD.CHUNK_SIZE;
    const rng = mulberry32(hash3(this.seed, tiles.cx, tiles.cz, 4242));
    const land: number[] = [], water: number[] = [], road: number[] = [];
    const biomeCount = new Map<number, number>();
    for (let i = 0; i < CS * CS; i++) {
      const t = tiles.types[i];
      if (t === TileType.Ground || t === TileType.GroundAlt || t === TileType.Sand) {
        if (!tiles.blocked[i]) land.push(i);
        biomeCount.set(tiles.biomes[i], (biomeCount.get(tiles.biomes[i]) ?? 0) + 1);
      } else if (t === TileType.Water) {
        water.push(i);
      } else if (t === TileType.Road || t === TileType.Bridge) {
        road.push(i);
      }
    }
    const out: Entity[] = [];
    if (land.length === 0 && water.length === 0 && road.length === 0) return out;
    let biome = 0 as Biome, best = -1;
    for (const [b, n] of biomeCount) if (n > best) { best = n; biome = b as Biome; }

    const tileXZ = (i: number): [number, number] => [
      tiles.cx * CS + (i % CS) + 0.5, tiles.cz * CS + Math.floor(i / CS) + 0.5,
    ];

    const place = (kindId: string, anchor: [number, number], count: number, leash: number): Herd => {
      const kind = KINDS[kindId];
      const herd = new Herd(kind, anchor[0], anchor[1], anchor[0], anchor[1], leash);
      for (let n = 0; n < count; n++) {
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
          const a = rng() * Math.PI * 2, r = kind.behaviour === 'fly' ? 4 : rng() * 2.2;
          const x = anchor[0] + Math.cos(a) * r, z = anchor[1] + Math.sin(a) * r;
          if (!canStand(this.world, kind, x, z)) continue;
          const e = new Entity(kind, x, z, herd, key, rng);
          const gy = kind.behaviour === 'fly' ? (this.world.heightAt(x, z) ?? 0) + (kind.altitude ?? 7) : (this.world.waterAt(x, z) ?? this.world.heightAt(x, z) ?? 0);
          e.y = gy;
          e.yaw = rng() * Math.PI * 2;
          if (!this.renderer.add(e)) break;
          herd.members.push(e);
          out.push(e);
          placed = true;
        }
      }
      if (herd.members.length > 0) this.herds.add(herd);
      return herd;
    };

    // villagers on the square, a congregation by the church door, keepers at their shop doors
    const inChunk = (x: number, z: number) => Math.floor(x / CS) === tiles.cx && Math.floor(z / CS) === tiles.cz;
    for (const v of this.villages) {
      if (inChunk(v.x, v.z)) {
        const herd = place('villager', [v.x, v.z], 2 + Math.floor(rng() * 3), Math.max(8, v.radius * 0.7));
        herd.tag = v.name;
      }
      if (v.churchDoor && inChunk(v.churchDoor[0] + 0.5, v.churchDoor[1] + 0.5)) {
        const herd = place('villager', [v.churchDoor[0] + 0.5, v.churchDoor[1] + 0.5], 3 + Math.floor(rng() * 2), 2.5);
        herd.tag = v.name;
        for (const e of herd.members) e.role = 'congregation';
      }
      for (const shop of v.shops) {
        if (!inChunk(shop.doorX + 0.5, shop.doorZ + 0.5)) continue;
        const herd = place('shopkeeper', [shop.doorX + 0.5, shop.doorZ + 0.5], 1, 1.2);
        herd.tag = v.name;
        for (const e of herd.members) { e.role = 'shopkeeper'; e.shop = shop.type; }
      }
    }

    // land herds
    if (land.length >= 30) {
      const rolls = rng() < 0.6 ? (rng() < 0.3 ? 2 : 1) : 0;
      for (let h = 0; h < rolls; h++) {
        const kindId = pickKind(BIOME_ANIMALS[biome], rng());
        if (!kindId) break;
        const kind = KINDS[kindId];
        const anchor = tileXZ(land[Math.floor(rng() * land.length)]);
        const size = kind.herd[0] + Math.floor(rng() * (kind.herd[1] - kind.herd[0] + 1));
        place(kindId, anchor, size, 12);
      }
    }
    // water herds
    if (water.length >= 6 && rng() < 0.55) {
      const kindId = pickKind(WATER_ANIMALS[biome], rng());
      if (kindId) {
        const kind = KINDS[kindId];
        const anchor = tileXZ(water[Math.floor(rng() * water.length)]);
        const size = kind.herd[0] + Math.floor(rng() * (kind.herd[1] - kind.herd[0] + 1));
        place(kindId, anchor, size, 6);
      }
    }
    // travellers on the road
    if (road.length >= 12 && rng() < 0.3) {
      const anchor = tileXZ(road[Math.floor(rng() * road.length)]);
      place('traveller', anchor, 1 + Math.floor(rng() * 2), 30);
    }
    return out;
  }
}
