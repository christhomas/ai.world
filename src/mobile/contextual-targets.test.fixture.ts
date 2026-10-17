import { expect } from 'vitest';
import type { DialogueNode } from '../ui/dialogue';
import type { GameState } from '../game/state';
import type { Surroundings } from '../game/interact/context';
import { herbInteractions } from '../game/interact/herbs';
import { travelInteractions } from '../game/interact/travel';
import { builderChoices, builderInteractions } from '../game/interact/builder';
import { villageInteractions } from '../game/interact/village';
import { wildInteractions } from '../game/interact/wild';
import { campInteractions } from '../game/interact/camp';
import { jailInteractions } from '../game/interact/jail';
import { carrierInteractions } from '../game/interact/carrier';
import { giftInteractions } from '../game/interact/gifts';
import { hireInteractions } from '../game/interact/hire';
import { rescueInteractions } from '../game/interact/rescue';
import { prayerInteractions } from '../game/interact/prayer';
import { createInteractions } from '../game/interact';
import { Market } from '../game/market';
import { questLine } from '../game/quests';
import { pubTalk } from '../game/pub';
import { bodyOfTheHall } from '../world/hall';
import { doorTile } from '../world/structures';
import { fareFor, type FerryLine } from '../game/ferry';
import { Houses } from '../game/building';
import { Gifts } from '../game/gifts';
import { Standing } from '../game/standing';
import { Hires, quoteFor } from '../game/hire';
import { Rescues, contractFor } from '../game/rescue';
import { Plots } from '../game/farming';
import { Manifest } from '../world/manifest';
import { Register } from '../world/register';
import { StructureKind } from '../world/structures';
import { Biome } from '../world/biomes';
import { errand, person, VILLAGE } from './dialogue-targets.test.fixture';

/**
 * Small, explicit pieces of country. These are rule fixtures, not empty procedural seeds: every
 * entry below asserts that the target answers before keeping its menu. Terrain and services that
 * a menu does not consult are left out rather than growing a second world for every counter.
 */
export function setting(state: GameState) {
  let node: DialogueNode | null = null;
  const flashes: string[] = [];
  const hero = { x: 0.5, z: 0.5, teleport(x: number, z: number) { hero.x = x; hero.z = z; } };
  const register = new Register(1, 1);
  register.settle(VILLAGE, 8, ['farmer', 'seller', 'soldier', 'builder']);
  const village = {
    name: VILLAGE, x: 0, z: 0, radius: 20, biome: Biome.Forest,
    houses: [], stalls: [], shops: [], pub: null, station: { doorX: 0, doorZ: 0 },
  };
  const ctx = {
    state, seed: 1, register, manifest: new Manifest(1),
    player: hero,
    structures: { villages: [village], doors: [], pois: [], caves: [], wrecks: [], castles: [],
      piers: [], signposts: [], derelicts: [], all: [] },
    around: { villages: () => [village], surveyVillages: () => [village], places: () => [] },
    sampler: { newSample: () => ({}), biomeOf: () => Biome.Plains,
      within: { x0: -512, x1: 512, z0: -512, z1: 512 } },
    chunks: { heightAt: () => 10, isPlantable: () => true },
    houses: new Houses(), plots: new Plots(), gifts: new Gifts(), standing: new Standing(), market: new Market(),
    hires: new Hires(), rescues: new Rescues(),
    online: { connected: true, away: false, id: '', name: 'Hero', folk: [], cartAction() {}, report() {} },
    places: { indoors: null }, entities: { within: () => [], nearest: () => null },
    sailing: { sailing: false, bought: false, near: () => false },
    mount: { riding: false, cargo: null, near: () => false, canLoad: () => false },
    high: { baitedAt: () => null }, skies: { calledFrom: () => null },
    nemesis: { choice: null },
    jail: { lawless: () => false, holds: () => null },
    dialogue: { start: (said: DialogueNode) => { node = said; } },
    hud: { flash: (said: string) => flashes.push(said) },
    sound: { chime() {}, select() {}, jingle() {}, thud() {} },
    ferries: [], eyries: [], discovered: state.discovered, quests: new Map(),
    questLine, saidOfMine: () => '', raining: () => false, discover() {}, persist() {},
    persistStrict: async () => {}, prayerHost: { isLive: () => true, randomSeed: () => 123, restart() {} },
  } as unknown as Surroundings;
  return { ctx, hero, flashes, take: () => {
    expect(node, 'the target started a conversation').not.toBeNull();
    expect(node!.pages.length).toBeGreaterThan(0);
    return node!;
  } };
}

