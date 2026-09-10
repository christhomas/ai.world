import { CAMERA } from '../core/config';
import type { Rng } from '../core/rng';
import { mulberry32 } from '../core/rng';
import type { IsoCamera } from '../render/camera';
import type { PropLibrary } from '../render/props';
import type { SceneRig } from '../render/scene';
import type { ChunkManager } from '../world/chunkManager';
import type { Manifest } from '../world/manifest';
import type { Doorway, ShopType } from '../world/structures';
import { generateDungeon, type DungeonStyle } from '../dungeon/generate';
import { DungeonScene } from '../dungeon/scene';
import { DungeonWorld } from '../dungeon/world';
import { generateInterior, interiorSeed, interiorTitle, type InteriorKind } from '../interior/generate';
import { InteriorScene } from '../interior/scene';
import { InteriorWorld } from '../interior/world';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { bodyForTrade } from '../entities/trades';
import type { Player } from '../entities/player';
import { DungeonMinimap } from '../ui/dungeonmap';
import { FACEWORK, putTheCrewToWork, type Digger } from './crews';
import { ITEMS } from './items';
import type { Register } from '../world/register';
import type { GameState } from './state';
import type { HeroGear } from '../render/herogear';

/** Everything a place needs to swap the world out from under the hero. */
export interface PlaceContext {
  /** Whoever is walking with you takes their share of any coin that comes in. */
  takeShare: (gold: number) => void;
  /** The village's miners who are down this hole today, so they can be met at the face. */
  crewIn: (anchorId: string) => readonly Digger[];
  /**
   * Somebody has been killed, and everything that follows from it: off the register for good, a
   * pack left where they fell, a line in the corner of the screen if it happened in sight.
   *
   * The overworld's crowd has had this since there were villagers to lose. A floor's crowd had
   * neither this nor the register, so an ogre could kill one of the crew in front of you and the
   * man was back at his face the next time you walked in — the tunnels could not report a death to
   * the one record there is. They are handed the same two things now, which is the point: nothing
   * invents a second answer about who is alive.
   */
  fallen: (who: Entity) => void;
  /** Who lives in the villages, so a man killed underground is the man the street knows. */
  register: Register;
  /**
   * And what a death in these workings does to the village that works them.
   *
   * Kept apart from `fallen`, because it is a different fact about a different thing: `fallen` is
   * about a person, and this is about a place. A village hears that somebody did not come up and
   * is frightened of the hole, whoever it was.
   */
  aDeathBelow: (anchorId: string) => void;
  seed: number;
  manifest: Manifest;
  state: GameState;
  props: PropLibrary;
  rig: SceneRig;
  iso: IsoCamera;
  player: Player;
  /** The outdoor world and the renderer the hero belongs to when above ground. */
  overworld: ChunkManager;
  overworldRenderer: EntityRenderer;
  /** Follows the hero between scenes so worn gear is drawn wherever they are. */
  heroGear: HeroGear;
  minimapCanvas: HTMLCanvasElement;
  rng: Rng;
  flash: (message: string) => void;
  chime: () => void;
  setCaveAmbience: (on: boolean) => void;
  persist: () => void;
  /** Tell anyone else in this world about a chest opened or a vault unlocked. */
  report: (delta: { kind: 'chest'; id: string } | { kind: 'key'; id: string }) => void;
  /**
   * A floor has been stepped into: which one, hanging off which anchor, and how deep.
   *
   * The world grows the same floor from the same anchor name and owns what walks about in it, so
   * this returns whether it did. When it did, nothing is spawned here — being told what lives
   * somewhere and inventing it are the two ways to have monsters, and doing both gives you two of
   * every one, half of which nobody else can see.
   */
  wentBelow: (below: {
    place: string;
    anchorId: string;
    kind: 'dungeon' | 'cave' | 'thicket';
    floor: number;
    /** What will draw the floor's monsters, and what will hold them, once it is told about them. */
    renderer: EntityRenderer;
    monsters: EntityManager;
  }) => boolean;
  /** And come back up, so whatever was drawing the floor's monsters can be put away. */
  cameUp: () => void;
}

/**
 * The style of place a floor is, which is the seam between the world above and the world below.
 *
 * `dungeon`, `cave` and `thicket` are the three that have always been here. `castle` is the fourth
 * and behaves exactly as they do — from up here, the gatehouse of a castle is a cave mouth with
 * better masonry. Everything past `enterDungeon` is `dungeon/`'s business.
 */
