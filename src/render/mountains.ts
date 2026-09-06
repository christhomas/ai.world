import * as THREE from 'three';
import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { hexToLinear } from '../world/mesher';
import { type Ranges } from '../world/ranges';

/**
 * Drawing the mountains.
 *
 * They are not chunks and are deliberately not built like them. A chunk is a square of ground
 * streamed in and out as the hero walks; a range is one shape, the size of a county, that exists
 * for the life of the world and is visible from most of it. So it goes into the scene once, whole,
 * as a single mesh of a few hundred triangles — cheaper than one chunk of ground, and never
 * rebuilt.
 *
 * Flat shading is the whole point rather than a saving. Every triangle is one plane with one
 * normal, so the light picks out each face separately and the mountain reads as facets, which is
 * the language the rest of the game is drawn in — the trees, the animals and the houses are all
 * made of a handful of flat surfaces each. Smooth-shading these would produce exactly the soft
 * grey lump this replaced.
 */

/** How a mountain is coloured. */
const ROCK = {
  /**
   * Bare rock at the foot, and the paler stone above.
   *
   * Warmer and darker at the bottom than the highland biome's grey, because a mountain seen from
   * the valley is mostly the shaded side of something and a single flat grey reads as a hole in the
   * world. The two are far enough apart that the height ramp does visible work on its own.
   */
  LOW: 0x6b6862,
  HIGH: 0x9a978f,
  /** Snow, and the height it starts at as a share of the tallest peak in the world. */
  SNOW: 0xeef2f5,
  SNOWLINE: 0.62,
  /** How abruptly it turns to snow, as a share of the tallest peak. Short, so a snowline reads. */
  SNOW_FADE: 0.12,
  /**
   * How much darker a face gets for lying flat, and how much lighter for standing up.
   *
   * Lambert shading alone gives a mountain one tone per angle to the sun, and half a mountain is
   * always facing away from it — so the flanks in shadow came out as one grey sheet whatever their
   * shape. Weathering does the opposite of the light: a ledge holds dust and lichen and goes dull,
   * a wall sheds everything and shows clean stone. Painted into the colour rather than lit, so it
   * is there at every hour and from every side.
   */
  BEDDING: 0.22,
  /** Where the sun is coming from, as a share of full brightness, for picking out one face in two. */
  FACING: 0.1,
  /**
   * How much brighter or darker one face may be than its neighbour.
   *
   * The chunks jitter every tile a little so a field of one colour is not a sheet of paint, and
   * these are so much larger that without it a mountain is six flat greys meeting at hard lines.
   * Per face rather than per vertex: a triangle is one surface and should be one colour.
   */
  SHADE: 0.26,
} as const;

/**
 * The hole kept open in front of the hero, in world units.
 *
 * Wide enough to hold him, his mount and the ground he is about to walk onto — narrower and you
 * are looking down a well — and no wider, because every unit of it is mountain the player paid to
 * have generated and cannot see.
 */
const HOLE = {
  RADIUS: 7.5,
  RIM: 3.5,
  /**
   * How far in front of the hero the hole starts, in world units.
   *
   * Without it the hole begins at his own depth, which takes away the ground he is standing on: on
   * a mountain flank the rock under his feet is at the same distance from the camera as he is, so
   * the whole hillside vanished and he appeared to be standing on the desert two hundred units
   * below. A few units of margin keeps what he is standing on and still cuts the wall between him
   * and the camera.
   */
  STARTS_AT: 4,
  /** And how far in front it takes to open fully, so the cut widens with distance rather than jumping. */
  OPENS_OVER: 14,
} as const;

/**
 * One mesh for all the mountains in the world.
 *
 * Non-indexed on purpose: three vertices per triangle, each carrying that triangle's own normal
 * and colour, which is what makes the shading flat and the facets distinct. Sharing vertices
 * between faces — the usual economy — would average their normals and round the ridges off, which
 * is precisely the look being got rid of.
 */
