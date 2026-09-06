import type * as THREE from 'three';
import { WORLD } from '../core/config';
import { hash3, mulberry32, type Rng } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { chunkKey, parseChunkKey } from '../world/spatial';
export type { ChunkSource, ChunkTiles } from '../world/tiles';
import { sortTiles, tileCentre, type SortedTiles } from './chunkspots';
export { tileCentre } from './chunkspots';
import type { ChunkSource, ChunkTiles } from '../world/tiles';
import { Biome } from '../world/biomes';
import { TileType } from '../world/terrain';
import { KINDS } from './animals';
import { BIOME_ANIMALS, HIGHLAND_ANIMALS, WATER_ANIMALS, dungeonMonsters, openGround, pickKind } from './spawns';
import { treeFor } from './behaviours';
import { pickTrade, tradesFor } from './trades';
import type { Register } from '../world/register';
import { stageOf, type Person } from '../world/people';
import { postsOf } from './villagers';
import { BEHAVIOUR, Entity, Herd, canStand, damageEntity, isDaytime, throwBlow, updateEntity, updateHerd, type Post, type TileWorld } from './entity';
import { keepBodiesApart } from './contact';
import { buryTheFallen, startDying } from './dying';
import { residentsOnTheStreet } from './residents';
import { callOutTheLaw, reseatVillagers } from './village';
import { PEOPLE, nearestPerson, nearestQuarry, nearestTrouble } from './quarry';
import { blowOf } from './motion';
import type { EntityView } from './roster';
import { doorTile, type Village } from '../world/structures';
import { ACTIVE_RANGE, BOUNTY, NIGHT_PREDATORS, SPAWN, SPAWN_RADIUS } from './spawning';

/** Per-chunk tile arrays the manager needs for spawning; provided by ChunkManager. */
export class EntityManager {
  private readonly spawned = new Map<string, Entity[]>();
  /**
   * Creatures somebody else owns: drawn here, found here, but never thought for here.
   *
   * A swing, an arrow, a hunt and the console's `entities` all ask this manager what is nearby, so
   * the world's own animals have to be findable through it or they are scenery. What they *do* is
   * decided where they live.
   */
  guests: Iterable<Entity> = [];
  /**
   * Other places worth keeping alive, besides whoever this manager is following.
   *
   * A game has one hero and this was built around that: creatures spawn in the chunks near him and
   * are forgotten as he leaves. A world server has as many heroes as there are players, and with a
   * single focus the country round each of them was spawned and then thrown away as the focus moved
   * on — measured with four players, three of them stood in an empty world while the fourth had a
   * hundred and thirty creatures around them.
   *
   * Empty in the game, where there is only ever one person to keep a world alive around.
   */
  alsoNear: ReadonlyArray<{ x: number; z: number }> = [];
  /**
   * True when somebody else decides what lives in this world.
   *
   * The simulation owns the creatures now — on a server, or in the thread next door — and a client
   * that also spawns its own would draw two of every deer, one of which nobody else can see. So it
   * stops spawning and starts being told; everything else it does, it goes on doing.
   */
  toldWhatLives = false;
  private readonly herds = new Set<Herd>();
  private readonly rng: Rng;
  private focusCx = Number.NaN;
  private focusCz = Number.NaN;
  /** Chunks spawned during the night carry predators; the flag flips at dusk and dawn. */
  private night = false;
  /** The register's day as of the last time the villagers on the street were checked against it. */
  private registerDay = -1;
  /** Where the hero was standing this tick, for deciding whether a creature is on them. */
  private heroX = 0;
  private heroZ = 0;
  /** Whether the law was already after the hero last time we looked. */
  private lawWasOut = false;

