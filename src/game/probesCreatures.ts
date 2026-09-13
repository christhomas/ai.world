import { BEHAVIOUR } from '../entities/properties';
import { GAMEPLAY } from '../core/config';
import { HEALTH } from '../world/health';
import type { EntityManager } from '../entities/manager';
import { bodyMotion } from '../entities/motion';
import { bodyOf } from '../entities/entity';
import type { Probed } from './probes';

/**
 * The handles onto what is alive around the hero, and whether the screen is telling the truth
 * about it.
 *
 * Split out of `probes.ts` when that file reached the size this codebase holds a module to, and
 * split along this line because every one of them asks the same manager the same question: who is
 * standing near me, where are they really, and what is happening to them. The paper half of a life
 * — the roll, the churchyard, a purse — went out to `probesPeople.ts` for the same reason and along
 * the same kind of seam.
 *
 * They exist because a fight is the part of this game that cannot be checked from a screenshot. A
 * blow lands against where the world has a wolf and the player swings at where it is drawn, so the
 * distance between those two is the difference between a game you can fight in and one that lies to
 * you — and it is a number nobody can see.
 */
export function installCreatureProbes(ctx: Probed): void {
  const { player, entities, places, remains, carcasses, wildlife, bites, commandWorld } = ctx;
  const debug = window as unknown as Record<string, unknown>;

  /**
   * The crowd the hero is actually standing in.
   *
   * There is more than one `EntityManager` in this game — the country has one, and every dungeon
   * floor, mine and castle keep has its own — and `places.crowd` is whichever of them owns what is
   * around the hero right now. Every probe that answers "who is near me" has to ask it that way or
   * it answers about the fields overhead while the hero is four floors down, which reads as an
   * empty cave and is how a crew of miners went unnoticed for a night.
   */
  const crowdAround = (): EntityManager => places.crowd ?? entities;

  (debug as { __entitiesFull?: () => unknown }).__entitiesFull = () =>
    // hearts and which way it is facing included: a fight cannot be watched from outside without
    // them, and "did that blow land" was unanswerable while the only readouts were name and place.
    // Whichever crowd the hero is standing in, for the same reason `__entities` asks that way: a
    // mine's crew and a dungeon's monsters are a manager of their own, and a probe that only ever
    // reads the overworld one reports an empty cave to somebody standing in a crowded one
    crowdAround().within(player.x, player.z, 90).map((e) => ({
      kind: e.kind.id, name: e.name, role: e.role, x: e.x, z: e.z,
      hp: e.hp, dead: e.dead, yaw: Math.round(e.yaw * 100) / 100, id: e.worldId ?? null,
      // how high they are standing, what they do for a living, and what they are doing about it.
      // A man posted on a watchtower is exactly the thing that cannot be checked from outside
      // without a height in the readout: on the platform and in the grass beside it are the same
      // two numbers otherwise
      y: Math.round(e.y * 100) / 100, trade: e.trade, doing: e.doing,
      // the box it is collided against, so a test can ask whether two of them are inside each other
      body: bodyOf(e.kind),
    }));
  (debug as { __entities?: () => unknown }).__entities = () => commandWorld.entities();
  /*
   * Who the game would talk to if you pressed Enter, and why it would not.
   *
   * `Enter` ends at `entities.nearest`, and when that answers nothing the player is told "no one
   * close enough" — which is the same sentence whether there is genuinely nobody there or whether
   * somebody standing at arm's length is being skipped for a reason. This reports both sides of
   * that: what the crowd answers, and what the nearest few look like to the rule it uses.
   */
  (debug as { __talkable?: () => unknown }).__talkable = () => {
    const crowd = crowdAround();
    const found = crowd.nearest(player.x, player.z, GAMEPLAY.TALK_RANGE);
    return {
      range: GAMEPLAY.TALK_RANGE,
      found: found ? { kind: found.kind.id, name: found.name } : null,
      near: crowd.within(player.x, player.z, 6)
        .map((e) => ({
          kind: e.kind.id, name: e.name, indoors: e.indoors, dead: e.dead, dying: e.dying,
          away: Math.round(Math.hypot(e.x - player.x, e.z - player.z) * 100) / 100,
        }))
        .sort((a, b) => a.away - b.away)
        .slice(0, 6),
    };
  };

  Object.defineProperty(debug, '__drift', { configurable: true, get: () => wildlife.drift() });
  /*
   * What a drift reading is about, so a run can go and stand next to it.
   *
   * `__drift` on its own cannot tell an honest nought from an empty measurement: a script that
   * walks up to whatever is nearest can end up under an eagle, which the close tally leaves out on
   * purpose, and read `0 corrections` — which is not a game that is drawing creatures correctly,
   * it is a game nobody measured. This names the creature the tally would count.
   */
  (debug as { __creature?: () => unknown }).__creature = () => wildlife.nearestCounted(player);
  Object.defineProperty(debug, '__bites', { configurable: true, get: () => bites });

  // Everything on the floor, whoever owns it: the world's monsters arrive as guests rather than
  // as entries in this manager's own roster, so reading the roster showed an empty dungeon.
  (debug as { __monsters?: () => unknown }).__monsters = () =>
    (places.underground?.monsters.within(player.x, player.z, 999) ?? []).map((m) => ({
      kind: m.kind.id, world: m.worldId,
      x: Math.round(m.x * 100) / 100, z: Math.round(m.z * 100) / 100, hp: m.hp,
    }));
  (debug as { __packs?: () => unknown }).__packs = () => remains.all;
  (debug as { __bodies?: () => unknown }).__bodies = () => carcasses();

  (debug as { __blow?: () => unknown }).__blow = () => ({
    hero: { blow: player.entity.blow, strike: Math.round(player.entity.strike * 100) / 100 },
    others: crowdAround().within(player.x, player.z, 30)
      .filter((e) => e.strike > 0)
      .map((e) => `${e.kind.id}: ${e.blow} ${Math.round(e.strike * 100) / 100}`),
  });
  (debug as { __dying?: () => unknown }).__dying = () => entities.theFallen().map((e) => {
    const body = bodyMotion(e);
    return {
      kind: e.kind.id, left: Math.round(e.dying * 100) / 100,
      roll: Math.round(body.roll * 100) / 100, bob: Math.round(body.bob * 100) / 100,
    };
  });

  /*
   * Hurt whoever is nearest, without hitting them: the flash and the bar, with none of the fight.
   *
   * Deliberately not `damageEntity` — no knockback, nobody turning on you — because what this is
   * for is photographing a wounded creature standing still.
   */
  (debug as { __hurt?: (damage?: number) => unknown }).__hurt = (damage = HEALTH.A_SCRATCH) => {
    const near = crowdAround().within(player.x, player.z, 30)
      .filter((e) => !e.dead && e.kind.id !== 'hero')
      .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    const hit = near[0];
    if (!hit) return null;
    hit.hp = Math.max(1, hit.hp - damage);
    hit.hurt = BEHAVIOUR.HURT_TIME;
    hit.bar = BEHAVIOUR.BAR_TIME;
    return { kind: hit.kind.id, name: hit.name, hp: hit.hp, of: hit.kind.hp, x: hit.x, z: hit.z };
  };
}
