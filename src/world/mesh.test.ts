import { describe, expect, it } from 'vitest';
import { FaceKind, MESH, faceAt, generateMesh, isLand, territoryOf } from './mesh';

/**
 * The mesh replaces "land is anywhere near a road" with "land is inside a land face". The tests
 * that matter are therefore about shape rather than about numbers: that the topology cannot come
 * out malformed, that the same seed is the same world, and that the country it makes is wide
 * enough to put a mountain on — which the road-tree world was not.
 *
 * Since the hexagons went, one more matters as much as any of them: that the faces really are a
 * mixture of three, four, five and six sides at several different sizes. That was the whole reason
 * for tearing out a lattice that worked, and a mixture is the sort of thing that can quietly
 * collapse back to one shape when a dial is retuned, with nothing failing to say so.
 */

const mesh = generateMesh(1);
/** More than one, because a histogram off a single seed says very little. */
const worlds = [1, 2, 3, 7, 12345].map((s) => generateMesh(s));

describe('the shape of the mesh', () => {
  it('gives every face three to six sides and a neighbour across each of them', () => {
    for (const face of mesh.faces) {
      expect(face.corners.length, `face ${face.id}`).toBeGreaterThanOrEqual(3);
      expect(face.corners.length, `face ${face.id}`).toBeLessThanOrEqual(6);
      expect(face.neighbours.length, `face ${face.id}`).toBe(face.corners.length);
    }
  });

  it('is a mixture of triangles, quadrilaterals, pentagons and hexagons', () => {
    // The point of the exercise, and the thing that must not regress quietly: a lattice of any one
    // shape scores nought on three of these four columns. A tenth of the faces each is a floor, not
    // a target — measured over these seeds it comes out near a fifth, a quarter, a quarter and a
    // quarter — and it is set that low so ordinary retuning does not trip it and a collapse does.
    const sides = new Map<number, number>();
    let total = 0;
    for (const world of worlds) {
      for (const face of world.faces) {
        sides.set(face.corners.length, (sides.get(face.corners.length) ?? 0) + 1);
        total++;
      }
    }
    const spread = [3, 4, 5, 6].map((s) => `${s}: ${sides.get(s) ?? 0}`).join(', ');
    for (const n of [3, 4, 5, 6]) {
      expect((sides.get(n) ?? 0) / total, `${n}-sided faces are too rare (${spread})`).toBeGreaterThan(0.1);
    }
    expect(sides.get(7) ?? 0, 'a face with more than six sides').toBe(0);
  });

  it('makes faces of visibly different sizes, not one size jittered', () => {
    // a lattice gives every cell the same area to within the jitter; a varying scatter gives a
    // spread of several times over, which is what makes some country close and some of it open
    const areas = mesh.faces.map((f) => f.area).sort((a, b) => a - b);
    const small = areas[Math.floor(areas.length * 0.1)];
    const large = areas[Math.floor(areas.length * 0.9)];
    expect(large / small, `p10 ${small.toFixed(0)}, p90 ${large.toFixed(0)}`).toBeGreaterThan(3);
  });

  it('shares corners between faces rather than giving each its own', () => {
    // a mesh that deduplicated nothing would have as many corners as all the faces have sides put
    // together, and no two roads in the world would ever meet
    const sides = mesh.faces.reduce((sum, f) => sum + f.corners.length, 0);
    const used = new Set(mesh.faces.flatMap((f) => f.corners));
    expect(used.size).toBeLessThan(sides * 0.5);
    expect(used.size).toBeGreaterThan(mesh.faces.length);
  });

  it('gives every crossroads at least three roads, so a junction is a junction', () => {
    const roads = new Map<number, Set<number>>();
    for (const face of mesh.faces) {
      for (let k = 0; k < face.corners.length; k++) {
        const a = face.corners[k], b = face.corners[(k + 1) % face.corners.length];
        if (!roads.has(a)) roads.set(a, new Set());
        if (!roads.has(b)) roads.set(b, new Set());
        roads.get(a)!.add(b);
        roads.get(b)!.add(a);
      }
    }
    for (const [corner, out] of roads) {
      expect(out.size, `crossroads ${corner}`).toBeGreaterThanOrEqual(MESH.MIN_ROADS);
    }
    // and a good many of them have more than three, which a hexagon lattice could never manage
    const busy = [...roads.values()].filter((out) => out.size > 3).length;
    expect(busy / roads.size, 'every junction is a plain three-way fork').toBeGreaterThan(0.15);
  });

  it('agrees with itself about who is next to whom', () => {
    for (const face of mesh.faces) {
      for (const n of face.neighbours) {
        if (n < 0) continue;
        expect(mesh.faces[n].neighbours, `${face.id} <-> ${n}`).toContain(face.id);
      }
    }
  });

  it('tiles the country without gaps or overlaps', () => {
    // Sampled in the mesh's own coordinates rather than through `faceAt`, because the displacement
    // `faceAt` applies is deliberately allowed to fold and would make a fold look like a tear.
    const { index } = mesh;
    for (let z = -300; z <= 300; z += 23) {
      for (let x = -300; x <= 300; x += 29) {
        const claims = mesh.faces.filter((face) => {
          let inside = false;
          const n = face.corners.length;
          for (let a = 0, b = n - 1; a < n; b = a++) {
            const va = mesh.vertices[face.corners[a]], vb = mesh.vertices[face.corners[b]];
            if ((va.z > z) !== (vb.z > z) && x < ((vb.x - va.x) * (z - va.z)) / (vb.z - va.z) + va.x) inside = !inside;
          }
          return inside;
        });
        expect(claims.length, `(${x}, ${z}) is claimed by ${claims.length} faces`).toBe(1);
        expect(index.faceStart.length).toBe(mesh.faces.length + 1);
      }
    }
  });

  it('puts every face inside the territory it belongs to, and agrees on what that is made of', () => {
    for (const face of mesh.faces) {
      const region = mesh.regions[face.region];
      expect(region.faces, `face ${face.id}`).toContain(face.id);
      expect(region.kind, `face ${face.id}`).toBe(face.kind);
    }
  });
});

