import { PropKind } from '../world/biomes';
import type { Footprint, Footprints } from '../world/footprints';
import { castleKeep, castleTower, curtainWall, gatehouse } from './castle';
import {
  banner, brazier, brazierFire, chandelier, chandelierFlames, cobweb, greatHearth, hearthFire,
  longTable, portcullis, sarcophagus, stainedGlass, stainedWindow, statue, suitOfArmour, tapestry,
  throne, towerStair,
} from './keep';
import {
  CHURCH_WINDOWS, HALL_WINDOWS, HOUSE_WINDOWS, WATCH_WINDOWS,
  church, glazing, house, townHall, watchHouse, type HouseStyle,
} from './buildings';
import {
  chimney, fountainBasin, fountainDry, fountainMarked, houseFrame, housePegs, houseRoof,
  poolDug, poolLined, poolMarked, storeyRaised, storeyScaffold, storeyTimber,
} from './sites';
import { box, cone, cyl, dodec, footprintOf, ico, prism, type PropPart } from './shapes';

/**
 * Everything that stands on the ground: what it is made of, and how much room it takes up.
 *
 * This was a list of `THREE` primitives, and everything about it was right except where it left
 * the answer to "how big is a house". That answer had to be measured off a mesh, so the only way
 * to know it was to build one — and the world server, which draws nothing and has never opened a
 * canvas, carried a 3D library into its container image for the sake of measuring a cottage.
 *
 * So a prop is now what a creature has always been: a list of parts, plain data, that anything can
 * read. `render/props.ts` turns the parts into geometry and draws them; `box` below falls out of
 * the same numbers with no renderer anywhere near it. The shapes stay in TypeScript rather than
 * going out to `properties/` for the reason `entities/animals.ts` gives about rigs — a shape is
 * read by looking at it, and five hundred boxes written out as JSON would be a worse file than
 * this one and no more editable.
 */

export interface PropDef {
  parts: PropPart[];
  /** The lit parts, drawn again unlit so a window can glow after dark. */
  glow?: PropPart[];
  /**
   * How much ground this takes up, for whoever has to walk round it.
   *
   * Measured off `parts` when the prop is written down, so a prop's box is a property of the prop
   * rather than a row in a table somewhere that has to be kept in step with it — the same bargain
   * a creature's `body` strikes with its rig. Null for the things with nothing in the walking
   * band at all: a rug, a lily pad, a tuft of grass. Nothing else may set it.
   */
  readonly box: Footprint | null;
}

const CATALOGUE = new Map<PropKind, PropDef>();

function prop(kind: PropKind, parts: PropPart[], glow?: PropPart[]): void {
  CATALOGUE.set(kind, glow ? { parts, glow, box: footprintOf(parts) } : { parts, box: footprintOf(parts) });
}

