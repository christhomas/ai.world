import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KINDS } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import { EntityRenderer } from '../entities/pool';
import { mulberry32 } from '../core/rng';
import { A_PASSAGE, AWAY, Beam, SCATTER } from './beam';

/**
 * The beam a teleport leaves behind.
 *
 * Two things are being guarded here and only one of them is the picture. The picture is that a
 * hero genuinely comes apart — his own blocks, lifted and shrunk, rather than a puff of something
 * drawn over the top of him. The other is the thing that would actually ruin a game: the hero is
 * not drawn at all while he is fully apart, so anything that leaves `apart` where it found it
 * leaves the player as an invisible man who can still walk about. Every test below that ticks the
 * beam ends by checking he is whole again.
 */

function hero(x = 0, z = 0): Entity {
  const rng = mulberry32(7);
  const herd = new Herd(KINDS.hero, x, z, x, z, 0);
  const e = new Entity(KINDS.hero, x, z, herd, 'hero', rng);
  e.x = x; e.z = z; e.y = 0; e.yaw = 0; e.walk = 0; e.phase = 0;
  return e;
}

/** A beam, the pool it takes a hero apart in, and the sword he is holding. */
function stand() {
  const scene = new THREE.Scene();
  const renderer = new EntityRenderer(scene);
  const carried = new THREE.Object3D();
  return { scene, renderer, carried, beam: new Beam(scene, renderer, carried) };
}

/** Run the clock at sixty frames a second for this many seconds. */
function seconds(beam: Beam, howLong: number): void {
  for (let t = 0; t < howLong; t += 1 / 60) beam.update(1 / 60);
}

/** Where instance zero of every mesh with anything in it ended up, and how big it was drawn. */
function blocks(renderer: EntityRenderer): Array<{ x: number; y: number; z: number; size: number }> {
  const m = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  return renderer.pickables().map((o) => {
    const mesh = o as THREE.InstancedMesh;
    mesh.getMatrixAt(0, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    // the volume it is drawn at rather than one axis of it, because a block that has been turned
    // and stretched in the wrong order is thinner one way and fatter another and no single axis
    // catches that
    return { x: m.elements[12], y: m.elements[13], z: m.elements[14], size: scale.x * scale.y * scale.z };
  });
}

describe('teleporting, as something you can watch', () => {
  it('takes the hero apart and puts him back together again', () => {
    const { renderer, beam } = stand();
    const who = hero();
    renderer.add(who);

    // arriving with nobody having left: no beat to wait out, so he gathers straight away
    beam.arrives(who);
    expect(who.apart, 'he arrives in pieces').toBe(1);
    beam.update(1 / 60);
    expect(who.apart, 'and starts gathering himself at once').toBeLessThan(1);

    seconds(beam, SCATTER + 0.1);
    expect(who.apart, 'whole again').toBe(0);
  });

  it('is a passage of about ten seconds rather than a flicker', () => {
    const { renderer, beam } = stand();
    const who = hero();
    renderer.add(who);
    beam.leaves(who);
    beam.arrives(who);

    /*
     * This test used to say the opposite — *"is over inside half a second, because it happens every
     * time you go anywhere"* — and that was the console's teleport talking, which is a tool. The
     * thing itself is an event, and at a third of a second nobody had ever seen it. Chris:
     *
     * > it looks cool, but its too fast
     */
    expect(A_PASSAGE).toBeGreaterThan(9);
    expect(A_PASSAGE).toBeLessThan(11);

    seconds(beam, 1);
    expect(who.apart, 'a second in he is still coming apart at the old place').toBe(1);
    seconds(beam, A_PASSAGE);
    expect(who.apart, 'and whole at the far end of it').toBe(0);
    expect(renderer.count, 'and the copy left behind is gone with it').toBe(1);
  });

  it('holds him fully apart until the copy has gone and the beat has passed', () => {
    const { renderer, beam } = stand();
    const who = hero();
    renderer.add(who);
    beam.leaves(who);
    beam.arrives(who);

    // the whole of the departure and the beat after it: nothing of him is drawn at either end
    seconds(beam, SCATTER + AWAY - 0.2);
    expect(who.apart, 'nowhere, the whole way').toBe(1);

    beam.update(1 / 60);
    seconds(beam, 0.5);
    expect(who.apart, 'and only then does he start to gather').toBeLessThan(1);
    expect(who.apart, 'but he is not there yet either').toBeGreaterThan(0);

    seconds(beam, SCATTER);
    expect(who.apart, 'whole at the end').toBe(0);
  });

  it('brings the camera along when he stops being at the old place, and only then', () => {
    const { renderer, beam } = stand();
    const who = hero();
    renderer.add(who);
    let looked = 0;
    beam.leaves(who);
    beam.arrives(who, () => { looked++; });

    seconds(beam, SCATTER - 0.2);
    expect(looked, 'the view stays to watch him leave').toBe(0);

    seconds(beam, AWAY + 0.3);
    expect(looked, 'and follows him once the beat is over').toBe(1);

    seconds(beam, A_PASSAGE);
    expect(looked, 'once, not once a frame').toBe(1);
  });

  it('leaves a copy of the hero behind to come apart where he was standing', () => {
    const { renderer, beam } = stand();
    const who = hero(10, 20);
    who.tints = [0x112233, 0x445566, 0x778899, 0xaabbcc];
    who.hiddenTags.add('hat');
    renderer.add(who);

    beam.leaves(who);
    expect(renderer.count, 'two heroes for a moment: him, and the picture of him').toBe(2);

    // he has already gone; the copy is what is standing in the light
    who.x = 400; who.z = 400;
    beam.update(1 / 60);
    seconds(beam, SCATTER + 0.1);
    expect(renderer.count, 'and then only him').toBe(1);
  });

  it('lifts and shrinks the hero’s own blocks rather than drawing something else', () => {
    const { renderer, beam } = stand();
    const who = hero();
    renderer.add(who);
    renderer.update();
    const whole = blocks(renderer);
    expect(whole.length, 'a hero is drawn out of several meshes of boxes').toBeGreaterThan(2);

    who.apart = 0.5;
    renderer.update();
    const flying = blocks(renderer);
    for (let i = 0; i < whole.length; i++) {
      expect(flying[i].y, 'every block has risen').toBeGreaterThan(whole[i].y);
      expect(flying[i].size, 'and is on its way to nothing').toBeLessThan(whole[i].size);
    }

    // they do not all leave in the same direction, or the body reads as one thing sliding upward
    const spread = new Set(flying.map((b, i) => `${Math.round((b.x - whole[i].x) * 100)},${Math.round((b.z - whole[i].z) * 100)}`));
    expect(spread.size, 'and each one takes its own way out').toBeGreaterThan(3);

    who.apart = 1;
    renderer.update();
    expect(renderer.pickables().length, 'gone entirely, and not drawn at all').toBe(0);
    beam.dispose();
  });

  it('will not let you click on somebody who is in pieces', () => {
    const { renderer } = stand();
    const who = hero();
    renderer.add(who);
    renderer.update();
    /** The first instance the pool would hand back if a ray landed on it. */
    const found = (): Entity | null => {
      for (const object of renderer.pickables()) {
        const at = renderer.entityAt({ object, instanceId: 0 } as unknown as THREE.Intersection);
        if (at) return at;
      }
      return null;
    };
    expect(found(), 'standing there, he is somebody you can talk to').toBe(who);

    who.apart = 0.4;
    renderer.update();
    expect(found(), 'half way to the sky, he is a picture').toBeNull();
  });
});
