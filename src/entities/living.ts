import type { Params } from '../core/behaviourFile';
import { GONE, carriedBy, handOver } from '../world/goods';
import { throwBlow, type Entity } from './entity';
import { blowOf } from './motion';
import { number, rollSeconds, type CreatureNode, type Mind } from './verbs';

/**
 * What everybody with a trade is doing all day.
 *
 * Out of `verbs.ts` on the night the trade verbs stopped being a corner of it. That file is the
 * vocabulary a behaviour tree is written in and it groups itself four ways in its own comments —
 * getting about, picking somebody out, backing off, and making a living. The last of those has
 * grown a hunter's whole day, a miner at a face and a farmer walking his herd, and it is the group
 * that changes whenever the economy does, which is a different clock from the one the others run
 * on. So it is a file.
 *
 * Everything here is the same shape as everything there: a function of the tree's parameters
 * returning a node that gets a tick and says running, success or failure. Nothing about the split
 * is visible from `behaviours/` — a tree names `sell` and gets `sell`.
 */

/** Close on the nearest wild animal. Fails when there is nothing about worth taking. */
export function stalkQuarry(params: Params): CreatureNode {
  return (tick) => {
    const { self, quarry } = tick.world;
    const prey = quarry(self, number(params, 'within', 30));
    if (!prey) return 'failure';
    self.tx = prey.x;
    self.tz = prey.z;
    if (self.state !== 'walk') { self.state = 'walk'; self.timer = 10; }
    return Math.hypot(self.x - prey.x, self.z - prey.z) <= number(params, 'reach', 1.6) ? 'success' : 'running';
  };
}

/** Take what has been run down: it leaves the world, and goes on the hunter's shoulder. */
export function take(params: Params): CreatureNode {
  return (tick) => {
    const { self, quarry, remove } = tick.world;
    const prey = quarry(self, number(params, 'reach', 1.8));
    if (!prey) return 'failure';
    remove(prey);
    // onto the shoulder through the same deed a chest and a rucksack use. A shoulder holds one kind
    // of thing, which `carriedBy` is what says: given a second it drops what it had, because a man
    // walking to market has two hands
    carriedBy(self).give(prey.kind.drop?.id ?? 'meat', 1);
    self.state = 'idle';
    self.timer = 1;
    return 'success';
  };
}

/**
 * Hand over what is being carried, and take the coin for it.
 *
 * The coin goes to the person as well as to the body standing in the street. The body is
 * destroyed the moment the player walks out of range, so for as long as this was the only
 * place it landed, every sale a villager ever made evaporated and the village was never a
 * penny better off for any of it.
 */
export function sell(): CreatureNode {
  return (tick) => {
    const { self } = tick.world;
    if (!self.carrying) return 'failure';
    const sold = self.carrying.id;
    const took = tick.world.worth(sold) * self.carrying.count;
    self.purse += took;
    // what it was matters to who buys it: a hungry neighbour wants the deer more than the
    // shopkeeper wants the stock, and until the sale said what it was, every sale in a village
    // went to whoever in it was richest
    tick.world.banked?.(self.person, took, sold);
    // and off it the same way, rather than by assigning null: the deed is what knows that a
    // shoulder emptied of the last of something is empty rather than carrying nought of it
    handOver(carriedBy(self), GONE, self.carrying.id, self.carrying.count);
    self.state = 'idle';
    self.timer = 1.5;
    return 'success';
  };
}

/**
 * Spend some of what is in the purse, on whatever this trade spends money on — and somebody takes
 * it.
 *
 * It used to take the money out of `self.purse` and give it to nobody, which is two faults in one
 * line. `self` is the body standing in the street and it is destroyed the moment a player walks
 * away, so the spending never reached the register and the man was as rich the next morning as he
 * had been before the pub. And the coin went nowhere, in a village whose whole economy is other
 * people's money moving: the innkeeper is paid every day in the books and had never once been paid
 * where anybody could see it.
 *
 * `on` says who sells the thing where the game knows — `food` and a bed are the innkeeper's, `gear`
 * is the seller's. `paid` is what actually changed hands, which can be less than was meant, so the
 * body in the street and the row on the register move by the same amount and cannot drift apart.
 */
export function spend(params: Params): CreatureNode {
  return (tick) => {
    const { self, spends } = tick.world;
    const cost = number(params, 'cost', params.on === 'gear' ? 40 : 6);
    if (self.purse < cost) return 'failure';
    const paid = spends?.(self.person, cost, params.on === 'gear' ? 'seller' : 'innkeeper') ?? cost;
    self.purse -= paid;
    self.state = 'idle';
    self.timer = 2;
    return 'success';
  };
}

