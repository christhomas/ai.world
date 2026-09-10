import { box, cone, cyl, ico, type PropPart } from './shapes';

/**
 * What a keep is furnished with.
 *
 * A castle was dressed out of a village's furniture for as long as it took to build one: an
 * `Altar` standing in for a throne, a `WeaponRack` for a wall of arms, a `Forge` for a kitchen
 * range, a `Table` for the board down a great hall. Every one of them is the right silhouette from
 * above and the wrong object up close, which is an honest trade while the castle is going up and a
 * poor one once it is standing.
 *
 * The reason these are their own file rather than fourteen more entries in `props.ts` is the one
 * `castle.ts` gives for the castle itself: that file is already six hundred lines of every prop in
 * the world, and a hall's furniture is a thing somebody will want to open on its own and work
 * through. It is also one idea rather than fourteen — a hall is bigger than a room, and what
 * stands in it is bigger than a room's things. A `Table` in a great hall reads as a canteen and a
 * `Hearth` in one reads as a fireplace somebody has mislaid.
 *
 * Scale, since it is the whole of whether these work: a cottage is 2.5 tiles across and 3.1 to the
 * chimney; the ceiling of a castle floor is five terraces, which is 2.5 world units. So nothing
 * here may stand taller than about 2.4, and the two that come near it — the suit of armour and the
 * statue — are meant to: a hall wants something in it at head height or the eye has nothing to
 * measure the room against.
 */

/**
 * The keep's palette, and it is deliberately not the castle's outside.
 *
 * `castle.ts` is pale dressed limestone in daylight, chosen to read as *built* against cold rock
 * from across a valley. In here the light is torchlight, everything is seen against dark stone,
 * and the same pale ashlar would glare. So the woods are darker than a cottage's, the metal is
 * pewter rather than silver, and the one bright thing in a room is whatever is burning in it —
 * which is what makes a hall read as a hall rather than as a lit box.
 */
const KEEP = {
  /** Old oak, darkened by two centuries of smoke: every board, bench and stair in the place. */
  oak: 0x4a3524,
  /** The same wood where a hand has worn it: table tops, arm rests, the nose of a stair. */
  worn: 0x60462f,
  /** Dressed stone indoors, which is the outside's ashlar with the sun off it. */
  stone: 0x9a9384,
  /** And the shadow in it: the underside of a lintel, the back of a hearth, a plinth. */
  shadow: 0x6e685c,
  /** Pewter and old iron: a portcullis, a helm, the hoop of a chandelier. */
  iron: 0x55555b,
  /** Steel that has been kept: the polearm a suit of armour holds, and its own plate. */
  steel: 0x8f929c,
  /** Gold leaf, used once per room at most — a throne's finial, a chandelier's cup. */
  gold: 0xc9a24a,
  /** The cloth of the house: banners, tapestries, the cushion of a high seat. */
  cloth: 0x8e2f3a,
  /** And its second colour, for the border of a hanging and the field of a tapestry. */
  trim: 0x2f4a6e,
  /** Fire, and everything the light of it lands on first. */
  flame: 0xff8a2a,
  /** Cobweb and dust: the grey that says nobody has been in here. */
  dust: 0xcfd0cc,
} as const;

/**
 * A high seat on the dais, and the thing the top floor of a castle exists to have in it.
 *
 * Stands in for nothing, because there is no seat anywhere else in this game — a villager's chair
 * is a stool with a back on it and would read as a chair with delusions. What makes a throne is
 * that it is *too big for a person*: a back twice the height of the man sitting in it, arms he
 * could not reach across, and a step up to it. That reads from the top of the room, which is where
 * it will be seen from.
 */
export function throne(): PropPart[] {
  return [
    // the step, which is what makes it a high seat rather than a chair
    box(1.10, 0.14, 0.90, KEEP.shadow, [0, 0.07, 0.20]),
    box(0.86, 0.10, 0.70, KEEP.stone, [0, 0.19, 0.10]),
    // the seat and the back: the back is the whole silhouette, so it is the tallest thing here
    box(0.74, 0.12, 0.62, KEEP.worn, [0, 0.52, 0]),
    box(0.70, 1.10, 0.10, KEEP.oak, [0, 1.05, -0.28]),
    // and the cloth over it, which is what says whose seat it is
    box(0.52, 0.86, 0.04, KEEP.cloth, [0, 1.02, -0.21]),
    // arms, wide enough apart to be a throne rather than a carver
    ...[-0.36, 0.36].map((x) => box(0.10, 0.34, 0.60, KEEP.oak, [x, 0.70, 0])),
    ...[-0.36, 0.36].map((x) => box(0.14, 0.10, 0.64, KEEP.worn, [x, 0.90, 0])),
    // two finials, the one piece of gold in the room
    ...[-0.30, 0.30].map((x) => cyl(0.06, 0.06, 0.16, 6, KEEP.gold, [x, 1.66, -0.28])),
    ...[-0.30, 0.30].map((x) => ico(0.08, 0, KEEP.gold, [x, 1.78, -0.28])),
  ];
}

