import { box, cone, cyl, type PropPart } from './shapes';

/**
 * The castle, in the four pieces it is built out of.
 *
 * Everything else in this world is one prop standing on one tile. A castle cannot be: a single
 * prop's footprint is a single box, and a castle drawn as one box is a thirteen-tile slab you
 * cannot see over, cannot walk beside, and cannot approach the gate of — the whole thing would
 * stop you a stride out from the moat and never let you nearer. Worse, the collision bench walks
 * everything in the game at everything solid from five tiles out, and a box that wide has the
 * walker starting inside it.
 *
 * So a castle is laid out the way a paddock is: a run of pieces, each its own structure on its own
 * tile, each measured off its own parts. `world/castles.ts` decides where the pieces go; this says
 * what each one is made of. The four are the whole vocabulary — a curtain wall by the tile, a drum
 * tower for the corners and the mid-points, the gatehouse you go in by, and the keep, which is the
 * tallest thing anybody has built in this world by a factor of three.
 *
 * Scale is the point of all of it. A cottage is 2.5 tiles across the walls and 3.1 to the chimney;
 * a chapel is 6.25 to its finial. The curtain wall alone is 6.1 — a whole church of blank stone,
 * repeated forty times round a ward — the towers are 15.3, and the keep is 22. Judged by looking
 * rather than by arithmetic: from the height this camera sits at, a keep that only doubled the
 * chapel read as a slightly big house, and the number that finally made it read as a castle was
 * the one where the banner cleared the top of the screen on approach.
 */

/**
 * The castle's palette: pale dressed limestone, not the grey of an outcrop.
 *
 * Deliberately not the greys the tower and the ruins are drawn in (0x8f8f8f and its neighbours).
 * Those are the colour of the rock the highlands are made of, which is right for something that
 * has half fallen back into the hillside — and wrong for this, which has to read as *built* from
 * across a valley, sitting on ground the same colour as the cliffs behind it. Warm ashlar against
 * cold rock is the whole of what tells them apart at that distance.
 */
const STONE = {
  /** Ashlar in the sun: every wall face. */
  face: 0xc4bcaa,
  /** The same stone in shadow: string courses, corbels, lintels, the dressed edges. */
  shade: 0xa89f8c,
  /** The battered footing everything stands on, darker for being wet half the year. */
  plinth: 0x8c8474,
  /** Every roof and cap, which are the one thing here that is not stone. */
  slate: 0x46505c,
  /** Arrow loops, the gate passage, a window with nobody behind it. */
  slit: 0x241d18,
  /** Iron: the portcullis and the pole a banner hangs off. */
  iron: 0x5a5852,
  banner: 0x8e2f3a,
  gold: 0xe0b43c,
} as const;

/**
 * Where the walking band starts, and why every plinth here stops a hair short of it.
 *
 * A prop's footprint is measured off whatever reaches between mid-shin and chest — see
 * `WALKING_BAND` in `world/footprints.ts`. A battered footing is something you step onto, not
 * something you walk into, and a castle has a great deal of footing: left at three tenths of a
 * tile the plinths would be what the whole castle collided as, and every wall in it would stop you
 * a hand's breadth further out than the stone you can see. So they are all 0.28, which is under
 * the band by a whisker, and the wall above is what stops you.
 */
const PLINTH = 0.28;

/**
 * A wall face cut into courses of blocks, instead of one slab of colour.
 *
 * Every wall in this castle was a single box five metres tall, which from the ridge reads as a
 * cardboard model of a castle rather than as masonry: a castle is *built*, and the one thing that
 * says so is that you can see what it was built out of. There are no textures in this world and
 * there should not be — the whole look is flat colour on honest geometry — so the blocks have to
 * be geometry, the same way the miner's hard hat has a moulded rib rather than a picture of one.
 *
 * Each block stands a hair proud of the wall behind it and is shaded a little off the wall's own
 * colour, so the joints are real shadow rather than drawn lines. The stagger is what makes it read
 * as a wall rather than as a grid: alternate courses start half a block along, so the vertical
 * joints break instead of running the full height. That is what a mason does, and the eye knows
 * it without being told.
 *
 * The shade of each block is fixed by where it sits in the wall rather than rolled, because every
 * curtain wall in the world is the same instanced geometry — a roll would give one pattern to all
 * forty of them anyway, and a fixed pattern at least cannot flicker.
 */
