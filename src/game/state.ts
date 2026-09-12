import { learnedFrom, levelFor, saidOf, PROWESS } from './prowess';
import { HEALTH } from '../world/health';
import { ITEMS, Inventory, type InventoryJson } from './shops';
import { SLOTS, type Ability, type EquipSlot, type Item, isConsumable, isEquippable } from './items';
import { chunkKey } from '../world/spatial';
import { provinceOf, type ProvinceId } from '../world/provinces';
import type { HorseSave } from './mount';
import type { PlotJson } from './farming';
import type { HouseJson } from './building';
import type { BoatSave } from './sailing';

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
  /**
   * The provinces somebody has bought a map of.
   *
   * Beside `explored` rather than folded into it, and the difference is the whole point: `explored`
   * is ground the hero has actually stood on, which is what decides whether he has *been* somewhere
   * — see `interact/travel.ts` — and a map he read over a counter is not that. Writing a bought
   * province into `explored` would have him remembering a valley he has never seen.
   *
   * Absent from every save written before tonight, and those load as a hero who has bought no maps,
   * which is exactly what they are. Somebody who already owns the old all-seeing map is untouched
   * by this: that is still an item, still in his pocket, and still lifts the fog off everything.
   */
  charted?: string[];
  quests: Record<string, QuestStatus>;
  discovered: string[];
  /** Ids of opened dungeon chests. */
  opened: string[];
  /** Anchor ids whose locked doors have been opened. */
  keys: string[];
  /**
   * The workings under the caves: what has been taken out of each, what the village round it
   * believes, and how much of what lived in it has been killed.
   *
   * Kept with `opened` and `keys` because it is the same kind of thing — state belonging to a
   * dungeon anchor, which nothing can derive from the seed because it is the record of days that
   * have already been lived. Written by main.ts at save time the way `gifts` and `jail` are.
   */
  mines?: MinesJson;
  /** Where the hero stands between good and evil, as one number. */
  standing?: number;
  practice?: number;
  /**
   * Who the hero has given things to, and what each of them made of it. Written by main.ts at
   * save time the way `standing` is: the state itself has no reason to know what a bond is.
   */
  gifts?: Record<string, Bond>;
  /**
   * Who is in which cell, and which police stations are still heaps of timber. Saved because a
   * prisoner who walks free every time you reload is not a prisoner.
   */
  jail?: JailSave;
  /** Which villages somebody agreed to clear the trouble from. Written by main.ts, like `gifts`. */
  rescues?: Record<string, Kept>;
  /** What each village holds against them, which fades from the day it was earned. */
  grudges?: Record<string, Held>;
  /** The horse you bought, and where it is tied up. */
  horse?: HorseSave | null;
  /** What is planted where. */
  plots?: PlotJson;
  /** The builder you are holding, and every house you have had put up. */
  houses?: HouseJson;
  /** The boat you bought, and where it is moored. */
  boat?: BoatSave | null;
}

/**
 * What the hero starts with, on the scale everything alive in this world is quoted in.
 *
 * `HEALTH.FULL`, which is what a fit grown adult has — see `world/health.ts`. The hero is the
 * anchor of the scale rather than an exception to it: a villager has sixty of these and a bear a
 * hundred and eighty, and the numbers mean the same thing on all three.
 */
const BASE_MAX_HP: number = HEALTH.FULL;
/** What a new hero sets out with: worn clothes, a stick, and something to eat. */
/**
 * What a hero starts with.
 *
 * The knife is the important one. Without it a beginner can kill a rabbit and come away with
 * sevenpence of meat, which does not read as a living; with it the same rabbit is a hide as well,
 * and the first hour of the game has an obvious thing to do in it. It is the cheapest possible
 * answer to "how am I supposed to make any money".
 */
const STARTING_KIT = { worn: ['tunic', 'boots', 'stick'], carried: { apple: 2, bread: 1, knife: 1 } } as const;
import { DAY_LENGTH } from '../../server/protocol';
import type { Bond } from './gifts';
import type { MinesJson } from './mines';
import type { JailSave } from './jail';
import type { Kept } from './rescue';
import type { Held } from './grudge';

/** Real seconds per in-game day, shared with the server so both keep the same time. */
export { DAY_LENGTH };
/** Time of day at which you wake after resting: 07:12. */
export const MORNING = 0.3;

export class GameState {
  hp = BASE_MAX_HP;
  maxHp = BASE_MAX_HP;
  /** Fraction of the day, 0 = midnight, 0.5 = noon. */
  time = 0.34;
  day = 1;
  readonly inventory = new Inventory();
  /** What is worn where. Items here are not in the rucksack. */
  readonly equipped: Partial<Record<EquipSlot, string>> = {};
  readonly explored = new Set<string>();
  /** The country somebody has paid to be shown, a province at a time. See `cartography.ts`. */
  readonly charted = new Set<ProvinceId>();
  readonly quests = new Map<string, QuestStatus>();
  readonly discovered = new Set<string>();
  readonly opened = new Set<string>();
  readonly keys = new Set<string>();
  /**
   * Where the hero stands between good and evil. Kept here as a plain number rather than as the
   * Standing object that interprets it, because a save is a picture of the game's state and has
   * no business knowing what the number means.
   */
  standing = 0;
  /** Bumped whenever something the HUD shows changed. */
  version = 0;

