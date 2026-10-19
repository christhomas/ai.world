import { describe, expect, it } from 'vitest';
import type { FrameDescription } from '../core/scene';
import { StepClock } from './host-globals';
import { ScenePackets } from './scene-packet';
import { walkKeysFor } from './game-engine';

describe('time in an engine that has none of its own', () => {
  it('runs what falls due as the host moves it on, in order, including what those set', () => {
    const clock = new StepClock();
    const ran: string[] = [];
    clock.after(() => ran.push('b'), 20);
    clock.after(() => { ran.push('a'); clock.after(() => ran.push('a+0'), 0); }, 10);
    const stop = clock.every(() => ran.push('tick'), 15);
    clock.advanceTo(9);
    expect(ran).toEqual([]);
    clock.advanceTo(31);
    expect(ran).toEqual(['a', 'a+0', 'tick', 'b', 'tick']);
    stop();
    clock.advanceTo(100);
    expect(ran.filter((one) => one === 'tick')).toHaveLength(2);
    expect(clock.now()).toBe(100);
  });

  it('will not be held for ever by a timer that keeps setting itself for now', () => {
    const clock = new StepClock();
    const again = () => { clock.after(again, 0); };
    again();
    expect(() => clock.advanceTo(1, 1000)).toThrow('more than 1000 timers');
  });
});

describe('a stick as the keys the hero walks by', () => {
  it('has the eight sectors the page stick has, and a dead zone in the middle', () => {
    expect([...walkKeysFor([0, 0.2])]).toEqual([]);
    expect([...walkKeysFor([0, 1])]).toEqual(['w']);
    expect([...walkKeysFor([0.7, 0.7])].sort()).toEqual(['d', 'w']);
    expect([...walkKeysFor([1, 0])]).toEqual(['d']);
    expect([...walkKeysFor([0.7, -0.7])].sort()).toEqual(['d', 's']);
    expect([...walkKeysFor([0, -1])]).toEqual(['s']);
    expect([...walkKeysFor([-0.7, -0.7])].sort()).toEqual(['a', 's']);
    expect([...walkKeysFor([-1, 0])]).toEqual(['a']);
    expect([...walkKeysFor([-0.7, 0.7])].sort()).toEqual(['a', 'w']);
  });
});

describe('the scene a step at a time', () => {
  const mesh = (id: string, positions: Float32Array, parent = -1): FrameDescription['nodes'][number] => ({
    id, parent, kind: 'mesh', world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], visible: true,
    castShadow: false, receiveShadow: false,
    attributes: { position: { size: 3, values: positions }, normal: { size: 3, values: positions } },
    indices: new Uint32Array([0, 1, 2]),
  } as unknown as FrameDescription['nodes'][number]);
  const frame = (nodes: FrameDescription['nodes']): FrameDescription => ({
    camera: { projection: [], world: [], orthographic: true }, background: 0, nodes, renderTimeMs: 0,
  } as unknown as FrameDescription);

  it('sends a geometry once, names it after, and sends a new one when the buffer is replaced', () => {
    const ground = new Float32Array(9), hut = new Float32Array(9);
    const packets = new ScenePackets();
    const first = packets.packet(frame([mesh('ground', ground), mesh('hut', hut)]));
    expect(Object.keys(first.geometries)).toHaveLength(2);
    const second = packets.packet(frame([mesh('ground', ground), mesh('hut', hut)]));
    expect(second.geometries).toEqual({});
    expect(second.frame.nodes, 'unchanged nodes do not recur with cached geometry').toEqual([]);
    expect(second.changes).toEqual([]);
    const rebuilt = packets.packet(frame([mesh('ground', ground), mesh('hut', new Float32Array(9))]));
    expect(Object.keys(rebuilt.geometries)).toHaveLength(1);
    packets.forget();
    expect(Object.keys(packets.packet(frame([mesh('ground', ground)])).geometries)).toHaveLength(1);
  });

  it('lets go of geometry the scene has left, and sends it again if it comes back', () => {
    const ground = new Float32Array(9), hut = new Float32Array(9);
    const packets = new ScenePackets(300_000, 2);
    const first = packets.packet(frame([mesh('ground', ground), mesh('hut', hut)]));
    const hutId = first.frame.nodes[1].geometryId;
    expect(packets.packet(frame([mesh('ground', ground)])).released, 'a packet away is not yet gone').toEqual([]);
    expect(packets.packet(frame([mesh('ground', ground)])).released).toEqual([hutId]);
    expect(packets.held).toBe(1);
    const back = packets.packet(frame([mesh('ground', ground), mesh('hut', hut)]));
    expect(Object.keys(back.geometries), 'back again, it is sent again under its own name').toEqual([hutId]);
    expect(back.frame.nodes[0].geometryId).toBe(hutId);
    // walking on over new ground: the app never holds more than the scene and the last packet or so
    for (let n = 0; n < 50; n++) packets.packet(frame([mesh('ground', new Float32Array(9))]));
    expect(packets.held).toBeLessThanOrEqual(2);
  });

  it('keeps a packet within its budget and holds back what did not fit, children and all', () => {
    const packets = new ScenePackets(30);
    const [a, b, child] = [new Float32Array(9), new Float32Array(30), new Float32Array(9)];
    const scene = () => frame([mesh('a', a), mesh('b', b), mesh('child', child, 1)]);
    const first = packets.packet(scene());
    expect(first.frame.nodes.map((node) => node.id)).toEqual(['a']);
    expect(first.withheld).toBe(2);
    // a geometry bigger than the budget still goes, on its own, rather than never
    const second = packets.packet(scene());
    expect(second.frame.nodes.map((node) => node.id)).toEqual(['b']);
    expect(packets.packet(scene()).frame.nodes.map((node) => node.id)).toEqual(['child']);
  });
});