/**
 * Walk from one of your beasts to the next, and stand a while with each.
 *
 * What keeping cattle looks like from the road, and the farmer's answer to the miner's `dig`. The
 * herd went into the field before he did — the register has counted it, calved it and sold its
 * surplus for a while now — and what a player found when they walked out there was four cows and a
 * man standing at the gate with his hands in his pockets. A trade you can watch is the whole of
 * this item, and standing near your work is not doing it.
 *
 * Deliberately not an animation. There is no milking, no mucking out and no herding in
 * `animations/motion.json`, and the vocabulary a body has is a walk, an idle, a flinch, a death
 * and five shapes of blow. `dig` solved the same problem by borrowing the nearest honest motion —
 * a pick coming over the top is exactly the sword's `swing` — and there is no such luck here: a
 * man crouching at a cow is not any blow in the file. So this is made of the two things a body
 * genuinely has, walking and standing, arranged into the shape of somebody working through a
 * herd. Read from twenty paces up, which is where this camera watches from, that is what it is.
 *
 * Never succeeds, only runs or fails. A morning at the herd is not a task with an end, and a
 * `steps` that parks on this keeps him there until the hour changes and the branch above stops
 * being true — which is exactly how the miner holds his face all day.
 */
export function tendStock(params: Params): CreatureNode {
  const key = Symbol('tending');
  return (tick) => {
    const { self, stock, rng } = tick.world;
    const reach = number(params, 'reach', 2.2);
    // standing with one of them. The pause is what makes it a round of the herd rather than a
    // man jogging between cows for the whole morning
    const left = tick.memory.get(key, 0) - tick.dt;
    if (left > 0) { tick.memory.set(key, left); self.state = 'idle'; return 'running'; }

    const beast = stock(self, number(params, 'within', 26), reach);
    if (!beast) return 'failure';                 // no cattle here: whatever is above this decides
    self.tx = beast.x;
    self.tz = beast.z;
    if (self.state !== 'walk') { self.state = 'walk'; self.timer = 10; }
    if (Math.hypot(self.x - beast.x, self.z - beast.z) > reach) return 'running';
    tick.memory.set(key, number(params, 'seconds', 4) + rng() * number(params, 'spread', 4));
    self.state = 'idle';
    self.timer = 1;
    return 'running';
  };
}

/**
 * Buy something to eat, and eat it.
 *
 * The other end of `sell`, and the reason a hunter's day is worth anything to anybody but himself.
 * A villager down to his last few hearts stops getting on with his trade and goes to buy dinner;
 * the money goes to whoever sold it to him, and the hearts come back.
 *
 * Both halves through the register rather than on the body, for the reason everything else about a
 * villager is: the body is destroyed the moment a player walks away, so a meal eaten only on the
 * entity would be a man who is hungry again the instant you turn round. `spends` moves the coin
 * between two rows in the register, and the hunger it clears is the register's own.
 *
 * Fails with nothing spent when he cannot afford it, which is the case that matters most: a man
 * with no money in a village with food in it is the whole of what `eat` is grim about, and this
 * must not quietly rescue him from it.
 */
export function eatSomething(params: Params): CreatureNode {
  return (tick) => {
    const { self, spends, fed } = tick.world;
    const cost = number(params, 'cost', 4);
    if (self.purse < cost) return 'failure';
    const paid = spends?.(self.person, cost, 'seller') ?? 0;
    if (paid <= 0) return 'failure';
    self.purse -= paid;
    fed?.(self.person);
    self.hp = self.kind.hp ?? self.hp;
    self.state = 'idle';
    self.timer = 2;
    return 'success';
  };
}

/**
 * Cut at the rock in front of you, and keep cutting.
 *
 * There is no pick-swing in `animations/motion.json` and there never has been. The vocabulary a
 * body has is a walk, an idle, a flinch, a death and five shapes of blow, and not one of them is
 * work — every animation in this game was written for getting somewhere or for hurting something.
 * Rather than invent a sixth and have it be the only motion in the file nothing else uses, this
 * throws the blow called `swing`: an arm coming over the top and down, which is what the hero's
 * sword does and is also, exactly, what a pick does. It is the nearest honest thing.
 *
 * Nothing is struck. A blow only hurts through `strike`, and this never calls it — so a man at a
 * face swings all day beside you and cannot take a heart off anybody, which is the difference
 * between working and fighting and is worth being certain of.
 *
 * `every` is the seconds between strokes, and it is spent through `attackCooldown` rather than
 * through this node's own memory on purpose: a man who is interrupted, hit, or walked away from
 * loses the rhythm the way anything else in the game loses a swing, rather than resuming a count
 * held in a tree that no longer applies to him.
 *
 * Never succeeds. A face is not something you finish; you knock off at the end of a shift.
 */
export function dig(params: Params): CreatureNode {
  return (tick) => {
    const { self } = tick.world;
    // stood, not ambling: the whole point of a face is that he is at one
    self.state = 'idle';
    self.walk = 0;
    if (self.attackCooldown <= 0) {
      self.attackCooldown = number(params, 'every', 1.4);
      throwBlow(self, 'swing');
    }
    return 'running';
  };
}