function coursed(
  along: 'x' | 'z', length: number, height: number, thickness: number, colour: number,
  at: [number, number, number], courses: number, across: number,
): PropPart[] {
  const out: PropPart[] = [];
  const tall = height / courses;
  // how far a block stands out of its wall. Small: at this camera a millimetre of relief is a
  // shadow line, and any more turns a wall into a stack of crates
  const PROUD = 0.05;
  for (let c = 0; c < courses; c++) {
    const y = at[1] - height / 2 + tall * (c + 0.5);
    // half a block along on alternate courses, with the half-blocks at the ends of those courses
    // making up the difference — a broken joint is the whole point of a course
    const shift = c % 2 === 1 ? 0.5 : 0;
    const edges = [0];
    for (let b = 1; b < across + (shift ? 1 : 0); b++) {
      const u = (b - shift) / across;
      if (u > 1e-6 && u < 1 - 1e-6) edges.push(u);
    }
    edges.push(1);
    for (let b = 0; b + 1 < edges.length; b++) {
      const u0 = edges[b], u1 = edges[b + 1];
      const wide = (u1 - u0) * length - JOINT;
      const mid = -length / 2 + ((u0 + u1) / 2) * length;
      // a quiet spread: a built wall is one stone cut by one mason, so what varies is weathering
      const shade = 0.90 + ((c * 7 + b * 3) % 5) * 0.05;
      const stone = tint(colour, shade);
      const deep = thickness + PROUD;
      out.push(along === 'x'
        ? box(wide, tall - JOINT, deep, stone, [at[0] + mid, y, at[2]])
        : box(deep, tall - JOINT, wide, stone, [at[0], y, at[2] + mid]));
    }
  }
  return out;
}

/** How wide the mortar joint between two blocks is. A hair: any more and the wall reads as brick. */
const JOINT = 0.04;

/** The same colour, lighter or darker, kept as a whole number the way every other colour here is. */
function tint(colour: number, by: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * by)));
  return (clamp((colour >> 16) & 0xff) << 16) | (clamp((colour >> 8) & 0xff) << 8) | clamp(colour & 0xff);
}

/**
 * One tile of curtain wall, built along z so that a structure's rotation lays it along its run.
 *
 * Exactly the bargain `Fence` strikes, and for the same reason: a wall that came in fixed lengths
 * would have to be cut at every corner and either side of every gate, and a ward would only ever
 * be a size that divided by the length. A tile at a time fits any ward and meets its neighbours at
 * the tile edges with nothing to step through — the wall box is a full tile deep, so a run of them
 * is one unbroken face rather than a row of posts with daylight between.
 *
 * The merlons are two to the tile rather than three. Three left a four-hundredth of a tile between
 * one tile's last merlon and the next tile's first, which at this camera is no gap at all and the
 * battlements read as a plain parapet; two gives a gap the same size either side of the tile join,
 * so the rhythm carries across the seam and the wall reads as crenellated from the ridge.
 */
