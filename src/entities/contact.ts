import { BEHAVIOUR, tryMove, type Entity, type Herd, type TileWorld } from './entity';

/**
 * Bodies taking up room.
 *
 * Everything in this game moves by wanting to be somewhere, and until now nothing had any opinion
 * about already being somewhere occupied. A hunting pack therefore converged on one point and
 * stayed there, standing inside the hero, every one of them in reach, with no space to react in
 * because there was no space at all. In the player's own words: they sit on your head and kill
 * you.
 *
 * Separation is what turns a swarm into something you can back away from. It runs after everything
 * has moved rather than during, so a creature that has just walked into an occupied square is
 * pushed out of it in the same frame and never draws overlapping.
 */

/**
 * Push a creature out of somewhere it should not be standing.
 *
 * Bodies take up room. Everything in this game moves by wanting to be somewhere, and nothing
 * until now had any opinion about already being somewhere occupied, so a hunting pack converged
 * on one point and stayed there. Separation is what turns a swarm into something you can back
 * away from.
 */
export function keepApart(
  e: Entity, fromX: number, fromZ: number, room: number, dt: number, world: TileWorld,
  maxPush = Infinity,
): number {
  const dx = e.x - fromX, dz = e.z - fromZ;
  const away = Math.hypot(dx, dz);
  if (away >= room || maxPush <= 0) return 0;

  // exactly on top of each other has no direction to it, so pick one from where they are
  const len = away || 0.0001;
  const nx = away > 0.001 ? dx / len : Math.cos(e.phase);
  const nz = away > 0.001 ? dz / len : Math.sin(e.phase);
  const x = e.x, z = e.z;
  const push = Math.min(room - away, BEHAVIOUR.SHOVE * dt, maxPush);
  tryMove(world, e, nx * push, nz * push);
  return Math.hypot(e.x - x, e.z - z);
}

/** How far from the hero bodies are held apart from each other as well as from him. */
const ELBOWS_OUT = 14;

/** Bound a creature's total positional correction from separation in one simulation tick. */
const MAX_SEPARATION_PER_BODY = 0.2;

/** Room two of these need between them, which is bigger the bigger they are. */
function elbowRoom(a: Entity, b: Entity): number {
  return BEHAVIOUR.ELBOW * (a.kind.scale + b.kind.scale);
}

/**
 * Give the hero their room, and creatures theirs.
 *
 * Three passes, cheapest first. The hero is checked against every active creature. Then everything
 * close enough to the hero to be looked at is checked against everything else that close, whatever
 * it belongs to: a wolf pack and a bear are different herds, and separating each herd within itself
 * left the two of them standing in the same square, which is the overlap the player could see. That
 * pass is square in the number of bodies, so it is fenced to the fourteen tiles around the hero —
 * about twenty bodies and two hundred pairs, once a frame, which is nothing.
 *
 * Herds keep their own spacing out beyond that, where the pass above does not reach and nobody is
 * watching closely enough to mind a little overlap.
 */
export function keepBodiesApart(
  crowds: Iterable<Entity[]>, herds: Iterable<Herd>,
  playerX: number, playerZ: number, range: number, dt: number, world: TileWorld,
): void {
  const r2 = range * range, seen2 = ELBOWS_OUT * ELBOWS_OUT;
  const inSight: Entity[] = [];
  const separated = new Map<Entity, number>();
  const separate = (e: Entity, x: number, z: number, room: number): void => {
    const spent = separated.get(e) ?? 0;
    const moved = keepApart(e, x, z, room, dt, world, MAX_SEPARATION_PER_BODY - spent);
    if (moved > 0) separated.set(e, spent + moved);
  };
  for (const list of crowds) {
    for (const e of list) {
      const dx = e.x - playerX, dz = e.z - playerZ;
      const away = dx * dx + dz * dz;
      if (away > r2 || e.indoors || e.dead) continue;
      // a mount is meant to be stood on, and nothing else the hero owns should shove them about
      if (e.role === 'mount') continue;
      // scaled up by big things and never down by small ones: the room the hero needs is the
      // hero's, and a bat being small is no reason to let it stand on their head
      separate(e, playerX, playerZ, BEHAVIOUR.PERSONAL * Math.max(1, e.kind.scale));
      if (away <= seen2) inSight.push(e);
    }
  }
  for (let i = 0; i < inSight.length; i++) {
    for (let j = i + 1; j < inSight.length; j++) {
      const a = inSight[i], b = inSight[j];
      separate(a, b.x, b.z, elbowRoom(a, b));
    }
  }
  for (const herd of herds) {
    const near = herd.members;
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const a = near[i], b = near[j];
        if (a.dead || b.dead || a.indoors || b.indoors) continue;
        // already elbowed apart above, and pushing twice in a frame makes them jitter
        const dx = a.x - playerX, dz = a.z - playerZ;
        if (dx * dx + dz * dz <= seen2) continue;
        separate(a, b.x, b.z, elbowRoom(a, b));
      }
    }
  }
}
