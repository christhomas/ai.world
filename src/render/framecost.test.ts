import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { KINDS } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import { mulberry32 } from '../core/rng';
import { Season, seasonLook } from '../game/seasons';
import type { Pod } from '../game/whales';
import { Biome, PropKind } from '../world/biomes';
import { buildSkyIsland, planSkyIslands } from '../world/skyisland';
import { Beam } from './beam';
import { EntityRenderer } from './entities';
import { addPropInstances, disposeInstances } from './instancing';
import { MountedThreePipeline, submitGraphFrame, type FrameSource } from './pipeline';
import { PropLibrary } from './props';
import { RecordingPipeline } from './recording';
import { SeasonTintMaterials } from './seasontint';
import { SkyIslands } from './skyisland';
import { WhaleSchool } from './whales';

/**
 * What a still frame costs now that the scene graph drives every draw.
 *
 * A mount or a producer runs once a frame, so anything it recomputes, re-uploads or allocates
 * whether or not something changed is paid sixty times a second on a Raspberry Pi — and nothing
 * in a picture shows it. These hold the shape of that work rather than a time, which no test can.
 */
const camera = {
  projection: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.002, 0, 0, 0, -1, 1],
  world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1],
  orthographic: true,
};

/**
 * How many three.js maths objects `run` constructs.
 *
 * Each of these constructors first assigns a field its instances own — `this.elements`, `this.x`,
 * `this._x` — so a setter left in that place on the prototype counts every one made, then gets
 * out of the way by giving the new object the field as its own. The classes the code under test
 * imports are not wrapped or replaced.
 */
function constructions(run: () => void): number {
  const marks = [
    [THREE.Matrix4.prototype, 'elements'], [THREE.Vector3.prototype, 'x'],
    [THREE.Quaternion.prototype, '_x'], [THREE.Euler.prototype, '_x'],
  ] as const;
  let made = 0;
  for (const [proto, field] of marks) {
    Object.defineProperty(proto, field, {
      configurable: true,
      set(this: object, value: unknown) {
        made++;
        Object.defineProperty(this, field, { value, writable: true, enumerable: true, configurable: true });
      },
    });
  }
  try { run(); } finally {
    for (const [proto, field] of marks) delete (proto as unknown as Record<string, unknown>)[field];
  }
  return made;
}

describe('a prop batch the frame did not change', () => {
  function hearths() {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    const scene = new THREE.Scene();
    const props = new PropLibrary();
    const glow = new THREE.MeshBasicMaterial({ color: 0xffc45a });
    const placements = Array.from({ length: 50 }, (_, at) => ({
      kind: PropKind.GreatHearth, x: at * 3, y: 0, z: at % 7, rot: at / 10,
    }));
    addPropInstances(scene, props, placements, glow, true, graph);
    const meshes = scene.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    const mesh = meshes.find((child) => child.material !== glow);
    const lit = meshes.find((child) => child.material === glow);
    // the precondition: a batch with a glow, both drawn from the fifty placements
    expect([mesh?.count, lit?.count]).toEqual([50, 50]);
    const mounted = new MountedThreePipeline(scene, () => {}, graph);
    return {
      graph, mesh: mesh!, lit: lit!, draw: () => submitGraphFrame(graph, [mounted]),
      dispose: () => { disposeInstances(scene); props.dispose(); glow.dispose(); },
    };
  }

  it('is not composed or uploaded again', () => {
    const { mesh, lit, draw, dispose } = hearths();
    const versions = [mesh.instanceMatrix.version, mesh.instanceColor?.version, lit.instanceMatrix.version];
    const glowArray = lit.instanceMatrix.array;
    for (let frame = 0; frame < 10; frame++) draw();
    expect([mesh.instanceMatrix.version, mesh.instanceColor?.version, lit.instanceMatrix.version]).toEqual(versions);
    expect(lit.instanceMatrix.array).toBe(glowArray);
    dispose();
  });

  it('is composed once when its placements change, and its glow keeps the array it had', () => {
    const { graph, mesh, lit, draw, dispose } = hearths();
    const node = graph.nodes[0];
    if (node.kind !== 'prop-batch') throw new Error('missing prop node');
    draw();
    const version = mesh.instanceMatrix.version;
    const glowArray = lit.instanceMatrix.array;
    node.placements = node.placements.map((placement) => ({ ...placement, x: placement.x + 1 }));
    draw();
    draw();
    expect(mesh.instanceMatrix.version).toBe(version + 1);
    expect(lit.instanceMatrix.array).toBe(glowArray);
    expect(Array.from(lit.instanceMatrix.array)).toEqual(Array.from(mesh.instanceMatrix.array));
    const moved = new THREE.Matrix4();
    mesh.getMatrixAt(49, moved);
    expect(moved.elements[12]).toBe(49 * 3 + 1);
    dispose();
  });
});

