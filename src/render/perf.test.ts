import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KINDS, type AnimalKind } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import { EntityRenderer } from '../entities/pool';
import { mulberry32 } from '../core/rng';
import { PropKind } from '../world/biomes';
import { PropBatch, type PropInstance } from './instancing';
import { PropLibrary } from './props';
import { QUALITY, setWorldView, worldView, type Quality } from './scene';

/**
 * Speed itself is a property of the machine and the hour, and no test can hold it. What a test
 * can hold is the shape of the work: that nothing is drawn twice, that nothing off screen is
 * drawn at all, that a pool never outgrows the buffer it was given, that a kind nobody is growing
 * costs no mesh at all, and that turning the quality down still turns off the things the label
 * promises.
 */

const rng = mulberry32(7);

/** A creature of the given kind standing at (x, z), with no world and no behaviour attached. */
function creature(kindId: string, x: number, z: number): Entity {
  const kind = KINDS[kindId];
  const herd = new Herd(kind, x, z, 0, 0, 8);
  return new Entity(kind, x, z, herd, 'test', rng);
}

/** Every instanced mesh a renderer put into a scene, in the order the pools built them. */
function meshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  scene.traverse((o) => { if (o instanceof THREE.InstancedMesh) out.push(o); });
  return out;
}

/** Instances actually handed to the GPU across every part of every pool. */
const drawn = (scene: THREE.Scene): number => meshes(scene).reduce((n, m) => n + m.count, 0);

/**
 * How many of a creature's parts one mesh draws. A mesh holding all four legs writes four
 * instances per animal, so "one creature in shot" is not "one instance" for it.
 */
const partsPer = (mesh: THREE.InstancedMesh): number => (mesh.userData.part as { parts: number }).parts;

/** The meshes of a pool whose parts are painted from the instance's own palette. */
const painted = (scene: THREE.Scene): THREE.InstancedMesh[] =>
  meshes(scene).filter((m) => m.instanceColor !== null && m.instanceColor !== undefined);

/** Where every drawn instance stands, as strings, so two frames can be compared for sameness. */
function positions(scene: THREE.Scene): string[] {
  const matrix = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const out: string[] = [];
  for (const mesh of meshes(scene)) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      out.push(`${at.x},${at.y},${at.z}`);
    }
  }
  return out;
}