export type PlaceStyle = 'dungeon' | 'cave' | 'thicket' | 'castle';

/**
 * A named spot with a way in: a shrine, a cave mouth, or a castle's gatehouse.
 *
 * `out` is where you are put when you come back up, and it exists because of the castle. Every
 * other way underground is a hole a couple of tiles across, so stepping a fixed distance off it
 * lands you on open ground; a gatehouse is three tiles deep and you go in through its face, so
 * that same fixed step lands you inside the stonework, which is a thing you cannot walk out of.
 * Anything that knows better than the default says so here.
 */
export interface Underground { name: string; x: number; z: number; out?: [number, number] }

export interface DungeonVisit {
  world: DungeonWorld;
  /** Which floor we are on, and how we got here, so climbing out returns to daylight. */
  floor: number;
  style: PlaceStyle;
  anchorId: string;
  scene: DungeonScene;
  renderer: EntityRenderer;
  monsters: EntityManager;
  map: DungeonMinimap;
  poi: Underground;
}

export interface InteriorVisit {
  world: InteriorWorld;
  scene: InteriorScene;
  renderer: EntityRenderer;
  /**
   * Whoever is in this room, which until now was a question the room could not be asked.
   *
   * A floor of a mine has had a crowd of its own since there were monsters on it, and an interior
   * had a renderer and a single body added straight to it — so a shop was the one place in the
   * game where "who is near me" had nobody to ask. See `Places.crowd` for what that cost.
   */
  crowd: EntityManager;
  keeper: Entity | null;
  exit: [number, number];
  /** The doorway this room was entered by, so the game can tell one room from another. */
  door: Doorway;
  title: string;
}

/** Where the hero stands when arriving underground: clear of the stairs, so the exit prompt waits. */
const STAIRS_CLEARANCE: Array<[number, number]> = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [1, 0]];
/** Reach for chests, doors and stairs underground; and for the keeper behind a counter. */
export const REACH = { CHEST: 1.8, DOOR: 2.0, STAIRS: 1.4, BUILDING_DOOR: 1.6 } as const;

/**
 * How far to the side of the mouth you are put when you come back up, in tiles. Beside the hole
 * rather than standing on it, so the thing you have just climbed out of is in front of you.
 */
const OUT_OF_THE_HOLE = 2.5;

/**
 * How much wider than the room the camera sits when you step indoors, so the walls are inside the
 * picture rather than pressed against its edges. The camera then holds still and the hero moves
 * about within it, which is what makes a room read as a room and not as a corridor of view.
 */
const FRAMES_THE_ROOM = 1.35;

/**
 * Who wins when a person and a piece of scenery are both within reach of one keypress.
 *
 * The person does, whenever they are the nearer of the two. Market pitches stand in the middle of
 * the square, which is where the elder holding your errand stands as well, so Enter reached the
 * trestle from anywhere in the square and — offline, where a pitch only says to come back online —
 * there was no way to be paid for the first job of a new save. Found by playing that errand
 * through to its payment and not being paid.
 *
 * Distance rather than a fixed order, because a player standing plainly in front of a stall with
 * somebody wandering past behind them still means the stall.
 */
export function personWins(
  playerX: number, playerZ: number,
  person: { x: number; z: number } | null,
  thingX: number, thingZ: number,
): boolean {
  if (!person) return false;
  return Math.hypot(person.x - playerX, person.z - playerZ)
    < Math.hypot(thingX - playerX, thingZ - playerZ);
}
const BIG_CHEST_PRIZES = ['potion', 'steelsword', 'ironshield', 'helm', 'jerkin', 'mail', 'greaves', 'charm', 'lantern', 'rope', 'map', 'gem'];

/**
 * The hero is always in exactly one place: outdoors, underground, or inside a building. This owns
 * the switch between them, including the scene, the renderer and the world the hero walks on.
 */
export class Places {
  underground: DungeonVisit | null = null;
  indoors: InteriorVisit | null = null;
  /** Camera zoom to put back when stepping outside again. */
  private outdoorZoom = 0;

  constructor(private readonly ctx: PlaceContext) {}