describe('the frame description', () => {
  it('is not built for a recorder that has not been asked for one', () => {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    graph.add({ kind: 'ambient', colour: 0xffffff, intensity: 1 });
    const recorder = new RecordingPipeline();
    const described = vi.spyOn(graph, 'frame');
    submitGraphFrame(graph, [recorder]);
    submitGraphFrame(graph, [recorder]);
    expect(recorder.frames).toBe(2);
    expect(described).not.toHaveBeenCalled();

    // and once it is asked, the recorder and the live mount are handed the one description
    recorder.captureNext();
    const drawn = vi.fn();
    const live = { draw: (source: FrameSource) => drawn(typeof source === 'function' ? source() : source) };
    submitGraphFrame(graph, [live, recorder]);
    expect(described).toHaveBeenCalledOnce();
    expect(recorder.last).toEqual(drawn.mock.calls[0][0]);
  });

  it('still reaches the live mount every draw, so the season tint follows a recorder nobody armed', () => {
    const graph = new SceneGraph(0x102030);
    graph.camera = camera;
    const tint = new SeasonTintMaterials();
    const recorder = new RecordingPipeline();
    const mounted = new MountedThreePipeline(new THREE.Scene(), () => {}, graph,
      [(frame) => tint.show(frame.season)]);
    const described = vi.spyOn(graph, 'frame');

    // the recorder asked first and did not want it; the live mount still has to be handed one
    graph.season = seasonLook(Season.Autumn, Biome.Forest);
    submitGraphFrame(graph, [recorder, mounted]);
    expect(tint.uniforms.uSeasonMul.value.toArray()).toEqual([1.35, 0.82, 0.42]);
    graph.season = seasonLook(Season.Winter, Biome.Plains);
    submitGraphFrame(graph, [mounted, recorder]);
    expect(tint.uniforms.uSeasonMul.value.toArray()).toEqual([0.88, 0.94, 1.06]);
    expect(tint.uniforms.uSeasonBlend.value).toBe(0.5);
    expect(described).toHaveBeenCalledTimes(2);
    expect(recorder.last).toBeNull();
  });
});

describe('a moving producer', () => {
  it('poses a pod of whales and their splash rings without making maths objects', () => {
    const school = new WhaleSchool(new THREE.Scene(), new SceneGraph(0));
    const pod: Pod = { id: 'pod', x: 20, z: -8, size: 2, favourite: 0, at: 0, seed: 7 };
    school.update([pod], 4, 0.1);
    school.splash(21, -9);
    expect(constructions(() => {
      school.update([pod], 4.1, 0.1);
      school.update([pod], 4.2, 0.1);
    })).toBe(0);
    school.dispose();
  });

  it('turns a column of teleport light without making maths objects', () => {
    const scene = new THREE.Scene();
    const beam = new Beam(scene, new EntityRenderer(scene), new THREE.Object3D(), new SceneGraph(0));
    const herd = new Herd(KINDS.hero, 12, -7, 12, -7, 0);
    const hero = new Entity(KINDS.hero, 12, -7, herd, 'hero', mulberry32(7));
    beam.arrives(hero);
    beam.update(0.2);
    expect(constructions(() => { beam.update(0.1); beam.update(0.1); })).toBe(0);
    beam.dispose();
  });

  it('turns a sky island\'s clouds without making maths objects', () => {
    const [site] = planSkyIslands(3, [{ id: 'isle:1000,0', x: 1000, z: 0, radius: 90 }], []);
    const isle = buildSkyIsland(site, 12345);
    isle.props = [];
    const land = new THREE.MeshLambertMaterial({ vertexColors: true });
    const water = new THREE.MeshBasicMaterial();
    const islands = new SkyIslands(new THREE.Scene(), { geometries: new Map(), glows: new Map() } as unknown as PropLibrary,
      water, land, new SceneGraph(0));
    islands.add(isle, () => 0);
    islands.update(1);
    expect(constructions(() => { islands.update(1); islands.update(1); })).toBe(0);
    islands.dispose();
    land.dispose();
    water.dispose();
  });
});
