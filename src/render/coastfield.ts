import * as THREE from 'three';
import { WORLD } from '../core/config';
import { TileType } from '../world/terrain';
import type { ChunkSource } from '../world/tiles';

/**
 * How far every point of open water is from the nearest land, as a picture the water shader reads.
 *
 * Waves are not a texture. Out at sea a swell is long and slow, and as it comes into the shallows
 * it feels the bottom: it slows down, the crests bunch up behind each other, they stand up, and
 * they break in a line along the shore. Every one of those is a function of one number — how far
 * you are from land — and the shader has no way to know it, because water is one flat plane and
 * the coast is somewhere else entirely.
 *
 * So the number is measured here, on the ground the chunks have already generated, and handed over
 * as a small greyscale image centred on the camera: nought at the water's edge, one out where the
 * open sea begins. That is enough for the whole of the shape above. Crests become contour lines of
 * this field, which is exactly what refraction does to a real swell — waves arrive parallel to the
 * beach whatever direction they started from, because the end nearest the shore is always the end
 * that slows first.
 *
 * It costs one sweep over the loaded chunks whenever the camera has moved a few tiles, and nothing
 * at all in between.
 */

export const COAST = {
  /** Cells across the field. Its area is this squared, so it is the cost as much as the size. */
  SIZE: 192,
  /** World units per cell. Two tiles: fine enough for a line of surf, coarse enough to be free. */
  CELL: 2,
  /**
   * How far from land the field still says anything, in world units.
   *
   * Past this everything is "open sea" and the waves stop caring about the coast. It wants to be
   * further out than the deepest water anybody can see at once and no further, because the further
   * it reaches the coarser the contours near the shore come out once it is squeezed into a byte.
   */
  RANGE: 64,
  /** How far the camera may travel before the field is measured again, in world units. */
  RESTEP: 6,
  /**
   * And how long it may stand still first, in milliseconds.
   *
   * Movement is not the only thing that changes the answer: the ground streams in a chunk at a
   * time, so the sea round somebody who has just arrived is measured against a world that is not
   * there yet. Without this the water at the end of a teleport stays flat open ocean for as long
   * as the player stands still on the beach, which is exactly as long as they are looking at it.
   */
  REFRESH: 400,
} as const;

/** Half the field's width in world units: what the camera stands in the middle of. */
const HALF = (COAST.SIZE * COAST.CELL) / 2;

const SQRT2 = Math.SQRT2;

/**
 * Distance from each cell to the nearest land cell, in cells.
 *
 * A two-pass chamfer sweep: forwards over the grid taking the best of the four neighbours already
 * settled, then backwards over the other four. It is not quite Euclidean — a diagonal run comes
 * out about two per cent long — and for a wave field that is far below what anybody could see.
 *
 * Exported for its own test, because a distance transform is the kind of thing that is either
 * right or subtly and invisibly wrong.
 */
export function spreadFromLand(land: Uint8Array, size: number, out: Float32Array): Float32Array {
  const far = size * 2;
  for (let i = 0; i < land.length; i++) out[i] = land[i] ? 0 : far;

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = z * size + x;
      if (out[i] === 0) continue;
      let best = out[i];
      if (z > 0) {
        best = Math.min(best, out[i - size] + 1);
        if (x > 0) best = Math.min(best, out[i - size - 1] + SQRT2);
        if (x < size - 1) best = Math.min(best, out[i - size + 1] + SQRT2);
      }
      if (x > 0) best = Math.min(best, out[i - 1] + 1);
      out[i] = best;
    }
  }
  for (let z = size - 1; z >= 0; z--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = z * size + x;
      if (out[i] === 0) continue;
      let best = out[i];
      if (z < size - 1) {
        best = Math.min(best, out[i + size] + 1);
        if (x > 0) best = Math.min(best, out[i + size - 1] + SQRT2);
        if (x < size - 1) best = Math.min(best, out[i + size + 1] + SQRT2);
      }
      if (x < size - 1) best = Math.min(best, out[i + 1] + 1);
      out[i] = best;
    }
  }
  return out;
}

/** Is a tile something a wave would break against? Everything that is not water or unmade. */
function isLandTile(type: number): boolean {
  return type !== TileType.Skip && type !== TileType.Seabed && type !== TileType.Water;
}