describe('what the creature pools draw', () => {
  it('draws nothing that the camera cannot see', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    const near = creature('sheep', 2, 2);
    const far = creature('sheep', 400, 400);
    renderer.add(near);
    renderer.add(far);

    setWorldView(scene, 0, 0, 40);
    renderer.update();

    const parts = KINDS.sheep.parts.length;
    // one instance per part for the sheep in shot, and nothing at all for the one four hundred
    // tiles away, rather than two instances per part as an uncontrolled pool would write
    expect(drawn(scene)).toBe(parts);
    for (const m of meshes(scene)) expect(m.count).toBe(partsPer(m));
  });

  it('draws a sheep in fewer meshes than it has parts', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    renderer.add(creature('sheep', 2, 2));
    setWorldView(scene, 0, 0, 40);
    renderer.update();

    // four legs of the same box in the same wool are one draw with four instances in it, which is
    // the whole reason instancing exists; a mesh per part gave the pools a hundred and forty
    // draw calls between them and nothing to show for it
    expect(meshes(scene).length).toBeLessThan(KINDS.sheep.parts.length);
    // and every part still gets drawn: the parts a mesh carries add up to the whole animal
    expect(meshes(scene).reduce((n, m) => n + partsPer(m), 0)).toBe(KINDS.sheep.parts.length);
  });

  it('gives every kind in the bestiary fewer meshes than parts, and never more', () => {
    let parts = 0;
    let drawCalls = 0;
    for (const kind of Object.values(KINDS)) {
      const scene = new THREE.Scene();
      const renderer = new EntityRenderer(scene);
      renderer.add(creature(kind.id, 0, 0));
      setWorldView(scene, 0, 0, 40);
      renderer.update();
      const built = meshes(scene);
      expect(built.reduce((n, m) => n + partsPer(m), 0)).toBe(kind.parts.length);
      expect(built.length).toBeLessThanOrEqual(kind.parts.length);
      parts += kind.parts.length;
      drawCalls += built.length;
    }
    // the whole bestiary, as a number somebody can watch: three hundred and twenty-eight parts
    // drawn by a hundred and fifty meshes. If a new creature pushes this up, it is because its
    // parts are shapes nothing else has, which is worth knowing rather than worth hiding
    expect(parts).toBeGreaterThan(300);
    expect(drawCalls).toBeLessThanOrEqual(parts * 0.5);
  });

  it('drops a whole part to no draw at all when nobody is in shot', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    renderer.add(creature('sheep', 300, 300));

    setWorldView(scene, 0, 0, 40);
    renderer.update();

    // three.js issues no draw call for an instanced mesh whose count is zero, which is the whole
    // point: a herd two fields away costs neither matrix work nor a draw. It still walks it and
    // sorts it into both passes to find that out, though, so it is hidden as well as empty
    for (const m of meshes(scene)) {
      expect(m.count).toBe(0);
      expect(m.visible).toBe(false);
    }
  });

  it('shows a part again the moment somebody of that kind walks back into shot', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    const sheep = creature('sheep', 300, 300);
    renderer.add(sheep);
    setWorldView(scene, 0, 0, 40);
    renderer.update();
    for (const m of meshes(scene)) expect(m.visible).toBe(false);

    sheep.x = 1; sheep.z = 1;
    renderer.update();
    for (const m of meshes(scene)) expect(m.visible).toBe(true);
  });

  it('draws everything when no camera has claimed the scene', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    renderer.add(creature('sheep', 2, 2));
    renderer.add(creature('sheep', 400, 400));

    // interiors and dungeons have no rig to say where the view is, so they are not culled
    expect(worldView(scene)).toBeNull();
    renderer.update();
    expect(drawn(scene)).toBe(KINDS.sheep.parts.length * 2);
  });

  it('does not draw anyone who has gone indoors', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    const villager = creature('sheep', 1, 1);
    renderer.add(villager);
    setWorldView(scene, 0, 0, 40);

    renderer.update();
    expect(drawn(scene)).toBe(KINDS.sheep.parts.length);

    villager.indoors = true;
    renderer.update();
    expect(drawn(scene)).toBe(0);
  });

  it('gives a hidden part no instance to draw', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    const hero = creature('hero', 0, 0);
    const tagged = KINDS.hero.parts.filter((p) => p.tag !== undefined);
    expect(tagged.length).toBeGreaterThan(0);
    renderer.add(hero);
    setWorldView(scene, 0, 0, 40);

    renderer.update();
    const all = drawn(scene);

    hero.hiddenTags.add(tagged[0].tag as string);
    renderer.update();
    const hiddenCount = KINDS.hero.parts.filter((p) => p.tag === tagged[0].tag).length;
    expect(drawn(scene)).toBe(all - hiddenCount);
  });

  it('never grows a pool past the buffer it was given', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    renderer.add(creature('sheep', 0, 0));
    // a mesh's buffer holds one slot per creature for each part it draws, so the number of
    // creatures a pool can hold is what that buffer divides down to
    const first = meshes(scene)[0];
    const capacity = first.instanceMatrix.count / partsPer(first);
    for (const m of meshes(scene)) expect(m.instanceMatrix.count).toBe(capacity * partsPer(m));

    // forty more than the buffer can hold are offered in all; forty must be turned away
    const OVER = 40;
    let refused = 0;
    for (let i = 1; i < capacity + OVER; i++) {
      const e = creature('sheep', (i % 20) * 0.1, Math.floor(i / 20) * 0.1);
      if (!renderer.add(e)) { refused++; expect(e.slot).toBe(-1); }
    }
    expect(refused).toBe(OVER);
    expect(renderer.count).toBe(capacity);

    setWorldView(scene, 0, 0, 400);
    renderer.update();
    for (const m of meshes(scene)) {
      const room = m.instanceMatrix.count;
      expect(m.count).toBeLessThanOrEqual(room);
      expect(m.count).toBe(capacity * partsPer(m));
    }
  });

  it('uploads only the slots it wrote, not the whole buffer', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    renderer.add(creature('sheep', 1, 1));
    setWorldView(scene, 0, 0, 40);
    renderer.update();

    for (const m of meshes(scene)) {
      const ranges = m.instanceMatrix.updateRanges;
      expect(ranges.length).toBe(1);
      // sixteen floats to a matrix: one sheep's worth of this mesh's parts, not the three hundred
      // creatures' worth the pool can hold
      expect(ranges[0]).toEqual({ start: 0, count: 16 * partsPer(m) });
    }
  });

  it('draws a stretched part as the shape it looks like, not the shape it was cut from', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    renderer.add(creature('sheep', 0, 0));
    setWorldView(scene, 0, 0, 40);
    renderer.update();

    // A mesh shared by parts of different sizes carries one shape and stretches each instance to
    // fit, so the sizes have to come back out of the matrices rather than out of the geometry.
    // Every box the sheep is made of must be findable at its own size somewhere in the pool.
    const drawnSizes: number[][] = [];
    const matrix = new THREE.Matrix4();
    const size = new THREE.Vector3();
    for (const mesh of meshes(scene)) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        size.setFromMatrixScale(matrix);
        drawnSizes.push([size.x, size.y, size.z]);
      }
    }
    const scale = KINDS.sheep.scale;
    for (const part of KINDS.sheep.parts) {
      if (part.shape !== 'box') continue;
      const want = part.size.map((v) => v * scale);
      const found = drawnSizes.some((got) => got.every((v, i) => Math.abs(v - want[i]) < 1e-6));
      expect(found, `no instance is ${want.join(' x ')}`).toBe(true);
    }
  });
});

