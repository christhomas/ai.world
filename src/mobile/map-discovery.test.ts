import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { composeGame, type GameHandle } from '../game/compose';
import { FloorSight, type FloorPicture } from '../dungeon/floor-picture';
import type { GamePlatform, ScreenParts } from '../platform/game-platform';
import { headlessGame, type HeadlessGame } from '../platform/headless-game';
import { savedInMemory } from '../save/memory';
import type { SessionSave } from '../save/store';
import { knownSquares } from '../world/map-ground';
import { PROVINCE } from '../world/provinces';
import { StructureKind } from '../world/structures';
import { systemClock } from '../../server/host-clock';
import { MapModels } from './map-model';

/**
 * What the app's map calls found, against what the page's map calls found, along one walk (#575).
 *
 * The page's maps are widgets on a canvas, and there is no canvas here. What they are handed is
 * the same either way, so this stands in front of the host's maps and keeps what the page's would
 * have kept: the chunks and provinces its fog was last told of, each floor's sight as its floor map
 * keeps it, and the readouts its full-screen map draws from. The app's side is what `MapModels`
 * sends, gathered the way `GameSession` gathers it and read the way `map_page.dart` reads it.
 *
 * Then the hero walks: out across the country, down a shrine, down to its second floor, back up,
 * a province bought, a save and a rejoin, and another world opened after. At each stop the two
 * have to agree on the dark, the marks, the title and the floor, cell for cell.
 */
const frame = 1000 / 30;
const breathe = () => new Promise<void>((resume) => setTimeout(resume, 4));
const DARK = 0x05060c;

beforeAll(() => { vi.stubGlobal('window', undefined); vi.stubGlobal('document', undefined); });
afterAll(() => { vi.unstubAllGlobals(); });

/** A floor's map as the page's floor map keeps it: what has been seen, and what it was last drawn with. */
interface PageFloor { sight: FloorSight; opened: (i: number) => boolean; unlocked: boolean }

/** What the page's maps were handed, as they would have kept it. */
interface Page {
  fog: { explored: string[]; charted: string[] };
  floors: PageFloor[];
  mapInput: ScreenParts['mapInput'] | null;
}

/** The host's platform, with the page's maps listening in on what its own are told. */
function overhear(platform: GamePlatform): { platform: GamePlatform; page: Page } {
  const page: Page = { fog: { explored: [], charted: [] }, floors: [], mapInput: null };
  return { page, platform: { ...platform,
    maps: (graph, sampler) => {
      const surfaces = platform.maps(graph, sampler);
      return { ...surfaces, fog: { reveal: (explored, charted = []) => {
        page.fog = { explored: [...explored], charted: [...charted] };
        surfaces.fog.reveal(page.fog.explored, page.fog.charted);
      } } };
    },
    floorMap: (map) => {
      const surface = platform.floorMap(map);
      const floor: PageFloor = { sight: new FloorSight(map), opened: () => false, unlocked: false };
      page.floors.push(floor);
      return {
        reveal: (x, z, radius) => { floor.sight.reveal(x, z, radius); surface.reveal(x, z, radius); },
        draw: (x, z, opened, chestId, unlocked) => {
          floor.opened = (i) => opened.has(chestId(i));
          floor.unlocked = unlocked;
          surface.draw(x, z, opened, chestId, unlocked);
        },
      };
    },
    screen: (parts) => { page.mapInput = parts.mapInput; return platform.screen(parts); },
  } };
}

/** What the app's map holds after every reply so far, as `GameSession` keeps it. */
class Phone {
  readonly models = new MapModels();
  map: Record<string, unknown> = {};
  floor: FloorPicture | null = null;
  readonly walked = new Set<string>();
  readonly charted = new Set<string>();

  take(game: HeadlessGame, renderTimeMs: number): void {
    const sent = this.models.take(game, game.handles().state, renderTimeMs) as unknown as
      { map?: Record<string, unknown>; floor?: FloorPicture | null };
    if ('floor' in sent) this.floor = sent.floor ?? null;
    if (!sent.map) return;
    this.map = sent.map;
    for (const key of sent.map.walked as string[]) this.walked.add(key);
    for (const corner of sent.map.charted as string[]) this.charted.add(corner);
  }

