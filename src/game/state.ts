import { ITEMS, Inventory, type InventoryJson } from './shops';
import { chunkKey } from '../world/spatial';

/**
 * Everything about the player that is not position: health, gold and items, time of day,
 * explored map cells, quest progress. Serialised whole into the save slot.
 */

export type QuestStatus = 'active' | 'done';

export interface GameStateJson {
  hp: number;
  maxHp: number;
  time: number;
  day: number;
  inventory: InventoryJson;
  explored: string[];
  quests: Record<string, QuestStatus>;
  discovered: string[];
}

export const BASE_MAX_HP = 10;
/** Real seconds per in-game day. */
export const DAY_LENGTH = 480;
/** Time of day at which you wake after resting: 07:12. */
export const MORNING = 0.3;

export class GameState {
  hp = BASE_MAX_HP;
  maxHp = BASE_MAX_HP;
  /** Fraction of the day, 0 = midnight, 0.5 = noon. */
  time = 0.34;
  day = 1;
  readonly inventory = new Inventory();
  readonly explored = new Set<string>();
  readonly quests = new Map<string, QuestStatus>();
  readonly discovered = new Set<string>();
  /** Bumped whenever something the HUD shows changed. */
  version = 0;

  has(id: string): boolean { return (this.inventory.items.get(id) ?? 0) > 0; }
  count(id: string): number { return this.inventory.items.get(id) ?? 0; }

  get maxHpTotal(): number { return this.maxHp + (this.has('helm') ? 2 : 0); }
  get armed(): boolean { return this.has('sword'); }
  /** Height the hero can step across: one terrace, two with a rope. */
  get climb(): number { return this.has('rope') ? 1.06 : 0.56; }

  get night(): number {
    // sun height: sin curve, above the horizon from 0.25 to 0.75
    const sun = Math.sin((this.time - 0.25) * Math.PI * 2);
    return 1 - smoothstep(-0.12, 0.25, sun);
  }

  tick(dt: number): void {
    this.time += dt / DAY_LENGTH;
    if (this.time >= 1) { this.time -= 1; this.day++; }
  }

  clock(): string {
    const mins = Math.floor(this.time * 24 * 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    return `Day ${this.day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHpTotal, this.hp + n);
    this.version++;
  }

  /** Apply damage (shield halves it). Returns true if the hero dropped to zero. */
  damage(n: number): boolean {
    const dealt = this.has('shield') ? Math.ceil(n / 2) : n;
    this.hp = Math.max(0, this.hp - dealt);
    this.version++;
    return this.hp === 0;
  }

  /** Sleep until morning: full heal, next day. */
  rest(): void {
    this.hp = this.maxHpTotal;
    if (this.time >= MORNING) this.day++;
    this.time = MORNING;
    this.version++;
  }

  /** Use a consumable from the inventory. Returns a message, or null if nothing happened. */
  use(id: string): string | null {
    const item = ITEMS[id];
    if (!item || !this.has(id) || !item.effect) return null;
    if (item.effect.type === 'heal') {
      if (this.hp >= this.maxHpTotal) return `You are already at full health.`;
      this.inventory.items.set(id, this.count(id) - 1);
      if (this.count(id) === 0) this.inventory.items.delete(id);
      this.heal(item.effect.amount);
      return `${item.name}: +${item.effect.amount} health.`;
    }
    if (item.effect.type === 'rest') {
      this.inventory.items.delete(id);
      this.rest();
      return 'You sleep soundly and wake at dawn, fully rested.';
    }
    return null;
  }

  markExplored(cx: number, cz: number): boolean {
    let changed = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const k = chunkKey(cx + dx, cz + dz);
      if (!this.explored.has(k)) { this.explored.add(k); changed = true; }
    }
    return changed;
  }

  toJSON(): GameStateJson {
    return {
      hp: this.hp, maxHp: this.maxHp, time: this.time, day: this.day,
      inventory: this.inventory.toJSON(),
      explored: [...this.explored],
      quests: Object.fromEntries(this.quests),
      discovered: [...this.discovered],
    };
  }

  static from(json: Partial<GameStateJson> | undefined): GameState {
    const g = new GameState();
    if (!json) return g;
    if (typeof json.hp === 'number') g.hp = json.hp;
    if (typeof json.maxHp === 'number') g.maxHp = json.maxHp;
    if (typeof json.time === 'number') g.time = json.time;
    if (typeof json.day === 'number') g.day = json.day;
    if (json.inventory) {
      const inv = Inventory.from(json.inventory);
      g.inventory.gold = inv.gold;
      for (const [k, v] of inv.items) g.inventory.items.set(k, v);
    }
    for (const k of json.explored ?? []) g.explored.add(k);
    for (const [k, v] of Object.entries(json.quests ?? {})) g.quests.set(k, v);
    for (const k of json.discovered ?? []) g.discovered.add(k);
    g.hp = Math.min(g.hp, g.maxHpTotal);
    return g;
  }
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
