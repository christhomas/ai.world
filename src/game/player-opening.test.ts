import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '../entities/entity';
import { growPatch, growWorld } from '../world/growworld';
import { boundsOf } from '../world/patchwork';
import { HOME_PATCH } from '../world/seedscore';
import { TerrainSampler } from '../world/terrain';
import type { Village } from '../world/structures';
import { openPlayer, IsoCamera, type PlayerOpening } from './portable-player';
import { playerOpeningWorkload } from '../../tools/mobile-runtime-spike/player-opening-workload';

afterEach(() => vi.unstubAllGlobals());

function open(villages: readonly Village[], extra: Partial<PlayerOpening> = {}) {
  const camera = new IsoCamera(() => ({ width: 1600, height: 900 }));
  camera.target.set(400, 10, 500);
  const added: Entity[] = [];
  const world = { heightAt: () => 0.5, waterAt: () => null, blocked: () => false, isRoad: () => true };
  const player = openPlayer({ world, renderer: { add: entity => { added.push(entity); } }, camera, villages, ...extra });
  return { player, camera, added };
}

describe('production player opening under host ports', () => {
  for (const kind of ['road', 'endless'] as const) {
    it(`puts a fresh ${kind} hero in the nearest actual generated village`, () => {
      const villages = kind === 'road' ? new TerrainSampler(growWorld(7)).structures.villages
        : growPatch(3, boundsOf(HOME_PATCH)).structures.villages;
      expect(villages.length).toBeGreaterThan(0);
      const h = open(villages);
      const village = villages.find(v => v.x === h.player.x && v.z === h.player.z);
      expect(village).toBeDefined();
      expect(Math.hypot(h.player.x, h.player.z)).toBe(Math.min(...villages.map(v => Math.hypot(v.x, v.z))));
      expect(h.camera.target).toMatchObject({ x: h.player.x, y: 0, z: h.player.z });
      expect(h.added).toEqual([h.player.entity]);
      expect(h.player.mode).toBe('follow');
    });
  }

  it('restores saved hero coordinates before mounting instead of saved camera coordinates', () => {
    const saved = { cam: { x: 200, z: 300, rot: 0.4, zoom: 20 }, player: { x: -120, z: 90 } };
    const h = open([], { saved: JSON.parse(JSON.stringify(saved)) });
    expect(h.player.entity).toMatchObject({ x: -120, z: 90 });
    expect(h.added[0]).toBe(h.player.entity);
    expect(h.camera.target).toMatchObject({ x: -120, y: 0, z: 90 });
    expect(h.camera.rotation).toBe(0.4);
    expect(h.camera.zoom).toBe(20);
    expect(saved.player).toEqual({ x: -120, z: 90 });
  });

  it('host start requests override the saved position and retain its camera settings', () => {
    const h = open([], { saved: { cam: { x: 1, z: 2, rot: 0.4, zoom: 20 }, player: { x: 18, z: -8 } },
      at: { x: 0, z: -30 }, freeCamera: true });
    expect(h.player.entity).toMatchObject({ x: 0, z: -30 });
    expect(h.camera.target).toMatchObject({ x: 0, y: 0, z: -30 });
    expect(h.camera.rotation).toBe(0.4);
    expect(h.camera.zoom).toBe(20);
    expect(h.player.mode).toBe('free');
  });

  it('an empty country falls back to the origin rather than stale camera targets', () => {
    const h = open([]);
    expect(h.player.entity).toMatchObject({ x: 0, z: 0 });
    expect(h.camera.target).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('a save without player coordinates retains fresh-world opening rules', () => {
    const villages = new TerrainSampler(growWorld(7)).structures.villages;
    const h = open(villages, { saved: { cam: { x: 200, z: 300, rot: 0.4, zoom: 20 } } });
    expect(h.player.entity).toMatchObject({ x: 0, z: 0 });
    expect(h.camera.rotation).toBe(0.4);
    expect(h.camera.zoom).toBe(20);
  });

  it('walks and reopens the actual Player without browser globals', () => {
    for (const name of ['window', 'document', 'localStorage', 'requestAnimationFrame']) vi.stubGlobal(name, undefined);
    const evidence = JSON.parse(playerOpeningWorkload());
    expect(evidence.initial).toEqual({ x: 18, z: -8 });
    expect(Math.hypot(evidence.walked.x - 18, evidence.walked.z + 8)).toBeGreaterThan(1);
    expect(evidence.reopened).toEqual(evidence.walked);
    expect(evidence.mounted).toBe(2);
  });
});
