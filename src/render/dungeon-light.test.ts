import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateDungeon } from '../dungeon/generate';
import { DungeonWorld } from '../dungeon/world';
import { DungeonScene } from './dungeon';
import { PropLibrary } from './props';

describe('dungeon hero light', () => {
  it('keeps the moving point light in the neutral frame and live adapter', () => {
    const world = new DungeonWorld(generateDungeon(7, 'vault', 1), 'test', 'vault');
    const props = new PropLibrary();
    const water = new THREE.MeshBasicMaterial();
    const scene = new DungeonScene(world, props, water, 7, new Set());
    scene.setHeroLight(3, 4, 5, 9);
    const light = scene.graph.nodes.find((node) => node.kind === 'point' && node.colour === 0xffc080);
    expect(light).toMatchObject({ intensity: 9, position: [3, 4, 5], distance: 7, decay: 1.6 });
    expect(scene.heroLight.position.toArray()).toEqual([3, 4, 5]);
    expect(scene.heroLight.intensity).toBe(9);
    scene.dispose();
    props.dispose();
    water.dispose();
  });
});