/**
 * A prop batch is the same bargain as a creature pool, struck for scenery instead: the world says
 * what grows where, and the batch decides how few draw calls that can be turned into. What these
 * hold is that the bargain is kept both ways — every prop that should be on screen is on screen,
 * and nothing is drawn that need not be.
 */
describe('what the prop batches draw', () => {
  const library = new PropLibrary();
  const glowMaterial = new THREE.MeshBasicMaterial();

  /** A row of props of one kind, marching away from the origin along x. */
  const row = (kind: PropKind, count: number, from = 0): PropInstance[] =>
    Array.from({ length: count }, (_, i) => ({ kind, x: from + i, y: 0, z: 0, rot: 0 }));

  /** How many instances of a kind are actually handed over, across every mesh drawing it. */
  const drawnOf = (scene: THREE.Scene, kind: PropKind): number =>
    meshes(scene)
      .filter((m) => m.geometry === library.geometries.get(kind))
      .reduce((n, m) => n + m.count, 0);

  it('gives a kind nobody is growing no mesh at all', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('a chunk with nothing on it', []);
    batch.update();
    // an InstancedMesh with a count of zero draws nothing and still costs a walk, a sort and a
    // look-in from the shadow pass; nine hundred of them was the whole problem
    expect(meshes(scene)).toEqual([]);
  });

  it('collapses one kind across many chunks into a single mesh', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    for (let i = 0; i < 40; i++) batch.set(`chunk ${i}`, row(PropKind.Oak, 3, i * 3));
    batch.update();

    // forty chunks of three oaks each is one draw of a hundred and twenty, not forty draws of three
    expect(meshes(scene).length).toBe(1);
    expect(drawn(scene)).toBe(120);
  });

  it('draws every prop once and once only', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('a', row(PropKind.Oak, 4));
    batch.set('b', row(PropKind.Oak, 4, 10));
    batch.set('c', row(PropKind.Rock, 5, 20));
    batch.update();

    expect(drawnOf(scene, PropKind.Oak)).toBe(8);
    expect(drawnOf(scene, PropKind.Rock)).toBe(5);
    const seen = new Set<string>();
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    for (const mesh of meshes(scene)) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        at.setFromMatrixPosition(matrix);
        seen.add(`${mesh.geometry.uuid}@${at.x},${at.z}`);
      }
    }
    expect(seen.size).toBe(13);
  });

  it('draws nothing that the camera cannot see', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('near', row(PropKind.Oak, 3));
    batch.set('far', row(PropKind.Oak, 7, 400));
    setWorldView(scene, 0, 0, 40);
    batch.update();
    expect(drawn(scene)).toBe(3);

    // the camera walks off to where the far seven are and the near three are left behind
    setWorldView(scene, 403, 0, 40);
    batch.update();
    expect(drawn(scene)).toBe(7);
  });

  it('hides a kind outright when none of it is in shot', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('over the hill', row(PropKind.Oak, 5, 900));
    setWorldView(scene, 0, 0, 40);
    batch.update();

    expect(drawn(scene)).toBe(0);
    // three finds out that a count of zero draws nothing only after walking it and sorting it;
    // hidden, it is passed over at the one point where passing over it is free
    for (const m of meshes(scene)) expect(m.visible).toBe(false);
  });

  it('draws the lot when no camera has claimed the scene', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('near', row(PropKind.Oak, 3));
    batch.set('far', row(PropKind.Oak, 7, 4000));
    // interiors and dungeons have no rig to say where the view is, so they are not culled
    expect(worldView(scene)).toBeNull();
    batch.update();
    expect(drawn(scene)).toBe(10);
  });

  it('takes a chunk away with its props, and gives them back when it returns', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('staying', row(PropKind.Oak, 3));
    batch.set('going', row(PropKind.Oak, 4, 10));
    batch.update();
    expect(drawn(scene)).toBe(7);

    batch.remove('going');
    batch.update();
    expect(drawn(scene)).toBe(3);

    // walking back the way you came must find the wood you walked through, in the same place
    const before = positions(scene);
    batch.set('going', row(PropKind.Oak, 4, 10));
    batch.update();
    expect(drawn(scene)).toBe(7);
    expect(positions(scene)).toEqual(expect.arrayContaining(before));
  });

  it('keeps no mesh for a kind whose last chunk has gone', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('only', row(PropKind.Rock, 6));
    batch.update();
    expect(meshes(scene).length).toBe(1);

    batch.remove('only');
    expect(meshes(scene)).toEqual([]);
  });

  it('grows the buffer rather than dropping what will not fit', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('a', row(PropKind.Oak, 4));
    batch.update();
    const small = meshes(scene)[0].instanceMatrix.count;

    // far more than the first buffer could hold: a wood streaming in must not be truncated
    for (let i = 0; i < 30; i++) batch.set(`chunk ${i}`, row(PropKind.Oak, 9, 100 + i * 9));
    batch.update();
    const grown = meshes(scene)[0];
    expect(grown.instanceMatrix.count).toBeGreaterThan(small);
    expect(grown.instanceMatrix.count).toBeGreaterThanOrEqual(274);
    expect(drawn(scene)).toBe(274);
  });

  it('lights exactly the windows it drew houses for', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('village', row(PropKind.HousePlains, 3));
    setWorldView(scene, 0, 0, 40);
    batch.update();

    const walls = meshes(scene).find((m) => m.geometry === library.geometries.get(PropKind.HousePlains));
    const windows = meshes(scene).find((m) => m.geometry === library.glows.get(PropKind.HousePlains));
    expect(walls).toBeDefined();
    expect(windows).toBeDefined();
    expect(windows!.count).toBe(walls!.count);
    // the lit panes have to stand in the same walls, or a house glows where it is not
    expect(windows!.instanceMatrix.array.slice(0, walls!.count * 16))
      .toEqual(walls!.instanceMatrix.array.slice(0, walls!.count * 16));
  });

  it('leaves nothing in the scene once it is disposed of', () => {
    const scene = new THREE.Scene();
    const batch = new PropBatch(scene, library, glowMaterial);
    batch.set('a', row(PropKind.Oak, 3));
    batch.update();
    expect(meshes(scene).length).toBe(1);

    batch.dispose();
    expect(meshes(scene)).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});

