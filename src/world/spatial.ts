/** Uniform-grid index over axis-aligned boxes. Query returns de-duplicated item ids. */
export class CellIndex {
  private readonly cells = new Map<number, number[]>();
  private stamp: Uint32Array;
  private gen = 1;

  constructor(private readonly cell: number, capacity: number) {
    this.stamp = new Uint32Array(capacity);
  }

  insert(id: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    if (id >= this.stamp.length) {
      const next = new Uint32Array(Math.max(id + 1, this.stamp.length * 2));
      next.set(this.stamp);
      this.stamp = next;
    }
    for (let cz = Math.floor(minZ / this.cell); cz <= Math.floor(maxZ / this.cell); cz++) {
      for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
        const k = (cx + 32768) * 65536 + (cz + 32768);
        let list = this.cells.get(k);
        if (!list) { list = []; this.cells.set(k, list); }
        list.push(id);
      }
    }
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    const gen = ++this.gen;
    const out: number[] = [];
    for (let cz = Math.floor(minZ / this.cell); cz <= Math.floor(maxZ / this.cell); cz++) {
      for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
        const list = this.cells.get((cx + 32768) * 65536 + (cz + 32768));
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] !== gen) { this.stamp[i] = gen; out.push(i); }
        }
      }
    }
    return out;
  }
}
