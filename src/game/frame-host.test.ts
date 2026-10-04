import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAMEPLAY } from '../core/config';
import { SceneGraph } from '../core/scenegraph';
import type { Viewport } from '../core/viewport';
import { Player } from '../entities/player';
import type { EntityRenderer } from '../render/entities';
import { AUTO, AutoQuality } from '../render/autoquality';
import { Biome } from '../world/biomes';
import { Breath } from './breath';
import { Fishing } from './fishing';
import { Magic } from './magic';
import { GameState } from './state';
import { createFrame, GameInput, IsoCamera, SessionLifetime, type Framing } from './portable-frame';

afterEach(() => vi.unstubAllGlobals());

/** Real controls, camera, hero, state and fishing; rendering/presentation are headless host ports. */
function host() {
  for (const name of ['window', 'document', 'localStorage', 'requestAnimationFrame']) vi.stubGlobal(name, undefined);
  let viewport: Viewport = { left: 40, top: 20, width: 800, height: 400 };
  const input = new GameInput();
  const iso = new IsoCamera(() => viewport);
  const ground = { heightAt: () => 0.5, waterAt: () => null, blocked: () => false, isRoad: () => true };
  const player = new Player(ground, { add: vi.fn() } as unknown as EntityRenderer, 0, 0);
  const state = new GameState(), fishing = new Fishing();
  const graph = new SceneGraph(0);
  const rig = {
    graph, quality: 'high', draw: vi.fn(), updateWater: vi.fn(), follow: vi.fn(), seaAround: vi.fn(),
    lastFrame: () => ({ draws: 0, triangles: 0 }),
    setQuality: vi.fn((quality: string) => { rig.quality = quality; }),
  };
  const hostPorts = { viewport: () => viewport, qualityReduced: vi.fn(), fishingChanged: vi.fn() };
  const places = { indoors: null, underground: null } as { indoors: unknown; underground: unknown };
  const pick = vi.fn(), startTalk = vi.fn(), persist = vi.fn(), sync = vi.fn();
  const worldMap = { isOpen: false, pan: vi.fn(), draw: vi.fn() };
  const flash = vi.fn(), chime = vi.fn();
  const ctx = {
    seed: 7, state, player, iso, rig, input, host: hostPorts, places, fishing,
    graph: { edges: [] }, chunks: { ...ground, stats: { drawn: 0, loaded: 0, pending: 0 },
      update: vi.fn(), standsOn: vi.fn() },
    sampler: { probe: () => ({ biome: Biome.Plains }) },
    entities: { count: 1, update: vi.fn(), pick }, entityRenderer: { update: vi.fn() },
    skyline: { headroom: 0, update: vi.fn() }, rock: { lookAt: vi.fn() }, cutaway: { lookAt: vi.fn() },
    endless: null, grower: null, daycycle: { apply: vi.fn() },
    weather: { set: vi.fn(), update: vi.fn() }, updraughts: { faceThe: vi.fn(), update: vi.fn() },
    swallows: { check: vi.fn() }, seaEyes: { update: vi.fn() }, shafts: { step: vi.fn() },
    holes: { update: vi.fn() }, couldBeAShaft: () => false, beam: { update: vi.fn() },
    skyRenderer: { update: vi.fn() }, skies: { aloft: null, update: vi.fn() },
    wildlife: { update: vi.fn(), drift: () => ({ drawn: 0, recent: 0 }) }, floorLife: () => null,
    mount: { riding: false, update: vi.fn() }, sailing: { sailing: false, bought: false },
    breath: new Breath(), magic: new Magic(), plots: {}, houses: { entries: () => [] },
    heroGear: { update: vi.fn(), lightSource: () => null }, packField: { update: vi.fn() },
    remains: { all: [], age: vi.fn() }, cropField: { update: vi.fn() }, buildingSite: { update: vi.fn() },
    villageRoofs: () => [], ownBoat: { visible: false }, minimap: { draw: vi.fn() }, worldMap,
    hud: { flash, setBreath: vi.fn(), setLink: vi.fn(), tick: vi.fn(), setDebug: vi.fn() },
    sound: { chime, update: vi.fn(), setScene: vi.fn(), setWater: vi.fn() }, online: { reaching: false },
    autoQuality: new AutoQuality(false), director: { advance: vi.fn() },
    walked: { walked: vi.fn(), settle: vi.fn(), reset: vi.fn() }, blows: { cooled: vi.fn() },
    tidings: { theDaysNews: vi.fn() }, watch: { watching: vi.fn(), hunted: vi.fn() },
    announceWindUps: vi.fn(), onAttack: vi.fn(), sync, sailFerries: vi.fn(), ageCamps: vi.fn(), runClock: vi.fn(),
    carcasses: () => [], noticeStall: vi.fn(), musterHires: vi.fn(), startTalk, updateHud: vi.fn(),
    mapInput: vi.fn(), markers: () => [], doorsteps: { step: vi.fn() }, streamCountry: vi.fn(),
    talking: () => false, tickDialogue: vi.fn(), reveal: vi.fn(), refreshJournal: vi.fn(),
    areaName: () => 'Test country', arriving: vi.fn(), outdoors: () => places.indoors === null && places.underground === null,
    persist,
  } as unknown as Framing;
  const frame = createFrame(ctx);
  return { ctx, frame, input, iso, player, state, fishing, rig, hostPorts, places, pick, startTalk, persist,
    sync, worldMap, flash, chime, resize: (size: Viewport) => { viewport = size; iso.resize(); } };
}