export function curtainWall(): PropPart[] {
  return [
    box(1.34, PLINTH, 1.04, STONE.plinth, [0, PLINTH / 2, 0]),
    // the wall itself, and then the same wall laid up in blocks. The slab behind stays: it is what
    // the arrow loop is cut through and what keeps the face solid where the courses break
    box(1.10, 5.00, 1.00, STONE.face, [0, PLINTH + 2.50, 0]),
    // along z, because that is the way a wall tile runs before its structure turns it: five courses
    // of a metre, two blocks to the tile, which at this camera is a block about the size of a door
    ...coursed('z', 1.00, 5.00, 1.10, STONE.face, [0, PLINTH + 2.50, 0], 5, 2),
    // an arrow loop cut clean through, so it is dark from both sides of the wall
    box(1.16, 1.00, 0.16, STONE.slit, [0, 3.10, 0]),
    box(1.32, 0.24, 1.16, STONE.shade, [0, 5.40, 0]),
    ...[-0.25, 0.25].map((z) => box(1.26, 0.60, 0.34, STONE.face, [0, 5.82, z])),
  ];
}

/**
 * A drum tower: the corners of the ward, and the middle of every side that has no gate in it.
 *
 * Round rather than square because that is what tells a castle from a keep at a glance, and
 * because a run of straight wall wants something to turn on. Eight-sided, like everything round in
 * this world — the game draws nothing smoother, and a footprint measured off eight faces is the
 * shape you actually walk into rather than the circle it stands in for.
 *
 * The flare below the parapet is machicolation, and it is worth its five faces: it is the one
 * detail that says "you could drop something on somebody from up there", and without it the tower
 * is a chimney.
 */
export function castleTower(): PropPart[] {
  return [
    cyl(1.80, 1.96, PLINTH, 8, STONE.plinth, [0, PLINTH / 2, 0]),
    cyl(1.52, 1.72, 9.00, 8, STONE.face, [0, PLINTH + 4.50, 0]),
    /*
     * String courses up the drum, so a tower is laid in stone like the wall beside it.
     *
     * Rings rather than blocks, and that is the difference between a round wall and a straight one
     * rather than a shortcut. A drum tower is eight faces wide and its stones run round it, so what
     * you see from any one side is three or four of them: the joints that read at this distance are
     * the horizontal ones. Laying individual blocks on a curve would be nine rings of eight stones
     * apiece for detail nobody can resolve, and would leave the corners of the octagon fighting
     * each other for the same pixels.
     *
     * Each ring stands a hair proud of the shaft and is shaded a little darker, so it is a shadow
     * line rather than a drawn one — the same trick the curtain wall's blocks use, and the reason
     * both read as built rather than printed.
     */
    ...Array.from({ length: 8 }, (_, n) => {
      const y = PLINTH + 1.0 + n * 1.0;
      // the shaft tapers, so a ring has to taper with it or it stands proud at the foot and sinks
      // in at the head — measured off the same 1.72-to-1.52 batter the shaft is cut with
      const at = (y - PLINTH) / 9.0;
      const r = 1.72 + (1.52 - 1.72) * at;
      return cyl(r + 0.07, r + 0.07, 0.16, 8, STONE.shade, [0, y, 0]);
    }),
    /*
     * Three loops up the shaft, each turned onto a different face, as the stair inside would put
     * them. A loop is one thin box driven clean through the tower, so it shows on the far side as
     * well and costs two faces rather than eight.
     *
     * The turns are odd numbers of eighths of a half-turn because that is where the faces are: an
     * eight-sided cylinder built by `ring` has a *corner* facing +x, so a slit at no turn at all
     * lands on the join between two faces and draws as two thin lines with a fold between them,
     * which is what the first version did.
     */
    ...[[2.6, 0.3927], [5.0, 1.1781], [7.4, 1.9635]].map(([y, turn]) =>
      box(3.05, 0.95, 0.16, STONE.slit, [0, y, 0], [1, 1, 1], [0, turn, 0])),
    cyl(1.94, 1.56, 0.56, 8, STONE.shade, [0, 9.56, 0]),
    cyl(1.94, 1.94, 0.80, 8, STONE.face, [0, 10.24, 0]),
    ...Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2).map((a) =>
      box(0.46, 0.66, 0.46, STONE.face, [Math.sin(a) * 1.66, 10.97, Math.cos(a) * 1.66], [1, 1, 1], [0, -a, 0])),
    cone(1.78, 3.40, 8, STONE.slate, [0, 12.34, 0]),
    box(0.10, 1.30, 0.10, STONE.iron, [0, 14.69, 0]),
    box(0.06, 0.46, 0.72, STONE.banner, [0, 14.86, 0.36]),
  ];
}