  get outdoors(): boolean { return this.underground === null && this.indoors === null; }

  /**
   * The creatures wherever the hero actually is.
   *
   * A floor of a dungeon has an `EntityManager` of its own — a mine's crew and the things living
   * down there are not in the overworld's — and anything that captured a manager when the game was
   * built captured the overworld's for ever. So `__entities` answered about the fields above your
   * head while you stood in a cave, and the only way to find out was to walk into one and see it
   * report a goat.
   *
   * A room used to answer the same way, and for a worse reason: it had no crowd at all, so this
   * said nobody and every probe fell back on the country. Stood at a watch house desk, `__entities`
   * listed ducks and sheep in a field two hundred tiles off and not the sergeant a pace in front of
   * the hero — which is how a whole class of indoor fault would go unseen, because the readout that
   * would have shown it was describing somewhere else.
   *
   * Indoors first, because that is the order a frame decides in: you can be inside a building that
   * stands over a cellar, and the room is the place you are actually in. Null only out of doors,
   * where the country's own crowd is the answer and whoever is asking already has it.
   */
  get crowd(): EntityManager | null {
    return this.indoors?.crowd ?? this.underground?.monsters ?? null;
  }

  // --- underground ---

  enterDungeon(poi: Underground, kind: PlaceStyle = 'dungeon', anchorId = `dungeon:${poi.name}`, floor = 1): void {
    const { manifest, state, props, rig, iso, player, overworldRenderer, minimapCanvas } = this.ctx;
    /*
     * A castle's floors hang off a `dungeon` anchor, and the seeds still come out different.
     *
     * The manifest's kinds are what salt an anchor's seed, and a castle has no salt of its own —
     * adding one would mean a new `AnchorKind`, a new entry in the salt table and a new generator
     * version, all of which belong to the seed tree rather than to this. It does not need one: an
     * anchor's seed is derived from its *id* as well as its kind, and a castle's id is
     * `castle:<name>`, which no vault has ever been called.
     */
    const anchor = manifest.ensure(anchorId, kind === 'castle' ? 'dungeon' : kind, poi.x, poi.z);
    /*
     * What the floor below is made of, handed to `dungeon/`.
     *
     * One word travels from the gate you walked up to all the way down to the room it grows, and
     * `dungeon` is the only one of the four that is renamed on the way — `vault` is what the
     * generator has always called the thing under a shrine. The other three are the same word on
     * both sides of the seam, which is what makes this line the whole of the handover.
     */
    const style: DungeonStyle = kind === 'dungeon' ? 'vault' : kind;
    const world = new DungeonWorld(generateDungeon(anchor.seed, style, floor), `${anchor.id}:${floor}`, style, props.footprints);
    world.unlocked = state.keys.has(anchor.id);
    const scene = new DungeonScene(world, props, rig.water.material, anchor.seed, state.opened);
    const renderer = new EntityRenderer(scene.scene);
    overworldRenderer.remove(player.entity);
    renderer.add(player.entity);
    this.ctx.heroGear.attachTo(scene.scene);
    player.setWorld(world);

    const [ex, ez] = world.map.entrance;
    const [dx, dz] = STAIRS_CLEARANCE.find(([ox, oz]) => world.heightAt(ex + ox + 0.5, ez + oz + 0.5) !== null) ?? [0, 0];
    player.teleport(ex + dx + 0.5, ez + dz + 0.5);
    iso.target.set(ex + dx + 0.5, 0.5, ez + dz + 0.5);
    // underground you are inside something, and the camera should say so: a cave seen from the
    // height a whole valley is seen from is a diagram of a cave rather than a place you are in
    iso.limitZoom(CAMERA.SHUT_IN_ZOOM);

    /*
     * The crowd of this floor, and it is told who is alive.
     *
     * `[]` villages, because nothing underground is a village and `spawnVillageFolk` walks that
     * list — a floor grows monsters and is handed its crew, and neither of those is a street. What
     * it does get is the register and the same `fallen` the country's own crowd has, so that a
     * miner killed at his face is buried once, in the one place anybody asks.
     */
    const monsters = new EntityManager(
      renderer, world, { getTiles: () => null }, anchor.seed + floor, [],
      undefined,
      (who) => {
        this.ctx.fallen(who);
        // a village is frightened of the hole rather than of the ogre in it, so this is about the
        // workings and not about whoever it was
        if (who.trade === FACEWORK) this.ctx.aDeathBelow(anchorId);
      },
      this.ctx.register,
    );
    const place = `${poi.name}:${floor}`;
    // The world owns a floor when there is a world to own it. Told, it says what lives down here
    // and this spawns nothing; alone, the floor is grown from the same seed the world would have
    // used, which is what keeps a game with no server behind it playing exactly as it did.
    // a castle goes over the wire as a dungeon, because that is a word the protocol already knows
    // and the anchor id is what the world actually grows the floor from
    const told = this.ctx.wentBelow({ place, anchorId, kind: kind === 'castle' ? 'dungeon' : kind, floor, renderer, monsters });
    monsters.toldWhatLives = told;
    if (!told) {
      monsters.spawnMonsters(world.map.monsterSpots, anchor.seed + floor, floor);
      if (world.map.boss) {
        const [bx, bz] = world.map.boss;
        monsters.spawnOne('troll', bx + 0.5, bz + 0.5, anchor.seed + 99);
      }
    }
    /*
     * And the village's own miners, at the faces they are working today.
     *
     * Outside the `told` block, and it is the last crowd of people in the game that is. The men on a
     * street are the world's now — a villager with a memory of his own is a villager two clients
     * would disagree about — but a mine's crew is put down by hand rather than rolled per chunk, and
     * the floor it is put down on is grown by whoever walked into it. Moving them across means the
     * world working the mines too, and the mines are a day's arithmetic on a register rather than a
     * thing anybody stands next to. That is its own item.
     *
     * This mine has been worked every day since the world began; the gold is in the village's
     * purses and the fear is in its gossip. Until now the one place it could not be seen was the
     * mine, and a hole in a hill where the coin of this world is minted stood empty every time
     * anybody walked into it.
     */
    putTheCrewToWork(monsters, world.map, this.ctx.crewIn(anchorId), anchor.seed);
    this.underground = { world, floor, style: kind, anchorId, scene, renderer, monsters, map: new DungeonMinimap(minimapCanvas, world.map), poi };
    this.ctx.setCaveAmbience(true);
    const depth = floor > 1 ? ` — floor ${floor}` : '';
    this.ctx.flash(kind === 'cave' ? `You squeeze into the ${poi.name}`
      : kind === 'castle' ? `You pass under the gate of ${poi.name}${depth}`
      : `You descend into the ${poi.name}${depth}`);
    this.ctx.persist();
  }

