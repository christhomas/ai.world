import * as THREE from 'three';
import { expect, it } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { Season } from '../game/seasons';
import { Weather } from './weather';

it('updates weather through the neutral point buffer used by WebGL', () => {
  const graph = new SceneGraph(0x8fc1e6);
  const weather = new Weather(new THREE.Scene(), graph);
  weather.set(0.8, Season.Winter);
  weather.update(0.1, 3, 4, 5);
  const node = graph.nodes[0];
  expect(node.kind).toBe('points');
  if (node.kind !== 'points') return;
  expect(node.visible).toBe(true);
  expect(node.size).toBe(0.22);
  expect(node.positions).toBe(weather.points.geometry.getAttribute('position').array);
  graph.camera = { projection: new Array(16).fill(0), world: new Array(16).fill(0), orthographic: true };
  expect(graph.frame().nodes[0].material).toMatchObject({ intent: 'points', size: 0.22 });
  weather.dispose();
  expect(graph.nodes).toHaveLength(0);
});