prop(PropKind.Oak, [
  cyl(0.13, 0.19, 1.0, 6, 0x6b4a2b, [0, 0.5, 0]),
  ico(0.82, 1, 0x3f9a3a, [0, 1.5, 0]),
  ico(0.5, 1, 0x4aa844, [0.4, 1.25, 0.25]),
]);
prop(PropKind.Pine, [
  cyl(0.1, 0.16, 0.7, 6, 0x5d3f26, [0, 0.35, 0]),
  cone(0.85, 1.05, 7, 0x2f6b34, [0, 1.05, 0]),
  cone(0.65, 0.95, 7, 0x357a3a, [0, 1.6, 0]),
  cone(0.42, 0.85, 7, 0x3d8a42, [0, 2.15, 0]),
]);
prop(PropKind.SnowPine, [
  cyl(0.1, 0.16, 0.7, 6, 0x4e3a2a, [0, 0.35, 0]),
  cone(0.85, 1.05, 7, 0x4f7f66, [0, 1.05, 0]),
  cone(0.65, 0.95, 7, 0x7fa792, [0, 1.6, 0]),
  cone(0.42, 0.85, 7, 0xe4edf2, [0, 2.15, 0]),
]);
// a slim pale trunk with dark flecks, and a light airy crown: reads as birch at any distance
prop(PropKind.Birch, [
  cyl(0.07, 0.1, 1.6, 6, 0xe8e4d8, [0, 0.8, 0]),
  box(0.11, 0.05, 0.11, 0x4a4438, [0, 1.0, 0]),
  box(0.11, 0.04, 0.11, 0x4a4438, [0, 0.55, 0]),
  ico(0.52, 1, 0x7ab84e, [0, 1.85, 0], [1, 0.9, 1]),
  ico(0.34, 1, 0x8cc75c, [0.26, 1.62, 0.18]),
]);
// taller and narrower than a pine, and darker: a mountain conifer
prop(PropKind.Fir, [
  cyl(0.09, 0.14, 0.6, 6, 0x4a3527, [0, 0.3, 0]),
  cone(0.62, 1.15, 7, 0x24512c, [0, 1.0, 0]),
  cone(0.48, 1.0, 7, 0x2a5c32, [0, 1.65, 0]),
  cone(0.34, 0.9, 7, 0x316838, [0, 2.25, 0]),
  cone(0.2, 0.7, 7, 0x387340, [0, 2.8, 0]),
]);
// the one tree in a wood that stops you: blossom instead of leaves
prop(PropKind.Blossom, [
  cyl(0.12, 0.18, 0.9, 6, 0x6b4a2b, [0, 0.45, 0]),
  ico(0.78, 1, 0xf0a8c4, [0, 1.4, 0], [1, 0.85, 1]),
  ico(0.46, 1, 0xf7c0d6, [0.38, 1.18, 0.22]),
  ico(0.32, 1, 0xe894b4, [-0.3, 1.55, -0.2]),
]);
prop(PropKind.Cactus, [
  cyl(0.2, 0.23, 1.5, 7, 0x4f9b47, [0, 0.75, 0]),
  box(0.42, 0.16, 0.16, 0x4f9b47, [0.3, 0.9, 0]),
  box(0.16, 0.5, 0.16, 0x559f4c, [0.46, 1.15, 0]),
  box(0.38, 0.16, 0.16, 0x4f9b47, [-0.28, 0.65, 0.05]),
  box(0.16, 0.42, 0.16, 0x559f4c, [-0.42, 0.85, 0.05]),
]);
prop(PropKind.Rock, [
  dodec(0.36, 0, 0x8a8a8a, [0, 0.2, 0], [1, 0.65, 1]),
]);
prop(PropKind.Boulder, [
  dodec(0.85, 0, 0x7d7d7d, [0, 0.5, 0], [1.15, 0.8, 1]),
  dodec(0.4, 0, 0x8f8f8f, [0.7, 0.25, 0.3], [1, 0.7, 1]),
]);
prop(PropKind.DeadTree, [
  cyl(0.08, 0.17, 1.4, 5, 0x6d5a48, [0, 0.7, 0]),
  box(0.07, 0.6, 0.07, 0x6d5a48, [0.22, 1.3, 0], [1, 1, 1], [0, 0, -0.7]),
  box(0.06, 0.5, 0.06, 0x6d5a48, [-0.18, 1.1, 0.05], [1, 1, 1], [0, 0, 0.9]),
]);
prop(PropKind.Bush, [
  ico(0.42, 1, 0x4f9a3f, [0, 0.3, 0], [1, 0.75, 1]),
  ico(0.3, 1, 0x58a646, [0.32, 0.24, 0.16], [1, 0.8, 1]),
]);
prop(PropKind.Reed, [
  cyl(0.02, 0.03, 0.9, 4, 0x7fa54a, [0, 0.45, 0], [1, 1, 1], [0, 0, 0.08]),
  cyl(0.02, 0.03, 1.05, 4, 0x8db452, [0.12, 0.52, 0.06], [1, 1, 1], [0.1, 0, -0.06]),
  cyl(0.02, 0.03, 0.8, 4, 0x7fa54a, [-0.1, 0.4, -0.08], [1, 1, 1], [-0.08, 0, 0.12]),
  cyl(0.045, 0.045, 0.18, 5, 0x6b4a2b, [0.12, 1.05, 0.06]),
  cyl(0.045, 0.045, 0.16, 5, 0x6b4a2b, [0, 0.9, 0]),
]);
prop(PropKind.Flower, [
  cyl(0.015, 0.02, 0.32, 4, 0x5f9a3a, [0, 0.16, 0]),
  ico(0.075, 0, 0xf25c6e, [0, 0.35, 0]),
  cyl(0.015, 0.02, 0.26, 4, 0x5f9a3a, [0.18, 0.13, 0.08]),
  ico(0.065, 0, 0xf7d94c, [0.18, 0.29, 0.08]),
  cyl(0.015, 0.02, 0.28, 4, 0x5f9a3a, [-0.14, 0.14, 0.12]),
  ico(0.07, 0, 0xffffff, [-0.14, 0.31, 0.12]),
]);
prop(PropKind.Tuft, [
  cone(0.07, 0.38, 4, 0x8cc457, [0, 0.19, 0], [1, 1, 1], [0.18, 0, 0.1]),
  cone(0.07, 0.42, 4, 0x9ccf5f, [0.1, 0.21, -0.06], [1, 1, 1], [-0.12, 0, -0.18]),
  cone(0.07, 0.34, 4, 0x8cc457, [-0.09, 0.17, 0.07], [1, 1, 1], [0.05, 0, 0.2]),
]);
prop(PropKind.Mushroom, [
  cyl(0.05, 0.07, 0.2, 6, 0xe8dcc0, [0, 0.1, 0]),
  ico(0.16, 0, 0xd23f3f, [0, 0.22, 0], [1, 0.55, 1]),
  cyl(0.035, 0.05, 0.14, 6, 0xe8dcc0, [0.2, 0.07, 0.1]),
  ico(0.11, 0, 0xd8563f, [0.2, 0.15, 0.1], [1, 0.55, 1]),
]);
prop(PropKind.Palm, [
  cyl(0.09, 0.16, 2.3, 6, 0x8a6a3e, [0.1, 1.15, 0], [1, 1, 1], [0, 0, -0.12]),
  ...[0, 1.26, 2.51, 3.77, 5.03].map((a) =>
    box(1.3, 0.04, 0.32, 0x4f9b47, [0.24 + Math.cos(a) * 0.55, 2.2 - 0.12, Math.sin(a) * 0.55], [1, 1, 1], [0, -a, -0.45])),
]);
prop(PropKind.Lily, [
  cyl(0.32, 0.32, 0.03, 7, 0x4f9b47, [0, 0.015, 0]),
  cyl(0.2, 0.2, 0.03, 7, 0x5aa84f, [0.45, 0.015, 0.25]),
  ico(0.08, 0, 0xf49ac1, [0.05, 0.08, 0.02]),
]);