  /** Is the item in the rucksack? Worn gear is not in the rucksack. */
  has(id: string): boolean { return (this.inventory.items.get(id) ?? 0) > 0; }
  count(id: string): number { return this.inventory.items.get(id) ?? 0; }

  /** Item worn in a slot, or null. */
  worn(slot: EquipSlot): Item | null {
    const id = this.equipped[slot];
    return id ? ITEMS[id] ?? null : null;
  }

  /** Is this item worn in any slot? */
  isWorn(id: string): boolean {
    return SLOTS.some((slot) => this.equipped[slot] === id);
  }

  /** Carried or worn. */
  owns(id: string): boolean { return this.has(id) || this.isWorn(id); }

  private sumWorn(pick: (item: Item) => number | undefined): number {
    let total = 0;
    for (const slot of SLOTS) {
      const item = this.worn(slot);
      if (item) total += pick(item) ?? 0;
    }
    return total;
  }

  /** Damage a swing deals: bare hands plus whatever is in your hand. */
  /**
   * What a blow of yours is worth: your arm, plus whatever is in your hand.
   *
   * The practice term is the only thing here that is yours rather than the shop's. It is small
   * against a sword on purpose — it is meant to be the difference between only just failing and
   * only just managing.
   */
  get attack(): number { return HEALTH.BARE_HANDS + levelFor(this.practice) * HEALTH.PER_LEVEL + this.sumWorn((i) => i.attack); }
  /** Armour: every two points turns one heart of a bite aside. */
  get defence(): number { return this.sumWorn((i) => i.defence); }
  /**
   * How much of you there is: what you were born with, what practice has added, and what you wear.
   *
   * Practice is in here rather than on `maxHp` because `maxHp` is saved and this is derived — a
   * hero who has levelled is not a hero whose starting health changed, and writing it down would be
   * a second copy of `practice` free to disagree with the first. See `PROWESS.TOUGHER`.
   */
  get maxHpTotal(): number {
    return this.maxHp + levelFor(this.practice) * PROWESS.TOUGHER + this.sumWorn((i) => i.hearts);
  }
  /** A weapon in hand keeps animal predators at bay. */
  get armed(): boolean { return (this.worn('hand')?.attack ?? 0) >= HEALTH.COUNTS_AS_ARMED; }

  /** Does any worn item grant this ability? */
  /**
   * Whether the hero can do a thing right now.
   *
   * Worn kit counts because holding it is the point: a lantern lights nothing from inside a pack.
   * A tool counts merely for being carried, because there are far too many of them to take turns
   * in the offhand, and a game where the main decision is which tool to leave behind is a game
   * about menus.
   */
  can(ability: Ability): boolean {
    if (SLOTS.some((slot) => this.worn(slot)?.ability === ability)) return true;
    for (const id of this.inventory.items.keys()) {
      const item = ITEMS[id];
      if (item?.tool && item.ability === ability) return true;
    }
    return false;
  }

  /** Height the hero can step across: one terrace, two with a rope on the belt. */
  get climb(): number { return this.can('climb') ? 1.06 : 0.56; }

  /**
   * Put an item from the rucksack on the body. Whatever was in that slot goes back in the
   * rucksack, so nothing is ever lost. Returns the item now worn, or null if it could not be worn.
   */
  equip(id: string): Item | null {
    const item = ITEMS[id];
    if (!item || !isEquippable(item) || !this.has(id)) return null;
    const slot = item.slot!;
    const previous = this.equipped[slot];
    this.take(id, 1);
    if (previous) this.give(previous, 1);
    this.equipped[slot] = id;
    this.hp = Math.min(this.hp, this.maxHpTotal);
    this.version++;
    return item;
  }

  /** Take the item off and put it back in the rucksack. */
  unequip(slot: EquipSlot): Item | null {
    const id = this.equipped[slot];
    if (!id) return null;
    delete this.equipped[slot];
    this.give(id, 1);
    this.hp = Math.min(this.hp, this.maxHpTotal);
    this.version++;
    return ITEMS[id] ?? null;
  }

  /** Add to the rucksack. */
  give(id: string, n = 1): void {
    this.inventory.items.set(id, this.count(id) + n);
    this.version++;
  }

  /** Remove from the rucksack. Returns how many were actually removed. */
  take(id: string, n = 1): number {
    const have = this.count(id);
    const removed = Math.min(have, n);
    if (removed <= 0) return 0;
    if (have - removed <= 0) this.inventory.items.delete(id);
    else this.inventory.items.set(id, have - removed);
    this.version++;
    return removed;
  }

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

