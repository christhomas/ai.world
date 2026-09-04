import type { Rng } from '../core/rng';
import { mulberry32 } from '../core/rng';
import type { IsoCamera } from '../render/camera';
import type { PropLibrary } from '../render/props';
import type { SceneRig } from '../render/scene';
import type { ChunkManager } from '../world/chunkManager';
import type { Manifest } from '../world/manifest';
import type { Doorway, ShopType } from '../world/structures';
import { generateDungeon } from '../dungeon/generate';
import { DungeonScene } from '../dungeon/scene';
import { DungeonWorld } from '../dungeon/world';
import { generateInterior, interiorSeed, interiorTitle, type InteriorKind } from '../interior/generate';
import { InteriorScene } from '../interior/scene';
import { InteriorWorld } from '../interior/world';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import type { Player } from '../entities/player';
import { DungeonMinimap } from '../ui/dungeonmap';
import { ITEMS } from './items';
import type { GameState } from './state';
import type { HeroGear } from '../render/herogear';

/** Everything a place needs to swap the world out from under the hero. */
export interface PlaceContext {
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
}

/** A named spot with a way down: a shrine, or a cave mouth. */
export interface Underground { name: string; x: number; z: number }

export interface DungeonVisit {
  world: DungeonWorld;
  /** Which floor we are on, and how we got here, so climbing out returns to daylight. */
  floor: number;
  style: 'dungeon' | 'cave';
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
  keeper: Entity | null;
  exit: [number, number];
  title: string;
}

/** Where the hero stands when arriving underground: clear of the stairs, so the exit prompt waits. */
const STAIRS_CLEARANCE: Array<[number, number]> = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [1, 0]];
/** Reach for chests, doors and stairs underground; and for the keeper behind a counter. */
export const REACH = { CHEST: 1.8, DOOR: 2.0, STAIRS: 1.4, BUILDING_DOOR: 1.6 } as const;
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

  // --- underground ---

  enterDungeon(poi: Underground, kind: 'dungeon' | 'cave' = 'dungeon', anchorId = `dungeon:${poi.name}`, floor = 1): void {
    const { manifest, state, props, rig, iso, player, overworldRenderer, minimapCanvas } = this.ctx;
    const anchor = manifest.ensure(anchorId, kind, poi.x, poi.z);
    const world = new DungeonWorld(generateDungeon(anchor.seed, kind === 'cave' ? 'cave' : 'vault', floor), `${anchor.id}:${floor}`);
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

    const monsters = new EntityManager(renderer, world, { getTiles: () => null }, anchor.seed + floor);
    monsters.spawnMonsters(world.map.monsterSpots, anchor.seed + floor);
    if (world.map.boss) {
      const [bx, bz] = world.map.boss;
      monsters.spawnOne('troll', bx + 0.5, bz + 0.5, anchor.seed + 99);
    }
    this.underground = { world, floor, style: kind, anchorId, scene, renderer, monsters, map: new DungeonMinimap(minimapCanvas, world.map), poi };
    this.ctx.setCaveAmbience(true);
    const depth = floor > 1 ? ` — floor ${floor}` : '';
    this.ctx.flash(kind === 'cave' ? `You squeeze into the ${poi.name}` : `You descend into the ${poi.name}${depth}`);
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
    player.teleport(visit.poi.x + 2.5, visit.poi.z + 0.5);
    iso.target.set(visit.poi.x + 2.5, 0.5, visit.poi.z + 0.5);
    this.underground = null;
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

  /** Tear down the current floor without putting the hero back outside. */
  private closeUnderground(): void {
    const visit = this.underground;
    if (!visit) return;
    visit.renderer.remove(this.ctx.player.entity);
    visit.renderer.dispose();
    visit.scene.dispose();
    this.underground = null;
  }

  // --- indoors ---

  enterBuilding(door: Doorway): void {
    const { seed, props, iso, player, overworldRenderer, rng } = this.ctx;
    const map = generateInterior(interiorSeed(seed, door.bx, door.bz), door.kind as InteriorKind, door.village);
    const world = new InteriorWorld(map);
    const scene = new InteriorScene(map, props);
    const renderer = new EntityRenderer(scene.scene);
    overworldRenderer.remove(player.entity);
    renderer.add(player.entity);
    this.ctx.heroGear.attachTo(scene.scene);
    player.setWorld(world);
    player.teleport(map.entry[0] + 0.5, map.entry[1] + 0.5);

    // frame the whole room: the camera holds still and the hero moves inside it
    this.outdoorZoom = iso.zoom;
    iso.zoom = Math.max(map.w, map.h) * 1.35;
    iso.resize();
    iso.target.set(map.w / 2, 0.5, map.h / 2);

    const keeper = map.keeper ? this.placeKeeper(map.keeper, door, renderer, rng) : null;
    this.indoors = { world, scene, renderer, keeper, exit: [door.x, door.z], title: interiorTitle(door.kind as InteriorKind, door.village) };
    this.ctx.chime();
  }

  private placeKeeper(spot: [number, number], door: Doorway, renderer: EntityRenderer, rng: Rng): Entity {
    const trade = door.kind !== 'house' && door.kind !== 'church';
    const kind = KINDS[trade ? 'shopkeeper' : 'villager'];
    const herd = new Herd(kind, spot[0], spot[1], spot[0], spot[1], 0);
    herd.tag = door.village;
    const keeper = new Entity(kind, spot[0] + 0.5, spot[1] + 0.5, herd, 'interior', rng);
    keeper.y = 0.5;
    keeper.yaw = Math.PI / 2;   // facing the door
    if (trade) { keeper.role = 'shopkeeper'; keeper.shop = door.kind as ShopType; }
    else keeper.role = door.kind === 'church' ? 'congregation' : 'villager';
    renderer.add(keeper);
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