/**
 * The board down the middle of a great hall: three tiles of it, laid along x.
 *
 * `Table` is a small square one and a row of them reads as a canteen, which is exactly what the
 * hall looked like before this. A long table is one plank on trestles — no legs at the corners,
 * because that is what tells a board from a table at a glance — and it is laid along x so that a
 * structure's rotation swings it across a room or down it.
 */
export function longTable(): PropPart[] {
  return [
    box(2.80, 0.10, 0.76, KEEP.worn, [0, 0.78, 0]),
    box(2.84, 0.06, 0.80, KEEP.oak, [0, 0.71, 0]),
    // trestles rather than legs: two A-frames, in from the ends the way a board is actually set up
    ...[-0.90, 0.90].map((x) => box(0.14, 0.68, 0.60, KEEP.oak, [x, 0.36, 0])),
    ...[-0.90, 0.90].map((x) => box(0.20, 0.10, 0.86, KEEP.oak, [x, 0.05, 0])),
    // a bench down each side, which is what makes it a hall and not an office
    ...[-0.62, 0.62].map((z) => box(2.40, 0.10, 0.30, KEEP.oak, [0, 0.44, z])),
    ...[-0.62, 0.62].flatMap((z) => [-0.80, 0.80].map((x) => box(0.12, 0.40, 0.26, KEEP.oak, [x, 0.20, z]))),
  ];
}

/**
 * A fireplace you could stand up in, which is what a hall has instead of a hearth.
 *
 * `Hearth` is a cottage fire — a ring of stones on the floor — and in a room this size it reads as
 * a fireplace somebody has mislaid. This is two tiles wide, has a lintel over it at head height,
 * and burns. Built against a wall: everything is at negative z, so the prop's own rotation puts
 * its back to whichever wall the room wants.
 */
export function greatHearth(): PropPart[] {
  return [
    // the jambs and the lintel: the frame that makes it architecture rather than furniture
    ...[-0.78, 0.78].map((x) => box(0.44, 1.60, 0.60, KEEP.stone, [x, 0.80, -0.30])),
    box(2.00, 0.36, 0.64, KEEP.stone, [0, 1.78, -0.30]),
    box(2.10, 0.16, 0.72, KEEP.shadow, [0, 1.60, -0.28]),
    // the back of it, dark, so the fire has something to be seen against
    box(1.14, 1.60, 0.16, KEEP.shadow, [0, 0.80, -0.52]),
    // the hearthstone, which is the bit that reads from above
    box(2.20, 0.10, 0.90, KEEP.shadow, [0, 0.05, -0.10]),
    // logs, and then the fire on top of them
    box(0.90, 0.16, 0.16, KEEP.oak, [0, 0.16, -0.30], [1, 1, 1], [0, 0.2, 0]),
    box(0.90, 0.16, 0.16, KEEP.oak, [0, 0.28, -0.30], [1, 1, 1], [0, -0.3, 0]),
  ];
}

/** And the fire in it, which is drawn again unlit so it glows after dark like a torch does. */
export function hearthFire(): PropPart[] {
  return [
    cone(0.34, 0.70, 5, KEEP.flame, [0, 0.60, -0.30]),
    cone(0.20, 0.46, 5, 0xffd23a, [0.08, 0.66, -0.26]),
  ];
}

/**
 * A banner on a wall, which is what tells you whose keep this is.
 *
 * Hangs like a `Torch` does — everything is offset out from the wall face it is fixed to, so the
 * prop stands *in* the rock rather than on the floor in front of it. Long rather than wide, and
 * with a swallow-tail cut at the foot, because a rectangle of cloth reads as a poster.
 */
