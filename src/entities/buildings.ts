import { box, cone, cyl, prism, type PropPart } from './shapes';

/**
 * The cottage and the chapel, which several biomes share.
 *
 * Kept apart from the catalogue because they are the two shapes in the game that are built rather
 * than written out: six biomes have a house and a church each, and a seventh kind of house is the
 * one the player builds, so eighteen props come out of these two functions. A biome only says what
 * colour its timber is.
 *
 * Nothing here knows what a village is; it knows what a wall is. The door faces +x in both, which
 * is what everything that walks up to one assumes — see `game/doorways.ts`, which puts a doorway
 * where `house` puts its leaf.
 */

export type WindowSpec = [[number, number, number], [number, number, number]];
export const HOUSE_WINDOWS: WindowSpec[] = [
  [[0.08, 0.42, 0.42], [1.22, 1.15, 0.75]],
  [[0.08, 0.42, 0.42], [1.22, 1.15, -0.75]],
  [[0.42, 0.42, 0.08], [0, 1.15, 1.22]],
  [[0.42, 0.42, 0.08], [-0.4, 1.15, -1.22]],
];
export const CHURCH_WINDOWS: WindowSpec[] = [
  [[0.08, 0.9, 0.3], [1.32, 1.8, 0.6]],
  [[0.08, 0.9, 0.3], [1.32, 1.8, -0.6]],
  [[0.3, 0.9, 0.08], [0.4, 1.5, 1.12]],
  [[0.3, 0.9, 0.08], [-0.4, 1.5, 1.12]],
  [[0.3, 0.9, 0.08], [0.4, 1.5, -1.12]],
  [[0.3, 0.9, 0.08], [-0.4, 1.5, -1.12]],
];

/**
 * A hall's windows are tall and evenly spaced along both flanks, which is the whole of what says
 * "public building" from above: a cottage has whatever windows it happened to get, and a hall has
 * a row of them because somebody drew it before it was built.
 */
export const HALL_WINDOWS: WindowSpec[] = [
  [[0.3, 0.8, 0.08], [0.6, 1.25, 1.42]],
  [[0.3, 0.8, 0.08], [-0.2, 1.25, 1.42]],
  [[0.3, 0.8, 0.08], [0.6, 1.25, -1.42]],
  [[0.3, 0.8, 0.08], [-0.2, 1.25, -1.42]],
  [[0.08, 0.8, 0.3], [-1.42, 1.25, 0.55]],
  [[0.08, 0.8, 0.3], [-1.42, 1.25, -0.55]],
];
/** And a watch house's are small, high and few, which is the same trick used the other way. */
export const WATCH_WINDOWS: WindowSpec[] = [
  [[0.3, 0.3, 0.08], [0.5, 1.45, 1.22]],
  [[0.3, 0.3, 0.08], [0.5, 1.45, -1.22]],
  [[0.08, 0.3, 0.3], [-1.32, 1.45, 0]],
];

export interface HouseStyle { wall: number; roof: number; trim: number; roofType: 'gable' | 'flat' | 'steep' }

/**
 * The slate a parish pays for.
 *
 * Both civic buildings are roofed in it whatever the country is made of, because that is the one
 * thing a village spends on a public building that it would not spend on a house — and it is what
 * lets you pick the two of them out of a street from above without reading a sign.
 */
const CIVIC_SLATE = { hall: 0x9aa3ad, watch: 0x5a626e } as const;

/**
 * The town hall: a porch of pillars, and a turret too big for the building under it.
 *
 * The turret is deliberate and was arrived at the hard way. Drawn to scale it was a box on a ridge
 * that nobody could pick out at the distance this camera looks from, and a town hall you cannot
 * find from across the square is a town hall nobody visits. A bell-cote, a spire and a banner:
 * three things at three heights, so it reads from every side.
 */
