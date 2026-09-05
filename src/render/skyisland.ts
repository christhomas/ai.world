import * as THREE from 'three';
import { WORLD } from '../core/config';
import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { BIOMES, Biome } from '../world/biomes';
import { MeshBuilder, hexToLinear } from '../world/mesher';
import { SKY, type SkyIsland } from '../world/skyisland';
import { addPropInstances, disposeInstances, meshFromData } from './instancing';
import type { PropLibrary } from './props';

/**
 * Drawing a village in the clouds.
 *
 * The island is cut from the same terraces the ground is, walled with the same cliffs and poured
 * off with the same water, so it belongs to this world rather than looking like something dropped
 * into it from another game. What it has that no chunk has is an underside: a keel of rock hanging
 * below the rim, because the whole thing is meant to be looked at from below as well as walked on,
 * and a flat slab seen from underneath is a flat slab.
 *
 * It goes into the ordinary outdoor scene alongside the chunks rather than into a scene of its
 * own. That is what keeps the promise the idea makes — the land is still down there, still being
 * generated and drawn exactly as it always was, and you can stand at the rim and look at it.
 */

/** How the island is drawn. Distances in world units unless they say tiles. */
const DRAW = {
  /**
   * The band of bare rock under the turf, before the keel starts tapering, in world units.
   *
   * This is what makes the island read as being in the air at all. The camera looks down at
   * forty-five degrees and can never get underneath anything, so the underside is not what sells
   * it — the near rim is. With a hand's breadth of rock the island looked like a low plateau lying
   * on the sea; with a proper cliff all round it, it is plainly a piece of country with nothing
   * holding it up.
   */
  RIM_DROP: 4.5,
  /** How far in and how far down the keel's belly sits, as shares of its depth. */
  BELLY_IN: 0.66,
  BELLY_DOWN: 0.5,
  /** Per-tile brightness jitter, matching the chunks so the two read as one material. */
  SHADE_MIN: 0.94,
  SHADE_RANGE: 0.12,
  /** The rock the keel is made of, and how much darker it gets toward the point. */
  KEEL_ROCK: 0x6b6257,
  KEEL_SHADE: 0.55,
  /** Ribbons the falling column is drawn as, and how much wider it gets on the way down. */
  RIBBONS: 3,
  SEGMENTS: 14,
  SPREAD: 1.7,
  /**
   * The raft of cloud under the rim: how far below it starts, how far out it reaches as a share of
   * the island's radius, how many puffs, and how flat each one is.
   *
   * Small and many rather than few and large, and flat enough to read as weather. Two dozen lumps
   * a third of the island wide, which is where this started, came out as frosted glass domes
   * standing over the village on the island below — solid-looking things in the middle distance
   * rather than the vapour the island is supposed to be resting on.
   */
  CLOUD_UNDER: 7.5,
  CLOUD_OUT: 0.75,
  CLOUDS: 46,
  CLOUD_FLAT: 0.18,
  CLOUD_SIZE: 0.07,
  CLOUD_GROW: 0.11,
  /** How long the cloud raft takes to go once round the island, in seconds. */
  CLOUD_TURN: 240,
} as const;

interface Placed {
  isle: SkyIsland;
  group: THREE.Group;
  clouds: THREE.Group;
}

/** The four sides of a tile: which way, and the corners of the edge shared with that neighbour. */
const SIDES = [
  { dx: 1, dz: 0, ax: 1, az: 0, bx: 1, bz: 1, nx: 1, nz: 0 },
  { dx: -1, dz: 0, ax: 0, az: 0, bx: 0, bz: 1, nx: -1, nz: 0 },
  { dx: 0, dz: 1, ax: 0, az: 1, bx: 1, bz: 1, nx: 0, nz: 1 },
  { dx: 0, dz: -1, ax: 0, az: 0, bx: 1, bz: 0, nx: 0, nz: -1 },
] as const;