export interface ContextFamily {
  id: string;
  build(state: GameState): DialogueNode;
  choices: Array<string | RegExp>;
  extraChoices?: boolean;
  visit?: string | RegExp;
}

const eyries = [
  { id: 'near', partner: 'far', name: 'Near Crag', x: 0.5, z: 0.5, fare: 18 },
  { id: 'far', partner: 'near', name: 'Far Crag', x: 100, z: 100, fare: 18 },
];

export const contextualFamilies: ContextFamily[] = [
  { id: 'stablehand', build(state) {
    state.inventory.gold = 0;
    const f = setting(state);
    f.ctx.structures.villages[0].stable = { stock: ['horse', 'goat', 'camel'] } as never;
    f.ctx.entities = { within: () => [person('', 'stablehand')] } as never;
    expect(villageInteractions(f.ctx).tryHorse()).toBe(true);
    return f.take();
  }, choices: [/Riding Horse \(140g\)/, /Mountain Goat \(90g\)/, /Desert Camel \(170g\)/, 'Not today'],
  visit: /Riding Horse/ },
  { id: 'fallen-craft', build(state) {
    const f = setting(state);
    f.ctx.structures.derelicts.push({ id: 'fallen', name: 'Fallen Star', x: 0.5, z: 0.5 });
    f.ctx.craft = () => ({ flying: false } as never);
    expect(travelInteractions(f.ctx).tryDerelict()).toBe(true);
    return f.take();
  }, choices: ['Climb in', 'Leave it be'] },
  ...(['descent', 'stairs'] as const).map((below): ContextFamily => ({
    id: `dungeon-${below}`, build(state) {
      const f = setting(state);
      f.ctx.places = { indoors: null, underground: {}, interactUnderground: () => below } as never;
      createInteractions(f.ctx).atHand();
      return f.take();
    }, choices: below === 'descent' ? ['Go deeper', 'Not yet'] : ['Climb out', 'Stay'],
  })),
  { id: 'pub', build(state) {
    const f = setting(state);
    const village = f.ctx.structures.villages[0];
    village.pub = { house: { tx: 10, tz: 10 } } as never;
    const talk = pubTalk(village, f.ctx.structures, 1);
    expect(talk).not.toBeNull();
    expect(talk!.errand, 'a real seeded pub errand').not.toBeNull();
    f.ctx.places = { indoors: { keeper: null, door: { kind: 'inn', village: VILLAGE, bx: 10, bz: 10 } } } as never;
    expect(villageInteractions(f.ctx).tryLandlord()).toBe(true);
    return f.take();
  }, choices: [/Play darts \(\d+g\)/, 'Have something built', 'What about a cart?', /Take it on \(\d+g\)/, 'Nothing, thanks'] },
  { id: 'notice-board', build(state) {
    const f = setting(state);
    f.ctx.structures.villages[0].board = [0, 0];
    f.ctx.quests.set(VILLAGE, errand('fetch'));
    expect(villageInteractions(f.ctx).tryBoard()).toBe(true);
    return f.take();
  }, choices: ['Take the errand (50g)', 'Leave it'] },
  { id: 'hall', build(state) {
    const f = setting(state);
    const village = f.ctx.structures.villages[0];
    // Every household has a roof; bodyOfTheHall chooses the mayor's actual house from them.
    village.houses = Array.from({ length: 16 }, (_, i) => ({ kind: StructureKind.House,
      tx: i * 10, tz: 0, hw: 1, hd: 1, level: 1, rot: 0, biome: Biome.Forest, path: [] }));
    const body = bodyOfTheHall(f.ctx.register.hallOf(VILLAGE), village.houses,
      f.ctx.register.living(VILLAGE), null, f.ctx.register.deedsOf(VILLAGE));
    expect(body, 'the mayor has a hall the hero can stand at').not.toBeNull();
    [f.hero.x, f.hero.z] = doorTile(body!);
    expect(villageInteractions(f.ctx).tryHall()).toBe(true);
    return f.take();
  }, choices: ['Read all my holding history', 'Read my holdings since last visit', 'That is all'], extraChoices: true,
  visit: 'Read all my holding history' },
  { id: 'market-pitch', build(state) {
    const f = setting(state);
    f.ctx.structures.villages[0].stalls = [[0, 0]];
    expect(villageInteractions(f.ctx).tryStall()).toBe(true);
    return f.take();
  }, choices: [/Rent it \(\d+g\)/, 'Leave it'] },
  { id: 'baths', build(state) {
    const f = setting(state);
    f.ctx.luxuryOf = () => 'sauna';
    expect(villageInteractions(f.ctx).tryLuxury()).toBe(true);
    return f.take();
  }, choices: [/Pay \(\d+g\)/, 'Another time'] },
  { id: 'ferry', build(state) {
    state.time = 0; state.inventory.gold = 0;
    const f = setting(state);
    const line = { id: 'crossing', islandId: 'island', fromName: 'Near', toName: 'Far',
      fromPier: { dockX: 0, dockZ: 0 }, toPier: { dockX: 100, dockZ: 0 },
      travel: 40, dwell: 20, period: 120 } as FerryLine;
    expect(fareFor(line)).toBe(12);
    f.ctx.ferries = [{ line, visual: {} as never }];
    expect(travelInteractions(f.ctx).tryFerry()).toBe(true);
    return f.take();
  }, choices: ['Board (12g)', 'Not now'], visit: 'Board (12g)' },
  { id: 'loft', build(state) {
    state.inventory.gold = 0; state.discovered.add('Far Shrine');
    const f = setting(state);
    f.ctx.structures.pois.push({ name: 'Far Shrine', x: 300, z: 0 } as never);
    f.ctx.skies = { aloft: { site: { x: 0, z: 0 } }, atLoft: () => true } as never;
    expect(travelInteractions(f.ctx).trySky()).toBe(true);
    return f.take();
  }, choices: ['Far Shrine — 300 tiles (39g)', 'Not today'], visit: /Far Shrine/ },
  { id: 'shrine', build(state) {
    const f = setting(state);
    f.ctx.structures.pois.push({ name: 'Echoes', kind: StructureKind.Shrine, x: 0.5, z: 0.5 } as never);
    expect(wildInteractions(f.ctx).tryShrine()).toBe(true);
    return f.take();
  }, choices: ['Descend', 'Ask the stones to raise high ground', 'Not now'] },
  { id: 'cave', build(state) {
    const f = setting(state);
    f.ctx.structures.caves.push({ id: 'cave:fixture', name: 'Blackmouth', x: 0.5, z: 0.5 });
    expect(wildInteractions(f.ctx).tryShrine()).toBe(true);
    return f.take();
  }, choices: ['Go in', 'Not now'] },
  { id: 'giant-tree', build(state) {
    const f = setting(state);
    f.ctx.structures.pois.push({ name: 'Old Oak', kind: StructureKind.GiantTree, x: 0.5, z: 0.5 } as never);
    expect(wildInteractions(f.ctx).tryShrine()).toBe(true);
    return f.take();
  }, choices: ['Push through', 'Leave it'] },
  { id: 'campfire', build(state) {
    const f = setting(state);
    f.ctx.structures.pois.push({ name: 'Old Fire', kind: StructureKind.Campfire, x: 0.5, z: 0.5 } as never);
    expect(wildInteractions(f.ctx).tryCampfire()).toBe(true);
    return f.take();
  }, choices: ['Rest', 'Move on'] },
  { id: 'mortar', build(state) {
    state.give('mortar', 1); state.give('herb', 1);
    const f = setting(state);
    expect(state.can('grind')).toBe(true);
    expect(herbInteractions(f.ctx).tryGrind()).toBe(true);
    return f.take();
  }, choices: [/Salve.*short/, /Warding Draught.*short/, 'Not now'], visit: /Salve/ },
  { id: 'boatwright', build(state) {
    const f = setting(state);
    f.ctx.structures.piers.push({ dockX: 0, dockZ: 0, dx: 1, dz: 0 } as never);
    expect(travelInteractions(f.ctx).tryBoat()).toBe(true);
    return f.take();
  }, choices: [/Buy the boat \(\d+g\)/, 'Another time'], visit: /Buy the boat/ },
  { id: 'eagle', build(state) {
    const f = setting(state);
    f.ctx.eyries = eyries;
    expect(travelInteractions(f.ctx).tryEagle()).toBe(true);
    return f.take();
  }, choices: ['Fly (18g)', 'Walk round'] },
  { id: 'skyward', build(state) {
    state.inventory.gold = 0;
    const f = setting(state);
    f.ctx.skies = { calledFrom: () => ({ name: 'Cloud Village' }) } as never;
    expect(travelInteractions(f.ctx).trySkyward()).toBe(true);
    return f.take();
  }, choices: [/Fly up \(\d+g\)/, 'Stand and watch'], visit: /Fly up/ },
  { id: 'sky-return', build(state) {
    const f = setting(state);
    f.ctx.skies = { aloft: { name: 'Cloud Village' }, atLoft: () => false, atPerch: () => true } as never;
    expect(travelInteractions(f.ctx).trySky()).toBe(true);
    return f.take();
  }, choices: ['Go back down', 'Stay a while'] },
  { id: 'builder', build(state) {
    const f = setting(state);
    const rows = builderChoices(f.ctx, f.ctx.structures.villages[0]);
    const build = rows.find((row) => row.label === 'Have something built');
    expect(build, 'the village offers construction').toBeDefined();
    return build!.next()!;
  }, choices: [/^A house —/, 'Nothing today'], visit: /^A house —/ },
  { id: 'strongbox', build(state) {
    const f = setting(state);
    f.ctx.houses = new Houses({ jobs: [{ id: 'home', x: 0, z: 0, village: VILLAGE,
      began: -30, paid: 180, price: 180, rot: 0, store: { gold: 7, items: { bread: 2 } } }] });
    expect(builderInteractions(f.ctx).tryChest()).toBe(true);
    return f.take();
  }, choices: ['Put something in', 'Take something out', 'Leave it shut'], visit: 'Take something out' },
  { id: 'field', build(state) {
    state.give('wheatseed', 2); state.give('pumpkinseed', 2);
    const f = setting(state);
    expect(wildInteractions(f.ctx).tryFarm()).toBe(true);
    return f.take();
  }, choices: [/Wheat \(2\)/, /Pumpkin \(2\).*wrong season/, 'Leave it'], visit: /Pumpkin/ },
  { id: 'camp', build(state) {
    state.give('tent', 1); state.time = 0.95;
    const f = setting(state);
    expect(state.can('camp')).toBe(true);
    expect(campInteractions(f.ctx).tryCamp()).toBe(true);
    return f.take();
  }, choices: ['Pitch the tent', 'Walk on'] },
  { id: 'carcass', build(state) {
    const f = setting(state);
    const camp = campInteractions(f.ctx);
    camp.fell('wolf', 0.5, 0.5);
    expect(camp.bodies().length, 'a real fallen wolf').toBe(1);
    expect(camp.trySkin()).toBe(true);
    return f.take();
  }, choices: ['Pull at it', 'Leave it for the eagles', 'Leave it'] },
  { id: 'cell', build(state) {
    const f = setting(state);
    expect(jailInteractions(f.ctx).tryCell()).toBe(true);
    return f.take();
  }, choices: [] },
  { id: 'carrier', build(state) {
    const f = setting(state);
    f.hero.x = 10; f.hero.z = 0;
    f.ctx.structures.villages = [{ name: 'From', x: 0, z: 0 }, { name: 'To', x: 20, z: 0 }] as never;
    f.ctx.sampler = { graph: { nodes: [{ x: 0, z: 0 }, { x: 20, z: 0 }], edges: [{ a: 0, b: 1 }] } } as never;
    f.ctx.register = { carrierFacts: () => [{ kind: 'cart-loaded', day: 1, from: 'From', to: 'To',
      meals: 12, price: 1, paying: [], paid: [] }] } as never;
    expect(carrierInteractions(f.ctx).tryCarrier()).toBe(true);
    return f.take();
  }, choices: ['Guard the load (choose again to stop)', 'Rob the load', 'Let them pass'] },
  { id: 'gift', build(state) {
    state.give('bread', 2);
    const f = setting(state);
    const resident = f.ctx.register.living(VILLAGE)[0];
    expect(resident).toBeDefined();
    const entity = person(resident.trade); entity.person = resident.id;
    f.ctx.entities = { within: () => [entity] } as never;
    expect(giftInteractions(f.ctx).tryGive()).toBe(true);
    return f.take();
  }, choices: [/Give .*Bread \(of 2\)/, 'Never mind'] },
  { id: 'hire', build(state) {
    const f = setting(state);
    const resident = f.ctx.register.living(VILLAGE).find((p) => p.trade !== '');
    expect(resident, 'a grown resident to arrange as the soldier').toBeDefined();
    resident!.trade = 'soldier';
    // Find willingness rather than assuming the first soldier will leave his gate.
    for (let seed = 1; seed <= 200; seed++) {
      if (quoteFor(seed, resident!, f.ctx.structures.villages[0])) { f.ctx.seed = seed; break; }
    }
    expect(quoteFor(f.ctx.seed, resident!, f.ctx.structures.villages[0])).not.toBeNull();
    const entity = person('soldier'); entity.person = resident!.id;
    f.ctx.entities = { within: () => [entity] } as never;
    expect(hireInteractions(f.ctx).tryHire()).toBe(true);
    return f.take();
  }, choices: [/.+/, /.+/, /.+/, 'Not today'] },
  { id: 'rescue', build(state) {
    const f = setting(state);
    const village = f.ctx.structures.villages[0];
    for (const resident of f.ctx.register.living(VILLAGE).slice(1)) f.ctx.register.bury(resident.id, state.day);
    expect(f.ctx.register.fortune(VILLAGE)).toBe('failing');
    f.ctx.structures.pois.push({ name: 'Standing Stones', kind: StructureKind.Shrine, x: 40, z: 0, structure: {} } as never);
    // Contract generation is seeded. Search only for this precise precondition, then assert it.
    for (let seed = 1; seed <= 500; seed++) {
      if (contractFor(seed, village, f.ctx.structures, f.ctx.register.fortune(VILLAGE))) { f.ctx.seed = seed; break; }
    }
    expect(contractFor(f.ctx.seed, village, f.ctx.structures, f.ctx.register.fortune(VILLAGE))).not.toBeNull();
    f.ctx.entities = { within: () => [person('', 'elder')] } as never;
    expect(rescueInteractions(f.ctx).tryRescue()).toBe(true);
    return f.take();
  }, choices: ['I will go', 'Not today'], visit: 'Not today' },
  { id: 'prayer', build(state) {
    const f = setting(state);
    return prayerInteractions(f.ctx).choicesAt({ name: 'Echoes', x: 0, z: 0 })[0].next()!;
  }, choices: ['Echoes north heights', 'Echoes east heights', 'Echoes south heights', 'Echoes west heights', 'Not now'],
  visit: 'Echoes east heights' },
  { id: 'empty-house', build(state) {
    const f = setting(state);
    f.ctx.structures.villages[0].houses = [];
    f.ctx.places = { indoors: { door: { kind: 'house', village: VILLAGE, bx: 90, bz: 90 }, title: 'Empty house' } } as never;
    expect(villageInteractions(f.ctx).tryFreeBed()).toBe(true);
    return f.take();
  }, choices: ['Sleep until morning', 'Leave it be'] },
];