export function townHall(st: HouseStyle): PropPart[] {
  const roofH = st.roofType === 'steep' ? 1.2 : 0.9;
  const ridge = st.roofType === 'flat' ? 2.4 : 2.14 + roofH;
  const roof = CIVIC_SLATE.hall;
  const parts: PropPart[] = [
    box(3.0, 0.24, 3.1, st.trim, [0, 0.12, 0]),
    box(2.6, 1.9, 2.9, st.wall, [-0.15, 1.19, 0]),
    box(0.08, 1.2, 0.8, 0x3a2a1a, [1.16, 0.84, 0]),
    ...HALL_WINDOWS.map(([size, pos]) => box(size[0], size[1], size[2], 0x9fd4ef, pos)),
    // the steps, which are below the height anything walks into and so cost nothing to walk past
    box(0.6, 0.14, 1.8, st.trim, [1.6, 0.07, 0]),
  ];
  for (const z of [-1.0, -0.35, 0.35, 1.0]) {
    parts.push(cyl(0.13, 0.13, 1.8, 6, st.trim, [1.35, 1.14, z]));
  }
  parts.push(box(0.8, 0.22, 2.4, st.trim, [1.35, 2.15, 0]));
  if (st.roofType === 'flat') {
    parts.push(box(3.0, 0.3, 3.3, roof, [-0.15, 2.24, 0]));
    parts.push(box(3.0, 0.26, 0.2, st.trim, [-0.15, 2.5, 1.55]));
    parts.push(box(3.0, 0.26, 0.2, st.trim, [-0.15, 2.5, -1.55]));
  } else {
    parts.push(prism(3.0, roofH, 3.3, roof, [-0.15, 2.14, 0]));
  }
  parts.push(box(0.8, 1.1, 0.8, 0xefe9d8, [-0.15, ridge + 0.35, 0]));
  parts.push(box(0.62, 0.7, 0.06, 0x2a1a10, [-0.15, ridge + 0.4, 0.41]));
  parts.push(box(0.06, 0.7, 0.62, 0x2a1a10, [0.41 - 0.15, ridge + 0.4, 0]));
  parts.push(cone(0.68, 1.0, 4, roof, [-0.15, ridge + 1.4, 0], [1, 1, 1], [0, Math.PI / 4, 0]));
  parts.push(box(0.07, 1.1, 0.07, 0xefe9d8, [-0.15, ridge + 2.4, 0]));
  parts.push(box(0.05, 0.4, 0.7, 0xc0392b, [-0.15, ridge + 2.75, 0.4]));
  return parts;
}

/**
 * The watch house: squat, with a stone lock-up wing proud of the wall and a lamp over the door.
 *
 * The wing is stone whatever the rest is built of, and stands out from the wall rather than being
 * inside it, because a cell you cannot see from the street is a cupboard. The lamp is how anybody
 * finds the place at the hour they usually need it.
 */
export function watchHouse(st: HouseStyle): PropPart[] {
  const parts: PropPart[] = [
    box(2.9, 0.3, 2.8, st.trim, [0, 0.15, 0]),
    box(2.7, 1.6, 2.6, st.wall, [0, 1.1, 0]),
    box(0.08, 1.1, 0.7, 0x2a1a10, [1.36, 0.85, 0]),
    ...WATCH_WINDOWS.map(([size, pos]) => box(size[0], size[1], size[2], 0x9fd4ef, pos)),
    box(1.05, 1.15, 2.7, 0x8f8f8f, [-0.85, 0.875, 0]),
    box(0.06, 0.45, 0.5, 0x2a1a10, [-1.4, 1.1, 0]),
    box(0.32, 0.08, 0.08, 0x3a2a1a, [1.5, 2.0, 0]),
    box(0.22, 0.28, 0.22, 0xf1c40f, [1.62, 1.82, 0]),
    box(0.34, 0.9, 0.34, st.trim, [0.55, 2.35, 0.85]),
  ];
  for (const z of [-0.18, 0, 0.18]) {
    parts.push(box(0.07, 0.47, 0.07, 0x4a4a4a, [-1.42, 1.1, z]));
  }
  if (st.roofType === 'flat') {
    parts.push(box(3.0, 0.3, 2.9, CIVIC_SLATE.watch, [0, 2.0, 0]));
    parts.push(box(3.0, 0.28, 0.2, st.trim, [0, 2.28, 1.35]));
    parts.push(box(3.0, 0.28, 0.2, st.trim, [0, 2.28, -1.35]));
  } else {
    parts.push(prism(3.0, st.roofType === 'steep' ? 1.0 : 0.75, 2.9, CIVIC_SLATE.watch, [0, 1.9, 0]));
  }
  return parts;
}

