import { describe, expect, it } from 'vitest';
import { SceneGraph, type SceneNode } from './scenegraph';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const triangle = (): Extract<SceneNode, { kind: 'mesh' }> => ({ kind: 'mesh', material: 'lit-solid', receiveShadow: false, geometry: {
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1),
  normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
} });

/*
 * A native renderer keeps what it has baked under the node's id. When that id was the node's place
 * in the frame, a chunk unloading from the middle renamed everything after it and every later mesh
 * was baked and sent again (#490). The id is the node's own, from the moment it is added.
 */
describe('scene node ids', () => {
  it('names each node once, keeps the name while others come and go, and never hands one out twice', () => {
    const graph = new SceneGraph(0);
    graph.camera = { orthographic: true, projection: identity, world: identity };
    const nodes = [graph.add({ kind: 'ambient', colour: 0xffffff, intensity: 1 }), graph.add(triangle()),
      graph.add(triangle()), graph.add(triangle())];
    const first = graph.frame().nodes.map((node) => node.id);
    expect(new Set(first).size).toBe(4);
    expect(graph.frame().nodes.map((node) => node.id)).toEqual(first);

    // the middle goes, as a chunk unloading does: what follows it keeps its name
    graph.remove(nodes[1]);
    expect(graph.frame().nodes.map((node) => node.id)).toEqual([first[0], first[2], first[3]]);

    // and whatever arrives next is new, even where the one that left used to be
    graph.add(triangle());
    const later = graph.frame().nodes.map((node) => node.id);
    expect(later.slice(0, 3)).toEqual([first[0], first[2], first[3]]);
    expect(first).not.toContain(later[3]);

    // a node taken out and put back is new again, even back in the place it left
    const last = graph.nodes[3];
    graph.remove(last);
    graph.add(last);
    const back = graph.frame().nodes.map((node) => node.id);
    expect(back.slice(0, 3)).toEqual([first[0], first[2], first[3]]);
    expect([...first, ...later]).not.toContain(back[3]);

    // a second graph — an interior beside the country — does not reuse the country's names
    const other = new SceneGraph(0);
    other.camera = graph.camera;
    other.add(triangle());
    expect(later).not.toContain(other.frame().nodes[0].id);
  });

  it('refuses a node put into the list without being added, which would have no name', () => {
    const graph = new SceneGraph(0);
    graph.camera = { orthographic: true, projection: identity, world: identity };
    graph.nodes.push(triangle());
    expect(() => graph.frame()).toThrow(/SceneGraph\.add/);
  });
});

/*
 * The live WebGL mount asks for a whole frame on every draw (#445), so a frame that built every
 * node's entry afresh cost the Pi half a millisecond with nothing moving (#511). An entry is kept
 * while what it was made from is unchanged, and it is the same object in the next frame.
 */
describe('a frame of a graph that did not change', () => {
  function everyKind() {
    const graph = new SceneGraph(0);
    graph.camera = { orthographic: true, projection: identity, world: identity };
    const sun = [1, 0.9, 0.8] as [number, number, number];
    const nodes = {
      ambient: graph.add({ kind: 'ambient', colour: 0xffffff, intensity: 1 }),
      hemisphere: graph.add({ kind: 'hemisphere', sky: [0.5, 0.6, 0.7], ground: 0x335522, intensity: 1 }),
      sun: graph.add({ kind: 'directional', colour: sun, intensity: 2, position: [1, 2, 3], target: [0, 0, 0], castShadow: true }),
      lamp: graph.add({ kind: 'point', colour: 0xffc080, intensity: 3, distance: 7, decay: 1.6, position: [0, 0, 0] }),
      rain: graph.add({ kind: 'points', positions: new Float32Array(9), colour: 0xffffff, size: 0.2, opacity: 0.5, visible: true }),
      land: graph.add(triangle()),
      model: graph.add({ ...triangle(), world: [...identity], materialState: { colour: 0x808080, effects: ['flat-shading'] } }),
      pool: graph.add({ kind: 'instances', geometry: { positions: new Float32Array(9), normals: new Float32Array(9) },
        colour: 0xffffff, count: 2, matrices: new Float32Array(64), castShadow: true, receiveShadow: true,
        material: { intent: 'unlit', effects: ['season'] } }),
      props: graph.add({ kind: 'prop-batch', parts: [], placements: [], castShadow: true, receiveShadow: false }),
    };
    return { graph, nodes, sun };
  }

  it('rebuilds no entry the second time', () => {
    const { graph } = everyKind();
    const first = graph.frame().nodes;
    const second = graph.frame().nodes;
    expect(second).toHaveLength(9);
    second.forEach((entry, at) => expect(entry).toBe(first[at]));
  });

  it('rebuilds only the entry of the one node that moved', () => {
    const { graph, nodes } = everyKind();
    const first = graph.frame().nodes;
    if (nodes.model.kind !== 'mesh') throw new Error('the model is a mesh');
    nodes.model.world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1];
    const second = graph.frame().nodes;
    const rebuilt = second.filter((entry, at) => entry !== first[at]);
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].world[12]).toBe(5);
  });

  it('still sees values written into the arrays and objects a node already had', () => {
    const { graph, nodes, sun } = everyKind();
    const first = graph.frame().nodes;
    if (nodes.lamp.kind !== 'point' || nodes.pool.kind !== 'instances' || nodes.model.kind !== 'mesh') throw new Error('kinds');
    // the day cycle writes the sun's channels into one array, and a dungeon its lamp's position
    sun[0] = 1.04;
    nodes.lamp.position[1] = 4;
    // a model writes its pose into the array it has, and a pool its instances into its buffer
    nodes.model.world![12] = 7;
    nodes.pool.matrices[12] = 9;
    nodes.pool.material!.effects!.push('cutaway');
    nodes.pool.count = 1;
    const [ambient, hemisphere, lit, lamp, rain, land, model, pool] = graph.frame().nodes;
    expect(lit.linearColour).toEqual([1.04, 0.9, 0.8]);
    expect(lamp.world[13]).toBe(4);
    expect(model.world[12]).toBe(7);
    expect(pool.instanceMatrices).toHaveLength(16);
    expect(pool.instanceMatrices?.[12]).toBe(9);
    expect(pool.material?.effects).toEqual(['season', 'cutaway']);

    // and what nothing touched is the entry it was
    [ambient, hemisphere, rain, land].forEach((entry, at) => expect(entry).toBe([first[0], first[1], first[4], first[5]][at]));
  });
});