export class SkyIslands {
  private readonly placed: Placed[] = [];
  private readonly cloudMaterial = new THREE.MeshLambertMaterial({
    color: 0xf4f8ff, transparent: true, opacity: 0.5, depthWrite: false,
  });
  private readonly landMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  private turned = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly props: PropLibrary,
    private readonly waterMaterial: THREE.Material,
    private readonly glowMaterial: THREE.Material,
  ) {}

  /**
   * Put one island in the sky. `groundY` is how high the land is under a point, which is where the
   * waterfall has to stop — a plume that carries on past the ground and out of the bottom of the
   * world is the one thing that gives the whole trick away.
   */
  add(isle: SkyIsland, groundY: (x: number, z: number) => number): void {
    const group = new THREE.Group();
    const land = buildLand(isle);
    if (land) {
      const mesh = meshFromData(land, this.landMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const water = buildWater(isle, groundY(isle.fall.x + isle.fall.dx * SKY.PLUME, isle.fall.z + isle.fall.dz * SKY.PLUME));
    if (water) {
      const mesh = meshFromData(water, this.waterMaterial);
      mesh.renderOrder = 2;
      group.add(mesh);
    }
    addPropInstances(group, this.props, isle.props.map((p) => ({
      kind: p.kind, x: p.x, y: p.y, z: p.z, rot: p.rot, scale: p.scale,
    })), this.glowMaterial);
    this.scene.add(group);

    const clouds = buildClouds(isle, this.cloudMaterial);
    this.scene.add(clouds);
    this.placed.push({ isle, group, clouds });
  }

  /** The clouds go round, slowly, because a still cloud is a rock. */
  update(dt: number): void {
    this.turned += (dt / DRAW.CLOUD_TURN) * Math.PI * 2;
    for (const p of this.placed) p.clouds.rotation.y = this.turned;
  }

  dispose(): void {
    for (const p of this.placed) {
      this.scene.remove(p.group);
      this.scene.remove(p.clouds);
      p.group.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
      });
      disposeInstances(p.group);
      p.clouds.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    this.placed.length = 0;
    this.cloudMaterial.dispose();
    this.landMaterial.dispose();
  }
}