describe('the production frame under an installed host', () => {
  it('walks the real hero, advances the clock, draws and autosaves without browser globals', () => {
    const h = host();
    h.input.hold('w');
    const time = h.state.time;
    for (let n = 0; n < Math.ceil((GAMEPLAY.AUTOSAVE_SECONDS + 1) / 0.1); n++) h.frame.frame(0.1, n * 0.1);
    expect(Math.hypot(h.player.x, h.player.z)).toBeGreaterThan(1);
    expect(h.state.time).not.toBe(time);
    expect(h.rig.draw).toHaveBeenCalled();
    expect(h.persist).toHaveBeenCalledTimes(1);
    // Autosave occurs before the quality sampler has settled; exercise its full window too.
    for (let n = 0; n < AUTO.SETTLE + AUTO.SAMPLE; n++) h.frame.frame(0.1, n * 0.1);
    expect(h.rig.setQuality).toHaveBeenCalledWith('medium');
    expect(h.hostPorts.qualityReduced).toHaveBeenCalledWith('medium');
    expect(h.input.isDown('w')).toBe(true);
  });

  it('picks in the host surface after offsets and resize, rejecting absent or outside surfaces', () => {
    const h = host();
    const tap = (x: number, y: number) => {
      h.input.clicked = true; h.input.clickX = x; h.input.clickY = y; h.frame.frame(0.01, 0);
      expect(h.input.clicked).toBe(false);
    };
    tap(440, 220);
    expect(h.pick).toHaveBeenLastCalledWith(0, 0, h.iso);
    h.resize({ left: 10, top: 30, width: 200, height: 100 });
    tap(60, 105);
    expect(h.pick).toHaveBeenLastCalledWith(-0.5, -0.5, h.iso);
    h.pick.mockClear();
    tap(0, 0);
    h.resize({ width: 0, height: 0 });
    tap(50, 50);
    expect(h.pick).not.toHaveBeenCalled();
    expect(h.iso.frameCamera().projection.every(Number.isFinite)).toBe(true);
  });

  it('publishes real fishing phases and sound while leaving CSS to the host', () => {
    const h = host();
    h.fishing.cast(0, 0, Biome.Plains, 7, 1);
    h.frame.frame(0.01, 0);
    expect(h.hostPorts.fishingChanged).toHaveBeenLastCalledWith('waiting', expect.any(Boolean));
    for (let n = 0; n < 50 && h.fishing.phase !== 'bite'; n++) h.frame.frame(0.1, n * 0.1);
    expect(h.hostPorts.fishingChanged).toHaveBeenLastCalledWith('bite', expect.any(Boolean));
    expect(h.chime).toHaveBeenCalledTimes(1);
    for (let n = 0; n < 20; n++) h.frame.frame(0.1, n * 0.1);
    expect(h.hostPorts.fishingChanged).toHaveBeenLastCalledWith('idle', expect.any(Boolean));
    expect(h.flash).toHaveBeenCalledWith('It got away.');
  });

  it.each(['room', 'dungeon'] as const)('advances the %s branch and draws its own graph', (place) => {
    const h = host(), graph = new SceneGraph(0);
    const renderer = { update: vi.fn() };
    if (place === 'room') h.places.indoors = { title: 'Test room', renderer, scene: { graph } };
    else h.places.underground = {
      poi: { name: 'Test mine' }, floor: 1, renderer,
      scene: { graph, setHeroLight: vi.fn() }, monsters: { update: vi.fn(), count: 1 },
      world: { heightAt: () => 0.5 }, map: { reveal: vi.fn(), draw: vi.fn() },
    };
    h.input.hold('d');
    h.frame.frame(0.1, 1);
    expect(renderer.update).toHaveBeenCalledWith(h.iso);
    expect(h.rig.draw).toHaveBeenCalledWith(graph, h.iso);
    expect(h.sync).toHaveBeenCalled();
    expect(Math.hypot(h.player.x, h.player.z)).toBeGreaterThan(0);
  });

  it('pauses for the map and fences the real frame after session disposal', () => {
    const h = host();
    const session = new SessionLifetime({ frame: h.frame.frame, pause: vi.fn(), resume: vi.fn(), release: () => h.input.dispose() });
    session.setActive(true);
    h.input.hold('w');
    h.worldMap.isOpen = true;
    const time = h.state.time;
    session.frame(0.1, 1);
    expect(h.state.time).toBe(time);
    expect(h.worldMap.pan).toHaveBeenCalled();
    expect(h.player.x).toBe(0);
    expect(h.player.z).toBe(0);
    session.dispose();
    h.rig.draw.mockClear();
    session.frame(0.1, 2);
    expect(h.rig.draw).not.toHaveBeenCalled();
    expect(h.input.isDown('w')).toBe(false);
  });
});