  exitDungeon(): void {
    const visit = this.underground;
    if (!visit) return;
    const { player, iso, overworld, overworldRenderer } = this.ctx;
    visit.renderer.remove(player.entity);
    visit.renderer.dispose();
    visit.scene.dispose();
    overworldRenderer.add(player.entity);
    this.ctx.heroGear.attachTo(this.ctx.rig.scene);
    player.setWorld(overworld);
    const [outX, outZ] = visit.poi.out ?? [visit.poi.x + OUT_OF_THE_HOLE, visit.poi.z + 0.5];
    player.teleport(outX, outZ);
    iso.target.set(outX, 0.5, outZ);
    iso.limitZoom(CAMERA.MAX_ZOOM);
    this.underground = null;
    this.ctx.cameUp();
    this.ctx.setCaveAmbience(false);
    this.ctx.persist();
  }

  /** Gold always, the key if this is the key chest, and gear from the big one at the far end. */
  openChest(index: number): void {
    const visit = this.underground;
    if (!visit) return;
    const { state, manifest } = this.ctx;
    const chest = visit.world.map.chests[index];
    const id = visit.world.chestId(index);
    const seed = manifest.get(visit.world.anchorId)?.seed ?? this.ctx.seed;
    const roll = mulberry32(seed + index + 1);
    const gold = chest.big ? 80 + Math.floor(roll() * 70) : 12 + Math.floor(roll() * 30);
    state.inventory.gold += gold;
    this.ctx.takeShare(gold);

    let extra = '';
    if (chest.key) {
      state.keys.add(visit.world.anchorId);
      visit.world.unlocked = true;
      this.ctx.report({ kind: 'key', id: visit.world.anchorId });
      extra = ' and a heavy iron key';
    }
    if (chest.big) {
      const prizes = BIG_CHEST_PRIZES.filter((p) => !state.owns(p) || p === 'potion' || p === 'gem');
      const prize = prizes[Math.floor(roll() * prizes.length)];
      if (prize) {
        state.give(prize, 1);
        extra += `${extra ? ' and' : ' and'} ${ITEMS[prize].emoji} ${ITEMS[prize].name}`;
      }
    }
    state.opened.add(id);
    this.ctx.report({ kind: 'chest', id });
    state.version++;
    visit.scene.rebuildProps(state.opened);
    if (chest.key) this.ctx.flash('The doors to the treasure room unlock');
    this.ctx.chime();
    this.ctx.flash(`Found ${gold} gold${extra}!`);
    this.ctx.persist();
  }

