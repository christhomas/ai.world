import { box, cone, prism, type PropPart } from './shapes';

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

export interface HouseStyle { wall: number; roof: number; trim: number; roofType: 'gable' | 'flat' | 'steep' }

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