describe('picking follows the packed buffer', () => {
  it('names the creature in a slot even after the ones before it left the view', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    const first = creature('sheep', 1, 0);
    const second = creature('sheep', 2, 0);
    renderer.add(first);
    renderer.add(second);
    setWorldView(scene, 0, 0, 40);
    renderer.update();

    // a mesh may carry several of an animal's parts, so the first creature owns the first block
    // of instances in it and the second the block after that
    const mesh = painted(scene)[0];
    const each = partsPer(mesh);
    const hitOf = (instanceId: number) => renderer.entityAt({ object: mesh, instanceId } as unknown as THREE.Intersection);
    for (let i = 0; i < each; i++) expect(hitOf(i)).toBe(first);
    for (let i = each; i < each * 2; i++) expect(hitOf(i)).toBe(second);

    // the first one wanders off; the second takes over slot zero, and a click there must find it
    first.x = 500;
    renderer.update();
    expect(mesh.count).toBe(each);
    for (let i = 0; i < each; i++) expect(hitOf(i)).toBe(second);
    expect(hitOf(each)).toBeNull();
  });

  it('offers no pickable mesh for a pool with nobody in shot', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    const sheep = creature('sheep', 1, 0);
    renderer.add(sheep);
    setWorldView(scene, 0, 0, 40);
    renderer.update();
    // every mesh the pool built has this sheep's parts in it, so every one can be clicked on
    expect(renderer.pickables().length).toBe(meshes(scene).length);

    sheep.x = 500;
    renderer.update();
    expect(renderer.pickables()).toEqual([]);
  });
});