  /** Apply damage, softened by armour but never below a scratch. Returns true if it dropped you. */
  damage(n: number): boolean {
    const dealt = Math.max(HEALTH.A_SCRATCH, n - Math.floor(this.defence / 2));
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

  /** Eat or drink something from the rucksack. Returns a message, or null if nothing happened. */
  use(id: string): string | null {
    const item = ITEMS[id];
    if (!item || !this.has(id) || !isConsumable(item)) return null;
    if (item.effect!.type === 'heal') {
      if (this.hp >= this.maxHpTotal) return 'You are already at full health.';
      this.take(id, 1);
      this.heal(item.effect!.amount);
      return `${item.name}: +${item.effect!.amount} hearts.`;
    }
    this.take(id, 1);
    this.rest();
    return 'You sleep soundly and wake at dawn, fully rested.';
  }

  markExplored(cx: number, cz: number): boolean {
    let changed = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const k = chunkKey(cx + dx, cz + dz);
      if (!this.explored.has(k)) { this.explored.add(k); changed = true; }
    }
    return changed;
  }

  /** Is the country round this place on a map somebody has already bought? */
  hasChart(x: number, z: number): boolean {
    return this.charted.has(provinceOf(x, z));
  }

  /**
   * Buy the country round a place, as a map of the province it stands in.
   *
   * Taken from a pair of coordinates rather than handed a province, because everywhere that sells
   * one knows where it is standing and none of them should have to know what a province is. Returns
   * false when that country was already bought, which is a shopkeeper declining to sell the same
   * sheet twice rather than a failure.
   */
  chart(x: number, z: number): boolean {
    const id = provinceOf(x, z);
    if (this.charted.has(id)) return false;
    this.charted.add(id);
    this.version++;
    return true;
  }

  /**
   * Swinging at things, in the units prowess.ts counts. Kept as the raw total rather than as a
   * level so the level's cost can be retuned without everybody's save resetting to nothing.
   */
  practice = 0;

  /** Something was hit. Returns the words for it when that pushed you up a level, else null. */
  practised(danger: number, killed: boolean): string | null {
    const before = levelFor(this.practice);
    this.practice += learnedFrom(danger, killed);
    const now = levelFor(this.practice);
    if (now === before) return null;
    /*
     * A level heals you, and it has to.
     *
     * A level adds `PROWESS.TOUGHER` to how much of you there is, and without this it adds only an
     * empty bar: you arrive at the new level on whatever health the fight left you, which is to say
     * at a third of yourself, and the reward for getting better at fighting is looking worse. It is
     * earned by fighting, so it is nearly always collected in the middle of one.
     *
     * The obvious objection is that a level in the middle of a fight is a free heal. It is, and it
     * is the right kind of free: there are five levels in a career, each dearer than the last, and
     * the last thing a game should do with a moment somebody has worked hours for is hand it over
     * quietly while they are looking at a health bar that has not moved.
     */
    this.hp = this.maxHpTotal;
    this.version++;
    return saidOf(now);
  }

  toJSON(): GameStateJson {
    return {
      hp: this.hp, maxHp: this.maxHp, time: this.time, day: this.day,
      inventory: { ...this.inventory.toJSON(), equipped: { ...this.equipped } },
      explored: [...this.explored],
      charted: [...this.charted],
      quests: Object.fromEntries(this.quests),
      discovered: [...this.discovered],
      opened: [...this.opened],
      keys: [...this.keys],
      standing: this.standing,
      practice: this.practice,
    };
  }

  /** A fresh hero: starting kit already on the body. */
  static fresh(): GameState {
    const g = new GameState();
    for (const [id, n] of Object.entries(STARTING_KIT.carried)) g.give(id, n);
    for (const id of STARTING_KIT.worn) { g.give(id, 1); g.equip(id); }
    g.version = 0;
    return g;
  }

  static from(json: Partial<GameStateJson> | undefined): GameState {
    if (!json) return GameState.fresh();
    const g = new GameState();
    if (typeof json.hp === 'number') g.hp = json.hp;
    if (typeof json.practice === 'number') g.practice = json.practice;
    if (typeof json.maxHp === 'number') g.maxHp = json.maxHp;
    if (typeof json.time === 'number') g.time = json.time;
    if (typeof json.day === 'number') g.day = json.day;
    if (json.inventory) {
      const inv = Inventory.from(json.inventory);
      g.inventory.gold = inv.gold;
      for (const [k, v] of inv.items) g.inventory.items.set(k, v);
      for (const [slot, id] of Object.entries(json.inventory.equipped ?? {})) {
        if (ITEMS[id] && ITEMS[id].slot === slot) g.equipped[slot as EquipSlot] = id;
      }
    }
    if (typeof json.standing === 'number') g.standing = json.standing;
    for (const k of json.explored ?? []) g.explored.add(k);
    // nothing here on a save from before maps were country, which reads back as a hero who has
    // bought none — and whose all-seeing trinket, if he has one, is in the inventory above
    for (const k of json.charted ?? []) g.charted.add(k);
    for (const [k, v] of Object.entries(json.quests ?? {})) g.quests.set(k, v);
    for (const k of json.discovered ?? []) g.discovered.add(k);
    for (const k of json.opened ?? []) g.opened.add(k);
    for (const k of json.keys ?? []) g.keys.add(k);
    g.hp = Math.min(g.hp, g.maxHpTotal);
    return g;
  }
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
