import type { Params } from '../core/behaviourFile';
import { yawFor } from './entity';
import { number, type CreatureNode } from './verbs';

/**
 * Standing somewhere the ground has never heard of, and shooting from it.
 *
 * Out of `verbs.ts` for the same reason the trade verbs went: that file is the vocabulary a
 * behaviour tree is written in, and these two are a corner of it with a subject of their own. A
 * watchtower has stood in this country since the first landmarks went in and has never been
 * anything but a shape on a hill; these are what make it a building somebody would pay for.
 *
 * The pair is the whole idea. `takePost` is how a man comes to be twenty feet up — he walks to the
 * foot of the tower and is on the platform a moment later, which is the same bargain the game makes
 * about every stair it does not draw. `loose` is what being up there is *for*: an arrow measures the
 * flight it actually has to make, so a man on a platform reaches things a man beside it cannot, and
 * he does not take a step toward any of them.
 *
 * Coming down is not here and is deliberately not a verb. It is a property of walking — see
 * `Entity.perch` and the walk case in `entity.ts` — because a man knocked off a tower has to come
 * down just as surely as one who was told to go somewhere else, and a verb could only answer for
 * the second.
 */

/**
 * Climb to a post and stand on it.
 *
 * The post is wherever the order said — `told.at`, the foot of a watchtower — and `height` is how
 * far above the ground the platform is. Running while he is still walking to it, success once he is
 * standing up there, so a tree can put the shooting behind it and be sure nobody is loosing arrows
 * from halfway across a field.
 *
 * There is no climb. He walks to the foot of the tower and is on the platform a moment later, which
 * is the same bargain the game makes about every ladder and stair it does not draw: what matters is
 * that he is up there, that he can see further than a man on the ground, and that stepping off is
 * what brings him down. A stair to animate him up is worth having one day and is not what makes
 * this work.
 */
export function takePost(params: Params): CreatureNode {
  return (tick) => {
    const { self } = tick.world;
    const spot = self.told?.at;
    if (!spot) return 'failure';
    const off = Math.hypot(self.x - spot.x, self.z - spot.z);
    if (off > number(params, 'within', 1.6)) {
      self.tx = spot.x;
      self.tz = spot.z;
      if (self.state !== 'walk') { self.state = 'walk'; self.timer = 4; }
      return 'running';
    }
    // at the foot of it: stop, and stand at the height the platform is
    self.tx = self.x;
    self.tz = self.z;
    if (self.state === 'walk') { self.state = 'idle'; self.timer = 1; }
    const ground = tick.world.ground.heightAt(self.x, self.z);
    if (ground === null) return 'failure';
    self.perch = ground + number(params, 'height', 5);
    return 'success';
  };
}

/**
 * Loose an arrow at whatever is marked, from where you are standing.
 *
 * The counterpart of `bite`, and deliberately built as its own verb rather than as a bite with a
 * longer reach. Three things are different and all three matter. It measures the flight of the
 * arrow rather than the ground between two feet, so a man on a tower can hit something that a man
 * standing beside the tower could not reach and a bird overhead is exactly as far off as it looks —
 * the same arithmetic the hero's own bow uses in `archery.ts`. It does not close the distance: a
 * bowman who walks toward what he is shooting at is a bowman who has thrown away the only thing a
 * bow is for. And it never touches the hero: what this verb can hurt is another creature, because
 * everything that shoots at *you* in this game shoots with its own hands and its own rules.
 */
export function loose(params: Params): CreatureNode {
  return (tick) => {
    const { self, strike } = tick.world;
    const at = self.target;
    if (!at || at.dead) return 'failure';
    if (self.attackCooldown > 0) return 'failure';

    const flight = Math.hypot(at.x - self.x, at.z - self.z, (at.y ?? 0) - (self.y ?? 0));
    if (flight > number(params, 'tiles', 14)) return 'failure';

    self.attackCooldown = number(params, 'cooldown', 1.6);
    self.yaw = yawFor(at.x - self.x, at.z - self.z);
    // an arrow is one arrow: it stops in the first thing it reaches, and there is no wind-up to
    // step out of, which is exactly what makes a bow worth having and worth being frightened of
    strike(self, at, number(params, 'damage', self.kind.damage ?? 1));
    return 'success';
  };
}