  constructor(
    /**
     * Whatever is showing these creatures: the game's renderer, or a list on a server with no
     * screen. The rules of the world are the same either way, so they are written once.
     */
    private readonly renderer: EntityView,
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
    /**
     * Whether a village keeps a stable. Handed in because which animals a place can sell is the
     * game's business, and a village with no stalls has no business having somebody to mind them.
     */
    private readonly hasStable: (village: string) => boolean = () => true,
    /**
     * How badly the law wants the hero: nought for somebody it has no interest in, one for the
     * worst there is. Handed in because guilt is the game's book-keeping, and this layer only
     * knows that a man in a helmet has decided to do something about it.
     */
    private readonly guiltOf: () => number = () => 0,
    /**
     * A constable has laid hands on the hero. Where they wake and how long they are held is the
     * game's business; all that happens here is that somebody was paid for it.
     */
    private readonly onArrest: (by: Entity) => void = () => {},
    /**
     * Whether this point is high country — on or against a massif.
     *
     * Asked rather than worked out, because what counts as a mountain belongs to the world's
     * generator and this layer only wants to know which list to spawn from. False everywhere in a
     * world with no mountains in it, which is the old one.
     */
    private readonly highland: (x: number, z: number) => boolean = () => false,
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
    this.heroX = playerX;
    this.heroZ = playerZ;
    const wasNight = this.night;
    if (time !== undefined) this.night = !isDaytime(time);
    const cx = Math.floor(playerX / CS), cz = Math.floor(playerZ / CS);
    if (this.night !== wasNight) {
      // day flipped: let chunks respawn so the night shift can arrive (or go home)
      for (const [key, list] of this.spawned) if (key !== 'dungeon') this.despawn(key, list);
    }
    if (cx !== this.focusCx || cz !== this.focusCz || this.alsoNear.length > 0) {
      this.focusCx = cx; this.focusCz = cz;
      for (const [key, list] of this.spawned) {
        // `dungeon` is a place rather than a chunk, and a place is kept as long as somebody is
        // standing in it. It read as a chunk at nowhere, nowhere is never worth keeping, and so a
        // floor lost every monster on it the first time this ran — which is the first frame, because
        // the focus starts at nowhere too. An empty dungeon is a hard thing to notice from outside:
        // the rooms are there, the doors are there, the chests are there, and nothing is home.
        if (key === 'dungeon') continue;
        const [kx, kz] = parseChunkKey(key);
        if (!this.worthKeeping(kx, kz, cx, cz)) this.despawn(key, list);
      }
    }
    // chunks arrive asynchronously, so keep polling the spawn window — round everybody in the
    // world, not only round whoever this manager is following
    for (const who of this.alsoNear) this.spawnAround(Math.floor(who.x / CS), Math.floor(who.z / CS));
    this.spawnAround(cx, cz);

    const ctx = {
      world: this.world, rng: this.rng, playerX, playerZ, playerArmed,
      playerAfloat: afloat, onAttack, time, treeFor,
      quarry: (from: Entity, within: number) => this.nearestQuarry(from, within),
      removeEntity: (prey: Entity) => this.killEntity(prey),
      nearestPerson: (from: Entity, within: number) => this.nearestPerson(from, within),
      nearestTrouble: (from: Entity, within: number) => this.nearestTrouble(from, within),
      strike: (attacker: Entity, victim: Entity, damage: number) => this.strike(attacker, victim, damage),
      worth: this.priceOf,
      // a sale reaches the register, which outlives the body that made it
      banked: (person: string, coin: number) => {
        const who = person ? this.register?.find(person) : undefined;
        if (who) who.purse += coin;
      },
      // asked once a tick and handed to everybody, because a village's constables all heard the
      // same news about the same person on the same morning
      wanted: this.guiltOf() > 0,
      arrest: (constable: Entity) => this.takeIn(constable),
    };
    if (this.register && this.register.today !== this.registerDay) {
      this.registerDay = this.register.today;
      reseatVillagers(this.herds, this.register, (e) => this.despawnEntity(e));
    }
    // the moment the law wants somebody, the village turns a constable out into the street. A
    // village shows only a handful of its people at once, so without this the police force is
    // usually indoors when it is needed, which reads as no police force at all.
    const lawOut = this.guiltOf() > 0;
    if (lawOut !== this.lawWasOut) {
      this.lawWasOut = lawOut;
      if (lawOut && this.register) callOutTheLaw(this.herds, this.register);
    }
    for (const h of this.herds) updateHerd(h, dt, ctx);
    const r2 = ACTIVE_RANGE * ACTIVE_RANGE;
    for (const list of this.spawned.values()) {
      for (const e of list) {
        if (!this.worthThinking(e, playerX, playerZ, r2)) continue;
        updateEntity(e, dt, ctx);
      }
    }
    keepBodiesApart(this.spawned.values(), this.herds, playerX, playerZ, ACTIVE_RANGE, dt, this.world);
    buryTheFallen(this.spawned.values(), dt, (e) => this.despawnEntity(e));
  }