export class CoastField {
  readonly texture: THREE.DataTexture;
  /** World position of the corner of cell (0,0), and how wide the whole field is. */
  x0 = -HALF;
  z0 = -HALF;
  readonly span = COAST.SIZE * COAST.CELL;

  private readonly land = new Uint8Array(COAST.SIZE * COAST.SIZE);
  private readonly dist = new Float32Array(COAST.SIZE * COAST.SIZE);
  private readonly bytes = new Uint8Array(COAST.SIZE * COAST.SIZE);
  /** Where the field was last measured from, and when. Nowhere and never, until it has been. */
  private atX = Infinity;
  private atZ = Infinity;
  private atTime = -Infinity;

  constructor() {
    // open sea until somebody says otherwise: a frame drawn before the first sweep should look
    // like water a long way from anywhere, not like land pressed against the camera
    this.bytes.fill(255);
    this.texture = new THREE.DataTexture(this.bytes, COAST.SIZE, COAST.SIZE, THREE.RedFormat);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
  }

  /**
   * Measure the coast around a point, if the camera has moved far enough to be worth it.
   *
   * The origin is snapped to whole cells so the grid stands still in the world as the view moves
   * over it. Without that every sweep samples the ground half a cell off from the last one and the
   * whole sea shimmers as you walk.
   */
  update(x: number, z: number, source: ChunkSource, now: number, force = false): boolean {
    const still = Math.abs(x - this.atX) < COAST.RESTEP && Math.abs(z - this.atZ) < COAST.RESTEP;
    if (!force && still && now - this.atTime < COAST.REFRESH) return false;
    this.atX = x;
    this.atZ = z;
    this.atTime = now;
    this.x0 = Math.floor((x - HALF) / COAST.CELL) * COAST.CELL;
    this.z0 = Math.floor((z - HALF) / COAST.CELL) * COAST.CELL;
    this.sample(source);
    spreadFromLand(this.land, COAST.SIZE, this.dist);
    const scale = (COAST.CELL / COAST.RANGE) * 255;
    for (let i = 0; i < this.bytes.length; i++) {
      this.bytes[i] = Math.min(255, this.dist[i] * scale);
    }
    this.texture.needsUpdate = true;
    return true;
  }

  /**
   * Read the ground into the land grid, one chunk at a time.
   *
   * Chunk by chunk rather than cell by cell on purpose: a chunk is eight cells across, so asking
   * per cell would look the same chunk up sixty-four times over. A chunk that is not loaded, or
   * that came back with nothing in it, is open water — which is what it is, out past the coast.
   */
  private sample(source: ChunkSource): void {
    this.land.fill(0);
    const CS = WORLD.CHUNK_SIZE;
    const perChunk = CS / COAST.CELL;
    const firstX = Math.floor(this.x0 / CS);
    const firstZ = Math.floor(this.z0 / CS);
    const lastX = Math.floor((this.x0 + this.span) / CS);
    const lastZ = Math.floor((this.z0 + this.span) / CS);

    for (let cz = firstZ; cz <= lastZ; cz++) {
      for (let cx = firstX; cx <= lastX; cx++) {
        const tiles = source.getTiles(cx, cz);
        if (!tiles) continue;
        // where this chunk's own first cell lands in the field
        const baseX = Math.round((cx * CS - this.x0) / COAST.CELL);
        const baseZ = Math.round((cz * CS - this.z0) / COAST.CELL);
        for (let lz = 0; lz < perChunk; lz++) {
          const gz = baseZ + lz;
          if (gz < 0 || gz >= COAST.SIZE) continue;
          for (let lx = 0; lx < perChunk; lx++) {
            const gx = baseX + lx;
            if (gx < 0 || gx >= COAST.SIZE) continue;
            // the middle of the cell, in the chunk's own tiles
            const tile = (lz * COAST.CELL + (COAST.CELL >> 1)) * CS + lx * COAST.CELL + (COAST.CELL >> 1);
            if (isLandTile(tiles.types[tile])) this.land[gz * COAST.SIZE + gx] = 1;
          }
        }
      }
    }
  }

  /** What the shader needs to find itself in the field: the corner, the scale, and the range. */
  area(into: THREE.Vector4): THREE.Vector4 {
    return into.set(this.x0, this.z0, 1 / this.span, COAST.RANGE);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