describe('the hurt flash survives being packed', () => {
  it('does not leave a creature white after it heals out of shot', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene);
    const sheep = creature('sheep', 1, 0);
    renderer.add(sheep);
    setWorldView(scene, 0, 0, 40);
    renderer.update();

    const tinted = painted(scene)[0];
    expect(tinted).toBeDefined();
    const colourAt = (i: number) => new THREE.Color().fromBufferAttribute(tinted.instanceColor!, i).getHex();

    const calm = colourAt(0);
    sheep.hurt = 1;
    renderer.update();
    const flashing = colourAt(0);
    expect(flashing).not.toBe(calm);

    // it walks out of shot while still smarting, heals there, and comes back to the same slot
    sheep.x = 500;
    renderer.update();
    sheep.hurt = 0;
    renderer.update();
    sheep.x = 1;
    renderer.update();
    expect(colourAt(0)).toBe(calm);
  });
});

/**
 * The pools do not rewrite a colour they believe is already right, which is the only reason the
 * colour buffer is not posted to the GPU every frame. That belief is held per buffer slot, and a
 * slot is a place in a shared mesh rather than a place in one part — so it can come to hold a
 * different part of the same animal, painted from a different entry of the same palette. What
 * this holds is the whole bargain: a pool that has been running is a pool that agrees, matrix for
 * matrix and colour for colour, with one built from scratch in the same state.
 */
