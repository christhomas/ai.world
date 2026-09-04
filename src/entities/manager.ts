import type * as THREE from 'three';
import { WORLD } from '../core/config';
import { hash3, mulberry32, type Rng } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { chunkKey, parseChunkKey } from '../world/spatial';
import { Biome } from '../world/biomes';
import { TileType } from '../world/terrain';
import { BIOME_ANIMALS, DUNGEON_MONSTERS, KINDS, WATER_ANIMALS, pickKind } from './animals';
import { treeFor } from './behaviours';
import { pickTrade, tradesFor } from './trades';
import type { Register } from '../world/register';
import { stageOf, type Person } from '../world/people';
import { Entity, Herd, canStand, damageEntity, isDaytime, updateEntity, updateHerd, type Post, type TileWorld } from './entity';
import type { EntityRenderer } from './pool';
import { doorTile, type Village } from '../world/structures';

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
/**
 * What the law is paid. A constable takes the whole bounty for putting down something that was
 * attacking somebody; anybody else who does it — a hunter, a passing farmer — takes a share, which
 * is the difference between doing the job and helping out.
 */
const BOUNTY = { RESCUE_SHARE: 0.3 } as const;

/** Kinds that count as people: what a predator prefers, and what a constable protects. */
const PEOPLE = new Set(['villager', 'traveller', 'shopkeeper', 'hero']);

const ACTIVE_RANGE = 44;     // tiles; beyond this creatures freeze

/** Spawn odds and sizes. Chances are per chunk, leashes in tiles. */
/** Extra packs that only come out after dark, per biome. */
const NIGHT_PREDATORS: Record<Biome, string[]> = {
  [Biome.Plains]: ['wolf'],
  [Biome.Forest]: ['wolf', 'bear'],
  [Biome.Desert]: ['bat'],
  [Biome.Swamp]: ['bat', 'wolf'],
  [Biome.Mountain]: ['wolf'],
  [Biome.Snow]: ['wolf'],
};

