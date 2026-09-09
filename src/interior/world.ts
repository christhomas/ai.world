import { WORLD } from '../core/config';
import type { TileWorld } from '../entities/entity';
import { ITile, blocksAt, furnitureBoxes, type InteriorMap } from './generate';
import type { Footprints } from '../world/footprints';
import type { Solids } from '../world/solids';

/** Interiors are flat, one terrace up, so the walls read as walls from above. */
const FLOOR_LEVEL = 1;
export const FLOOR_Y = FLOOR_LEVEL * WORLD.STEP;
export const WALL_HEIGHT = 3;

/** Walkability inside a building. Walls, counters and furniture are solid; the doorway is not. */
export class InteriorWorld implements TileWorld {
  /**
   * The furniture as boxes, when whoever built this room had the measurements to hand.
   *
   * A room is a grid and its walls are tiles, but a bed is 1.9 tiles long and a table is not tile
   * shaped either. Blocking them by the tile they stand on left the far half of every bed as
   * scenery you could stand in.
   */
  private readonly furniture: Solids | null;

  constructor(readonly map: InteriorMap, footprints?: Footprints) {
    this.furniture = footprints ? furnitureBoxes(map, footprints) : null;
  }

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

  blocked(x: number, z: number, room = 0): boolean {
    return blocksAt(this.map, x, z, this.furniture ?? undefined, room);
  }

  /** The way from one point to another, against the furniture: the same question as out of doors. */
  crosses(x0: number, z0: number, x1: number, z1: number, room = 0): boolean {
    return this.furniture?.crosses(x0, z0, x1, z1, room) ?? false;
  }

  isRoad(): boolean { return true; }

  /** Is the hero standing on the way out? */
  /**
   * How far from the doorway somebody is standing, in tiles.
   *
   * Given as a distance rather than a yes or no because two different questions are asked of it:
   * the key wants a generous reach, so pressing Enter anywhere near the door leaves; and walking
   * out wants a tight one, so brushing past the doorway on the way to the counter does not put you
   * in the street.
   */
  fromDoor(x: number, z: number): number {
    const [dx, dz] = this.map.door;
    return Math.hypot(dx + 0.5 - x, dz + 0.5 - z);
  }

  atDoor(x: number, z: number): boolean {
    return this.fromDoor(x, z) < 1.2;
  }

  /**
   * Is somebody standing in the doorway itself, rather than merely near it?
   *
   * The door is always the middle of the south wall, so the way through it is z and the wall is x.
   * Narrow along the wall on purpose: walking the length of a shop counter takes you past the
   * doorway, and that is not the same as leaving.
   */
  inDoorway(x: number, z: number, across: number, along: number): boolean {
    const [dx, dz] = this.map.door;
    return Math.abs(z - (dz + 0.5)) <= across && Math.abs(x - (dx + 0.5)) <= along;
  }

  /** Is the keeper (shopkeeper or priest) within talking distance? */
  nearKeeper(x: number, z: number, range = 2.6): boolean {
    if (!this.map.keeper) return false;
    const [kx, kz] = this.map.keeper;
    return Math.hypot(kx + 0.5 - x, kz + 0.5 - z) < range;
  }
}