export function buildMountainMesh(ranges: Ranges, material: THREE.Material): THREE.Mesh | null {
  const count = ranges.tris.length / 9;
  if (count === 0) return null;

  const positions = new Float32Array(ranges.tris);
  const normals = new Float32Array(count * 9);
  const colors = new Float32Array(count * 9);

  const tallest = ranges.peaks.reduce((most, p) => Math.max(most, p.lift), 1);
  const rockLow = hexToLinear(ROCK.LOW);
  const rockHigh = hexToLinear(ROCK.HIGH);
  const snow = hexToLinear(ROCK.SNOW);

  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let t = 0; t < count; t++) {
    const i = t * 9;
    ab.set(positions[i + 3] - positions[i], positions[i + 4] - positions[i + 1], positions[i + 5] - positions[i + 2]);
    ac.set(positions[i + 6] - positions[i], positions[i + 7] - positions[i + 1], positions[i + 8] - positions[i + 2]);
    n.copy(ab).cross(ac).normalize();
    // A fan is wound from the apex outwards, and whether that comes out clockwise depends on which
    // way round the polygon's corners were stored. Rather than fix the winding, take the normal
    // that points at the sky: a mountain has no underside anybody can get to.
    if (n.y < 0) n.negate();

    // the middle of the triangle decides its colour, so one surface is one shade
    const mid = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
    const up = Math.max(0, Math.min(1, mid / tallest));
    const stone = mix(rockLow, rockHigh, up);
    // snow lies on what is flat enough to hold it: a wall stays bare however high it stands, which
    // is the difference between a mountain and a white triangle
    const lying = Math.max(0, Math.min(1, (n.y - 0.35) / 0.5));
    const white = Math.max(0, Math.min(1, (up - ROCK.SNOWLINE) / ROCK.SNOW_FADE)) * lying;
    const colour = mix(stone, snow, white);
    // a fixed jitter per triangle: the same mountain has the same face lit the same way every time
    const jitter = (rand2(ranges.owner[t] + 1, Math.round(positions[i]), Math.round(positions[i + 2]), TILE_SALT.SHADE) - 0.5) * ROCK.SHADE;
    // and the rock's own bedding: flat ledges dull, walls clean, one face in two catching the light
    const bedding = (n.y - 0.5) * -ROCK.BEDDING;
    const facing = (n.x * 0.7 + n.z * 0.7) * ROCK.FACING;
    const shade = 1 + jitter + bedding + facing;

    for (let v = 0; v < 3; v++) {
      normals[i + v * 3] = n.x; normals[i + v * 3 + 1] = n.y; normals[i + v * 3 + 2] = n.z;
      colors[i + v * 3] = colour[0] * shade;
      colors[i + v * 3 + 1] = colour[1] * shade;
      colors[i + v * 3 + 2] = colour[2] * shade;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // it is bigger than the shadow slab and the frustum test, and it is always somewhere near
  mesh.frustumCulled = false;
  mesh.name = 'mountains';
  return mesh;
}

/**
 * The material a mountain is drawn with, and the hole it keeps open in front of the hero.
 *
 * A mountain is the first thing in this world tall enough to stand between the camera and the
 * player. The camera cannot be moved out of the way — it is fixed at forty-five degrees and the
 * hero is always in the middle of the picture — so walking round the north side of a range put the
 * hero behind a wall of rock and the game became unplayable in exactly the places this work was
 * meant to make worth visiting.
 *
 * So the rock in front of him is not drawn. A fragment is dropped when it is both nearer the camera
 * than the hero is and within a short distance of the line the camera looks at him down; everything
 * else is drawn as usual. That is a cylinder cut out of the mountain, following him about — the
 * ground, the trees and the animals inside it are the ones he is standing among, and the mountain
 * beyond him is untouched, so it still reads as a mountain he is inside rather than a hole.
 *
 * The rim is dithered rather than blended. A soft alpha edge needs the whole mesh drawn as a
 * transparent object — sorted, no depth writes, and every facet behind it showing through — which
 * on a shape this size looks like coloured glass. Dropping fragments in a noise pattern keeps the
 * mountain a solid, and at the scale of a few pixels the eye reads the speckled edge as a fade.
 */
export class MountainMaterial {
  /**
   * Drawn on both sides.
   *
   * A fan is wound from its apex outwards and whether that comes out clockwise depends on which way
   * round the polygon's corners were stored, so half the triangles in a world face away from the
   * camera. The normal is turned to face the sky either way — a mountain has no underside anybody
   * can get to — but a back-facing triangle is not drawn at all, and the result was a hillside with
   * holes in it that the hero appeared to be standing on the desert through.
   */
  readonly material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    /**
     * A little light of its own, so the shaded side of a mountain is rock rather than a hole.
     *
     * Half a mountain faces away from the sun at any hour, and Lambert gives an unlit face nothing
     * but the ambient — which on a slab this size reads as a black shape cut out of the sky. Stone
     * in shadow is dark grey and still plainly stone; this is the difference between the two.
     */
    emissive: 0x23262e,
  });
  private readonly uniforms = {
    /** Where the hero is standing, in world space. */
    uHero: { value: new THREE.Vector3(0, 0, 0) },
    /** The direction the camera looks, normalised: what "in front of him" means. */
    uLook: { value: new THREE.Vector3(0, -1, 0) },
    /** How wide the hole is, and how much of that width is the dithered rim. */
    uHole: { value: HOLE.RADIUS },
    uRim: { value: HOLE.RIM },
    uStarts: { value: HOLE.STARTS_AT },
    uOpens: { value: HOLE.OPENS_OVER },
  };

  constructor() {
    this.material.customProgramCacheKey = () => 'ai-world-mountain';
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vRockWorld;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vRockWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vRockWorld;
uniform vec3 uHero;
uniform vec3 uLook;
uniform float uHole;
uniform float uRim;
uniform float uStarts;
uniform float uOpens;

// a cheap hash of the pixel, so the rim breaks up in a fixed speckle rather than a moving fizz
float rockDither(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453);
}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  vec3 fromHero = vRockWorld - uHero;
  float along = dot(fromHero, uLook);          // negative: between the camera and the hero
  float across = length(fromHero - along * uLook);
  // how far in front of him this is, and therefore how much of a hole it is worth: nothing at his
  // own depth, which is the ground he is standing on, and all of it further forward
  float infront = clamp((-along - uStarts) / uOpens, 0.0, 1.0);
  if (infront > 0.0) {
    float hole = uHole * infront;
    float edge = smoothstep(hole - uRim, hole, across);
    if (edge < rockDither(gl_FragCoord.xy)) discard;
  }
}`);
    };
  }

  /** Tell the rock where the hero is and which way the camera is looking at him. */
  look(hero: THREE.Vector3, camera: THREE.Camera, target: THREE.Vector3): void {
    this.uniforms.uHero.value.copy(hero);
    this.uniforms.uLook.value.copy(target).sub(camera.position).normalize();
  }

  dispose(): void {
    this.material.dispose();
  }
}

/** Blend two linear colours. */
function mix(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