  /** Enter/Space underground: a chest, a locked door, deeper stairs, or the way out. */
  interactUnderground(): 'chest' | 'locked' | 'stairs' | 'descent' | null {
    const visit = this.underground;
    if (!visit) return null;
    const { player, state } = this.ctx;
    const chest = visit.world.chestNear(player.x, player.z, REACH.CHEST, state.opened);
    if (chest >= 0) { this.openChest(chest); return 'chest'; }
    if (visit.world.lockedDoorAt(player.x, player.z, REACH.DOOR)) return 'locked';
    if (visit.world.nearDescent(player.x, player.z, REACH.STAIRS)) return 'descent';
    if (visit.world.nearStairs(player.x, player.z, REACH.STAIRS)) return 'stairs';
    return null;
  }

  /** Take the stairs down to the next floor of the same vault. */
  descend(): void {
    const visit = this.underground;
    if (!visit) return;
    const { poi, style, anchorId, floor } = visit;
    this.closeUnderground();
    this.enterDungeon(poi, style, anchorId, floor + 1);
  }

  /** Put away whatever the hero is standing in: the world is being shut down. */
  dispose(): void {
    this.closeUnderground();
    if (this.indoors) this.leaveBuilding();
  }

  /** Tear down the current floor without putting the hero back outside. */
  private closeUnderground(): void {
    const visit = this.underground;
    if (!visit) return;
    visit.renderer.remove(this.ctx.player.entity);
    visit.renderer.dispose();
    visit.scene.dispose();
    this.underground = null;
    this.ctx.cameUp();
  }

  // --- indoors ---

  enterBuilding(door: Doorway): void {
    const { seed, props, iso, player, overworldRenderer, rng } = this.ctx;
    const room = interiorSeed(seed, door.bx, door.bz);
    const map = generateInterior(room, door.kind as InteriorKind, door.village);
    const world = new InteriorWorld(map, props.footprints);
    const scene = new InteriorScene(map, props);
    const renderer = new EntityRenderer(scene.scene);
    overworldRenderer.remove(player.entity);
    renderer.add(player.entity);
    this.ctx.heroGear.attachTo(scene.scene);
    player.setWorld(world);
    player.teleport(map.entry[0] + 0.5, map.entry[1] + 0.5);

    // frame the whole room: the camera holds still and the hero moves inside it
    this.outdoorZoom = iso.zoom;
    iso.zoom = Math.max(map.w, map.h) * FRAMES_THE_ROOM;
    iso.limitZoom(iso.zoom);
    iso.resize();
    iso.target.set(map.w / 2, 0.5, map.h / 2);

    /*
     * The crowd of this room, on the same terms a floor of a mine is given one.
     *
     * `[]` villages and no tiles to spawn from, because a room is neither a street nor a chunk of
     * country: nothing is grown in here, and everybody in here was put here deliberately. The
     * register and `fallen` are handed over for exactly the reason the tunnels were given them —
     * so that there is one answer about who is alive, wherever they happened to die. A man killed
     * behind his own counter has to be as dead in the village's book as one killed in a field.
     *
     * Seeded from the room's own seed, which is the seed the room was grown from, so a crowd can
     * never end up laid out for a different building than the one it is standing in.
     *
     * It is worth being plain about what this does not do yet: nothing calls `update` on it, so the
     * keeper stands as still today as he did before. What it buys straight away is that the room
     * can be *asked* — every probe that says who is near the hero now answers about this room — and
     * that there is somewhere for a second person indoors to be.
     */
    const crowd = new EntityManager(
      renderer, world, { getTiles: () => null }, room, [],
      undefined,
      (who) => this.ctx.fallen(who),
      this.ctx.register,
    );
    const keeper = map.keeper ? this.placeKeeper(map.keeper, door, crowd, rng) : null;
    this.indoors = { world, scene, renderer, crowd, keeper, door, exit: [door.x, door.z], title: interiorTitle(door.kind as InteriorKind, door.village) };
    this.ctx.chime();
  }