export function banner(): PropPart[] {
  return [
    // the pole across the top, and the two cords it hangs by
    box(0.10, 0.10, 1.10, KEEP.iron, [0.42, -0.30, 0]),
    box(0.80, 0.06, 0.90, KEEP.cloth, [0.44, -0.90, 0]),
    // the field, a shade darker where it falls away from the light
    box(0.76, 0.04, 0.86, KEEP.trim, [0.46, -1.30, 0]),
    box(0.72, 0.04, 0.30, KEEP.cloth, [0.46, -1.62, 0]),
    // the tails
    ...[-0.22, 0.22].map((z) => box(0.60, 0.04, 0.34, KEEP.cloth, [0.46, -1.88, z])),
    // and a charge on it, so it is a device rather than a rag
    box(0.30, 0.03, 0.30, KEEP.gold, [0.50, -1.10, 0]),
  ];
}

/**
 * A tapestry: the same idea two tiles wide, for the long wall of a gallery.
 *
 * A cold stone wall with nothing on it is exactly what makes a corridor read as a mine, which is
 * the complaint this answers. Wider and shorter than a banner, with a plain border, because what
 * is *on* a tapestry cannot be drawn at this scale and a border can.
 */
export function tapestry(): PropPart[] {
  return [
    box(0.06, 1.40, 1.90, KEEP.trim, [0.44, -1.10, 0]),
    box(0.04, 1.16, 1.66, KEEP.cloth, [0.48, -1.10, 0]),
    // three panels, which at this distance is all the pattern anybody will resolve
    ...[-0.52, 0, 0.52].map((z) => box(0.03, 0.90, 0.34, KEEP.trim, [0.51, -1.10, z])),
    // the rail it hangs from
    box(0.12, 0.10, 2.00, KEEP.oak, [0.44, -0.34, 0]),
  ];
}

/**
 * A suit of armour standing against a wall, holding a polearm.
 *
 * Its whole point is that from the top of a stair you cannot tell it from something that is going
 * to move. It is built to the same proportions as the game's people for that reason — a head at
 * 1.5, shoulders at 1.25 — so at a glance it *is* a man in the corridor, and only when you have
 * walked up to it and nothing has happened is it furniture.
 */
export function suitOfArmour(): PropPart[] {
  return [
    // the plinth, low enough to step onto and not to walk into
    box(0.60, 0.10, 0.60, KEEP.shadow, [0, 0.05, 0]),
    // legs, body, arms: a person's proportions, in plate
    ...[-0.13, 0.13].map((x) => box(0.16, 0.60, 0.18, KEEP.steel, [x, 0.40, 0])),
    box(0.44, 0.56, 0.28, KEEP.steel, [0, 0.98, 0]),
    box(0.50, 0.12, 0.34, KEEP.iron, [0, 1.22, 0]),
    ...[-0.30, 0.30].map((x) => box(0.14, 0.50, 0.16, KEEP.steel, [x, 1.00, 0])),
    // and the helm, which is the piece that makes it read as somebody standing there
    box(0.28, 0.30, 0.30, KEEP.steel, [0, 1.44, 0]),
    box(0.30, 0.06, 0.06, KEEP.shadow, [0, 1.46, 0.14]),
    cone(0.16, 0.16, 6, KEEP.iron, [0, 1.64, 0]),
    // the polearm, held out from the body so it breaks the silhouette
    cyl(0.04, 0.04, 2.00, 5, KEEP.oak, [0.38, 1.00, 0.10]),
    box(0.10, 0.34, 0.04, KEEP.steel, [0.38, 2.10, 0.10]),
    box(0.22, 0.14, 0.04, KEEP.steel, [0.44, 1.98, 0.10]),
  ];
}

/**
 * A bowl of fire on a tripod, for the middle of a hall where no wall bracket reaches.
 *
 * The lighting problem a great hall has: torches are brackets and brackets are on walls, so the
 * middle of a room forty feet across is dark whatever you do to the walls. A brazier is what a
 * castle actually did about that.
 */
export function brazier(): PropPart[] {
  return [
    ...[0, 2.09, 4.19].map((a) => cyl(0.05, 0.07, 0.80, 5, KEEP.iron,
      [Math.cos(a) * 0.22, 0.40, Math.sin(a) * 0.22], [1, 1, 1], [Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18])),
    cyl(0.40, 0.28, 0.26, 8, KEEP.iron, [0, 0.92, 0]),
    cyl(0.38, 0.34, 0.06, 8, KEEP.shadow, [0, 1.02, 0]),
  ];
}