/**
 * The gatehouse, which is the door. It faces +x, like every other door in this game.
 *
 * Solid, and meant to be. A castle you could stroll into the yard of would want the yard modelled,
 * peopled and lit, and the yard is not what is on the other side of this — the inside of a castle
 * is a dungeon anchor, the way the inside of a cave is. So the gatehouse behaves exactly as a cave
 * mouth behaves: you walk up to it and it takes you somewhere else. The archway is drawn dark and
 * the portcullis is drawn half down, which between them say "shut" without a sign saying so.
 *
 * The stair turret is on one flank and the banner on the other. Symmetry was tried first and was
 * the worse building: two identical towers with a hole between them reads as a wall with a gap in
 * it, and the moment one side went up and the other grew a flag it read as a gate.
 *
 * The flanking towers are deeper than the block they hold between them, and stand a wall's height
 * above it. Flush and level was the first version and it read as one tower with a door in it —
 * from this camera, what makes a gatehouse a gatehouse is a notch in its own skyline.
 */
export function gatehouse(): PropPart[] {
  const flanks = [1.40, -1.40];
  return [
    box(3.40, PLINTH, 4.50, STONE.plinth, [0, PLINTH / 2, 0]),
    ...flanks.map((z) => box(3.00, 10.20, 1.50, STONE.face, [0, PLINTH + 5.10, z])),
    // the passage: dark the whole depth of the gatehouse, with the arch stone over it
    box(2.46, 3.60, 1.32, STONE.slit, [0, PLINTH + 1.80, 0]),
    box(2.54, 0.42, 1.52, STONE.shade, [0, 4.09, 0]),
    box(2.40, 4.60, 1.32, STONE.face, [0, 6.60, 0]),
    box(0.16, 0.66, 0.52, STONE.gold, [1.26, 5.10, 0]),
    ...[0.42, -0.42].map((z) => box(2.46, 0.90, 0.18, STONE.slit, [0, 7.10, z])),
    // the portcullis, down far enough to mean it
    ...[-0.44, -0.22, 0, 0.22, 0.44].map((z) => box(0.10, 2.80, 0.10, STONE.iron, [1.18, 1.68, z])),
    box(0.12, 0.12, 1.02, STONE.iron, [1.18, 3.04, 0]),
    box(0.12, 0.12, 1.02, STONE.iron, [1.18, 1.14, 0]),
    // machicolations over whoever is stood at the door
    ...[-0.48, -0.16, 0.16, 0.48].map((z) => box(0.34, 0.54, 0.26, STONE.shade, [1.44, 8.60, z])),
    box(2.60, 0.60, 1.52, STONE.shade, [0, 9.20, 0]),
    ...[1.16, -1.16].flatMap((x) =>
      [-0.36, 0.36].map((z) => box(0.40, 0.58, 0.40, STONE.face, [x, 9.79, z]))),
    // each flanking tower gets its own parapet and battlements
    ...flanks.map((z) => box(3.36, 0.28, 1.86, STONE.shade, [0, 10.62, z])),
    ...flanks.flatMap((z) => [
      ...[-0.50, 0, 0.50].flatMap((along) => [
        box(0.44, 0.68, 0.46, STONE.face, [1.36, 11.10, z + along]),
        box(0.44, 0.68, 0.46, STONE.face, [-1.36, 11.10, z + along]),
      ]),
      box(0.46, 0.68, 0.44, STONE.face, [0, 11.10, z + Math.sign(z) * 0.72]),
    ]),
    // a stair turret on one flank, a banner on the other
    box(1.30, 3.60, 1.30, STONE.face, [0, 12.56, 1.40]),
    cone(1.15, 2.00, 4, STONE.slate, [0, 15.36, 1.40], [1, 1, 1], [0, Math.PI / 4, 0]),
    box(0.09, 2.60, 0.09, STONE.iron, [0, 12.06, -1.40]),
    box(0.06, 0.85, 1.15, STONE.banner, [0, 12.75, -0.74]),
  ];
}