  /** The country taken out of the dark, as the app's map painter takes it: a chunk by its key, a province by its corner. */
  known(): string[] {
    const chunk = this.map.chunk as number, province = this.map.province as number;
    return [
      ...[...this.walked].map((key) => { const [cx, cz] = key.split(',').map(Number); return `${cx * chunk},${cz * chunk},${chunk}`; }),
      ...[...this.charted].map((corner) => `${corner},${province}`),
    ].sort();
  }
}

/** The page's fog, as the squares it punched out of its mask. */
const pageKnown = (page: Page) => knownSquares(page.fog.explored, page.fog.charted).map((s) => `${s.x},${s.z},${s.side}`).sort();

/** A floor model's cells, row by row, unpacked from its runs as the app unpacks them. */
function cellsOf(picture: FloorPicture): number[] {
  const cells: number[] = [];
  for (let i = 0; i < picture.runs.length; i += 2) {
    for (let n = 0; n < picture.runs[i + 1]; n++) cells.push(picture.colours[picture.runs[i]]);
  }
  return cells;
}

/** A floor as the page's floor map paints it (`ui/dungeonmap.ts`): each cell, the way in once seen, and every seen chest. */
function painted({ sight, opened, unlocked }: PageFloor) {
  const { size, entrance: [ex, ez], chests } = sight.map;
  const cells: number[] = [];
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) cells.push(sight.cell(x, z, unlocked) ?? DARK);
  return {
    cells,
    entrance: sight.seen[ez * size + ex] ? [ex, ez] : null,
    chests: chests.flatMap((c, i) => {
      const colour = sight.chest(i, opened(i));
      return colour === null ? [] : [{ x: c.x, z: c.z, colour }];
    }),
  };
}

interface Opened { game: HeadlessGame; page: Page; phone: Phone; handle: GameHandle; store: ReturnType<typeof savedInMemory>; now: number }

function open(slotKey: string, seed: number, saved?: SessionSave): Opened {
  const game = headlessGame({
    viewport: { width: 1200, height: 540 }, clock: systemClock, now: () => performance.now(), random: Math.random,
  });
  const { platform, page } = overhear(game.platform);
  const store = savedInMemory();
  const handle = composeGame({ store, slotKey, saved, seed, worldName: undefined, world: 'road' }, platform);
  return { game, page, phone: new Phone(), handle, store, now: 0 };
}

/** Frames, with a reply to the app after each, holding a key if asked to. */
async function play(o: Opened, frames: number, hold?: string): Promise<void> {
  if (hold) o.game.input.hold(hold);
  for (let step = 0; step < frames; step++) {
    o.game.frame(frame);
    await breathe();
    o.phone.take(o.game, o.now += frame);
  }
  if (hold) o.game.input.release(hold);
}

/** Until the world in this thread has answered and the ground round the hero has arrived. */
async function settle(o: Opened): Promise<void> {
  const { chunks, online } = o.game.handles();
  for (let step = 0; step < 900; step++) {
    await play(o, 1);
    const ground = chunks.captureProgress();
    if (online.connected && ground.desired > 0 && ground.loaded >= Math.min(40, ground.desired) && ground.pending === 0) break;
  }
  expect(online.connected, `the world in this thread: ${online.status}`).toBe(true);
}