  /** Closest creature within `r` tiles of a point. Anyone indoors is not there to talk to. */
  nearest(x: number, z: number, r: number): Entity | null {
    let best: Entity | null = null, bestD = r * r;
    for (const list of this.spawned.values()) {
      for (const e of list) {
        if (e.indoors || e.dead) continue;
        const d = (e.x - x) ** 2 + (e.z - z) ** 2;
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  /** How many creatures have joined this floor's roster, so each gets a number of its own. */
  private enrolled = 0;

  /** Spawn monsters directly (used by dungeons, which have their own tile world). */
  spawnMonsters(anchors: Array<[number, number]>, seed: number, floor = 1): Entity[] {
    const rng = mulberry32(seed);
    const out: Entity[] = [];
    const key = 'dungeon';
    let list = this.spawned.get(key);
    if (!list) { list = []; this.spawned.set(key, list); }
    for (const [x, z] of anchors) {
      const kindId = pickKind(dungeonMonsters(floor), rng());
      if (!kindId) continue;
      const herd = this.spawnHerdAt(kindId, x, z, rng, key, out);
      if (herd.members.length === 0) continue;
    }
    this.enrol(list, out);
    return out;
  }

  private spawnHerdAt(kindId: string, x: number, z: number, rng: Rng, key: string, out: Entity[], many = 0): Herd {
    const kind = KINDS[kindId];
    // a caller who knows how many are left says so: a band that has been fought is not a fresh one
    const size = many > 0 ? many : kind.herd[0] + Math.floor(rng() * (kind.herd[1] - kind.herd[0] + 1));
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
  spawnPack(kindId: string, x: number, z: number, radius: number, seed: number, key = 'sea', many = 0): Entity[] {
    const rng = mulberry32(seed);
    const out: Entity[] = [];
    const angle = rng() * Math.PI * 2;
    const herd = this.spawnHerdAt(
      kindId,
      x + Math.cos(angle) * radius,
      z + Math.sin(angle) * radius,
      rng, key, out, many,
    );
    if (herd.members.length === 0) return out;
    herd.tag = key;                          // so a creature that dies knows whose band it was
    let list = this.spawned.get(key);
    if (!list) { list = []; this.spawned.set(key, list); }
    list.push(...out);
    return out;
  }

  /** Send a pack away: the sea hunters lose interest ashore, and a band walks out of sight. */
  despawnPack(key = 'sea'): void {
    const list = this.spawned.get(key);
    if (!list) return;
    for (const e of [...list]) this.despawnEntity(e);
    this.spawned.delete(key);
  }

  /** How many of a pack are still standing. */
  packSizeOf(key = 'sea'): number {
    return this.spawned.get(key)?.length ?? 0;
  }

  /** How many hunters are in the water right now. */
  get packSize(): number {
    return this.packSizeOf();
  }

  /**
   * Put one named creature somewhere: a dungeon boss, say.
   *
   * Filed under the chunk it stands in rather than under `dungeon` when it is put down out of
   * doors, because the sweep that decides which chunks are worth keeping cannot read `dungeon` as
   * a place: it comes out as nowhere, and nowhere is never worth keeping. So anything put into the
   * open air used to be swept away on the next step, which is a hard thing to notice from the
   * outside — the creature is made, it is handed back, and then it is not there.
   */
  spawnOne(kindId: string, x: number, z: number, seed: number, outdoors = false): Entity | null {
    const rng = mulberry32(seed);
    const out: Entity[] = [];
    const CS = WORLD.CHUNK_SIZE;
    const key = outdoors ? chunkKey(Math.floor(x / CS), Math.floor(z / CS)) : 'dungeon';
    const herd = this.spawnHerdAt(kindId, x, z, rng, key, out);
    let list = this.spawned.get(key);
    if (!list) { list = []; this.spawned.set(key, list); }
    this.enrol(list, out);
    return herd.members[0] ?? null;
  }

  /**
   * A creature has been killed: let it fall before it leaves.
   *
   * This is the difference between dying and being removed. Everything that kills something comes
   * through here, and it keeps a body for the length of the collapse; unloading a chunk, or a
   * host telling us a monster is gone, still goes straight to `despawnEntity`, because neither of
   * those is a death and neither should be watched.
   *
   * Its pace is dropped rather than left where it was, so the walk stops with it and the file's
   * collapse is not fighting a stride that is still running underneath.
   */
  killEntity(e: Entity): void {
    startDying(e);
  }

  /** Bodies presently on their way down. `within` will not return them: they are not alive. */
  theFallen(): Entity[] {
    const out: Entity[] = [];
    for (const list of this.spawned.values()) for (const e of list) if (e.dying > 0) out.push(e);
    return out;
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
   * The three questions creatures ask of a crowd. The work is in quarry.ts; what stays here is
   * the crowd itself, which only the manager can supply.
   */
  private nearestQuarry(from: Entity, within: number): Entity | null {
    return nearestQuarry(from, this.within(from.x, from.z, within));
  }

  private nearestPerson(from: Entity, within: number): Entity | null {
    return nearestPerson(from, this.within(from.x, from.z, within));
  }

  private nearestTrouble(from: Entity, within: number): Entity | null {
    return nearestTrouble(from, this.within(from.x, from.z, within), this.heroX, this.heroZ);
  }

  /**
   * A constable has caught up with somebody the law wants, and taken them in.
   *
   * The pay is the law's own, on the same purse as every other bounty: putting down the wolf that
   * was on a farmer and putting away the man who was is the same job, and a worse criminal is
   * worth more of it. What being taken in actually costs the hero is the game's business.
   */
  private takeIn(constable: Entity): void {
    const guilt = Math.max(0, Math.min(1, this.guiltOf()));
    constable.purse += Math.round(BOUNTY.ARREST + guilt * BOUNTY.ARREST_WORST);
    this.onArrest(constable);
  }

  /**
   * One creature hurting another. The victim fights back or runs, and anything killed leaves the
   * world; the hero's own hearts are handled elsewhere, because they have a HUD and a save.
   */
  private strike(attacker: Entity, victim: Entity, damage: number): void {
    throwBlow(attacker, blowOf(attacker.kind));
    if (damageEntity(victim, damage, attacker.x, attacker.z, this.world)) {
      if (PEOPLE.has(victim.kind.id)) this.onFallen(victim);
      // what a killed animal is worth to whoever killed it: a constable's bounty, a hunter's pelt
      const bounty = victim.kind.gold?.[0] ?? 0;
      if (bounty > 0 && PEOPLE.has(attacker.kind.id)) {
        attacker.purse += attacker.trade === 'constable' ? bounty : Math.round(bounty * BOUNTY.RESCUE_SHARE);
      }
      this.killEntity(victim);
      attacker.target = null;
      return;
    }
    // being bitten is a good reason to notice who is biting you
    if ((victim.kind.dangerous ?? 0) > 0) victim.target = attacker;
  }

  /** Every live creature within `r` tiles, nearest first. */
  /**
   * Everything alive within `r` tiles, nearest first.
   *
   * The dead are left out here rather than at each of the dozen places that ask, because a body
   * now stays in the world while it falls: without this you could talk to a corpse, hand it a
   * gift, hire it, or have it answer Enter in front of the person standing behind it. Anything
   * that genuinely wants a body wants a carcass, which is a different list.
   */
  within(x: number, z: number, r: number): Entity[] {
    const hits: Array<{ e: Entity; d: number }> = [];
    const near = (e: Entity): void => {
      if (e.dead) return;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d <= r) hits.push({ e, d });
    };
    for (const list of this.spawned.values()) for (const e of list) near(e);
    for (const e of this.guests) near(e);
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
  /**
   * Take away the wildlife this client invented for itself, keeping the people.
   *
   * Called when the world takes over the animals. Without it the deer this client made go on
   * standing in the field beside the ones the world sent, and only one of each pair is there as far
   * as anybody else is concerned. The villagers stay: nobody else is spawning those.
   */
  forgetTheWildlife(): void {
    for (const [key, list] of this.spawned) {
      // somebody with a name in the register, or a job in a village: those are the client's
      const people = list.filter((e) => e.person !== '' || e.role !== 'none');
      for (const e of list) if (!people.includes(e)) this.despawnEntity(e);
      this.spawned.set(key, people);
    }
  }

  /** Fill in the creatures around one place, for whatever chunks have arrived there. */
  private spawnAround(cx: number, cz: number): void {
    for (let dz = -SPAWN_RADIUS; dz <= SPAWN_RADIUS; dz++) {
      for (let dx = -SPAWN_RADIUS; dx <= SPAWN_RADIUS; dx++) {
        const key = chunkKey(cx + dx, cz + dz);
        if (this.spawned.has(key)) continue;
        const tiles = this.chunks.getTiles(cx + dx, cz + dz);
        if (!tiles) continue;
        this.spawned.set(key, this.spawnChunk(tiles, key));
      }
    }
  }

  /** Whether a chunk is near anybody at all: the one this manager follows, or another player. */
  private worthKeeping(kx: number, kz: number, cx: number, cz: number): boolean {
    if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) <= SPAWN_RADIUS + 1) return true;
    const CS = WORLD.CHUNK_SIZE;
    for (const who of this.alsoNear) {
      const ox = Math.floor(who.x / CS), oz = Math.floor(who.z / CS);
      if (Math.max(Math.abs(kx - ox), Math.abs(kz - oz)) <= SPAWN_RADIUS + 1) return true;
    }
    return false;
  }

  /** Whether a creature is near enough to anybody to be worth thinking for. */
  private worthThinking(e: Entity, playerX: number, playerZ: number, r2: number): boolean {
    const dx = e.x - playerX, dz = e.z - playerZ;
    if (dx * dx + dz * dz <= r2) return true;
    for (const who of this.alsoNear) {
      const ox = e.x - who.x, oz = e.z - who.z;
      if (ox * ox + oz * oz <= r2) return true;
    }
    return false;
  }

  private spawnChunk(tiles: ChunkTiles, key: string): Entity[] {
    const rng = mulberry32(hash3(this.seed, tiles.cx, tiles.cz, SALT.HERD_CHUNK));
    const sorted = sortTiles(tiles);
    const out: Entity[] = [];
    if (sorted.land.length === 0 && sorted.water.length === 0 && sorted.road.length === 0) return out;
    const ctx: SpawnCtx = { tiles, key, rng, out };

    this.spawnVillageFolk(ctx);
    // Everything below this line is wildlife, and the world owns that when there is a world to own
    // it: the animals are what two players standing in one field disagree about. The people of a
    // village are not — they are the seed and the register, which everybody has.
    if (this.toldWhatLives) return out;
    // after dark, something else is out on the land
    if (this.night && sorted.land.length >= SPAWN.MIN_LAND_TILES && rng() < SPAWN.NIGHT_PACK_CHANCE) {
      const table = NIGHT_PREDATORS[sorted.biome];
      const kindId = table[Math.floor(rng() * table.length)];
      const den = openGround(this.world, tiles, sorted.land, rng);
      if (den) this.spawnHerd(ctx, kindId, den, SPAWN.NIGHT_LEASH);
    }
    if (sorted.land.length >= SPAWN.MIN_LAND_TILES) {
      const rolls = rng() < SPAWN.HERD_CHANCE ? (rng() < SPAWN.SECOND_HERD_CHANCE ? 2 : 1) : 0;
      for (let h = 0; h < rolls; h++) {
        // high ground has its own list: a massif can stand in any country, so what decides what
        // lives here is the height rather than the biome the map happens to call it
        const spot = openGround(this.world, tiles, sorted.land, rng);
        if (!spot) break;
        const table = this.highland(spot[0], spot[1]) ? HIGHLAND_ANIMALS : BIOME_ANIMALS[sorted.biome];
        const kindId = pickKind(table, rng());
        if (!kindId) break;
        this.spawnHerd(ctx, kindId, spot, SPAWN.HERD_LEASH);
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
  /** The people a village would have out today, given who is alive and who is already outside. */
  private residentsFor(v: Village, posts: Partial<Record<Post, [number, number]>>, wanted: number): Person[] {
    if (!this.register) return [];
    const alreadyOut = new Set([...this.herds].flatMap((h) => h.members.map((e) => e.person)));
    return residentsOnTheStreet(this.register, v, posts, wanted, alreadyOut, this.guiltOf() > 0);
  }

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
        // one of them keeps the horses, in the villages that have any
        if (herd.members.length > 1 && this.hasStable(v.name)) herd.members[1].role = 'stablehand';
        // everybody gets a house, a trade, and the places that trade takes them
        const posts = postsOf(v, this.world);
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

