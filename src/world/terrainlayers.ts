import { Simplex2D } from './noise';
import { FaceKind } from './mesh';

/** A face-kind edit applied before roads, water, and settlements are planned. Later edits win. */
export interface TerrainLayer {
  x: number;
  z: number;
  reach: number;
  seed: number;
  kind: 'land' | 'sea';
}

const CELL = 128;
const WIDE = CELL * 16;
const FEW = 8;

/** The authored terrain list, indexed by the faces it can affect. */
export class TerrainLayers {
  static readonly none = new TerrainLayers([]);
  readonly layers: readonly TerrainLayer[];
  private readonly noise: Simplex2D[];
  private readonly cells: Map<string, number[]> | null;
  private readonly wide: number[] = [];

  constructor(layers: readonly TerrainLayer[]) {
    this.layers = [...layers];
    this.noise = layers.map((layer) => new Simplex2D(layer.seed));
    this.cells = layers.length > FEW ? new Map() : null;
    if (!this.cells) return;
    layers.forEach((layer, i) => {
      if (layer.reach > WIDE) { this.wide.push(i); return; }
      const radius = layer.reach * 1.1;
      const x0 = Math.floor((layer.x - radius) / CELL), x1 = Math.floor((layer.x + radius) / CELL);
      const z0 = Math.floor((layer.z - radius) / CELL), z1 = Math.floor((layer.z + radius) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const key = `${cx},${cz}`;
        const at = this.cells!.get(key);
        if (at) at.push(i); else this.cells!.set(key, [i]);
      }
    });
  }

  /** What this list says a face is, or null when the seed's own answer stands. */
  kindAt(x: number, z: number): FaceKind | null {
    const near = this.cells
      ? this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []
      : this.layers.map((_, i) => i);
    // The authored order matters: the last layer touching a face has the last word.
    const candidates = this.wide.length ? [...near, ...this.wide].sort((a, b) => a - b) : near;
    let kind: FaceKind | null = null;
    for (const i of candidates) {
      const layer = this.layers[i];
      const edge = layer.reach * (1 + 0.1 * this.noise[i].noise(x * 0.018, z * 0.018));
      if (Math.hypot(x - layer.x, z - layer.z) <= edge) {
        kind = layer.kind === 'land' ? FaceKind.Land : FaceKind.Sea;
      }
    }
    return kind;
  }
}