const SPAWN = {
  MIN_LAND_TILES: 30,
  HERD_CHANCE: 0.6,
  SECOND_HERD_CHANCE: 0.3,
  HERD_LEASH: 12,
  MIN_WATER_TILES: 6,
  WATER_HERD_CHANCE: 0.55,
  /** A chunk with no land in it at all is open sea, and open sea has hunters in it. */
  DEEP_PACK_CHANCE: 0.18,
  DEEP_LEASH: 14,
  WATER_LEASH: 6,
  MIN_ROAD_TILES: 12,
  TRAVELLER_CHANCE: 0.3,
  TRAVELLER_LEASH: 30,
  CONGREGATION_LEASH: 2.5,
  SHOPKEEPER_LEASH: 1.2,
  PLACE_ATTEMPTS: 8,
  SCATTER: 2.2,          // members land within this radius of the anchor
  FLIER_RING: 4,
  NIGHT_PACK_CHANCE: 0.35,
  NIGHT_LEASH: 16,
} as const;

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
  /** Chunks spawned during the night carry predators; the flag flips at dusk and dawn. */
  private night = false;
  /** The register's day as of the last time the villagers on the street were checked against it. */
  private registerDay = -1;

  constructor(
    private readonly renderer: EntityRenderer,
    private readonly world: TileWorld,
    private readonly chunks: ChunkSource,
    private readonly seed: number,
    private readonly villages: Village[] = [],
    /**
     * What a thing fetches at market. Passed in because what a pelt is worth belongs to the game's
     * item catalogue, and this layer has no business knowing it.
     */
    private readonly priceOf: (id: string) => number = () => 4,
    /**
     * Somebody has been killed. The game decides what that means — a pack left in the grass, a
     * line in the chat — because this layer only knows that a creature stopped moving.
     */
    private readonly onFallen: (who: Entity) => void = () => {},
    /**
     * Who lives in the villages. A villager standing in the street is one of the people on this
     * register, not a stranger rolled on the spot, which is what lets them have a family, a name
     * somebody else will use, and a death worth mentioning.
     */
    private readonly register: Register | null = null,
  ) {
    this.rng = mulberry32(derive(seed, SALT.HERDS));
  }

  get count(): number { return this.renderer.count; }

  /**
   * @param afloat the hero is in the water or on a boat, which is what the sea hunters want to know
   */
  update(
    dt: number, playerX: number, playerZ: number, playerArmed = false,
    onAttack: (e: Entity, damage: number) => void = () => {}, time?: number, afloat = false,
  ): void {
    const CS = WORLD.CHUNK_SIZE;
    const wasNight = this.night;
    if (time !== undefined) this.night = !isDaytime(time);
    const cx = Math.floor(playerX / CS), cz = Math.floor(playerZ / CS);
    if (this.night !== wasNight) {
      // day flipped: let chunks respawn so the night shift can arrive (or go home)
      for (const [key, list] of this.spawned) if (key !== 'dungeon') this.despawn(key, list);
    }
    if (cx !== this.focusCx || cz !== this.focusCz) {
      this.focusCx = cx; this.focusCz = cz;
      for (const [key, list] of this.spawned) {
        const [kx, kz] = parseChunkKey(key);
        if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) > SPAWN_RADIUS + 1) this.despawn(key, list);
      }
    }
    // chunks arrive asynchronously, so keep polling the spawn window
    for (let dz = -SPAWN_RADIUS; dz <= SPAWN_RADIUS; dz++) {
      for (let dx = -SPAWN_RADIUS; dx <= SPAWN_RADIUS; dx++) {
        const key = chunkKey(cx + dx, cz + dz);
        if (this.spawned.has(key)) continue;
        const tiles = this.chunks.getTiles(cx + dx, cz + dz);
        if (!tiles) continue;
        this.spawned.set(key, this.spawnChunk(tiles, key));
      }
    }

    const ctx = {
      world: this.world, rng: this.rng, playerX, playerZ, playerArmed,
      playerAfloat: afloat, onAttack, time, treeFor,
      quarry: (from: Entity, within: number) => this.nearestQuarry(from, within),
      removeEntity: (prey: Entity) => this.despawnEntity(prey),
      nearestPerson: (from: Entity, within: number) => this.nearestPerson(from, within),
      nearestTrouble: (from: Entity, within: number) => this.nearestTrouble(from, within),
      strike: (attacker: Entity, victim: Entity, damage: number) => this.strike(attacker, victim, damage),
      worth: this.priceOf,
    };
    if (this.register && this.register.today !== this.registerDay) {
      this.registerDay = this.register.today;
      this.reseat();
    }
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

  /** Closest creature within `r` tiles of a point. Anyone indoors is not there to talk to. */
  nearest(x: number, z: number, r: number): Entity | null {
    let best: Entity | null = null, bestD = r * r;
    for (const list of this.spawned.values()) {
      for (const e of list) {
        if (e.indoors) continue;
        const d = (e.x - x) ** 2 + (e.z - z) ** 2;
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  /** How many creatures have joined this floor's roster, so each gets a number of its own. */
  private enrolled = 0;

  /** Spawn monsters directly (used by dungeons, which have their own tile world). */
  spawnMonsters(anchors: Array<[number, number]>, seed: number): Entity[] {
    const rng = mulberry32(seed);
    const out: Entity[] = [];
    const key = 'dungeon';
    let list = this.spawned.get(key);
    if (!list) { list = []; this.spawned.set(key, list); }
    for (const [x, z] of anchors) {
      const kindId = pickKind(DUNGEON_MONSTERS, rng());
      if (!kindId) continue;
      const herd = this.spawnHerdAt(kindId, x, z, rng, key, out);
      if (herd.members.length === 0) continue;
    }
    this.enrol(list, out);
    return out;
  }

  private spawnHerdAt(kindId: string, x: number, z: number, rng: Rng, key: string, out: Entity[]): Herd {
    const kind = KINDS[kindId];
    const size = kind.herd[0] + Math.floor(rng() * (kind.herd[1] - kind.herd[0] + 1));
    const herd = new Herd(kind, x, z, x, z, SPAWN.HERD_LEASH);
    for (let n = 0; n < size; n++) {
      for (let attempt = 0; attempt < SPAWN.PLACE_ATTEMPTS; attempt++) {
        const a = rng() * Math.PI * 2, r = rng() * SPAWN.SCATTER;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!canStand(this.world, kind, px, pz)) continue;
        const e = new Entity(kind, px, pz, herd, key, rng);
        e.y = kind.behaviour === 'fly' ? (this.world.heightAt(px, pz) ?? 0) + (kind.altitude ?? 2) : (this.world.heightAt(px, pz) ?? 0);
        e.yaw = rng() * Math.PI * 2;
        if (!this.renderer.add(e)) break;
        herd.members.push(e);
        out.push(e);
        break;
      }
    }
    if (herd.members.length > 0) this.herds.add(herd);
    return herd;
  }

  /**
   * Put a pack of hunters in the water around a point. Open sea has no chunks to spawn from —
   * nothing is generated out there but the surface — so what lives in it has to be put there
   * deliberately, around whatever it has come for.
   */
  spawnPack(kindId: string, x: number, z: number, radius: number, seed: number): Entity[] {
    const rng = mulberry32(seed);
    const out: Entity[] = [];
    const angle = rng() * Math.PI * 2;
    const herd = this.spawnHerdAt(
      kindId,
      x + Math.cos(angle) * radius,
      z + Math.sin(angle) * radius,
      rng, 'sea', out,
    );
    if (herd.members.length === 0) return out;
    let list = this.spawned.get('sea');
    if (!list) { list = []; this.spawned.set('sea', list); }
    list.push(...out);
    return out;
  }

  /** Send the sea pack away: they lose interest once you are ashore. */
  despawnPack(): void {
    const list = this.spawned.get('sea');
    if (!list) return;
    for (const e of [...list]) this.despawnEntity(e);
    this.spawned.delete('sea');
  }

  /** How many hunters are in the water right now. */
  get packSize(): number {
    return this.spawned.get('sea')?.length ?? 0;
  }

  /** Put one named creature somewhere: a dungeon boss, say. */
  spawnOne(kindId: string, x: number, z: number, seed: number): Entity | null {
    const rng = mulberry32(seed);
    const out: Entity[] = [];
    const herd = this.spawnHerdAt(kindId, x, z, rng, 'dungeon', out);
    let list = this.spawned.get('dungeon');
    if (!list) { list = []; this.spawned.set('dungeon', list); }
    this.enrol(list, out);
    return herd.members[0] ?? null;
  }

  /** Drop a dead creature from the world. */
  despawnEntity(e: Entity): void {
    this.renderer.remove(e);
    const h = e.herd;
    const i = h.members.indexOf(e);
    if (i >= 0) h.members.splice(i, 1);
    if (h.members.length === 0) this.herds.delete(h);
    for (const list of this.spawned.values()) {
      const j = list.indexOf(e);
      if (j >= 0) { list.splice(j, 1); return; }
    }
  }

  /** Add newcomers to a floor's roster, numbering them in the order every client spawns them. */
  private enrol(list: Entity[], arrivals: Entity[]): void {
    for (const e of arrivals) { e.rosterIndex = this.enrolled++; list.push(e); }
  }

  /** The dungeon's monsters still alive, each carrying the roster number it was born with. */
  get roster(): Entity[] {
    return this.spawned.get('dungeon') ?? [];
  }

  /** The monster with this roster number, if it is still down there. */
  onRoster(index: number): Entity | null {
    return this.roster.find((e) => e.rosterIndex === index) ?? null;
  }

  /**
   * The nearest wild animal worth a hunter's arrow: something that can be killed, is not a person,
   * and is not something that would rather kill them.
   */
  private nearestQuarry(from: Entity, within: number): Entity | null {
    let best: Entity | null = null;
    let bestAway = within;
    for (const e of this.within(from.x, from.z, within)) {
      if (e === from || e.dead || !e.kind.hp) continue;
      if (PEOPLE.has(e.kind.id) || (e.kind.dangerous ?? 0) > 0) continue;
      const away = Math.hypot(e.x - from.x, e.z - from.z);
      if (away < bestAway) { bestAway = away; best = e; }
    }
    return best;
  }

  /** The nearest person: somebody a wolf would rather have than a rabbit. */
  private nearestPerson(from: Entity, within: number): Entity | null {
    let best: Entity | null = null;
    let bestAway = within;
    for (const e of this.within(from.x, from.z, within)) {
      if (e === from || e.dead || e.indoors || !PEOPLE.has(e.kind.id)) continue;
      const away = Math.hypot(e.x - from.x, e.z - from.z);
      if (away < bestAway) { bestAway = away; best = e; }
    }
    return best;
  }

  /** The nearest creature presently going for somebody: what a constable comes running about. */
  private nearestTrouble(from: Entity, within: number): Entity | null {
    let best: Entity | null = null;
    let bestAway = within;
    for (const e of this.within(from.x, from.z, within)) {
      if (e === from || e.dead || !(e.kind.dangerous ?? 0)) continue;
      if (!e.target || e.target.dead || !PEOPLE.has(e.target.kind.id)) continue;
      const away = Math.hypot(e.x - from.x, e.z - from.z);
      if (away < bestAway) { bestAway = away; best = e; }
    }
    return best;
  }

  /**
   * One creature hurting another. The victim fights back or runs, and anything killed leaves the
   * world; the hero's own hearts are handled elsewhere, because they have a HUD and a save.
   */
  private strike(attacker: Entity, victim: Entity, damage: number): void {
    if (damageEntity(victim, damage, attacker.x, attacker.z, this.world)) {
      if (PEOPLE.has(victim.kind.id)) this.onFallen(victim);
      // what a killed animal is worth to whoever killed it: a constable's bounty, a hunter's pelt
      const bounty = victim.kind.gold?.[0] ?? 0;
      if (bounty > 0 && PEOPLE.has(attacker.kind.id)) {
        attacker.purse += attacker.trade === 'constable' ? bounty : Math.round(bounty * BOUNTY.RESCUE_SHARE);
      }
      this.despawnEntity(victim);
      attacker.target = null;
      return;
    }
    // being bitten is a good reason to notice who is biting you
    if ((victim.kind.dangerous ?? 0) > 0) victim.target = attacker;
  }

  /** Every live creature within `r` tiles, nearest first. */
  within(x: number, z: number, r: number): Entity[] {
    const hits: Array<{ e: Entity; d: number }> = [];
    for (const list of this.spawned.values()) {
      for (const e of list) {
        const d = Math.hypot(e.x - x, e.z - z);
        if (d <= r) hits.push({ e, d });
      }
    }
    return hits.sort((a, b) => a.d - b.d).map((h) => h.e);
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

  /** Deterministic per-chunk spawn: land herds, water herds, travellers, and any village folk. */
  private spawnChunk(tiles: ChunkTiles, key: string): Entity[] {
    const rng = mulberry32(hash3(this.seed, tiles.cx, tiles.cz, SALT.HERD_CHUNK));
    const sorted = sortTiles(tiles);
    const out: Entity[] = [];
    if (sorted.land.length === 0 && sorted.water.length === 0 && sorted.road.length === 0) return out;
    const ctx: SpawnCtx = { tiles, key, rng, out };

    this.spawnVillageFolk(ctx);
    // after dark, something else is out on the land
    if (this.night && sorted.land.length >= SPAWN.MIN_LAND_TILES && rng() < SPAWN.NIGHT_PACK_CHANCE) {
      const table = NIGHT_PREDATORS[sorted.biome];
      const kindId = table[Math.floor(rng() * table.length)];
      this.spawnHerd(ctx, kindId, tileCentre(tiles, sorted.land[Math.floor(rng() * sorted.land.length)]), SPAWN.NIGHT_LEASH);
    }
    if (sorted.land.length >= SPAWN.MIN_LAND_TILES) {
      const rolls = rng() < SPAWN.HERD_CHANCE ? (rng() < SPAWN.SECOND_HERD_CHANCE ? 2 : 1) : 0;
      for (let h = 0; h < rolls; h++) {
        const kindId = pickKind(BIOME_ANIMALS[sorted.biome], rng());
        if (!kindId) break;
        this.spawnHerd(ctx, kindId, tileCentre(tiles, sorted.land[Math.floor(rng() * sorted.land.length)]), SPAWN.HERD_LEASH);
      }
    }
    if (sorted.water.length >= SPAWN.MIN_WATER_TILES && rng() < SPAWN.WATER_HERD_CHANCE) {
      const kindId = pickKind(WATER_ANIMALS[sorted.biome], rng());
      if (kindId) this.spawnHerd(ctx, kindId, tileCentre(tiles, sorted.water[Math.floor(rng() * sorted.water.length)]), SPAWN.WATER_LEASH);
    }
    // nothing but water in this chunk means open sea, where something else is waiting
    if (sorted.land.length === 0 && sorted.water.length >= SPAWN.MIN_WATER_TILES && rng() < SPAWN.DEEP_PACK_CHANCE) {
      const hunter = rng() < 0.7 ? 'shark' : 'orca';
      this.spawnHerd(ctx, hunter, tileCentre(tiles, sorted.water[Math.floor(rng() * sorted.water.length)]), SPAWN.DEEP_LEASH);
    }
    if (sorted.road.length >= SPAWN.MIN_ROAD_TILES && rng() < SPAWN.TRAVELLER_CHANCE) {
      this.place(ctx, 'traveller', tileCentre(tiles, sorted.road[Math.floor(rng() * sorted.road.length)]), 1 + Math.floor(rng() * 2), SPAWN.TRAVELLER_LEASH);
    }
    return out;
  }

  /** A herd of a kind's natural size around an anchor. */
  private spawnHerd(ctx: SpawnCtx, kindId: string, anchor: [number, number], leash: number): Herd {
    const kind = KINDS[kindId];
    const size = kind.herd[0] + Math.floor(ctx.rng() * (kind.herd[1] - kind.herd[0] + 1));
    return this.place(ctx, kindId, anchor, size, leash);
  }

  /** Villagers on the square (first one is the elder), a congregation by the church, keepers at shop doors. */
  private spawnVillageFolk(ctx: SpawnCtx): void {
    const CS = WORLD.CHUNK_SIZE;
    const inChunk = (x: number, z: number) => Math.floor(x / CS) === ctx.tiles.cx && Math.floor(z / CS) === ctx.tiles.cz;
    for (const v of this.villages) {
      if (inChunk(v.x, v.z)) {
        const herd = this.place(ctx, 'villager', [v.x, v.z], 2 + Math.floor(ctx.rng() * 3), Math.max(8, v.radius * 0.7));
        herd.tag = v.name;
        if (herd.members.length > 0) herd.members[0].role = 'elder';
        // one of them keeps the horses
        if (herd.members.length > 1) herd.members[1].role = 'stablehand';
        // everybody gets a house, a trade, and the places that trade takes them
        const posts = this.postsOf(v);
        const residents = this.residentsFor(v, posts, herd.members.length);
        herd.members.forEach((e, i) => {
          const house = v.houses[i % Math.max(1, v.houses.length)];
          const home: [number, number] = house
            ? [doorTile(house)[0] + 0.5, doorTile(house)[1] + 0.5]
            : [v.x, v.z];
          const angle = (i / Math.max(1, herd.members.length)) * Math.PI * 2;
          e.posts = {
            ...posts,
            home,
            work: [v.x + Math.cos(angle) * (v.radius * 0.55), v.z + Math.sin(angle) * (v.radius * 0.55)],
          };
          // the elder and the stablehand have their own reasons to be where they are; everybody
          // else in the village keeps a trade, and their trade keeps their day
          if (e.role === 'none') {
            e.role = 'villager';
            e.trade = pickTrade(posts, ctx.rng);
          }
          // and whoever this is, they are somebody the village register knows by name
          const resident = residents[i];
          if (resident) {
            e.person = resident.id;
            e.name = resident.name;
            if (resident.trade !== '') e.trade = resident.trade;
          }
        });
      }
      if (v.churchDoor && inChunk(v.churchDoor[0] + 0.5, v.churchDoor[1] + 0.5)) {
        const herd = this.place(ctx, 'villager', [v.churchDoor[0] + 0.5, v.churchDoor[1] + 0.5], 3 + Math.floor(ctx.rng() * 2), SPAWN.CONGREGATION_LEASH);
        herd.tag = v.name;
        for (const e of herd.members) e.role = 'congregation';
      }
      // shopkeepers are inside their shops; the street outside is for villagers
    }
  }

  /**
   * Nobody stands in the street after they have left the register.
   *
   * A villager can be there for days, and in that time the person they are can die of old age or
   * be killed somewhere the player never saw. When that happens the body in the street is given
   * to somebody who is actually alive — a village always has more people than it ever shows at
   * once — and if there is nobody spare, they go indoors and are gone.
   */
  private reseat(): void {
    if (!this.register) return;

    for (const herd of this.herds) {
      for (const villager of [...herd.members]) {
        if (villager.person === '' || this.register.find(villager.person)) continue;

        const taken = new Set([...this.herds].flatMap((h) => h.members.map((e) => e.person)));
        const free = this.register.living(herd.tag)
          .find((p) => !taken.has(p.id) && stageOf(p, this.register!.today) !== 'baby');
        if (!free) { this.despawnEntity(villager); continue; }

        villager.person = free.id;
        villager.name = free.name;
        if (free.trade !== '') villager.trade = free.trade;
      }
    }
  }

  /**
   * Which of a village's residents are out on the street right now.
   *
   * A village holds far more people than are ever drawn at once, so this takes the grown ones who
   * are not already standing somewhere else. Babies stay indoors, which is why nobody ever meets
   * one; they turn up as children a week later.
   */
  private residentsFor(v: Village, posts: Partial<Record<Post, [number, number]>>, wanted: number): Person[] {
    if (!this.register) return [];
    const trades = tradesFor(posts).map((t) => t.id);
    const out = new Set([...this.herds].flatMap((h) => h.members.map((e) => e.person)));

    return this.register.settle(v.name, v.houses.length, trades)
      .filter((p) => !out.has(p.id) && stageOf(p, this.register!.today) !== 'baby')
      .slice(0, wanted);
  }

  /**
   * The places a village's working day can send somebody. Whatever the land nearby actually
   * offers: a shore only where there is water, heights only where the ground climbs, and the
   * square as the fallback for everything, because a village always has a middle.
   */
  private postsOf(v: Village): Partial<Record<Post, [number, number]>> {
    const middle: [number, number] = [v.x, v.z];
    const posts: Partial<Record<Post, [number, number]>> = { square: middle };
    const inn = v.shops.find((shop) => shop.type === 'inn') ?? v.shops[0];
    if (inn) posts.inn = [inn.doorX + 0.5, inn.doorZ + 0.5];
    const shop = v.shops.find((s) => s.type === 'smith') ?? v.shops.find((s) => s.type === 'store') ?? inn;
    if (shop) posts.shop = [shop.doorX + 0.5, shop.doorZ + 0.5];
    if (v.stalls.length) posts.market = v.stalls[0];
    // the surgery is the house furthest from the market: quiet, and nobody treated in a crowd
    let quietest: [number, number] | null = null;
    let quietestAway = -1;
    for (const house of v.houses) {
      const [dx, dz] = doorTile(house);
      const away = Math.hypot(dx - v.x, dz - v.z);
      if (away > quietestAway) { quietestAway = away; quietest = [dx + 0.5, dz + 0.5]; }
    }
    if (quietest) posts.doctor = quietest;

    // walk a ring round the village and see what is out there
    let bestHeight = -Infinity;
    for (let step = 0; step < 24; step++) {
      const angle = (step / 24) * Math.PI * 2;
      for (const reach of [v.radius * 0.8, v.radius * 1.3, v.radius * 1.9]) {
        const x = v.x + Math.cos(angle) * reach, z = v.z + Math.sin(angle) * reach;
        const ground = this.world.heightAt(x, z);
        if (ground === null) {
          if (!posts.shore && this.world.waterAt(x, z) !== null) posts.shore = [v.x + Math.cos(angle) * (reach - 2), v.z + Math.sin(angle) * (reach - 2)];
          continue;
        }
        if (!posts.field && reach < v.radius * 1.4) posts.field = [x, z];
        if (!posts.woods && reach > v.radius * 1.5) posts.woods = [x, z];
        if (!posts.gate && this.world.isRoad(x, z)) posts.gate = [x, z];
        if (ground > bestHeight) { bestHeight = ground; posts.heights = [x, z]; }
      }
    }
    return posts;
  }

  /** Create `count` entities of a kind scattered around `anchor`, registered with the renderer. */
  private place(ctx: SpawnCtx, kindId: string, anchor: [number, number], count: number, leash: number): Herd {
    const { rng } = ctx;
    const kind = KINDS[kindId];
    const herd = new Herd(kind, anchor[0], anchor[1], anchor[0], anchor[1], leash);
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < SPAWN.PLACE_ATTEMPTS; attempt++) {
        const a = rng() * Math.PI * 2, r = kind.behaviour === 'fly' ? SPAWN.FLIER_RING : rng() * SPAWN.SCATTER;
        const x = anchor[0] + Math.cos(a) * r, z = anchor[1] + Math.sin(a) * r;
        if (!canStand(this.world, kind, x, z)) continue;
        const e = new Entity(kind, x, z, herd, ctx.key, rng);
        e.y = kind.behaviour === 'fly'
          ? (this.world.heightAt(x, z) ?? 0) + (kind.altitude ?? 7)
          : (this.world.waterAt(x, z) ?? this.world.heightAt(x, z) ?? 0);
        e.yaw = rng() * Math.PI * 2;
        if (!this.renderer.add(e)) break;
        herd.members.push(e);
        ctx.out.push(e);
        break;
      }
    }
    if (herd.members.length > 0) this.herds.add(herd);
    return herd;
  }
}

interface SpawnCtx { tiles: ChunkTiles; key: string; rng: Rng; out: Entity[] }

interface SortedTiles { land: number[]; water: number[]; road: number[]; biome: Biome }

/** Bucket a chunk's tiles by what can spawn on them, and find its dominant biome. */
function sortTiles(tiles: ChunkTiles): SortedTiles {
  const CS = WORLD.CHUNK_SIZE;
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
  let biome = 0 as Biome, best = -1;
  for (const [b, n] of biomeCount) if (n > best) { best = n; biome = b as Biome; }
  return { land, water, road, biome };
}

function tileCentre(tiles: ChunkTiles, i: number): [number, number] {
  const CS = WORLD.CHUNK_SIZE;
  return [tiles.cx * CS + (i % CS) + 0.5, tiles.cz * CS + Math.floor(i / CS) + 0.5];
}
