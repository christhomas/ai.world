import { createEntityScene, type EntityRenderer } from '../../src/render/entities';
import { SceneGraph } from '../../src/core/scenegraph';
import { IsoCamera } from '../../src/render/camera';
import type { WorldView } from '../../src/render/scene-view';
import { Entity, Herd } from '../../src/entities/entity';
import { KINDS } from '../../src/entities/animals';
import { mulberry32 } from '../../src/core/rng';

type CreatureBuffers = Pick<EntityRenderer, 'add' | 'remove' | 'update' | 'dispose' | 'count' | 'barsShowing'>;
type Factory = (graph: SceneGraph, view: () => WorldView | null) => CreatureBuffers;

/** Real production instance buffers; a bounded fixture, not an installed game session. */
export function entitySceneWorkload(factory: Factory = createEntityScene): string {
  const graph = new SceneGraph(0x123456), view = { x: 0, z: 0, radius: 20 };
  const renderer = factory(graph, () => view);
  const camera = new IsoCamera(() => ({ width: 750, height: 342 }));
  const creature = (id: string, x: number) => {
    const kind = KINDS[id];
    const e = new Entity(kind, x, 0, new Herd(kind, x, 0, x, 0, 0), 'entity-proof', mulberry32(3));
    e.y = 1; e.walk = 1; e.phase = 0.4;
    return e;
  };
  const hero = creature('hero', 0), sheep = creature('sheep', 7), wolf = creature('wolf', 8);
  wolf.bar = 1;
  for (const entity of [hero, sheep, wolf]) renderer.add(entity);
  const frames: unknown[] = [];
  const capture = () => {
    renderer.update(camera);
    const nodes = graph.nodes.filter(node => node.kind === 'instances');
    frames.push({ count: renderer.count, bars: renderer.barsShowing, nodes: nodes.map(node => {
      if (node.kind !== 'instances') throw new Error('Non-instance creature node');
      return { count: node.count, colour: node.colour, order: node.renderOrder ?? 0,
        geometry: [node.geometry.positions.length, node.geometry.normals.length, node.geometry.indices?.length ?? 0],
        matrices: Array.from(node.matrices.subarray(0, node.count * 16)),
        colours: node.colours ? Array.from(node.colours.subarray(0, node.count * 3)) : [] };
    }) });
  };
  capture();
  sheep.indoors = true; wolf.x = 100; hero.hurt = 1; capture();
  view.x = 100; wolf.apart = 0.5; capture();
  view.x = 0; wolf.x = 8; wolf.apart = 1; hero.hurt = 0;
  renderer.remove(sheep); capture();
  renderer.dispose();
  if (graph.nodes.length !== 0) throw new Error('Creature scene records survived disposal');
  return JSON.stringify(frames);
}

/** Float channels are compared at four decimal places across embedded math implementations. */
export function entityWorkload(): string {
  const quantized = JSON.parse(entitySceneWorkload(), (_key, value) =>
    typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : value);
  return JSON.stringify(quantized);
}