/** The app's map and the page's, at one moment: the dark, the marks, the title and the floor. */
function same(o: Opened, where: string): void {
  // a second on, so a mark that has moved since the last time the app was sent them is sent
  o.phone.take(o.game, o.now += 1000);
  const shown = o.page.mapInput!();
  const { state, places } = o.game.handles();
  expect(o.phone.map.title, `${where}: the title`).toBe(shown.title);
  expect(o.phone.map.fogged, `${where}: whether there is a dark at all`).toBe(shown.fog);
  expect(o.phone.map.markers, `${where}: the marks`).toEqual(JSON.parse(JSON.stringify(shown.markers)));
  expect(o.phone.known(), `${where}: the country out of the dark`).toEqual(pageKnown(o.page));
  expect(pageKnown(o.page), `${where}: and the page's fog is not behind the hero`)
    .toEqual(knownSquares(state.explored, state.charted).map((s) => `${s.x},${s.z},${s.side}`).sort());
  const below = places.underground;
  if (!below) { expect(o.phone.floor, `${where}: no floor above ground`).toBeNull(); return; }
  const floor = o.page.floors.at(-1)!;
  expect(floor.sight.map, `${where}: the page's floor map is of the floor he is on`).toBe(below.world.map);
  expect(o.phone.floor, `${where}: the app has the floor`).not.toBeNull();
  const page = painted(floor);
  expect(o.phone.floor!.size).toBe(floor.sight.map.size);
  expect(cellsOf(o.phone.floor!), `${where}: the floor, cell for cell`).toEqual(page.cells);
  expect(o.phone.floor!.entrance, `${where}: the way in`).toEqual(page.entrance);
  expect(o.phone.floor!.chests, `${where}: the chests`).toEqual(page.chests);
  expect(page.cells.some((colour) => colour !== DARK), `${where}: something of the floor has been seen`).toBe(true);
}

describe('the app\'s map and the page\'s map along one walk (#575)', () => {
  it('find the same country, the same places and the same floors, and keep them across a rejoin', async () => {
    const first = open('discovery', 3);
    let saved!: SessionSave;
    let before!: string[];
    let province!: string;
    try {
      await settle(first);
      await play(first, 120, 'w');
      same(first, 'out across the country');

      const { structures, places, state, player } = first.game.handles();
      const shrine = structures.pois.find((p) => p.kind === StructureKind.Shrine);
      expect(shrine, 'a world with a shrine to go down').toBeDefined();
      // found as walking up to it finds it, so the map has a place of its own to mark
      state.discovered.add(shrine!.name);
      places.enterDungeon(shrine!);
      await play(first, 20);
      await play(first, 60, 'w');
      same(first, 'the first floor');
      expect(first.phone.map.title).toBe(`${shrine!.name} Depths`);
      expect(first.phone.map.markers as Array<{ label?: string }>).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: shrine!.name })]));

      places.descend();
      await play(first, 20);
      await play(first, 60, 'd');
      same(first, 'the second floor');
      expect(first.page.floors.at(-1)!.sight.map.floor).toBe(2);
      expect(first.phone.map.title, 'the map says which floor').toBe(`${shrine!.name} Depths · floor 2`);

      places.exitDungeon();
      await play(first, 20);
      same(first, 'back up');

      // a province bought over a counter, far off: country known without being walked
      expect(state.chart(player.x + PROVINCE * 3, player.z)).toBe(true);
      await play(first, 2);
      same(first, 'a map bought');
      expect(first.phone.charted.size).toBe(1);
      province = first.phone.known().find((square) => square.endsWith(`,${PROVINCE}`))!;
      // a place nobody has found is on neither map
      const hidden = structures.caves.find((c) => !state.discovered.has(c.name));
      if (hidden) {
        expect((first.phone.map.markers as Array<{ label?: string }>).map((m) => m.label)).not.toContain(hidden.name);
      }

      await first.handle.save();
      saved = JSON.parse(first.store.read('discovery')!) as SessionSave;
      before = first.phone.known();
    } finally {
      first.handle.dispose();
    }

    // the same game opened again from its save: everything found is found on both maps again
    const again = open('discovery', 3, saved);
    try {
      await settle(again);
      same(again, 'rejoined');
      expect(again.phone.known(), 'nothing found was lost by the rejoin').toEqual(expect.arrayContaining(before));
    } finally {
      again.handle.dispose();
    }

    // and another world: a new engine's map, with nothing of the last world's on it
    const other = open('elsewhere', 4);
    try {
      await settle(other);
      same(other, 'another world');
      expect(other.phone.charted.size, 'the province bought in the other world').toBe(0);
      expect(other.phone.known()).not.toContain(province);
    } finally {
      other.handle.dispose();
    }
  });
});