const HOUSE_STYLES: Array<[PropKind, HouseStyle]> = [
  [PropKind.HousePlains, { wall: 0xf1e4c8, roof: 0xa5502f, trim: 0x8a6a4a, roofType: 'gable' }],
  [PropKind.HouseForest, { wall: 0x8a6238, roof: 0x4f6f3a, trim: 0x5a4632, roofType: 'gable' }],
  [PropKind.HouseDesert, { wall: 0xd9b57c, roof: 0xc49a5c, trim: 0xb08a55, roofType: 'flat' }],
  [PropKind.HouseSwamp, { wall: 0x6f5a42, roof: 0x8a7a45, trim: 0x4a3a2a, roofType: 'gable' }],
  [PropKind.HouseMountain, { wall: 0x8f8f8f, roof: 0x4f5a66, trim: 0x6e6e6e, roofType: 'steep' }],
  [PropKind.HouseSnow, { wall: 0x5a4632, roof: 0xf0f4f8, trim: 0x3a2a1a, roofType: 'steep' }],
];
/** How far up the second storey pushes the upper row of windows. */
const STOREY = 1.2;
for (const [kind, style] of HOUSE_STYLES) {
  prop(kind, house(style), glazing(HOUSE_WINDOWS));
  // the same house with another floor in it, for a villager whose trade has gone well
  const tall = kind + (PropKind.TallHousePlains - PropKind.HousePlains);
  prop(tall, house(style, 2), [...glazing(HOUSE_WINDOWS), ...glazing(HOUSE_WINDOWS, STOREY)]);
  const churchKind = kind + (PropKind.ChurchPlains - PropKind.HousePlains);
  prop(churchKind, church(style), glazing(CHURCH_WINDOWS));
  // and the two a village builds for itself once there are enough people to need them, out of the
  // same timber for the same reason a chapel is: what tells them apart is the shape, not the colour
  const hallKind = kind + (PropKind.TownHallPlains - PropKind.HousePlains);
  prop(hallKind, townHall(style), glazing(HALL_WINDOWS));
  const watchKind = kind + (PropKind.WatchHousePlains - PropKind.HousePlains);
  prop(watchKind, watchHouse(style), glazing(WATCH_WINDOWS));
}

// A bath house: low, broad, timber, with a stone stack going up out of it and steam-coloured
// trim. Charged for by whoever built it.
prop(PropKind.Sauna, [
  box(2.6, 0.2, 2.2, 0x6b4a2b, [0, 0.1, 0]),
  box(2.4, 1.1, 2.0, 0x8a6238, [0, 0.75, 0]),
  prism(2.8, 0.7, 2.4, 0x5a4632, [0, 1.5, 0]),
  box(0.45, 1.2, 0.45, 0x8f8f8f, [-0.8, 1.9, 0]),
  box(0.08, 0.8, 0.5, 0x3a2a1a, [1.22, 0.6, 0]),
  box(0.5, 0.12, 1.0, 0xd9cbb0, [1.5, 0.06, 0]),
]);
// And a pool: a sunk stone tank with water in it and a lip to sit on.
prop(PropKind.Pool, [
  box(3.0, 0.24, 2.6, 0xbfae90, [0, 0.12, 0]),
  box(2.4, 0.16, 2.0, 0x2f8fbf, [0, 0.26, 0]),
  box(0.3, 0.34, 2.6, 0xd9cbb0, [1.5, 0.3, 0]),
  box(0.3, 0.34, 2.6, 0xd9cbb0, [-1.5, 0.3, 0]),
  box(3.0, 0.34, 0.3, 0xd9cbb0, [0, 0.3, 1.3]),
  box(3.0, 0.34, 0.3, 0xd9cbb0, [0, 0.3, -1.3]),
]);

prop(PropKind.Well, [
  cyl(0.62, 0.66, 0.7, 8, 0x8a8a8a, [0, 0.35, 0]),
  cyl(0.46, 0.46, 0.72, 8, 0x2a4a6a, [0, 0.36, 0]),
  box(0.1, 1.4, 0.1, 0x6b4a2b, [0, 1.0, 0.5]),
  box(0.1, 1.4, 0.1, 0x6b4a2b, [0, 1.0, -0.5]),
  prism(1.4, 0.5, 1.4, 0xa5502f, [0, 1.7, 0]),
  box(0.06, 0.06, 1.0, 0x3a2a1a, [0, 1.6, 0]),
  cyl(0.12, 0.1, 0.16, 6, 0x5a4632, [0, 1.2, 0]),
]);
prop(PropKind.Shrine, [
  cyl(2.1, 2.1, 0.1, 12, 0xc9c4b4, [0, 0.05, 0]),
  box(0.9, 0.5, 0.9, 0xa8a498, [0, 0.35, 0]),
  ico(0.34, 0, 0x6fd3ff, [0, 1.25, 0], [0.8, 1.3, 0.8]),
  ...Array.from({ length: 6 }, (_, i) => (i / 6) * Math.PI * 2).flatMap((a) => [
    cyl(0.16, 0.2, 1.6, 6, 0xb8b4a8, [Math.cos(a) * 1.7, 0.8, Math.sin(a) * 1.7]),
    box(0.44, 0.16, 0.44, 0xa8a498, [Math.cos(a) * 1.7, 1.68, Math.sin(a) * 1.7]),
  ]),
]);
prop(PropKind.Ruins, [
  box(2.8, 0.12, 2.8, 0x8a8f80, [0, 0.06, 0]),
  box(2.4, 1.3, 0.36, 0x9a9a92, [0, 0.65, -1.1]),
  box(0.36, 0.8, 1.9, 0x9a9a92, [-1.1, 0.4, 0]),
  box(0.36, 1.7, 1.0, 0x9a9a92, [1.1, 0.85, 0.5]),
  box(0.5, 0.5, 0.36, 0x9a9a92, [0.9, 1.55, -1.1]),
  ico(0.26, 0, 0x8a8a8a, [0.3, 0.2, 0.6]),
  ico(0.2, 0, 0x8a8a8a, [-0.5, 0.16, 0.9]),
  ico(0.3, 0, 0x7f8a70, [0.7, 0.22, -0.3], [1, 0.6, 1]),
]);
prop(PropKind.Tower, [
  box(2.2, 0.4, 2.2, 0x7a7a7a, [0, 0.2, 0]),
  box(1.6, 4.6, 1.6, 0x8f8f8f, [0, 2.7, 0]),
  box(2.3, 0.3, 2.3, 0x6e6e6e, [0, 5.15, 0]),
  box(2.3, 0.4, 0.15, 0x7a7a7a, [0, 5.5, 1.08]),
  box(2.3, 0.4, 0.15, 0x7a7a7a, [0, 5.5, -1.08]),
  box(0.15, 0.4, 2.3, 0x7a7a7a, [1.08, 5.5, 0]),
  box(0.15, 0.4, 2.3, 0x7a7a7a, [-1.08, 5.5, 0]),
  cone(1.5, 1.2, 4, 0x4f5a66, [0, 5.9, 0], [1, 1, 1], [0, Math.PI / 4, 0]),
  box(0.1, 1.0, 0.6, 0x2a1a10, [0.82, 0.9, 0]),
  box(0.1, 0.5, 0.2, 0x2a1a10, [0.82, 3.2, 0]),
  box(0.1, 0.5, 0.2, 0x2a1a10, [-0.82, 4.0, 0]),
]);
/*
 * The castle, in its four pieces. Written out in `castle.ts` for the same reason the cottage and
 * the chapel are written out in `buildings.ts`: the four of them together are three hundred parts,
 * which is half this file again, and a keep is a thing somebody will want to open on its own and
 * change the roof of.
 */
