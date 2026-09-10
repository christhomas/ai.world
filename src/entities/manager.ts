import type * as THREE from 'three';
import { WORLD } from '../core/config';
import { hash3, mulberry32, type Rng } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { chunkKey, parseChunkKey } from '../world/spatial';
export type { ChunkSource, ChunkTiles } from '../world/tiles';
import { sortTiles } from './chunkspots';
export { tileCentre } from './chunkspots';
import type { ChunkSource, ChunkTiles } from '../world/tiles';
import { KINDS } from './animals';
import { dungeonMonsters, pickKind, type SpawnSpot } from './spawns';
import { treeFor } from './behaviours';
import type { Register } from '../world/register';
import { stageOf, type Person } from '../world/people';
import { spawnPaddocks } from './paddocks';
import { spawnVillageFolk } from './street';
import { spawnWildlife } from './wilds';
import { BEHAVIOUR, Entity, Herd, anybodyAt, canStand, isDaytime, updateEntity, updateHerd, type Post, type TileWorld } from './entity';
import { keepBodiesApart } from './contact';
import { buryTheFallen, startDying } from './dying';
import { residentsOnTheStreet } from './residents';
import { callOutTheLaw, reseatVillagers } from './village';
import { nearestPerson, nearestQuarry, nearestTrouble } from './quarry';
import { nearest, within } from './neighbours';
import type { EntityView } from './roster';
import type { Village } from '../world/structures';
import { ACTIVE_RANGE, SPAWN, SPAWN_RADIUS } from './spawning';
import { Pace, now } from './pace';
import { arrestPay, oneHurtsAnother } from './violence';
import { Tiers, arrive, worthKeeping, type Arrival } from './tiers';

/**
 * The list a place's own people are filed under, as against a chunk of open country.
 *
 * The word is `dungeon` because a floor of a vault was the first place that ever needed one, and
 * the name has since travelled to the wire and to `roster`, where changing it would be a protocol
 * change made for a spelling. What it *means* is a place: somewhere held for exactly as long as
 * somebody is standing in it, and let go of the moment they walk out. A shop is one of those as
 * much as a mine is.
 *
 * It matters which list somebody is in. Every other key is read as a chunk of the country by the
 * sweep at the top of `update`, and a key that is not a chunk comes out of `parseChunkKey` as
 * nowhere — which is never worth keeping. So anybody filed under a name of their own would be
 * swept away on the first step across the room, which is the hardest kind of fault to see from
 * outside: the person is made, they are handed back, and then they are not there.
 */
export const A_PLACE = 'dungeon';

/**
 * And the other list of that kind: where the men this player has paid are filed.
 *
 * A place in exactly the sense above, and the place is *you*: a hired man is under no chunk because
 * he walks with you across all of them, and he is kept for as long as the bargain is.
 */
export const COMPANY = 'hired';