/** The keys of `T` that are `readonly`: the ones a frame reads only when a node first appears. */
type ReadonlyKeys<T> = { [K in keyof T]-?:
  (<U>() => U extends { [Q in K]: T[K] } ? 1 : 2) extends (<U>() => U extends { -readonly [Q in K]: T[K] } ? 1 : 2)
    ? never : K }[keyof T];
type Of<K extends SceneNode['kind']> = Extract<SceneNode, { kind: K }>;

/*
 * Every field of every kind, filled in, so a field added to a kind has to be added here too. Each
 * writable one is changed in turn and must rebuild the entry, into what a fresh graph would build.
 * That is what catches a field the frame forgot to compare.
 */
const geometry = { positions: new Float32Array(9), normals: new Float32Array(9), colors: new Float32Array(9),
  indices: Uint16Array.of(0, 1, 2), flow: new Float32Array(3), sea: new Float32Array(3) };
const material = { intent: 'lit' as const, colour: 0x808080, emissive: 0, vertexColours: true, transparent: false,
  opacity: 1, depthWrite: true, depthTest: true, toneMapped: true, side: 'front' as const, effects: ['season'] };
const everyField: { [K in SceneNode['kind']]: { node: () => Required<Of<K>>; fixed: readonly ReadonlyKeys<Of<K>>[] } } = {
  ambient: { node: () => ({ kind: 'ambient', colour: [0.5, 0.6, 0.7], intensity: 1 }), fixed: ['kind'] },
  hemisphere: { node: () => ({ kind: 'hemisphere', sky: [0.5, 0.6, 0.7], ground: [0.2, 0.3, 0.1], intensity: 1 }), fixed: ['kind'] },
  point: { node: () => ({ kind: 'point', colour: [1, 0.8, 0.5], intensity: 3, distance: 7, decay: 1.6, position: [1, 2, 3] }),
    fixed: ['kind'] },
  directional: { node: () => ({ kind: 'directional', colour: [1, 0.9, 0.8], intensity: 2, position: [1, 2, 3],
    target: [0, 0, 0], castShadow: true }), fixed: ['kind'] },
  'prop-batch': { node: () => ({ kind: 'prop-batch', parts: [], glowParts: [], glowColour: 0xffc45a,
    placements: [{ kind: 1, x: 0, y: 0, z: 0, rot: 0 }], castShadow: true, receiveShadow: false }),
    fixed: ['kind', 'parts', 'glowParts', 'castShadow', 'receiveShadow'] },
  instances: { node: () => ({ kind: 'instances', geometry, colour: 0xffffff, count: 2, matrices: new Float32Array(64),
    colours: new Float32Array(12), castShadow: true, receiveShadow: true, renderOrder: 1, material }),
    fixed: ['kind', 'geometry', 'colour', 'castShadow', 'receiveShadow', 'renderOrder', 'material'] },
  points: { node: () => ({ kind: 'points', positions: new Float32Array(9), colour: 0xffffff, size: 0.2, opacity: 0.5,
    visible: true }), fixed: ['kind'] },
  mesh: { node: () => ({ kind: 'mesh', geometry, material: 'lit-vertex-colours', colour: 0xffffff, castShadow: true,
    receiveShadow: true, renderOrder: 1, world: [...identity], frustumCulled: true, visible: true, effects: ['season'],
    materialState: material }),
    fixed: ['kind', 'geometry', 'material', 'castShadow', 'receiveShadow', 'renderOrder', 'frustumCulled', 'effects'] },
};

/** A value unlike `value`: a number moved, a flag flipped, an array or object that is a new one. */
function other(value: unknown): unknown {
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (ArrayBuffer.isView(value)) return (value as Float32Array).slice();
  if (Array.isArray(value)) return typeof value[0] === 'number' ? [value[0] + 1, ...value.slice(1)] : [...value];
  if (value && typeof value === 'object') return { ...value };
  throw new Error(`no other value for ${String(value)}`);
}

describe('a node that changed', () => {
  for (const [kind, { node, fixed }] of Object.entries(everyField)) {
    const fields = Object.keys(node()).filter((field) => !(fixed as readonly string[]).includes(field));
    it(`rebuilds its entry when a ${kind} changes any field it may change`, () => {
      // the precondition: every kind has something that may change
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        const graph = new SceneGraph(0);
        graph.camera = { orthographic: true, projection: identity, world: identity };
        const subject = graph.add(node() as SceneNode) as unknown as Record<string, unknown>;
        const [before] = graph.frame().nodes;
        subject[field] = other(subject[field]);
        const [after] = graph.frame().nodes;
        expect(after, field).not.toBe(before);
        const fresh = new SceneGraph(0);
        fresh.camera = graph.camera;
        fresh.add(subject as unknown as SceneNode);
        expect({ ...after, id: 0 }, field).toEqual({ ...fresh.frame().nodes[0], id: 0 });
      }
    });
  }
});
