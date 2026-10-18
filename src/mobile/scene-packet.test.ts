import { describe, expect, it } from 'vitest';
import type { FrameDescription } from '../core/scene';
import { ScenePackets, plainArrays } from './scene-packet';

type Node = FrameDescription['nodes'][number];
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const mesh = (id: number, overrides: Partial<Node> = {}): Node => ({
  id, parent: -1, kind: 'mesh', world: [...identity], visible: true,
  castShadow: false, receiveShadow: false,
  attributes: { position: { size: 3, values: positions } },
  ...overrides,
});
const frame = (nodes: Node[], step = 0): FrameDescription => ({
  camera: { projection: [...identity], world: [...identity], orthographic: true },
  background: 0, fog: null, renderTimeMs: step * 20, nodes,
});
// Read the actual JSON contract, including typed arrays, just as the app does.
const wire = (packets: ScenePackets, value: FrameDescription) =>
  JSON.parse(JSON.stringify(packets.packet(value), plainArrays));

function apply(state: Map<string, Record<string, unknown>>, packet: ReturnType<typeof wire>) {
  if (packet.full) state.clear();
  for (const key of packet.removed) expect(state.delete(key), `unknown removal ${key}`).toBe(true);
  for (const node of packet.frame.nodes) state.set(keyOf(node), node);
  for (const change of packet.changes) {
    const key = keyOf(change);
    expect(state.has(key), `unknown change ${key}`).toBe(true);
    state.set(key, { ...state.get(key), ...change });
  }
}
const keyOf = (node: { id: number; part?: number }) => node.part === undefined ? `${node.id}` : `${node.id}.${node.part}`;

describe('node changes on the local scene channel', () => {
  it('sends only a changed transform or visibility, and nothing for an unchanged node', () => {
    const packets = new ScenePackets();
    const actor = mesh(1), ground = mesh(2);
    const first = wire(packets, frame([actor, ground]));
    expect(first).toMatchObject({ version: 1, generation: 1, full: true, removed: [], changes: [] });
    const idle = wire(packets, frame([actor, ground]));
    expect(idle).toMatchObject({ generation: 2, full: false, changes: [], removed: [] });
    expect(idle.frame.nodes).toEqual([]);
    expect(idle.order).toBeUndefined();
    // The graph may edit its transform in place; the sender must remember the previous values.
    actor.world[12] = 4;
    const moved = wire(packets, frame([actor, ground]));
    expect(moved.frame.nodes).toEqual([]);
    expect(moved.geometries).toEqual({});
    expect(moved.changes).toEqual([{ id: 1, world: actor.world }]);
    actor.visible = false;
    const hidden = wire(packets, frame([actor, ground]));
    expect(hidden.frame.nodes).toEqual([]);
    expect(hidden.changes).toEqual([{ id: 1, visible: false }]);
    expect(JSON.stringify(hidden).length).toBeLessThan(JSON.stringify(first).length);
  });

  it('sends animated instance transforms without repeating geometry or material', () => {
    const packets = new ScenePackets();
    const matrices = new Float32Array(identity);
    const actor = mesh(1, { kind: 'instances', instanceMatrices: matrices });
    wire(packets, frame([actor]));
    matrices[12] = 3;
    const moved = wire(packets, frame([actor]));
    expect(moved.frame.nodes).toEqual([]);
    expect(moved.geometries).toEqual({});
    expect(moved.changes).toEqual([{ id: 1, instanceMatrices: Array.from(matrices) }]);
    expect(wire(packets, frame([actor])).changes).toEqual([]);
  });

  it('keeps parents and expanded parts stable through insertion, removal and reordering', () => {
    const packets = new ScenePackets();
    const parent = mesh(10, { kind: 'group' }), child = mesh(11, { parent: 0 });
    const body = mesh(12, { part: 0 }), glow = mesh(12, { part: 1 });
    const first = wire(packets, frame([parent, child, body, glow]));
    expect(first.frame.nodes[1].parent).toBe('10');
    const changed = wire(packets, frame([body, glow, mesh(13)]));
    expect(changed.removed).toEqual(['10', '11']);
    expect(changed.frame.nodes.map((node: Node) => node.id)).toEqual([13]);
    expect(changed.order).toEqual(['12.0', '12.1', '13']);
    const shifted = wire(packets, frame([glow, body, mesh(13)]));
    expect(shifted.frame.nodes).toEqual([]);
    expect(shifted.changes).toEqual([]);
    expect(shifted.order).toEqual(['12.1', '12.0', '13']);
  });

  it('sends replacement records for material and geometry changes and a fresh bounded resync', () => {
    const packets = new ScenePackets(12);
    const actor = mesh(1);
    wire(packets, frame([actor]));
    actor.castShadow = true;
    const changed = wire(packets, frame([actor]));
    expect(changed.frame.nodes).toHaveLength(1);
    expect(changed.changes).toEqual([]);
    packets.forget();
    const reset = wire(packets, frame([actor, mesh(2, { attributes: {
      position: { size: 3, values: new Float32Array(18) },
    } })]));
    expect(reset).toMatchObject({ generation: 3, full: true, withheld: 1, changes: [], removed: [] });
    expect(Object.keys(reset.geometries)).toHaveLength(1);
    const arrival = wire(packets, frame([actor, mesh(2, { attributes: {
      position: { size: 3, values: new Float32Array(18) },
    } })]));
    expect(arrival.frame.nodes.map((node: Node) => node.id)).toEqual([2]);
    expect(arrival.withheld).toBe(0);
  });

  it('reconstructs every deterministic step exactly as full packets do', () => {
    const packets = new ScenePackets();
    const state = new Map<string, Record<string, unknown>>();
    let order: string[] = [];
    for (let step = 0; step < 20; step++) {
      const world = [...identity];
      world[12] = step / 4;
      const nodes = [mesh(1, { world, visible: step % 3 !== 0 }), mesh(2)];
      if (step % 4 < 2) nodes.splice(1, 0, mesh(3));
      if (step > 12) nodes.reverse();
      const recorded = frame(nodes, step);
      const delta = wire(packets, recorded);
      apply(state, delta);
      order = delta.order ?? order;
      const full = wire(new ScenePackets(), recorded);
      expect(order.map((key) => state.get(key)), `step ${step}`).toEqual(full.frame.nodes);
      expect(delta.generation).toBe(step + 1);
      expect(delta.frame.renderTimeMs).toBe(full.frame.renderTimeMs);
    }
  });
});