prop(PropKind.CastleWall, curtainWall());
prop(PropKind.CastleTower, castleTower());
prop(PropKind.CastleGate, gatehouse());
prop(PropKind.CastleKeep, castleKeep());

prop(PropKind.Campfire, [
  ...[0, 1.57, 3.14, 4.71].map((a) => ico(0.18, 0, 0x7a7a7a, [Math.cos(a) * 0.55, 0.12, Math.sin(a) * 0.55])),
  cyl(0.08, 0.08, 0.9, 5, 0x5a3a22, [0, 0.1, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
  cyl(0.08, 0.08, 0.9, 5, 0x5a3a22, [0, 0.18, 0], [1, 1, 1], [Math.PI / 2, 0, 0]),
  cone(0.26, 0.6, 5, 0xff7a1a, [0, 0.45, 0]),
  cone(0.15, 0.45, 5, 0xffd23a, [0.08, 0.5, 0.05]),
  cyl(0.16, 0.16, 1.3, 6, 0x6b4a2b, [1.1, 0.16, 0.5], [1, 1, 1], [0, 0.6, Math.PI / 2]),
  box(0.6, 0.06, 0.9, 0x8a6a4a, [-1.0, 0.03, -0.6]),
]);
prop(PropKind.GiantTree, [
  cyl(0.55, 0.85, 3.4, 7, 0x5a3f28, [0, 1.7, 0]),
  box(1.2, 0.5, 0.4, 0x5a3f28, [0.8, 0.25, 0.3], [1, 1, 1], [0, 0.4, 0]),
  box(1.2, 0.5, 0.4, 0x5a3f28, [-0.7, 0.25, -0.5], [1, 1, 1], [0, 2.3, 0]),
  box(1.0, 0.5, 0.4, 0x5a3f28, [-0.3, 0.25, 0.8], [1, 1, 1], [0, 4.0, 0]),
  ico(2.5, 1, 0x3f9a3a, [0, 4.4, 0]),
  ico(1.7, 1, 0x4aa844, [1.6, 3.7, 0.9]),
  ico(1.5, 1, 0x3a8f36, [-1.4, 4.0, -0.8]),
  ico(1.3, 1, 0x4aa844, [-0.6, 3.4, 1.5]),
]);

prop(PropKind.Stall, [
  box(1.8, 0.12, 0.9, 0x8a6a4a, [0, 0.8, 0]),
  box(1.7, 0.7, 0.8, 0x6b4a2b, [0, 0.4, 0]),
  box(0.08, 2.0, 0.08, 0x5a4632, [-0.8, 1.0, -0.4]),
  box(0.08, 2.0, 0.08, 0x5a4632, [0.8, 1.0, -0.4]),
  box(0.08, 1.7, 0.08, 0x5a4632, [-0.8, 0.85, 0.5]),
  box(0.08, 1.7, 0.08, 0x5a4632, [0.8, 0.85, 0.5]),
  box(2.0, 0.06, 1.2, 0xd94a4a, [0, 1.85, 0.05], [1, 1, 1], [0.28, 0, 0]),
  ico(0.14, 0, 0xd23f3f, [-0.5, 0.94, 0.1]),
  ico(0.14, 0, 0xf5c542, [-0.2, 0.94, -0.15]),
  ico(0.14, 0, 0x6fae4b, [0.2, 0.94, 0.15]),
  box(0.4, 0.3, 0.3, 0xc9a26a, [0.55, 1.0, 0]),
]);
prop(PropKind.Sign, [
  box(0.08, 1.4, 0.08, 0x5a4632, [0, 0.7, 0]),
  box(0.7, 0.4, 0.06, 0xd9b57c, [0, 1.25, 0]),
  box(0.5, 0.05, 0.08, 0x8a2a2a, [0, 1.3, 0]),
  box(0.35, 0.05, 0.08, 0x8a2a2a, [0, 1.18, 0]),
]);

// One tile of paddock rail. Built along z so that a structure's rotation — which everything
// else here uses to face a door — turns it to lie along its run, and long enough to meet its
// neighbours at the tile edges with nothing to step through between them.
prop(PropKind.Fence, [
  box(0.12, 0.95, 0.12, 0x6b4a2b, [0, 0.48, -0.5]),
  box(0.12, 0.95, 0.12, 0x6b4a2b, [0, 0.48, 0.5]),
  box(0.07, 0.11, 1.0, 0x8a6a3d, [0, 0.78, 0]),
  box(0.07, 0.11, 1.0, 0x8a6a3d, [0, 0.44, 0]),
]);

// dungeon furniture: torch hangs from the wall top and reaches into the room (+x)
prop(PropKind.Torch, [
  box(0.12, 0.5, 0.12, 0x4a3a2a, [0.5, -1.35, 0]),
  box(0.5, 0.08, 0.08, 0x4a3a2a, [0.3, -1.1, 0]),
  cyl(0.05, 0.07, 0.5, 5, 0x6b4a2b, [0.62, -0.95, 0]),
], [
  ico(0.16, 0, 0xffffff, [0.62, -0.62, 0], [0.8, 1.4, 0.8]),
]);
prop(PropKind.Chest, [
  box(0.8, 0.45, 0.6, 0x7a4a24, [0, 0.225, 0]),
  box(0.84, 0.2, 0.64, 0x8a5a2e, [0, 0.55, 0]),
  box(0.86, 0.06, 0.66, 0xc9a24a, [0, 0.46, 0]),
  box(0.12, 0.14, 0.06, 0xc9a24a, [0, 0.5, 0.33]),
]);
prop(PropKind.ChestOpen, [
  box(0.8, 0.45, 0.6, 0x7a4a24, [0, 0.225, 0]),
  box(0.84, 0.2, 0.64, 0x8a5a2e, [0, 0.72, -0.42], [1, 1, 1], [-1.6, 0, 0]),
  box(0.7, 0.1, 0.5, 0xf1c40f, [0, 0.45, 0]),
  ico(0.1, 0, 0xffe066, [0.1, 0.55, 0.05]),
]);
prop(PropKind.Stairs, [
  box(1.2, 1.2, 1.2, 0x2a2a34, [0, 0.6, -0.7]),
  box(1.0, 0.25, 0.4, 0x8f8f8f, [0, 0.125, 0.4]),
  box(1.0, 0.5, 0.4, 0x8f8f8f, [0, 0.25, 0.0]),
  box(1.0, 0.75, 0.4, 0x8f8f8f, [0, 0.375, -0.4]),
  box(0.1, 1.4, 0.1, 0x4a3a2a, [-0.65, 0.7, 0.2]),
  box(0.1, 1.4, 0.1, 0x4a3a2a, [0.65, 0.7, 0.2]),
]);

// --- interior furniture ---
prop(PropKind.Bed, [
  box(0.9, 0.3, 1.9, 0x6b4a2b, [0, 0.25, 0]),
  box(0.94, 0.22, 1.5, 0xe8e0cc, [0, 0.5, 0.15]),
  box(0.9, 0.14, 0.45, 0xc0392b, [0, 0.6, 0.5]),
  box(0.7, 0.16, 0.3, 0xf4f0e6, [0, 0.6, -0.65]),
  box(0.94, 0.7, 0.12, 0x5a3f28, [0, 0.5, -0.95]),
]);
prop(PropKind.Table, [
  box(1.3, 0.12, 1.0, 0x8a6a3d, [0, 0.7, 0]),
  ...([[-0.55, -0.4], [0.55, -0.4], [-0.55, 0.4], [0.55, 0.4]] as const).map(([x, z]) =>
    box(0.12, 0.7, 0.12, 0x6b4a2b, [x, 0.35, z])),
]);
prop(PropKind.Chair, [
  box(0.5, 0.1, 0.5, 0x8a6a3d, [0, 0.45, 0]),
  box(0.12, 0.7, 0.5, 0x6b4a2b, [-0.2, 0.7, 0]),
  ...([[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const).map(([x, z]) =>
    box(0.08, 0.45, 0.08, 0x6b4a2b, [x, 0.22, z])),
]);
prop(PropKind.Hearth, [
  box(1.5, 1.4, 0.7, 0x8a8a8a, [0, 0.7, -0.15]),
  box(0.9, 0.8, 0.5, 0x2a2118, [0, 0.4, 0.16]),
  cone(0.24, 0.5, 5, 0xff7a1a, [0, 0.35, 0.2]),
  cone(0.14, 0.35, 5, 0xffd23a, [0.06, 0.4, 0.24]),
  box(1.7, 0.16, 0.85, 0x9a9a9a, [0, 1.45, -0.15]),
], [
  ico(0.22, 0, 0xffffff, [0, 0.4, 0.22], [1, 1.3, 1]),
]);
prop(PropKind.Shelf, [
  box(0.9, 0.08, 0.35, 0x8a6a3d, [0, 0.5, 0]),
  box(0.9, 0.08, 0.35, 0x8a6a3d, [0, 1.0, 0]),
  box(0.9, 0.08, 0.35, 0x8a6a3d, [0, 1.5, 0]),
  box(0.1, 1.6, 0.35, 0x6b4a2b, [-0.44, 0.8, 0]),
  box(0.1, 1.6, 0.35, 0x6b4a2b, [0.44, 0.8, 0]),
  box(0.16, 0.24, 0.16, 0x6fae4b, [-0.25, 0.66, 0]),
  box(0.16, 0.24, 0.16, 0xd23f3f, [0.05, 1.16, 0]),
  box(0.16, 0.2, 0.16, 0xf5c542, [0.28, 1.62, 0]),
]);
prop(PropKind.Barrel, [
  cyl(0.34, 0.3, 0.8, 8, 0x8a6a3d, [0, 0.4, 0]),
  cyl(0.36, 0.36, 0.08, 8, 0x5a4632, [0, 0.6, 0]),
  cyl(0.36, 0.36, 0.08, 8, 0x5a4632, [0, 0.2, 0]),
  cyl(0.3, 0.3, 0.06, 8, 0x6b4a2b, [0, 0.83, 0]),
]);
prop(PropKind.Crate, [
  box(0.7, 0.7, 0.7, 0x9a7a4d, [0, 0.35, 0]),
  box(0.74, 0.08, 0.08, 0x6b4a2b, [0, 0.55, 0.34]),
  box(0.74, 0.08, 0.08, 0x6b4a2b, [0, 0.15, 0.34]),
]);
prop(PropKind.Forge, [
  box(1.4, 1.0, 1.0, 0x6e6e6e, [0, 0.5, 0]),
  box(0.9, 0.5, 0.7, 0x2a2118, [0, 0.75, 0.2]),
  cone(0.3, 0.6, 5, 0xff5a1a, [0, 0.9, 0.2]),
  cyl(0.24, 0.3, 1.6, 6, 0x555555, [0, 1.8, -0.2]),
], [
  ico(0.26, 0, 0xffffff, [0, 0.95, 0.2], [1, 1.2, 1]),
]);
prop(PropKind.Anvil, [
  box(0.5, 0.4, 0.5, 0x5a3f28, [0, 0.2, 0]),
  box(0.75, 0.22, 0.34, 0x4a4a52, [0, 0.5, 0]),
  box(0.3, 0.16, 0.3, 0x4a4a52, [0, 0.34, 0]),
  cone(0.14, 0.36, 4, 0x4a4a52, [0.45, 0.5, 0], [1, 1, 1], [0, 0, -Math.PI / 2]),
]);
prop(PropKind.WeaponRack, [
  box(0.16, 1.6, 0.16, 0x6b4a2b, [-0.5, 0.8, 0]),
  box(0.16, 1.6, 0.16, 0x6b4a2b, [0.5, 0.8, 0]),
  box(1.2, 0.12, 0.16, 0x6b4a2b, [0, 1.5, 0]),
  box(0.1, 1.0, 0.1, 0xb8b8c0, [-0.28, 0.9, 0.06]),
  box(0.28, 0.1, 0.1, 0x8a6a3d, [-0.28, 1.3, 0.06]),
  box(0.1, 1.1, 0.1, 0xb8b8c0, [0.1, 0.95, 0.06]),
  box(0.5, 0.5, 0.08, 0x8a6a3d, [0.38, 0.9, 0.06]),
]);
prop(PropKind.Cauldron, [
  cyl(0.42, 0.32, 0.5, 8, 0x3a3a42, [0, 0.45, 0]),
  cyl(0.36, 0.36, 0.06, 8, 0x6fae4b, [0, 0.68, 0]),
  ...[0, 2.1, 4.2].map((a) => box(0.08, 0.3, 0.08, 0x3a3a42, [Math.cos(a) * 0.3, 0.15, Math.sin(a) * 0.3])),
  cone(0.2, 0.3, 5, 0xff7a1a, [0, 0.15, 0]),
], [
  cyl(0.3, 0.3, 0.06, 8, 0xffffff, [0, 0.7, 0]),
]);
prop(PropKind.Altar, [
  box(1.6, 0.9, 0.8, 0xd8d2c0, [0, 0.45, 0]),
  box(1.8, 0.14, 0.94, 0xefe9d8, [0, 0.95, 0]),
  box(0.12, 0.7, 0.12, 0xf1c40f, [0, 1.35, 0]),
  box(0.5, 0.12, 0.12, 0xf1c40f, [0, 1.45, 0]),
]);
prop(PropKind.Pew, [
  box(1.8, 0.14, 0.4, 0x8a6a3d, [0, 0.45, 0]),
  box(1.8, 0.6, 0.12, 0x6b4a2b, [0, 0.7, -0.2]),
  box(0.14, 0.45, 0.4, 0x6b4a2b, [-0.8, 0.22, 0]),
  box(0.14, 0.45, 0.4, 0x6b4a2b, [0.8, 0.22, 0]),
]);
/**
 * One tile of cell bars, standing across the width of a tile.
 *
 * A run of them is what makes the corner of a watch house a lock-up rather than a corner: they were
 * placed by the interior generator and drawn by nothing at all, so the cell was an ordinary bit of
 * floor with a bed in it that you could not walk into for reasons the room never showed you.
 *
 * Iron, thin, and floor to lintel, with a rail top and bottom so a run of them reads as one thing
 * from across the room rather than as a row of separate posts.
 */
prop(PropKind.Bars, [
  box(0.9, 0.07, 0.07, 0x4a4a4a, [0, 0.06, 0]),
  box(0.9, 0.07, 0.07, 0x4a4a4a, [0, 1.9, 0]),
  box(0.06, 1.9, 0.06, 0x55555b, [-0.34, 0.95, 0]),
  box(0.06, 1.9, 0.06, 0x55555b, [-0.11, 0.95, 0]),
  box(0.06, 1.9, 0.06, 0x55555b, [0.11, 0.95, 0]),
  box(0.06, 1.9, 0.06, 0x55555b, [0.34, 0.95, 0]),
]);
prop(PropKind.Candle, [
  cyl(0.12, 0.16, 0.9, 6, 0xb8a878, [0, 0.45, 0]),
  cyl(0.08, 0.08, 0.3, 6, 0xf4efdc, [0, 1.05, 0]),
], [
  ico(0.1, 0, 0xffffff, [0, 1.28, 0], [0.7, 1.4, 0.7]),
]);
prop(PropKind.Rug, [
  box(1.9, 0.04, 1.2, 0x8a3a3a, [0, 0.02, 0]),
  box(1.6, 0.05, 0.9, 0xc0603a, [0, 0.03, 0]),
]);

prop(PropKind.CaveMouth, [
  dodec(1.5, 0, 0x6e6e6e, [-0.5, 0.7, 0], [1, 1.1, 1.3]),
  dodec(1.1, 0, 0x7a7a7a, [0.1, 0.5, 1.3], [1, 1, 1]),
  dodec(1.1, 0, 0x7a7a7a, [0.1, 0.5, -1.3], [1, 1, 1]),
  box(0.9, 1.5, 1.5, 0x0a0a10, [0.85, 0.75, 0]),
  ico(0.35, 0, 0x8a8a8a, [1.3, 0.2, 1.0]),
  ico(0.28, 0, 0x8a8a8a, [1.4, 0.16, -0.8]),
]);
prop(PropKind.Shipwreck, [
  box(4.2, 0.9, 1.8, 0x5a3f28, [0, 0.45, 0], [1, 1, 1], [0.18, 0, 0.12]),
  box(1.4, 1.1, 1.5, 0x6b4a2b, [-1.8, 0.7, 0], [1, 1, 1], [0, 0, 0.3]),
  box(0.16, 0.9, 1.7, 0x4a3222, [1.6, 0.9, 0]),
  box(0.14, 0.8, 1.6, 0x4a3222, [0.4, 1.0, 0], [1, 1, 1], [0, 0, -0.2]),
  cyl(0.12, 0.16, 3.4, 6, 0x5a3f28, [-0.4, 1.6, 0], [1, 1, 1], [0, 0, 0.7]),
  box(0.06, 1.2, 1.1, 0xd8d0bc, [-1.4, 1.9, 0], [1, 1, 1], [0, 0, 0.7]),
  ico(0.3, 0, 0x8a8a8a, [2.2, 0.15, 0.7]),
]);

/*
 * The derelict: something that came down here, a long time before anybody was watching.
 *
 * It reads as wrong on purpose. Everything else in this country is timber, thatch, stone and
 * canvas in the colours those come in; this is one smooth grey shell, a canopy the wrong colour for
 * glass, and a light on it that has not gone out. Nothing else in the world is that shape, which is
 * the whole of how a player knows to walk over and press Enter.
 *
 * Tilted, because it landed badly: the hull sits nose-down with one fin buried and the other still
 * up, and the ground around it is scorched — `landmarks.ts` puts it on open ground for that reason,
 * so the shape is not lost against a cliff.
 */
prop(PropKind.Derelict, [
  box(4.6, 1.1, 2.4, 0x8f97a3, [0, 0.7, 0], [1, 1, 1], [0, 0, -0.14]),
  box(2.6, 0.7, 1.9, 0x9aa3b0, [0.6, 1.35, 0], [1, 1, 1], [0, 0, -0.14]),
  box(1.5, 0.45, 1.2, 0x2f5d6d, [1.1, 1.75, 0], [1, 1, 1], [0, 0, -0.14]),
  box(2.2, 0.14, 0.9, 0x79818c, [-1.4, 0.9, 1.3], [1, 1, 1], [0.35, 0, -0.1]),
  box(2.2, 0.14, 0.9, 0x79818c, [-1.4, 0.55, -1.3], [1, 1, 1], [-0.2, 0, -0.1]),
  box(0.5, 1.3, 0.12, 0x6f7681, [-2.0, 1.2, 0], [1, 1, 1], [0, 0, -0.5]),
  cyl(0.34, 0.34, 0.5, 8, 0x3a3f47, [-2.3, 0.7, 0], [1, 1, 1], [0, 0, 1.57]),
  ico(0.18, 0, 0x7fe0c8, [1.9, 1.55, 0]),
  ico(0.22, 0, 0x2a2a2a, [2.6, 0.2, 0.9]),
  ico(0.18, 0, 0x2a2a2a, [-2.9, 0.16, -0.7]),
]);

// three stages of growth, shown on any planted square
prop(PropKind.Seedling, [
  box(0.9, 0.06, 0.9, 0x6b4a2b, [0, 0.03, 0]),
  cone(0.05, 0.16, 4, 0x7fc04a, [-0.2, 0.1, -0.2]),
  cone(0.05, 0.16, 4, 0x7fc04a, [0.2, 0.1, 0.15]),
  cone(0.05, 0.16, 4, 0x7fc04a, [0.05, 0.1, -0.05]),
]);
prop(PropKind.CropYoung, [
  box(0.9, 0.06, 0.9, 0x6b4a2b, [0, 0.03, 0]),
  ...([[-0.22, -0.2], [0.22, 0.16], [0.02, -0.04], [-0.18, 0.22]] as const).map(([x, z]) =>
    cone(0.09, 0.4, 5, 0x66b23f, [x, 0.22, z])),
]);
prop(PropKind.CropRipe, [
  box(0.9, 0.06, 0.9, 0x6b4a2b, [0, 0.03, 0]),
  ...([[-0.22, -0.2], [0.22, 0.16], [0.02, -0.04], [-0.18, 0.22]] as const).map(([x, z]) =>
    cone(0.12, 0.7, 5, 0xd8b73a, [x, 0.38, z])),
  ico(0.13, 0, 0xe8c94a, [0.02, 0.74, -0.04]),
]);

/**
 * Everything a builder can be told to put up, in every state it stands in before it is finished.
 *
 * The shapes are in `sites.ts`, which explains why each kind is shown the way it is; this is only
 * the list of numbers they are drawn under. A house is four states, and the pool, the fountain and
 * the second storey are three apiece plus whatever they leave behind on the last morning — a pool,
 * a fountain, and a cottage a floor taller.
 *
 * The finished house is `buildings.ts`'s cottage with a stone chimney on it, because the one house
 * in the world that is yours should be findable from the ridge without opening the map, and it
 * grows with the roof it comes out of when a storey goes under it.
 */
{
  const yours = { wall: 0xf1e4c8, roof: 0x7d5a3a, trim: 0x6b4a2b, roofType: 'gable' } as const;
  prop(PropKind.HousePegs, housePegs);
  prop(PropKind.HouseFrame, houseFrame);
  prop(PropKind.HouseRoof, houseRoof);
  prop(PropKind.HouseYours, [...house(yours), ...chimney()], glazing(HOUSE_WINDOWS));
  prop(PropKind.HouseYoursTwo, [...house(yours, 2), ...chimney(2)], glazing(HOUSE_WINDOWS));
  prop(PropKind.PoolMarked, poolMarked);
  prop(PropKind.PoolDug, poolDug);
  prop(PropKind.PoolLined, poolLined);
  prop(PropKind.FountainMarked, fountainMarked);
  prop(PropKind.FountainBasin, fountainBasin);
  prop(PropKind.FountainDry, fountainDry);
  prop(PropKind.StoreyTimber, storeyTimber);
  prop(PropKind.StoreyScaffold, storeyScaffold);
  prop(PropKind.StoreyRaised, storeyRaised);
}

/*
 * A fountain: a stone basin, a standing column and water falling back into it.
 *
 * Small on purpose — it stands in the yard of a house rather than in a square — and built out of
 * the same handful of shapes as the well, because the two are the same idea and a fountain that
 * looked like it came from another game would be the thing you noticed about the house.
 */
prop(PropKind.Fountain, [
  cyl(1.05, 1.15, 0.34, 10, 0x9a9a92, [0, 0.17, 0]),
  cyl(0.92, 0.92, 0.1, 10, 0x2f8fbf, [0, 0.36, 0]),
  cyl(0.2, 0.26, 0.9, 8, 0xb4b4aa, [0, 0.75, 0]),
  cyl(0.42, 0.1, 0.16, 10, 0xb4b4aa, [0, 1.24, 0]),
  cyl(0.09, 0.09, 0.34, 6, 0x7fc8e4, [0, 1.45, 0]),
]);

prop(PropKind.NoticeBoard, [
  box(0.12, 1.3, 0.12, 0x6b4a2b, [0, 0.65, -0.6]),
  box(0.12, 1.3, 0.12, 0x6b4a2b, [0, 0.65, 0.6]),
  box(0.1, 1.0, 1.5, 0x8a6a3d, [0, 1.35, 0]),
  box(0.13, 1.1, 1.6, 0x5a4632, [-0.02, 1.35, 0]),
  box(0.06, 0.3, 0.24, 0xf4efdc, [0.07, 1.55, -0.35]),
  box(0.06, 0.26, 0.2, 0xe8e0cc, [0.07, 1.2, 0.1]),
  box(0.06, 0.22, 0.26, 0xf4efdc, [0.07, 1.5, 0.42]),
  prism(1.8, 0.35, 0.6, 0xa5502f, [0, 1.9, 0]),
]);

prop(PropKind.Signpost, [
  cyl(0.09, 0.11, 2.0, 6, 0x6b4a2b, [0, 1.0, 0]),
  box(0.9, 0.22, 0.06, 0xd9b57c, [0.35, 1.72, 0], [1, 1, 1], [0, 0, 0.04]),
  box(0.8, 0.2, 0.06, 0xcfa96f, [-0.3, 1.42, 0], [1, 1, 1], [0, Math.PI, -0.04]),
  box(0.7, 0.18, 0.06, 0xd9b57c, [0.1, 1.12, 0], [1, 1, 1], [0, Math.PI / 2, 0.03]),
  ico(0.12, 0, 0x8a6a3d, [0, 2.05, 0]),
]);

// a hole in the floor with steps going down: the way deeper in
prop(PropKind.Descent, [
  box(1.5, 0.16, 1.5, 0x4a4a52, [0, 0.08, 0]),
  box(1.1, 0.5, 1.1, 0x07070c, [0, -0.2, 0]),
  box(1.0, 0.1, 0.3, 0x8f8f8f, [0, -0.02, 0.4]),
  box(1.0, 0.1, 0.3, 0x7f7f7f, [0, -0.16, 0.1]),
  box(1.0, 0.1, 0.3, 0x6f6f6f, [0, -0.3, -0.2]),
  box(0.12, 0.9, 0.12, 0x5a4632, [-0.65, 0.5, 0.6]),
  box(0.12, 0.9, 0.12, 0x5a4632, [0.65, 0.5, 0.6]),
]);

prop(PropKind.Door, [
  box(0.2, 2.2, 0.2, 0x5a4632, [0, 1.1, 0.6]),
  box(0.2, 2.2, 0.2, 0x5a4632, [0, 1.1, -0.6]),
  box(0.24, 0.2, 1.4, 0x5a4632, [0, 2.1, 0]),
  box(0.14, 1.9, 1.0, 0x6b4a2b, [0, 0.95, 0]),
  box(0.18, 0.12, 1.0, 0x9a8a6a, [0, 1.5, 0]),
  box(0.18, 0.12, 1.0, 0x9a8a6a, [0, 0.6, 0]),
  ico(0.12, 0, 0xf1c40f, [0.1, 1.05, 0]),
]);

prop(PropKind.Willow, [
  cyl(0.15, 0.23, 1.2, 6, 0x5a4632, [0, 0.6, 0]),
  ico(1.05, 1, 0x6a9a3c, [0, 1.45, 0], [1, 0.55, 1]),
  ico(0.65, 1, 0x5f8c36, [0, 1.0, 0], [1.05, 0.9, 1.05]),
]);

/*
 * And what a keep is furnished with, out of `keep.ts` for the reason the castle itself is out of
 * `castle.ts`: this file is already every prop in the world, and a hall's furniture is a thing
 * somebody will want to open on its own.
 *
 * Four of them burn or glow, so they are given a lit list as well — the same arrangement a torch
 * and a lit window have, where the bright parts are drawn a second time unlit so that they go on
 * showing when the room round them has gone dark.
 */
prop(PropKind.Throne, throne());
prop(PropKind.LongTable, longTable());
prop(PropKind.GreatHearth, greatHearth(), hearthFire());
prop(PropKind.Banner, banner());
prop(PropKind.Tapestry, tapestry());
prop(PropKind.SuitOfArmour, suitOfArmour());
prop(PropKind.Brazier, brazier(), brazierFire());
prop(PropKind.Chandelier, chandelier(), chandelierFlames());
prop(PropKind.Portcullis, portcullis());
prop(PropKind.Statue, statue());
prop(PropKind.TowerStair, towerStair());
prop(PropKind.Cobweb, cobweb());
prop(PropKind.Sarcophagus, sarcophagus());
prop(PropKind.StainedWindow, stainedWindow(), stainedGlass());

/** Every prop in the game, in the order they were written down. */
export const PROPS: ReadonlyMap<PropKind, PropDef> = CATALOGUE;

/**
 * The boxes alone, for the halves of the game that walk things about without drawing them.
 *
 * The server owns where every hero and creature is standing and has never built a mesh. It used to
 * get these by building every prop in the game at boot, measuring the meshes and throwing them
 * away — twenty milliseconds, five megabytes, and a 3D library in a container that had no other
 * use for one. Now it reads the same numbers the catalogue above worked out for itself.
 *
 * A prop with nothing in the walking band — a rug, a lily pad — answers `undefined` here, which is
 * the same answer it gave when there was nothing to measure. Whether a box *stops* anybody is a
 * separate question with a different answer indoors and out; see `blocking` in `world/footprints`.
 */
export function propFootprints(): Footprints {
  return { get: (kind: PropKind): Footprint | undefined => CATALOGUE.get(kind)?.box ?? undefined };
}
