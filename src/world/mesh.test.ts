import { describe, expect, it } from 'vitest';
import { FaceKind, MESH, generateMesh, territoryOf } from './mesh';

/**
 * The mesh replaces "land is anywhere near a road" with "land is inside a land face". The tests
 * that matter are therefore about shape rather than about numbers: that the topology cannot come
 * out malformed, that the same seed is the same world, and that the country it makes is wide
 * enough to put a mountain on — which the road-tree world was not.
 */

const mesh = generateMesh(1);

describe('the shape of the mesh', () => {
  it('gives every face six sides and six neighbours', () => {
    for (const face of mesh.faces) {
      expect(face.corners.length, `face ${face.id}`).toBe(6);
      expect(face.neighbours.length, `face ${face.id}`).toBe(6);
    }
  });

  it('shares corners between faces rather than giving each its own', () => {
    // three faces meet at every corner, so a mesh that deduplicated nothing would have six
    // vertices per face and the roads would not join up
    expect(mesh.vertices.length).toBeLessThan(mesh.faces.length * 6 * 0.6);
    expect(mesh.vertices.length).toBeGreaterThan(mesh.faces.length);
  });

  it('agrees with itself about who is next to whom', () => {
    for (const face of mesh.faces) {
      for (const n of face.neighbours) {
        if (n < 0) continue;
        expect(mesh.faces[n].neighbours, `${face.id} <-> ${n}`).toContain(face.id);
      }
    }
  });

  it('never pushes a corner far enough to turn a face inside out', () => {
    for (const face of mesh.faces) {
      for (const c of face.corners) {
        const v = mesh.vertices[c];
        const away = Math.hypot(v.x - face.cx, v.z - face.cz);
        expect(away).toBeLessThan(MESH.FACE_RADIUS * (1 + MESH.JITTER));
      }
    }
  });
});

describe('the same seed is the same world', () => {
  it('builds an identical mesh twice', () => {
    const again = generateMesh(1);
    expect(again.faces.length).toBe(mesh.faces.length);
    expect(again.vertices).toEqual(mesh.vertices);
    expect(again.faces.map((f) => f.kind)).toEqual(mesh.faces.map((f) => f.kind));
  });

  it('builds a different one from a different seed', () => {
    const other = generateMesh(2);
    expect(other.faces.map((f) => f.kind)).not.toEqual(mesh.faces.map((f) => f.kind));
  });
});

describe('the country it makes', () => {
  it('puts dry land under the hero, who starts at the middle', () => {
    expect(mesh.isLand(0, 0)).toBe(true);
  });

  it('ends in open sea rather than at a wall', () => {
    const rim = mesh.radius * 0.95;
    for (const [x, z] of [[rim, 0], [-rim, 0], [0, rim], [0, -rim]] as const) {
      expect(mesh.isLand(x, z), `land at the rim (${x}, ${z})`).toBe(false);
    }
  });

  it('has both sea and a good deal of dry land', () => {
    const dry = mesh.faces.filter((f) => f.kind === FaceKind.Land || f.kind === FaceKind.Mountain);
    const share = dry.length / mesh.faces.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.75);
  });

  it('stands mountain country up somewhere', () => {
    expect(mesh.faces.some((f) => f.kind === FaceKind.Mountain)).toBe(true);
  });

  it('merges neighbouring faces into one landmass rather than leaving islands', () => {
    const start = mesh.faces.find((f) => f.kind === FaceKind.Land)!;
    const land = mesh.faces.filter((f) => f.kind === FaceKind.Land);
    expect(territoryOf(mesh, start).length).toBeGreaterThan(land.length * 0.2);
  });

  it('is wide enough to stand a mountain on, which the road-tree world was not', () => {
    // the old world measured fifteen tiles of land at the median and twenty-eight at its widest,
    // so nothing broader than about twenty-seven tiles could be put anywhere. This is the number
    // the whole rebuild exists to change.
    let longest = 0;
    for (let z = -300; z <= 300; z += 30) {
      let run = 0;
      for (let x = -mesh.radius; x <= mesh.radius; x += 4) {
        if (mesh.isLand(x, z)) { run += 4; longest = Math.max(longest, run); } else run = 0;
      }
    }
    expect(longest, 'still ribbons').toBeGreaterThan(200);
  });
});