  /**
   * Whoever is stood behind the counter, and what saying so makes them.
   *
   * The trade a person is given here is the whole of what a conversation later has to go on: the
   * altar makes a priest, the hall makes a clerk, the watch house makes a sergeant. None of them is
   * chosen — each is a fact about which door was walked through, which is why the room and not the
   * person is what decides which book comes out.
   *
   * He goes into the room's crowd rather than straight onto its renderer. Drawn was all he used to
   * be, and being drawn is not being present: nothing could find him, because there was nothing
   * holding him to be asked.
   */
  private placeKeeper(spot: [number, number], door: Doorway, crowd: EntityManager, rng: Rng): Entity {
    const civic = door.kind === 'townhall' || door.kind === 'watchhouse';
    const shop = door.kind !== 'house' && door.kind !== 'church' && !civic;
    /*
     * What this person does, worked out before they exist rather than after.
     *
     * `Entity.kind` is readonly and the renderer pools by it, so a body cannot be changed once
     * somebody is standing there — the trade has to be known first. It is the same order
     * `spawnVillageFolk` had to be put into when the trades got bodies of their own, and for the
     * same reason: what a person does is what decides what they are drawn as.
     *
     * A sergeant behind the desk of a watch house was a shopkeeper until now, which is a sergeant
     * nobody can tell from a grocer, and the priest at the altar was one too.
     */
    const trade = door.kind === 'townhall' ? 'clerk'
      : door.kind === 'watchhouse' ? 'sergeant'
      : door.kind === 'church' ? 'priest'
      : undefined;
    const body = trade ? bodyForTrade(trade) : shop ? 'shopkeeper' : 'villager';
    const kind = KINDS[body];
    const herd = new Herd(kind, spot[0], spot[1], spot[0], spot[1], 0);
    herd.tag = door.village;
    const keeper = new Entity(kind, spot[0] + 0.5, spot[1] + 0.5, herd, 'interior', rng);
    keeper.y = 0.5;
    keeper.yaw = Math.PI / 2;   // facing the door
    if (trade) keeper.trade = trade;
    if (shop) { keeper.role = 'shopkeeper'; keeper.shop = door.kind as ShopType; }
    else if (civic) { keeper.role = 'keeper'; }
    // whoever is stood at the altar is the priest, and saying so is what makes him somebody you
    // can ask about the churchyard rather than another villager who happens to be indoors
    else if (door.kind === 'church') { keeper.role = 'congregation'; }
    else keeper.role = 'villager';
    // exactly where he was put and exactly who he was made: `admit` rolls nothing and moves nobody,
    // which is the whole reason he is taken in rather than spawned
    crowd.admit(keeper);
    return keeper;
  }

  leaveBuilding(): void {
    const visit = this.indoors;
    if (!visit) return;
    const { player, iso, overworld, overworldRenderer } = this.ctx;
    visit.renderer.remove(player.entity);
    visit.renderer.dispose();
    visit.scene.dispose();
    overworldRenderer.add(player.entity);
    this.ctx.heroGear.attachTo(this.ctx.rig.scene);
    player.setWorld(overworld);
    player.teleport(visit.exit[0], visit.exit[1] + 1);
    iso.limitZoom(CAMERA.MAX_ZOOM);
    iso.zoom = this.outdoorZoom;
    iso.resize();
    iso.target.set(visit.exit[0], 0.5, visit.exit[1] + 1);
    this.indoors = null;
    this.ctx.persist();
  }

  /** Enter/Space indoors: the keeper, the way out, or nothing. */
  interactIndoors(): 'keeper' | 'left' | null {
    const visit = this.indoors;
    if (!visit) return null;
    const { player } = this.ctx;
    if (visit.keeper && visit.world.nearKeeper(player.x, player.z)) return 'keeper';
    if (visit.world.atDoor(player.x, player.z)) { this.leaveBuilding(); return 'left'; }
    return null;
  }
}