/** Window glass, blown out a fraction so it can be drawn again unlit and read as a lit window at night. */
export function glazing(windows: WindowSpec[], lift = 0): PropPart[] {
  return windows.map(([size, pos]) =>
    box(size[0] * 1.06, size[1] * 1.06, size[2] * 1.06, 0xffffff, [pos[0], pos[1] + lift, pos[2]]));
}

/**
 * Small cottage on a 3x3 footprint; door faces +x.
 *
 * `storeys` is what a villager who has done well buys with it: the same house with another floor
 * under the same roof, and a second row of windows to say so from a distance.
 */
export function house(st: HouseStyle, storeys = 1): PropPart[] {
  const lift = (storeys - 1) * 1.2;
  const parts: PropPart[] = [
    box(2.6, 0.2, 2.6, st.trim, [0, 0.1, 0]),
    box(2.4, 1.5 + lift, 2.4, st.wall, [0, 0.95 + lift / 2, 0]),
    box(0.08, 0.95, 0.62, 0x3a2a1a, [1.22, 0.68, 0]),
    ...HOUSE_WINDOWS.map(([size, pos]) => box(size[0], size[1], size[2], 0x9fd4ef, pos)),
    box(0.55, 0.16, 0.9, st.trim, [1.5, 0.08, 0]),
  ];
  // an upper row of windows, so the extra floor reads as a floor rather than as a taller box
  if (lift > 0) {
    for (const [size, pos] of HOUSE_WINDOWS) {
      parts.push(box(size[0], size[1], size[2], 0x9fd4ef, [pos[0], pos[1] + lift, pos[2]]));
    }
  }
  if (st.roofType === 'flat') {
    parts.push(box(2.7, 0.3, 2.7, st.roof, [0, 1.85 + lift, 0]));
    parts.push(box(2.7, 0.3, 0.2, st.trim, [0, 2.1 + lift, 1.25]));
    parts.push(box(2.7, 0.3, 0.2, st.trim, [0, 2.1 + lift, -1.25]));
    parts.push(box(0.2, 0.3, 2.7, st.trim, [-1.25, 2.1 + lift, 0]));
  } else {
    const h = st.roofType === 'steep' ? 1.6 : 1.1;
    parts.push(prism(3.0, h, 3.0, st.roof, [0, 1.7 + lift, 0]));
    parts.push(box(0.34, 0.9, 0.34, st.trim, [-0.7, 1.7 + lift + h * 0.55, 0.7]));
  }
  return parts;
}

/** Chapel on a 3x3 footprint: nave with a steep roof, a steeple at the back, door facing +x. */
export function church(st: HouseStyle): PropPart[] {
  const parts: PropPart[] = [
    box(2.7, 0.2, 2.7, st.trim, [0, 0.1, 0]),
    box(2.5, 2.1, 2.2, st.wall, [0.05, 1.25, 0]),
    box(0.08, 1.3, 0.8, 0x3a2a1a, [1.32, 0.85, 0]),
    ...CHURCH_WINDOWS.map(([size, pos]) => box(size[0], size[1], size[2], 0x9fd4ef, pos)),
    box(0.7, 0.16, 1.1, st.trim, [1.6, 0.08, 0]),
    // steeple at the back
    box(1.0, 4.2, 1.0, st.wall, [-0.9, 2.1, 0]),
    cone(0.85, 1.4, 4, st.roof, [-0.9, 4.9, 0], [1, 1, 1], [0, Math.PI / 4, 0]),
    box(0.08, 0.7, 0.08, 0xf1c40f, [-0.9, 5.9, 0]),
    box(0.4, 0.08, 0.08, 0xf1c40f, [-0.9, 6.0, 0]),
    box(0.3, 0.5, 0.08, 0x2a1a10, [-0.9, 3.6, 0.52]),
    box(0.3, 0.5, 0.08, 0x2a1a10, [-0.9, 3.6, -0.52]),
  ];
  if (st.roofType === 'flat') {
    parts.push(box(2.7, 0.3, 2.5, st.roof, [0.15, 2.45, 0]));
  } else {
    parts.push(prism(2.9, 1.5, 2.6, st.roof, [0.15, 2.3, 0]));
  }
  return parts;
}
