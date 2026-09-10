import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KINDS } from '../entities/animals';
import { Entity, Herd, damageEntity, type TileWorld } from '../entities/entity';
import { EntityRenderer } from '../entities/pool';
import { mulberry32 } from '../core/rng';
import { BEHAVIOUR } from '../entities/properties';
import { BAR, HealthBars, heightOf } from './healthbars';

/**
 * What a creature has left, over its head.
 *
 * The promise is small and worth pinning anyway: hit something and you can see how it is going.
 * Two ways for that to be broken quietly — a bar that never appears, and a bar that appears over
 * everything in the county — so both ends are measured here rather than the drawing itself.
 */

/** Flat ground for ever, with nothing standing on it: enough for a blow to knock somebody back. */
const FIELD: TileWorld = {
  heightAt: () => 0,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => true,
};

function creature(id: string, x = 0, z = 0): Entity {
  const kind = KINDS[id];
  const e = new Entity(kind, x, z, new Herd(kind, x, z, x, z, 0), 'bench', mulberry32(3));
  e.y = 0;
  return e;
}

/** The instance matrices a frame wrote, as position and scale. */
function drawn(mesh: THREE.InstancedMesh, at: number): { pos: THREE.Vector3; scale: THREE.Vector3 } {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(at, m);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return { pos, scale };
}

function meshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh
    && (o as THREE.InstancedMesh).geometry.type === 'PlaneGeometry');
}

describe('how tall a creature is', () => {
  it('is measured off the parts it is drawn from', () => {
    const hero = heightOf(KINDS.hero);
    expect(hero, 'a man of no height at all').toBeGreaterThan(0.5);
    expect(hero, 'a man three tiles tall').toBeLessThan(3);
    // and it follows the bestiary rather than a table: a bear is drawn bigger than a rabbit
    expect(heightOf(KINDS.bear)).toBeGreaterThan(heightOf(KINDS.rabbit));
  });
});

describe('a health bar', () => {
  it('is not there until something is hit, and goes away again when it is left alone', () => {
    const scene = new THREE.Scene();
    const bars = new HealthBars(scene);
    const camera = new THREE.OrthographicCamera();
    const wolf = creature('wolf');

    bars.begin(camera);
    bars.add(wolf, 1, 1);
    bars.done();
    expect(bars.showing, 'a bar over something nobody has touched').toBe(0);

    damageEntity(wolf, 1, 5, 0, FIELD);
    expect(wolf.bar, 'being hit did not raise a bar').toBeGreaterThan(0);
    bars.begin(camera);
    bars.add(wolf, 1, 1);
    bars.done();
    expect(bars.showing, 'hit, and nothing over its head').toBe(1);

    // and it fades out of its own accord: the timer is what the world counts down
    wolf.bar = 0;
    bars.begin(camera);
    bars.add(wolf, 1, 1);
    bars.done();
    expect(bars.showing, 'the bar stayed up after the fight was over').toBe(0);
  });

  it('drains from the right and keeps its left edge where it was', () => {
    const scene = new THREE.Scene();
    const bars = new HealthBars(scene);
    const camera = new THREE.OrthographicCamera();
    const [, fill] = meshes(scene);
    const elk = creature('elk');
    const most = elk.kind.hp ?? 1;
    expect(most, 'this test wants something with more than one hit in it').toBeGreaterThan(1);

    const edges: number[] = [];
    const widths: number[] = [];
    for (let hit = 0; hit < most - 1; hit++) {
      elk.hp = most - hit;
      elk.bar = BEHAVIOUR.BAR_TIME;
      bars.begin(camera);
      bars.add(elk, 1, 1);
      bars.done();
      const { pos, scale } = drawn(fill, 0);
      widths.push(scale.x);
      edges.push(pos.x - scale.x / 2);
    }
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i], 'the bar did not go down as it was hit').toBeLessThan(widths[i - 1]);
      expect(edges[i], 'the bar shrank toward its middle instead of draining').toBeCloseTo(edges[0], 5);
    }
    // as wide as the share of the picture it is asked for: this camera is two world units tall
    expect(widths[0]).toBeCloseTo(BAR.WIDE * 2, 5);
  });

  it('floats over the head rather than through it', () => {
    const scene = new THREE.Scene();
    const bars = new HealthBars(scene);
    const [back] = meshes(scene);
    const bear = creature('bear');
    bear.y = 3;
    bear.bar = BEHAVIOUR.BAR_TIME;
    bars.begin(new THREE.OrthographicCamera());
    bars.add(bear, heightOf(bear.kind), bear.kind.scale);
    bars.done();
    const { pos } = drawn(back, 0);
    expect(pos.y, 'the bar is inside the animal').toBeGreaterThan(3 + heightOf(bear.kind) * bear.kind.scale);
  });

  it('is never worn by the hero, who has hearts of his own', () => {
    const scene = new THREE.Scene();
    const bars = new HealthBars(scene);
    const hero = creature('hero');
    hero.bar = BEHAVIOUR.BAR_TIME;
    hero.hp = 1;
    bars.begin(new THREE.OrthographicCamera());
    bars.add(hero, 1, 1);
    bars.done();
    expect(bars.showing, 'the hero was given a health bar as well as his hearts').toBe(0);
  });

  it('is drawn by the renderer for the creatures it draws, and only when there is a camera', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    const wolf = creature('wolf', 2, 2);
    renderer.add(wolf);
    damageEntity(wolf, 1, 9, 2, FIELD);

    renderer.update();
    expect(renderer.barsShowing, 'bars were written with nobody looking').toBe(0);
    renderer.update(new THREE.OrthographicCamera());
    expect(renderer.barsShowing, 'a hurt wolf in shot has nothing over its head').toBe(1);

    // a body is not a patient: nothing over a dead thing
    wolf.dead = true;
    renderer.update(new THREE.OrthographicCamera());
    expect(renderer.barsShowing, 'a bar over a corpse').toBe(0);
  });
});
