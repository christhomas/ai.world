import { WORLD } from '../core/config';
import type { TileWorld } from '../entities/entity';
import { ITile, blocksAt, type InteriorMap } from './generate';

/** Interiors are flat, one terrace up, so the walls read as walls from above. */
export const FLOOR_LEVEL = 1;
export const FLOOR_Y = FLOOR_LEVEL * WORLD.STEP;
export const WALL_HEIGHT = 3;

/** Walkability inside a building. Walls, counters and furniture are solid; the doorway is not. */
export class InteriorWorld implements TileWorld {
  constructor(readonly map: InteriorMap) {}

  tile(x: number, z: number): ITile | null {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.map.w || tz >= this.map.h) return null;
    return this.map.tiles[tz * this.map.w + tx] as ITile;
  }

  heightAt(x: number, z: number): number | null {
    const t = this.tile(x, z);
    if (t === null || t === ITile.Wall || t === ITile.Counter) return null;
    return FLOOR_Y;
  }

  waterAt(): number | null { return null; }

  blocked(x: number, z: number): boolean { return blocksAt(this.map, x, z); }

  isRoad(): boolean { return true; }

  /** Is the hero standing on the way out? */
  atDoor(x: number, z: number): boolean {
    const [dx, dz] = this.map.door;
    return Math.hypot(dx + 0.5 - x, dz + 0.5 - z) < 1.2;
  }

  /** Is the keeper (shopkeeper or priest) within talking distance? */
  nearKeeper(x: number, z: number, range = 2.6): boolean {
    if (!this.map.keeper) return false;
    const [kx, kz] = this.map.keeper;
    return Math.hypot(kx + 0.5 - x, kz + 0.5 - z) < range;
  }
}