/** The island's top, its cliffs, its rim, and the keel of rock hanging under all of it. */
function buildLand(isle: SkyIsland): ReturnType<MeshBuilder['build']> | null {
  const b = new MeshBuilder();
  const def = BIOMES[Biome.Mountain];
  const cliff = hexToLinear(def.cliff);
  const rock = hexToLinear(DRAW.KEEL_ROCK);
  const rimY = isle.site.y - DRAW.RIM_DROP;
  const seed = isle.x0 * 31 + isle.z0;
  const at = (gx: number, gz: number): number =>
    gx < 0 || gz < 0 || gx >= isle.w || gz >= isle.h ? Number.NaN : isle.top[gz * isle.w + gx];

  for (let gz = 0; gz < isle.h; gz++) {
    for (let gx = 0; gx < isle.w; gx++) {
      const i = gz * isle.w + gx;
      const y = isle.top[i];
      if (Number.isNaN(y)) continue;
      const wx = isle.x0 + gx, wz = isle.z0 + gz;
      const wet = isle.water[i] > 0;
      const shade = DRAW.SHADE_MIN + rand2(seed, wx, wz, TILE_SALT.SHADE) * DRAW.SHADE_RANGE;
      // a bed under water is the ground darkened, exactly as a river bed is
      const base = hexToLinear(wet ? def.sand : (rand2(seed, wx, wz, TILE_SALT.GROUND_VARIANT) < 0.35 ? def.groundAlt : def.ground));
      const dim = wet ? 0.72 : 1;
      const top: [number, number, number] = [base[0] * shade * dim, base[1] * shade * dim, base[2] * shade * dim];
      b.quad([wx, y, wz], [wx, y, wz + 1], [wx + 1, y, wz + 1], [wx + 1, y, wz], 0, 1, 0, top);

      for (const side of SIDES) {
        const n = at(gx + side.dx, gz + side.dz);
        const rim = Number.isNaN(n);
        const floor = rim ? rimY : n;
        if (floor >= y - 1e-3) continue;
        const xa = wx + side.ax, za = wz + side.az, xb = wx + side.bx, zb = wz + side.bz;
        // a terrace step inside the island is the country's own cliff; the rim is the rock the
        // whole thing is torn out of, and takes the keel's colour so the two read as one mass
        b.quad([xa, floor, za], [xb, floor, zb], [xb, y, zb], [xa, y, za], side.nx, 0, side.nz, rim ? rock : cliff);
      }
    }
  }

  // The keel. Every tile edge with nothing beyond it is one rib of it: out at the rim it is the
  // island's own outline, and it closes on a point underneath the middle, so from below the
  // village reads as something torn out of the ground rather than as a table top.
  const apex: [number, number, number] = [isle.site.x, rimY - SKY.KEEL, isle.site.z];
  const deep: [number, number, number] = [rock[0] * DRAW.KEEL_SHADE, rock[1] * DRAW.KEEL_SHADE, rock[2] * DRAW.KEEL_SHADE];
  const belly = (x: number, z: number): [number, number, number] => [
    isle.site.x + (x - isle.site.x) * DRAW.BELLY_IN,
    rimY - SKY.KEEL * DRAW.BELLY_DOWN,
    isle.site.z + (z - isle.site.z) * DRAW.BELLY_IN,
  ];
  for (let gz = 0; gz < isle.h; gz++) {
    for (let gx = 0; gx < isle.w; gx++) {
      if (Number.isNaN(isle.top[gz * isle.w + gx])) continue;
      const wx = isle.x0 + gx, wz = isle.z0 + gz;
      for (const side of SIDES) {
        if (!Number.isNaN(at(gx + side.dx, gz + side.dz))) continue;
        const a: [number, number, number] = [wx + side.ax, rimY, wz + side.az];
        const c: [number, number, number] = [wx + side.bx, rimY, wz + side.bz];
        const ba = belly(a[0], a[2]), bc = belly(c[0], c[2]);
        b.quad(a, c, bc, ba, side.nx, -0.35, side.nz, rock);
        // a triangle is a quad with two corners in the same place; the winding fix-up copes
        b.quad(ba, bc, apex, apex, side.nx * 0.4, -1, side.nz * 0.4, deep);
      }
    }
  }
  return b.empty ? null : b.build(false);
}

/** The spring, the stream, and the fall that is the reason any of this exists. */
function buildWater(isle: SkyIsland, landsAt: number): ReturnType<MeshBuilder['build']> | null {
  const b = new MeshBuilder();
  const river = hexToLinear(0x3fa3da);
  const foam = hexToLinear(0xd9f0fb);
  const surfaceAt = (gx: number, gz: number): number =>
    gx < 0 || gz < 0 || gx >= isle.w || gz >= isle.h ? -1 : isle.water[gz * isle.w + gx];

  for (let gz = 0; gz < isle.h; gz++) {
    for (let gx = 0; gx < isle.w; gx++) {
      const s = isle.water[gz * isle.w + gx];
      if (s <= 0) continue;
      const wx = isle.x0 + gx, wz = isle.z0 + gz;
      b.quad([wx, s, wz], [wx, s, wz + 1], [wx + 1, s, wz + 1], [wx + 1, s, wz], 0, 1, 0, river, 0);
      // where the stream steps down a terrace it makes a little fall of its own, which is what
      // tells you at a glance which way the water is going before it reaches the edge
      for (const side of SIDES) {
        const ns = surfaceAt(gx + side.dx, gz + side.dz);
        if (ns < 0 || ns >= s - 0.01) continue;
        const xa = wx + side.ax + side.nx * 0.02, za = wz + side.az + side.nz * 0.02;
        const xb = wx + side.bx + side.nx * 0.02, zb = wz + side.bz + side.nz * 0.02;
        b.quad([xa, ns, za], [xb, ns, zb], [xb, s, zb], [xa, s, za], side.nx, 0, side.nz, foam, 1);
      }
    }
  }

  pourOver(b, isle, landsAt, foam);
  return b.empty ? null : b.build(true);
}

