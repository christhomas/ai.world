/**
 * Tiles that are solid because somebody put something there after the ground was made.
 *
 * A chunk's blocked flags are baked in the worker when its ground is generated, which is right for
 * everything the world grows and no use at all for a house the player commissioned this afternoon.
 * The first house anybody built could be walked straight through: everything else about it was
 * real, and that one thing gave it away.
 *
 * Rebaking the chunk would be the thorough answer and it costs a regeneration every time a wall
 * goes up. This is a handful of tiles consulted on the way past instead.
 */
export class Standing {
  private tiles = new Set<number>();

  /**
   * One tile as one number, so the set holds primitives rather than strings.
   *
   * The offset keeps both halves positive and the stride is wider than any coordinate the world
   * uses, so no two tiles can land on the same key. A collision here would wall off somewhere
   * nobody had built anything, which is close to impossible to diagnose from inside the game.
   */
  private static key(tx: number, tz: number): number {
    return (tz + Standing.OFFSET) * Standing.STRIDE + (tx + Standing.OFFSET);
  }

  private static readonly OFFSET = 0x80000;
  private static readonly STRIDE = 0x100000;

  /**
   * Replace everything standing.
   *
   * Given whole rather than added to, because the caller owns the list: a house can be abandoned
   * or a commission dropped, and an add-only overlay would quietly accumulate walls that nobody
   * had built and nobody could pull down.
   */
  replace(tiles: Iterable<{ x: number; z: number }>): void {
    const next = new Set<number>();
    for (const tile of tiles) next.add(Standing.key(Math.floor(tile.x), Math.floor(tile.z)));
    this.tiles = next;
  }

  /** Is there something on the tile this point falls in? */
  at(x: number, z: number): boolean {
    return this.tiles.has(Standing.key(Math.floor(x), Math.floor(z)));
  }

  get count(): number { return this.tiles.size; }
}