/** The fire in the bowl, drawn unlit as well so it burns after dark. */
export function brazierFire(): PropPart[] {
  return [
    cone(0.26, 0.44, 5, KEEP.flame, [0, 1.20, 0]),
    cone(0.14, 0.30, 5, 0xffd23a, [0.05, 1.24, 0.04]),
  ];
}

/**
 * A chandelier: the one light a great hall should have that a cellar cannot.
 *
 * Hangs from 3.5, which is above the ceiling of the floor it is on — deliberately. Nothing in this
 * game draws a ceiling, so a light hanging at head height reads as a lamp on a pole; hung above
 * where the ceiling would be, it reads as coming down out of the dark, which is what a hall wants.
 */
export function chandelier(): PropPart[] {
  return [
    cyl(0.03, 0.03, 1.00, 4, KEEP.iron, [0, 3.00, 0]),
    cyl(0.62, 0.62, 0.08, 8, KEEP.iron, [0, 2.46, 0]),
    cyl(0.40, 0.40, 0.06, 8, KEEP.iron, [0, 2.60, 0]),
    ...[0, 1.57, 3.14, 4.71].map((a) => box(0.60, 0.04, 0.04, KEEP.iron,
      [Math.cos(a) * 0.30, 2.54, Math.sin(a) * 0.30], [1, 1, 1], [0, -a, 0])),
    // candle cups round the hoop
    ...[0, 0.79, 1.57, 2.36, 3.14, 3.93, 4.71, 5.50].map((a) =>
      cyl(0.05, 0.05, 0.18, 5, KEEP.gold, [Math.cos(a) * 0.62, 2.58, Math.sin(a) * 0.62])),
  ];
}

/** Its candles, lit: eight small flames in a ring, which is the whole reason it is up there. */
export function chandelierFlames(): PropPart[] {
  return [0, 0.79, 1.57, 2.36, 3.14, 3.93, 4.71, 5.50].map((a) =>
    ico(0.07, 0, 0xffe08a, [Math.cos(a) * 0.62, 2.72, Math.sin(a) * 0.62], [0.8, 1.5, 0.8]));
}

/**
 * A portcullis: a grid dropping out of the head of an arch, halfway down.
 *
 * Distinct from `Door`, which is a hinged plank and reads as a cottage wherever it is put. Halfway
 * rather than shut, because a castle bars a stair with one of these and a grid resting on the
 * floor is a wall — at half height you can see the room beyond it, which is what makes it a thing
 * you have to deal with rather than a dead end.
 */
export function portcullis(): PropPart[] {
  return [
    // the head of the arch it drops out of
    box(1.10, 0.24, 0.30, KEEP.stone, [0, 2.28, 0]),
    box(1.16, 0.10, 0.36, KEEP.shadow, [0, 2.12, 0]),
    // the grid: uprights sharpened at the foot, and two rails across them
    ...[-0.36, -0.12, 0.12, 0.36].map((x) => box(0.07, 1.10, 0.07, KEEP.iron, [x, 1.50, 0])),
    ...[-0.36, -0.12, 0.12, 0.36].map((x) => cone(0.06, 0.16, 4, KEEP.iron, [x, 0.90, 0], [1, -1, 1])),
    ...[1.20, 1.86].map((y) => box(0.92, 0.07, 0.07, KEEP.iron, [0, y, 0])),
  ];
}

/**
 * A statue on a plinth: the corners of a gallery, and the head of a stair.
 *
 * Plinth and figure, and the figure is deliberately worse than the suit of armour — no arms held
 * out, no colour but stone. What it is for is scale: something person-shaped and clearly not a
 * person, standing where a corridor turns, so the turn has something in it.
 */
export function statue(): PropPart[] {
  return [
    box(0.70, 0.16, 0.70, KEEP.shadow, [0, 0.08, 0]),
    box(0.58, 0.60, 0.58, KEEP.stone, [0, 0.46, 0]),
    box(0.66, 0.10, 0.66, KEEP.shadow, [0, 0.80, 0]),
    // the figure: a robe rather than legs, which is what a mason carves and what reads at this size
    cyl(0.20, 0.30, 0.90, 6, KEEP.stone, [0, 1.30, 0]),
    box(0.40, 0.34, 0.24, KEEP.stone, [0, 1.88, 0]),
    ico(0.15, 0, KEEP.stone, [0, 2.14, 0]),
    // one arm across the chest, which is the difference between a figure and a bollard
    box(0.34, 0.12, 0.14, KEEP.stone, [0.06, 1.82, 0.14], [1, 1, 1], [0, 0, 0.3]),
  ];
}