/** The lists that are places, which the country sweeps below must let alone. */
const PLACES: ReadonlySet<string> = new Set([A_PLACE, COMPANY]);

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
   *
   * The people of a village were the exception until a villager was given something of his own to
   * remember; `street.ts` has that argument. Nothing at all is spawned here now when somebody else
   * is holding the world — villagers, paddocks and wildlife alike.
   */
  toldWhatLives = false;
  /**
   * How long the ground a herd belongs to had been nobody's business when it was handed back.
   *
   * In seconds, and nought is the honest answer for most of them. It is a question the manager
   * cannot answer for itself — a week of absence is written in a province file and a province is
   * the server's idea rather than a creature's — so whoever holds the world answers it, and on a
   * server that is `SharedWorld.asleep(provinceOfHome(herd))`. Left alone, nothing is ever caught
   * up, which is what a dungeon floor wants: a floor is grown when somebody walks into it and
   * dropped when they leave, so it has no absence to account for.
   */
  sleptFor: (herd: Herd) => number = () => 0;
  /**
   * People on the register who are not to be put out into the street, by id. See `residentsFor`.
   */
  spokenFor: ReadonlySet<string> = new Set();
  private readonly herds = new Set<Herd>();
  /** Who is near enough to somebody to matter this tick, sorted once and used three times. */
  private readonly tiers = new Tiers();
  /** How many creatures this machine can afford to think for, measured from its own clock. */
  private readonly pace = new Pace();
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
      // day flipped: let chunks respawn so the night shift can arrive (or go home). Places are left
      // alone — a floor and the men in your pay are not a night's worth of country to be rolled
      // again, and throwing them away here would take a paid soldier off the road at every dusk.
      for (const [key, list] of this.spawned) if (!PLACES.has(key)) this.despawn(key, list);
    }
    if (cx !== this.focusCx || cz !== this.focusCz || this.alsoNear.length > 0) {
      this.focusCx = cx; this.focusCz = cz;
      for (const [key, list] of this.spawned) {
        // A place is kept as long as its owner wants it rather than as long as it is near. `A_PLACE`
        // read as a chunk at nowhere, nowhere is never worth keeping, and so a floor lost every
        // monster on it the first time this ran — which is the first frame, because the focus starts
        // at nowhere too. An empty dungeon is a hard thing to notice from outside: the rooms are
        // there, the doors are there, the chests are there, and nothing is home.
        if (PLACES.has(key)) continue;
        const [kx, kz] = parseChunkKey(key);
        if (!worthKeeping(kx, kz, cx, cz, this.alsoNear)) this.despawn(key, list);
      }
    }
    // chunks arrive asynchronously, so keep polling the spawn window — round everybody in the
    // world, not only round whoever this manager is following
    const when: Arrival | null = time === undefined ? null : { time, seed: this.seed, ground: this.world };
    for (const who of this.alsoNear) this.spawnAround(Math.floor(who.x / CS), Math.floor(who.z / CS), when);
    this.spawnAround(cx, cz, when);

    const ctx = {
      world: this.world, rng: this.rng, playerX, playerZ, playerArmed,
      playerAfloat: afloat, onAttack, time, treeFor,
      quarry: (from: Entity, within: number) => this.nearestQuarry(from, within),
      removeEntity: (prey: Entity) => this.killEntity(prey),
      nearestPerson: (from: Entity, within: number) => this.nearestPerson(from, within),
      nearestTrouble: (from: Entity, within: number) => this.nearestTrouble(from, within),
      strike: (attacker: Entity, victim: Entity, damage: number) => oneHurtsAnother(
        { world: this.world, fallen: (who) => this.onFallen(who), remove: (who) => this.killEntity(who) },
        attacker, victim, damage,
      ),
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
    // Everything below this line works off the tiers rather than off everything the world holds,
    // and that is the whole of C2's third tier: the sweep used to walk every creature in the world
    // to find the few it had an opinion about, and the herd pass used to run for every herd whether
    // or not anybody was thinking for its members. Both now get the list instead of building it.
    /*
     * And how many of them this machine can afford to think for, which is C2b.
     *
     * The clock decides, not a constant: the live pass is timed and the budget follows it, so a
     * laptop thinks for a few hundred creatures and a Pi for fewer, and both are holding the same
     * world. Nothing is despawned and nothing refused — see `pace.ts` for why that distinction is
     * the whole of the design.
     */
    this.tiers.sort(this.spawned.values(), playerX, playerZ, this.alsoNear, this.pace.many);
    const began = now();
    for (const h of this.tiers.liveHerds) updateHerd(h, dt, ctx);
    for (const e of this.tiers.live) updateEntity(e, dt, ctx);
    this.pace.measured((now() - began) / 1000, dt, this.tiers.live.length);
    keepBodiesApart([this.tiers.live], this.tiers.liveHerds, playerX, playerZ, ACTIVE_RANGE, dt, this.world);
    buryTheFallen(this.spawned.values(), dt, (e) => this.despawnEntity(e));
  }

  /** Closest creature within `r` tiles of a point. Anyone indoors is not there to talk to. */
  nearest(x: number, z: number, r: number): Entity | null {
    return nearest(this.spawned.values(), this.guests, x, z, r);
  }

  /** How many creatures have joined this floor's roster, so each gets a number of its own. */
  private enrolled = 0;

  /** Spawn monsters directly (used by dungeons). A spot that names its occupant gets it: @see SpawnSpot. */
  spawnMonsters(anchors: ReadonlyArray<SpawnSpot>, seed: number, floor = 1): Entity[] {
    const rng = mulberry32(seed);
    const out: Entity[] = [];
    const key = 'dungeon';
    let list = this.spawned.get(key);
    if (!list) { list = []; this.spawned.set(key, list); }
    for (const [x, z, named] of anchors) {
      const kindId = named ?? pickKind(dungeonMonsters(floor), rng());
      if (!kindId || !KINDS[kindId]) continue;
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
   * Take somebody who already exists into this crowd, exactly where they are standing.
   *
   * Everything else here makes a person as well as places one: a kind is named, a spot is rolled
   * somewhere near an anchor, and what comes out is a stranger. A building's keeper is the other
   * way round. The room decides who he is before he exists — `Entity.kind` is readonly and the
   * trade is what chooses the body, so a sergeant has to be known to be a sergeant before there is
   * anybody there at all — and then he stands on the one tile behind his own counter and nowhere
   * else. Rolled through `spawnPack` he would be scattered off that tile, and worse: the spawn asks
   * `canStand` about the ground beside a counter, which can perfectly well answer no, and the shop
   * would then have nobody in it at all.
   *
   * So this places nobody and asks nothing. It takes what it is handed, files it under the place,
   * gives it to the renderer and gives it a roster number — which between them are the whole of
   * what belonging to a crowd means: found by `within`, thought for by `update`, and buried through
   * the same `onFallen` as everybody else. It is the opposite end of the same idea as `guests`,
   * which is for creatures that are drawn here and thought for somewhere else.
   */
  admit(who: Entity, key: string = A_PLACE): Entity {
    let list = this.spawned.get(key);
    if (!list) { list = []; this.spawned.set(key, list); }
    // a body built outside is not necessarily in its own herd's list yet, and a herd nobody has
    // ever added is a herd `updateHerd` never runs
    if (!who.herd.members.includes(who)) who.herd.members.push(who);
    this.herds.add(who.herd);
    // whether the pool had room is the renderer's business: somebody it could not draw is still
    // standing there, and can still be talked to, which is what he is there for
    this.renderer.add(who);
    this.enrol(list, [who]);
    return who;
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
   * What this manager holds, under the chunk or the place each of it was filed under.
   *
   * Handed out because that filing is the answer to a question this class should not have to grow
   * a second opinion about: which of these things belongs to a province. `homeland.ts` reads it.
   */
  get filed(): ReadonlyMap<string, Entity[]> { return this.spawned; }

  /**
   * Everything near enough to somebody that they could be told about it, as of the last step.
   *
   * The list a frozen creature is off, and the point of freezing at all. Whoever describes a world
   * to a player walks this rather than the roster, so the country the world is holding but nobody
   * is anywhere near is walked past once a tick here instead of once a tick for every player
   * connected. It is a live view of the manager's own array and is rebuilt by the next `update`, so
   * it is for reading now and not for keeping.
   */
  get watched(): ReadonlyArray<Entity> { return this.tiers.watched; }

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

  /** A constable has caught up with somebody the law wants. The pay is `violence.ts`'s to reckon. */
  private takeIn(constable: Entity): void {
    constable.purse += arrestPay(this.guiltOf());
    this.onArrest(constable);
  }

  /** Is anybody but `ignore` standing here? The arithmetic of two bodies is `anybodyAt`. */
  occupied(x: number, z: number, ignore: Entity): boolean { return anybodyAt(this.within(x, z, 1.6), x, z, ignore); }

  /** Everything alive within `r` tiles, nearest first, this manager's and its guests' alike. */
  within(x: number, z: number, r: number): Entity[] {
    return within(this.spawned.values(), this.guests, x, z, r);
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

  /**
   * Take away everything this client invented for itself.
   *
   * Called when the world takes over, and again when it stops talking: the same act in both
   * directions, because a chunk this forgets is a chunk that gets rolled again by whichever half is
   * deciding at the time. Without it the deer this client made go on standing in the field beside
   * the ones the world sent, and only one of each pair is there as far as anybody else is concerned.
   *
   * It used to keep the people, on the argument `street.ts` sets out and no longer holds, so the
   * street is emptied along with the field. A floor's monsters and a pack of sea hunters are put
   * down by hand rather than rolled per chunk, and after this has run, so it is not about them.
   */
  forgetWhatWeInvented(): void {
    for (const [key, list] of this.spawned) {
      // except the men this player has paid for. They are not the world's and never were — it has
      // been told to take them off the street precisely so that they can be this page's own — so
      // taking them away here would be dismissing somebody's company because a world spoke.
      if (key === COMPANY) continue;
      for (const e of [...list]) this.despawnEntity(e);
      // the chunk is forgotten rather than emptied, so that it is rolled again the next time this
      // page is the one deciding. Left as an empty list it would be a square of country this
      // manager believes it has already populated, and a world that went quiet would hand back a
      // countryside with nothing in it until the hero walked far enough away to lose the chunk.
      this.spawned.delete(key);
    }
  }

  /**
   * Fill in the creatures around one place, for whatever chunks have arrived there.
   *
   * @param when the hour and the seed, for putting a herd where the time nobody was here would have
   * left it. Null when nothing has told this manager what time it is, and then nothing is caught up
   * at all — half the closed forms are about which post somebody stands at at three in the morning,
   * and a form handed a guessed hour would stand a village in the street at the wrong end of a day.
   */
  private spawnAround(cx: number, cz: number, when: Arrival | null): void {
    for (let dz = -SPAWN_RADIUS; dz <= SPAWN_RADIUS; dz++) {
      for (let dx = -SPAWN_RADIUS; dx <= SPAWN_RADIUS; dx++) {
        const key = chunkKey(cx + dx, cz + dz);
        if (this.spawned.has(key)) continue;
        const tiles = this.chunks.getTiles(cx + dx, cz + dz);
        if (!tiles) continue;
        const born = this.spawnChunk(tiles, key);
        this.spawned.set(key, born);
        // The coarse tier, and the whole of it. A chunk comes back with its herds standing exactly
        // where the seed founded them, however long ago anybody was last here; this is the one
        // moment at which the time away can be accounted for, and it is before a single player has
        // been told any of these creatures exist.
        if (when) arrive(born, this.sleptFor, when);
      }
    }
  }

  /** Deterministic per-chunk spawn: land herds, water herds, travellers, and any village folk. */
  private spawnChunk(tiles: ChunkTiles, key: string): Entity[] {
    const rng = mulberry32(hash3(this.seed, tiles.cx, tiles.cz, SALT.HERD_CHUNK));
    const sorted = sortTiles(tiles);
    const out: Entity[] = [];
    if (sorted.land.length === 0 && sorted.water.length === 0 && sorted.road.length === 0) return out;
    const ctx: SpawnCtx = { tiles, key, rng, out };

    // Nothing at all when somebody else is holding this world. The animals went across first, on
    // the argument that they are what two players standing in one field disagree about; the people
    // stayed behind on the argument that they are the seed and the register and so nobody disagrees
    // about them. That second argument was true right up until a villager was given something of
    // his own to remember, and then it was two men of the same name in two different moods.
    if (this.toldWhatLives) return out;

    spawnVillageFolk({
      villages: this.villages, world: this.world,
      place: (...a) => this.place(...a),
      residentsFor: (v, posts, wanted) => this.residentsFor(v, posts, wanted),
      hasStable: (village) => this.hasStable(village),
    }, ctx);
    spawnPaddocks({ villages: this.villages, place: (...a) => this.place(...a) }, ctx);
    spawnWildlife({
      world: this.world, night: this.night, highland: this.highland,
      awayFromVillages: (x, z) => {
        let nearest = Infinity;
        for (const v of this.villages) nearest = Math.min(nearest, Math.hypot(v.x - x, v.z - z));
        return nearest;
      },
      herd: (c, kindId, anchor, leash) => this.spawnHerd(c, kindId, anchor, leash),
      place: (...a) => this.place(...a),
    }, ctx, sorted);
    return out;
  }

  /**
   * The people a village would have out today, given who is alive and who is elsewhere.
   *
   * Elsewhere is two things and they are the same thing: already standing outside, or away in
   * somebody's pay. A hired man has left his village — he walks with the traveller who bought his
   * day, indoors and down staircases and onto boats — so a street that went on showing him at the
   * well would be showing a man who is two counties off.
   */
  private residentsFor(v: Village, posts: Partial<Record<Post, [number, number]>>, wanted: number): Person[] {
    if (!this.register) return [];
    const alreadyOut = new Set([...this.herds].flatMap((h) => h.members.map((e) => e.person)));
    for (const hired of this.spokenFor) alreadyOut.add(hired);
    return residentsOnTheStreet(this.register, v, posts, wanted, alreadyOut, this.guiltOf() > 0);
  }

  /** A herd of a kind's natural size around an anchor. */
  private spawnHerd(ctx: SpawnCtx, kindId: string, anchor: [number, number], leash: number): Herd {
    const kind = KINDS[kindId];
    const size = kind.herd[0] + Math.floor(ctx.rng() * (kind.herd[1] - kind.herd[0] + 1));
    return this.place(ctx, kindId, anchor, size, leash);
  }

  /**
   * @param scatter how far from the anchor the first of them may stand. The default is the open
   * country's, which is wider than a paddock: a goat put down forty feet outside its own fence
   * spends the rest of the day trying to walk back through it.
   */
  /**
   * @param bodyFor which body the nth of them wears, when they are not all the same.
   *
   * `kind` is readonly and the renderer pools by it, so a body cannot be changed after the fact:
   * it has to be chosen before the entity exists. `trades.ts` says which body a trade wears.
   */
  private place(
    ctx: SpawnCtx, kindId: string, anchor: [number, number], count: number, leash: number,
    scatter = SPAWN.SCATTER, bodyFor?: (n: number) => string,
  ): Herd {
    const { rng } = ctx;
    const kind = KINDS[kindId];
    const herd = new Herd(kind, anchor[0], anchor[1], anchor[0], anchor[1], leash);
    for (let n = 0; n < count; n++) {
      // the herd keeps the kind it was asked for — it is what decides how they move together — and
      // only the body changes, which is why a village of seven trades is still one herd
      const wears = bodyFor ? KINDS[bodyFor(n)] ?? kind : kind;
      for (let attempt = 0; attempt < SPAWN.PLACE_ATTEMPTS; attempt++) {
        const a = rng() * Math.PI * 2, r = kind.behaviour === 'fly' ? SPAWN.FLIER_RING : rng() * scatter;
        const x = anchor[0] + Math.cos(a) * r, z = anchor[1] + Math.sin(a) * r;
        if (!canStand(this.world, kind, x, z)) continue;
        const e = new Entity(wears, x, z, herd, ctx.key, rng);
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

export interface SpawnCtx { tiles: ChunkTiles; key: string; rng: Rng; out: Entity[] }