/**
 * The keep: the tallest thing anybody has built in this world, and by a long way.
 *
 * Twenty-two tiles to the top of the banner, against a chapel's six and a quarter. That number was
 * arrived at by putting one beside the other and looking, which is the only way it could have
 * been: from the height and angle this camera sits at, a tower reads by how far it stands above
 * everything around it and not by how many units tall it is, and a keep at twelve — twice a
 * chapel, which sounds enormous written down — looked like a mill.
 *
 * Four corner turrets running the full height, not just the top, because that is the difference
 * between a tower and a keep: the block is one thing, and the turrets bundle it. They stop at the
 * same half-width the block's own door does, which is what settles the footprint at 2.3 either
 * way — comfortably clear of where the collision bench sets a walker down.
 */
export function castleKeep(): PropPart[] {
  const turrets: Array<[number, number]> = [[1.75, 1.75], [1.75, -1.75], [-1.75, 1.75], [-1.75, -1.75]];
  return [
    box(5.10, PLINTH, 5.10, STONE.plinth, [0, PLINTH / 2, 0]),
    box(4.00, 12.00, 4.00, STONE.face, [0, PLINTH + 6.00, 0]),
    ...turrets.map(([x, z]) => box(1.10, 15.00, 1.10, STONE.face, [x, PLINTH + 7.50, z])),
    // the great door, and the arch stone over it
    box(0.16, 2.80, 1.70, STONE.slit, [2.02, PLINTH + 1.40, 0]),
    box(0.24, 0.36, 1.98, STONE.shade, [2.02, 3.26, 0]),
    // a string course where the floor inside is, so twelve tiles of wall reads as two storeys
    box(4.30, 0.24, 4.30, STONE.shade, [0, 6.40, 0]),
    // windows: narrow low down where the walls are thickest, wider in the hall above
    ...[-1.10, 1.10].map((z) => box(4.06, 1.10, 0.22, STONE.slit, [0, 4.20, z])),
    ...[-1.10, 1.10].map((z) => box(4.06, 1.60, 0.34, STONE.slit, [0, 8.80, z])),
    ...[-1.10, 1.10].map((x) => box(0.22, 1.60, 4.06, STONE.slit, [x, 8.80, 0])),
    box(4.50, 0.28, 4.50, STONE.shade, [0, 12.42, 0]),
    // battlements round the roof of the main block, in the runs the turrets leave between them
    ...[-0.90, -0.30, 0.30, 0.90].flatMap((along) => [
      box(0.48, 0.64, 0.46, STONE.face, [1.94, 12.88, along]),
      box(0.48, 0.64, 0.46, STONE.face, [-1.94, 12.88, along]),
      box(0.46, 0.64, 0.48, STONE.face, [along, 12.88, 1.94]),
      box(0.46, 0.64, 0.48, STONE.face, [along, 12.88, -1.94]),
    ]),
    // and a last stage above them, so the roofline steps rather than stopping flat
    box(3.00, 3.20, 3.00, STONE.face, [0, 14.16, 0]),
    box(3.30, 0.26, 3.30, STONE.shade, [0, 15.89, 0]),
    cone(2.10, 3.60, 4, STONE.slate, [0, 17.82, 0], [1, 1, 1], [0, Math.PI / 4, 0]),
    ...turrets.map(([x, z]) => cone(0.86, 1.70, 4, STONE.slate, [x, 16.13, z], [1, 1, 1], [0, Math.PI / 4, 0])),
    box(0.10, 2.40, 0.10, STONE.iron, [0, 20.82, 0]),
    box(0.07, 0.90, 1.30, STONE.banner, [0, 21.20, 0.65]),
  ];
}
