import { expect, it } from 'vitest';
import { composeGame } from '../game/compose';
import { headlessGame } from '../platform/headless-game';
import { savedInMemory } from '../save/memory';
import { systemClock } from '../../server/host-clock';
import type { FrameDescription } from '../core/scene';
import { ScenePackets, plainArrays } from './scene-packet';

it('replays recorded game steps to exactly the same scene as full packets', async () => {
  const game = headlessGame({ viewport: { width: 1200, height: 540 }, clock: systemClock,
    now: () => performance.now(), random: () => 0.5 });
  const opened = composeGame({ store: savedInMemory(), slotKey: 'deltas', seed: 3, world: 'road',
    saved: undefined, worldName: undefined }, game.platform);
  const packets = new ScenePackets(Number.MAX_SAFE_INTEGER);
  const geometries = new Map<string, Record<string, unknown>>();
  const nodes = new Map<string, Record<string, unknown>>();
  let order: string[] = [];
  const keyOf = (node: { id: number; part?: number }) => node.part === undefined ? `${node.id}` : `${node.id}.${node.part}`;
  const wire = (sender: ScenePackets, frame: FrameDescription) => JSON.parse(JSON.stringify(sender.packet(frame), plainArrays));
  let changes = 0;
  try {
    for (let n = 0; n < 900; n++) {
      game.frame(1000 / 30);
      await new Promise<void>((resume) => setTimeout(resume, 4));
      const ground = game.handles().chunks.captureProgress();
      if (ground.loaded >= 40 && ground.pending === 0) break;
    }
    expect(game.handles().chunks.captureProgress().loaded).toBeGreaterThanOrEqual(40);
    const from = game.handles().player.z;
    game.input.hold('w');
    for (let step = 0; step < 12; step++) {
      game.recording.captureNext();
      game.frame(1000 / 30);
      const captured = game.recording.last;
      expect(captured).not.toBeNull();
      const delta = wire(packets, captured!);
      const full = wire(new ScenePackets(Number.MAX_SAFE_INTEGER), captured!);
      if (delta.full) { nodes.clear(); geometries.clear(); }
      for (const [id, geometry] of Object.entries(delta.geometries)) geometries.set(id, geometry as Record<string, unknown>);
      for (const id of delta.removed) expect(nodes.delete(id)).toBe(true);
      for (const node of delta.frame.nodes) nodes.set(keyOf(node), node);
      for (const change of delta.changes) {
        const key = keyOf(change);
        expect(nodes.has(key)).toBe(true);
        nodes.set(key, { ...nodes.get(key), ...change });
        changes++;
      }
      order = delta.order ?? order;
      for (const id of delta.released) expect(geometries.delete(id)).toBe(true);
      expect(delta.generation).toBe(step + 1);
      const resolve = (node: Record<string, unknown>, geometry: Record<string, unknown>) => {
        const { geometryId: _id, ...rest } = node;
        return { ...rest, ...geometry };
      };
      const replay = order.map((id) => {
        const node = nodes.get(id)!;
        return resolve(node, geometries.get(node.geometryId as string) ?? {});
      });
      const expected = full.frame.nodes.map((node: Record<string, unknown>) => resolve(node, full.geometries[node.geometryId as string] ?? {}));
      expect(replay, `game step ${step}`).toEqual(expected);
      expect(delta.frame.camera).toEqual(full.frame.camera);
      expect(delta.frame.renderTimeMs).toBe(full.frame.renderTimeMs);
    }
    expect(changes).toBeGreaterThan(0);
    expect(game.handles().player.z).not.toBe(from);
  } finally { opened.dispose(); }
}, 60_000);