/**
 * The column of water from the lip to the ground.
 *
 * Drawn as a few flat ribbons crossing on the same axis rather than as a box, because the camera
 * turns and a box shows its corners: three ribbons at sixty degrees always present a face to the
 * view, cost a dozen quads apiece, and the water shader's downward streaks do the rest.
 *
 * The plume leans out as it falls rather than dropping in a straight line. Water going over a lip
 * keeps the speed it arrived with and only gains downward, so its offset grows as the square root
 * of the distance fallen — and drawn as a straight vertical curtain it reads as a pane of glass
 * stuck to the cliff instead of as water leaving it.
 */
function pourOver(b: MeshBuilder, isle: SkyIsland, landsAt: number, foam: [number, number, number]): void {
  const { x, z, lipY, dx, dz, width } = isle.fall;
  const drop = lipY - landsAt;
  if (drop <= 0) return;
  const centre = (t: number): [number, number, number] => [
    x + dx * SKY.PLUME * Math.sqrt(t),
    lipY - drop * t,
    z + dz * SKY.PLUME * Math.sqrt(t),
  ];
  const halfAt = (t: number): number => width * (1 + (DRAW.SPREAD - 1) * t);

  for (let r = 0; r < DRAW.RIBBONS; r++) {
    const a = (r / DRAW.RIBBONS) * Math.PI;
    const ax = Math.cos(a), az = Math.sin(a);
    for (let s = 0; s < DRAW.SEGMENTS; s++) {
      const t0 = s / DRAW.SEGMENTS, t1 = (s + 1) / DRAW.SEGMENTS;
      const c0 = centre(t0), c1 = centre(t1);
      const h0 = halfAt(t0), h1 = halfAt(t1);
      b.quad(
        [c0[0] - ax * h0, c0[1], c0[2] - az * h0],
        [c0[0] + ax * h0, c0[1], c0[2] + az * h0],
        [c1[0] + ax * h1, c1[1], c1[2] + az * h1],
        [c1[0] - ax * h1, c1[1], c1[2] - az * h1],
        -az, 0, ax, foam, 1,
      );
    }
  }

  // and where it lands: a disc of white water, so the fall arrives somewhere instead of stopping
  const [lx, , lz] = centre(1);
  const pool = halfAt(1) * 1.5;
  const y = landsAt + 0.06;
  const round = 18;
  for (let k = 0; k < round; k++) {
    const a0 = (k / round) * Math.PI * 2, a1 = ((k + 1) / round) * Math.PI * 2;
    b.quad(
      [lx, y, lz],
      [lx + Math.cos(a0) * pool, y, lz + Math.sin(a0) * pool],
      [lx + Math.cos(a1) * pool, y, lz + Math.sin(a1) * pool],
      [lx, y, lz],
      0, 1, 0, foam, 1,
    );
  }
}

/** The raft of cloud the island appears to be resting on. */
function buildClouds(isle: SkyIsland, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.position.set(isle.site.x, 0, isle.site.z);
  const R = isle.site.radius;
  for (let k = 0; k < DRAW.CLOUDS; k++) {
    // spread from the seed's own arithmetic rather than Math.random, so two machines agree
    const a = (k / DRAW.CLOUDS) * Math.PI * 2 + rand2(isle.x0, k, isle.z0, 3) * 0.6;
    const d = R * (0.45 + rand2(isle.x0, k, isle.z0, 5) * DRAW.CLOUD_OUT);
    const size = R * (DRAW.CLOUD_SIZE + rand2(isle.x0, k, isle.z0, 7) * DRAW.CLOUD_GROW);
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), material);
    puff.scale.set(1, DRAW.CLOUD_FLAT, 1);
    puff.position.set(
      Math.cos(a) * d,
      isle.site.y - DRAW.CLOUD_UNDER - rand2(isle.x0, k, isle.z0, 11) * 3.5,
      Math.sin(a) * d,
    );
    puff.rotation.y = rand2(isle.x0, k, isle.z0, 13) * Math.PI;
    group.add(puff);
  }
  return group;
}
