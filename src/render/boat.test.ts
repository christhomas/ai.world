import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneGraph } from '../core/scenegraph';
import { BOAT_PARTS, putBoatIn } from './boat';
import { putFerriesOut } from './ferries';
import { MountedThreePipeline } from './pipeline';
import { Cutaway } from './cutaway';
import { expandForFlutter, disposeFlutterFrameGeometry } from './flutter-frame';
import { addPropInstances, disposeInstances } from './instancing';
import { PropLibrary } from './props';
import { SeasonTintMaterials } from './seasontint';
import { Season, seasonLook } from '../game/seasons';
import { Biome, PropKind } from '../world/biomes';

describe('boats in the neutral frame', () => {
  it('uses one part definition and one pose for the live boat and recording', () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraph(0);
    const boat = putBoatIn(scene, graph);
    const node = graph.nodes[0];
    expect(node).toMatchObject({ kind: 'prop-batch', parts: BOAT_PARTS, placements: [] });
    expect((scene.children[0] as THREE.Group).children).toHaveLength(BOAT_PARTS.length);
    boat.setPose(12, 3, -5, 0.4);
    boat.visible = true;
    expect(node.kind === 'prop-batch' && node.placements).toEqual([{ x: 12, y: 3, z: -5, rot: 0.4 }]);
    expect(scene.children[0].position.toArray()).toEqual([12, 3, -5]);
    boat.visible = false;
    expect(node.kind === 'prop-batch' && node.placements).toEqual([]);
  });

  it('records every ferry using its scheduled pose', () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraph(0);
    const [ferry] = putFerriesOut(['crossing'], scene, graph);
    ferry.visual.setPose(-4, 2, 9, 1.2);
    const node = graph.nodes[0];
    expect(node.kind === 'prop-batch' && node.placements).toEqual([{ x: -4, y: 2, z: 9, rot: 1.2 }]);
    expect(scene.children[0].rotation.y).toBeCloseTo(1.2);
    if (node.kind !== 'prop-batch') throw new Error('ferry has no neutral pose');
    node.placements[0].x = 34;
    graph.camera = { projection: new THREE.Matrix4().toArray(), world: new THREE.Matrix4().toArray(), orthographic: true };
    new MountedThreePipeline(scene, () => {}, graph).draw(graph.frame());
    expect(scene.children[0].position.x).toBe(34);
  });

  it('gives the boat on Flutter exactly the effects WebGL draws it with, and the props theirs (#513)', () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraph(0);
    const props = new PropLibrary();
    // the prop material as the game wires it: tinted by the chunk manager, cut away by main
    new SeasonTintMaterials().attach(props.material);
    new Cutaway().attach(props.material);
    const boat = putBoatIn(scene, graph);
    boat.setPose(3, 0, 4, 0);
    boat.visible = true;
    const trees = new THREE.Group();
    addPropInstances(trees, props, [{ kind: PropKind.Oak, x: 8, y: 1, z: 2, rot: 0 }], new THREE.MeshBasicMaterial(), true, graph);
    graph.season = seasonLook(Season.Autumn, Biome.Forest);
    graph.camera = { projection: new THREE.Matrix4().toArray(), world: new THREE.Matrix4().toArray(), orthographic: true };
    const [boatNode, oakNode] = graph.nodes;
    expect(boatNode).toMatchObject({ kind: 'prop-batch', parts: BOAT_PARTS });
    expect(oakNode.kind).toBe('prop-batch');
    const source = graph.frame();
    const [boatId, oakId] = source.nodes.map((node) => node.id);
    const frame = expandForFlutter(source);
    expect(frame.season?.multiply).toEqual([1.35, 0.82, 0.42]);
    const body = (id: number) => frame.nodes.find((node) => node.id === id && node.part === 0);
    expect(body(boatId)?.kind).toBe('instances');
    expect(body(oakId)?.kind).toBe('instances');

    // WebGL draws the boat in plain materials that nothing patches: no season, no cutaway
    const boatMaterials = (scene.children[0] as THREE.Group).children
      .map((part) => ((part as THREE.Mesh).material as THREE.Material).userData.effects ?? []);
    expect(boatMaterials).toHaveLength(BOAT_PARTS.length);
    expect(boatMaterials.every((effects) => effects.length === 0)).toBe(true);
    expect(body(boatId)?.material?.effects).toEqual([]);

    // and the props in the one prop material, which is both
    expect([...props.material.userData.effects].sort()).toEqual(['cutaway', 'season']);
    expect([...(body(oakId)?.material?.effects ?? [])].sort()).toEqual(['cutaway', 'season']);

    disposeInstances(trees);
    props.dispose();
    disposeFlutterFrameGeometry();
  });
});