describe('what a pool remembers between frames', () => {
  /** A creature whose palette is chosen from its own stream, so two of these can be made alike. */
  const twin = (kindId: string, x: number, z: number, seed: number): Entity => {
    const kind = KINDS[kindId];
    const herd = new Herd(kind, x, z, 0, 0, 8);
    return new Entity(kind, x, z, herd, 'test', mulberry32(seed));
  };

  /** Every matrix and colour a renderer has handed over, mesh by mesh. */
  const buffers = (scene: THREE.Scene): Array<{ matrices: number[]; colors: number[] }> =>
    meshes(scene).map((m) => ({
      matrices: Array.from(m.instanceMatrix.array.slice(0, m.count * 16)),
      colors: m.instanceColor ? Array.from(m.instanceColor.array.slice(0, m.count * 3)) : [],
    }));

  /**
   * Two parts of one shape painted from different entries of the same palette, the first of them
   * hideable. Nothing in the bestiary is built quite like this today; what it is here for is that
   * hiding the first part slides the second one down into a slot the first was painted in, which
   * is the one way a slot can change what it is drawing without changing whose it is.
   */
  const twoTone: AnimalKind = {
    ...KINDS.sheep,
    id: 'test-two-tone',
    palettes: [[0x112233, 0xccddee]],
    parts: [
      { shape: 'box', size: [1, 1, 1], offset: [0, 1, 0], color: 0xffffff, tint: 0, tag: 'saddle' },
      { shape: 'box', size: [1, 1, 1], offset: [0, 2, 0], color: 0xffffff, tint: 1 },
    ],
  };

  it('agrees with a pool built from scratch after a part is hidden under a slot', () => {
    const run = (hideFirst: boolean): THREE.Scene => {
      const scene = new THREE.Scene();
      const renderer = new EntityRenderer(scene);
      const herd = new Herd(twoTone, 1, 0, 0, 0, 8);
      const beast = new Entity(twoTone, 1, 0, herd, 'test', mulberry32(3));
      renderer.add(beast);
      setWorldView(scene, 0, 0, 40);
      if (!hideFirst) renderer.update();
      beast.hiddenTags.add('saddle');
      renderer.update();
      return scene;
    };

    // one pool has drawn a frame with the saddle on and then had it taken away; the other never
    // saw the saddle at all. Nothing about the picture should be able to tell them apart
    expect(buffers(run(false))).toEqual(buffers(run(true)));
  });

  it('agrees with a pool built from scratch after the one in front walks out of shot', () => {
    const run = (aloneFromTheStart: boolean): THREE.Scene => {
      const scene = new THREE.Scene();
      const renderer = new EntityRenderer(scene);
      const front = twin('wolf', 1, 0, 3);
      const behind = twin('wolf', 2, 0, 9);
      renderer.add(front);
      renderer.add(behind);
      setWorldView(scene, 0, 0, 40);
      if (!aloneFromTheStart) renderer.update();
      front.x = 500;
      renderer.update();
      return scene;
    };

    // a wolf is grey over a paler belly, so the slots the front one gave up are slots the one
    // behind it has to repaint rather than inherit
    expect(buffers(run(false))).toEqual(buffers(run(true)));
  });
});

describe('quality levels', () => {
  it('still change what their labels promise', () => {
    const levels: Quality[] = ['low', 'medium', 'high'];
    for (const level of levels) expect(QUALITY[level]).toBeDefined();

    expect(QUALITY.low.shadows).toBe(false);
    expect(QUALITY.medium.shadows).toBe(true);
    expect(QUALITY.high.shadows).toBe(true);
    expect(QUALITY.high.pixels).toBeGreaterThan(QUALITY.medium.pixels);
    expect(QUALITY.medium.pixels).toBeGreaterThan(QUALITY.low.pixels);
    expect(QUALITY.high.shadowMap).toBeGreaterThan(QUALITY.medium.shadowMap);
    for (const level of levels) expect(QUALITY[level].label).toMatch(/[a-z]{3}/);
  });
});

describe('the view a scene reports', () => {
  it('is written in place, so a frame allocates nothing to say where the camera is', () => {
    const scene = new THREE.Scene();
    setWorldView(scene, 1, 2, 30);
    const first = worldView(scene);
    setWorldView(scene, 5, 6, 40);
    expect(worldView(scene)).toBe(first);
    expect(worldView(scene)).toEqual({ x: 5, z: 6, radius: 40 });
  });
});
