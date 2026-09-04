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
): void {
  const dx = e.x - fromX, dz = e.z - fromZ;
  const away = Math.hypot(dx, dz);
  if (away >= room) return;

  // exactly on top of each other has no direction to it, so pick one from where they are
  const len = away || 0.0001;
  const nx = away > 0.001 ? dx / len : Math.cos(e.phase);
  const nz = away > 0.001 ? dz / len : Math.sin(e.phase);
  const push = Math.min(room - away, BEHAVIOUR.SHOVE * dt);
  tryMove(world, e, nx * push, nz * push);
}

/**
 * Give the hero their room, and creatures theirs.
 *
 * The hero is checked against every active creature, which is one cheap pass over a list that is
 * already limited to what is near them. Creatures are only checked against their own herd,
 * because a herd is at most a handful and checking every creature against every other one is the
 * whole frame's budget spent on something nobody would see.
 */
export function keepBodiesApart(
  crowds: Iterable<Entity[]>, herds: Iterable<Herd>,
  playerX: number, playerZ: number, range: number, dt: number, world: TileWorld,
): void {
  const r2 = range * range;
  for (const list of crowds) {
    for (const e of list) {
      const dx = e.x - playerX, dz = e.z - playerZ;
      if (dx * dx + dz * dz > r2 || e.indoors || e.dead) continue;
      // a mount is meant to be stood on, and nothing else the hero owns should shove them about
      if (e.role === 'mount') continue;
      // scaled up by big things and never down by small ones: the room the hero needs is the
      // hero's, and a bat being small is no reason to let it stand on their head
      keepApart(e, playerX, playerZ, BEHAVIOUR.PERSONAL * Math.max(1, e.kind.scale), dt, world);
    }
  }
  for (const herd of herds) {
    const near = herd.members;
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const a = near[i], b = near[j];
        if (a.dead || b.dead || a.indoors || b.indoors) continue;
        keepApart(a, b.x, b.z, BEHAVIOUR.ELBOW * (a.kind.scale + b.kind.scale), dt, world);
      }
    }
  }
}