describe('the same seed is the same world', () => {
  it('builds an identical mesh twice', () => {
    const again = generateMesh(1);
    expect(again.faces.length).toBe(mesh.faces.length);
    expect(again.vertices).toEqual(mesh.vertices);
    expect(again.faces.map((f) => f.corners)).toEqual(mesh.faces.map((f) => f.corners));
    expect(again.faces.map((f) => f.kind)).toEqual(mesh.faces.map((f) => f.kind));
  });

  it('builds a different one from a different seed', () => {
    const other = generateMesh(2);
    expect(other.faces.map((f) => f.kind)).not.toEqual(mesh.faces.map((f) => f.kind));
    expect(other.vertices).not.toEqual(mesh.vertices);
  });
});

describe('the country it makes', () => {
  it('puts dry land under the hero, who starts at the middle', () => {
    for (const world of worlds) expect(isLand(world, 0, 0), `seed ${world.seed}`).toBe(true);
  });

  it('ends in open sea rather than at a wall', () => {
    for (const world of worlds) {
      const rim = world.radius * 0.95;
      for (const [x, z] of [[rim, 0], [-rim, 0], [0, rim], [0, -rim]] as const) {
        expect(isLand(world, x, z), `land at the rim of seed ${world.seed} (${x}, ${z})`).toBe(false);
      }
    }
  });

  it('has both sea and a good deal of dry land', () => {
    for (const world of worlds) {
      const dry = world.faces.filter((f) => f.kind === FaceKind.Land || f.kind === FaceKind.Mountain);
      const share = dry.length / world.faces.length;
      expect(share, `seed ${world.seed}`).toBeGreaterThan(0.15);
      expect(share, `seed ${world.seed}`).toBeLessThan(0.75);
    }
  });

  it('stands mountain country up somewhere, and holds water inland somewhere', () => {
    for (const world of worlds) {
      expect(world.faces.some((f) => f.kind === FaceKind.Mountain), `seed ${world.seed}`).toBe(true);
    }
    expect(worlds.filter((w) => w.faces.some((f) => f.kind === FaceKind.Lake)).length).toBeGreaterThan(2);
  });

  it('merges neighbouring faces into one landmass rather than leaving islands', () => {
    const start = mesh.faces.find((f) => f.kind === FaceKind.Land)!;
    const land = mesh.faces.filter((f) => f.kind === FaceKind.Land);
    expect(territoryOf(mesh, start).length).toBeGreaterThan(land.length * 0.2);
  });

  it('throws off islands: dry ground with open water all the way round it', () => {
    const dry = (k: FaceKind): boolean => k === FaceKind.Land || k === FaceKind.Mountain;
    for (const world of worlds) {
      const mainland = world.regions
        .filter((r) => dry(r.kind))
        .sort((a, b) => b.faces.length - a.faces.length)[0];
      const offshore = world.regions.filter((r) => dry(r.kind) && r.id !== mainland.id);
      expect(offshore.length, `seed ${world.seed} has nowhere to sail to`).toBeGreaterThan(0);
    }
  });

  it('is wide enough to stand a mountain on, which the road-tree world was not', () => {
    // the old world measured fifteen tiles of land at the median and twenty-eight at its widest,
    // so nothing broader than about twenty-seven tiles could be put anywhere. This is the number
    // the whole rebuild exists to change.
    let longest = 0;
    for (let z = -300; z <= 300; z += 30) {
      let run = 0;
      for (let x = -mesh.radius; x <= mesh.radius; x += 4) {
        if (isLand(mesh, x, z)) { run += 4; longest = Math.max(longest, run); } else run = 0;
      }
    }
    expect(longest, 'still ribbons').toBeGreaterThan(200);
  });

  it('has a coastline that does not run along the borders it was drawn from', () => {
    // The displacement is what turns a straight polygon border into a coast. Without it the shore
    // would be exactly a face border, so counting how much of the world is answered for by a face
    // it does not geometrically sit in is a direct test that the borders are not visible in the
    // finished country. It comes out around a quarter; a tenth would mean the displacement had
    // been turned down far enough for the polygons to start showing through the coast again.
    let strayed = 0, coast = 0;
    for (let z = -400; z <= 400; z += 7) {
      for (let x = -400; x <= 400; x += 7) {
        const face = faceAt(mesh, x, z);
        if (!face) continue;
        // the face the point is in, versus the face the point sits inside geometrically
        const home = mesh.faces.find((f) => {
          let inside = false;
          const n = f.corners.length;
          for (let a = 0, b = n - 1; a < n; b = a++) {
            const va = mesh.vertices[f.corners[a]], vb = mesh.vertices[f.corners[b]];
            if ((va.z > z) !== (vb.z > z) && x < ((vb.x - va.x) * (z - va.z)) / (vb.z - va.z) + va.x) inside = !inside;
          }
          return inside;
        });
        coast++;
        if (home && home.id !== face.id) strayed++;
      }
    }
    expect(strayed / coast, 'the coast is the polygon border').toBeGreaterThan(0.15);
  });
});