/**
 * A spiral stair turning up out of sight, for the corner towers.
 *
 * What should be standing in a tower instead of the flat `Stairs` plate, which is a diagram of a
 * stair. Eleven steps round a newel post, each turned a little further and set a little higher,
 * and the top one goes into the dark above the room — which is the whole point: a stair you can
 * see the top of is a step.
 */
export function towerStair(): PropPart[] {
  const steps = 11;
  return [
    cyl(0.14, 0.16, 2.50, 6, KEEP.stone, [0, 1.25, 0]),
    ...Array.from({ length: steps }, (_, n) => {
      const turn = (n / steps) * Math.PI * 1.8;
      const y = 0.12 + n * 0.20;
      return box(0.62, 0.10, 0.26, KEEP.worn,
        [Math.cos(turn) * 0.38, y, Math.sin(turn) * 0.38], [1, 1, 1], [0, -turn, 0]);
    }),
  ];
}

/**
 * Cobweb: the tell that a wing is the haunted one, read from the top of the stair.
 *
 * The point is that it is information rather than decoration. A castle's haunted rooms are known
 * to the generator and were known to nobody else until you were in one; this is what a player can
 * see from the doorway. Pale, low and flat — it hangs in the corner of a room rather than standing
 * in the middle of one, so it never gets in the way of anything.
 */
export function cobweb(): PropPart[] {
  return [
    box(0.90, 0.02, 0.90, KEEP.dust, [0, 1.90, 0], [1, 1, 1], [0.25, 0, 0.25]),
    box(0.60, 0.02, 0.60, KEEP.dust, [0.18, 1.72, 0.18], [1, 1, 1], [0.4, 0.7, 0.2]),
    ...[0, 1.57, 3.14].map((a) => box(0.02, 0.50, 0.02, KEEP.dust,
      [Math.cos(a) * 0.28, 1.55, Math.sin(a) * 0.28])),
  ];
}

/**
 * A sarcophagus: the crypt under the chapel, and where a wight is.
 *
 * Two tiles long, low, and with the lid pushed a hand's breadth off square — which is the entire
 * story the object has to tell. A closed box is furniture; a box with the lid moved is a room you
 * should not have come into.
 */
export function sarcophagus(): PropPart[] {
  return [
    box(1.90, 0.56, 0.86, KEEP.stone, [0, 0.28, 0]),
    box(2.00, 0.10, 0.94, KEEP.shadow, [0, 0.05, 0]),
    // the lid, shoved off true
    box(1.86, 0.16, 0.82, KEEP.stone, [0.14, 0.64, -0.06], [1, 1, 1], [0, 0.05, 0]),
    // and a figure carved on it, which is what says whose it is
    box(0.30, 0.06, 0.60, KEEP.shadow, [0.10, 0.73, -0.06]),
  ];
}

/**
 * A stained window: the one thing a castle interior has that a cave never can, which is an outside.
 *
 * Hangs on a wall face like a banner. Lit from behind — the coloured panes are in the lit list, so
 * they go on glowing when everything round them has gone dark, which is what makes a window a
 * window rather than a painting of one.
 */
export function stainedWindow(): PropPart[] {
  return [
    // the surround, and the mullion down the middle of it
    box(0.14, 2.40, 1.04, KEEP.stone, [0.40, -1.20, 0]),
    box(0.10, 0.10, 1.04, KEEP.shadow, [0.44, -0.10, 0]),
    box(0.08, 2.20, 0.08, KEEP.shadow, [0.46, -1.20, 0]),
  ];
}

/** The panes, which are the lit half: three colours in two lights, glowing after dark. */
export function stainedGlass(): PropPart[] {
  return [
    box(0.04, 0.90, 0.40, 0x8e2f3a, [0.48, -0.70, -0.24]),
    box(0.04, 0.90, 0.40, 0x2f6e4a, [0.48, -0.70, 0.24]),
    box(0.04, 0.70, 0.40, 0x2f4a8e, [0.48, -1.70, -0.24]),
    box(0.04, 0.70, 0.40, 0xc9a24a, [0.48, -1.70, 0.24]),
  ];
}
