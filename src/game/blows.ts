import { GAMEPLAY } from '../core/config';
import { BEHAVIOUR, throwBlow, yawFor, type Entity, type TileWorld } from '../entities/entity';
import type { EntityManager } from '../entities/manager';
import type { Blow } from '../entities/motion';
import { canBeCut } from '../entities/monsters';
import type { Player } from '../entities/player';
import { PEOPLE as PEOPLE_KINDS } from '../entities/quarry';
import type { ChunkManager } from '../world/chunkManager';
import type { Structures } from '../world/structures';
import { BOW, bowInHand, canShoot, quiver, shoot } from './archery';
import type { Sound } from './audio';
import { BREATH, Breath, guardCovers } from './breath';
import { COMBAT, struck, swing, type SwingResult } from './combat';
import type { Director } from './director';
import type { Duel } from './duel';
import type { Hires } from './hire';
import type { DialogueNode } from './interact/context';
import { carriedTo, costOf, saidOfKnockout } from './knockout';
import type { Magic, SpellId } from './magic';
import type { Mines } from './mines';
import type { Online } from './online';
import type { Places } from './places';
import type { Sailing } from './sailing';
import { ITEMS } from './shops';
import type { Skies } from './skies';
import type { Standing } from './standing';
import type { GameState } from './state';
import type { Warband } from './warband';

/**
 * Everything that is thrown at somebody, and everything thrown at the hero.
 *
 * A sword, an arrow and a spell are three ways of doing one thing, and this is the one place that
 * knows what that thing costs and what follows from it: the breath it takes, what the ledger makes
 * of the kill, what the village whose cow it was thinks of you, and — the part nobody sees until
 * it is missing — telling the world it happened at all.
 */
export interface Fighting {
  seed: number;
  state: GameState;
  player: Player;
  places: Places;
  chunks: ChunkManager;
  entities: EntityManager;
  structures: Structures;
  standing: Standing;
  breath: Breath;
  magic: Magic;
  mines: Mines;
  online: Online;
  duel: Duel;
  warband: Warband;
  hires: Hires;
  sailing: Sailing;
  skies: Skies;
  sound: Sound;
  director: Director;
  /** Is a conversation up? Nothing may be swung while somebody is being spoken to. */
  talking: () => boolean;
  /** And does the console have the keyboard? A spell key is a letter like any other. */
  typing: () => boolean;
  flash: (message: string) => void;
  /** The screen's own flinch, for a blow that got through. */
  hurt: () => void;
  /** Stop the world and say what happened. Losing a fight deserves more than three seconds of toast. */
  converse: (node: DialogueNode) => void;
  /** The mine the hero is swinging inside, or nothing. Only a cave counts as somewhere anybody works. */
  fightingInAMine: () => string | null;
  /** The world a blow is thrown in when the world owns it, and null when this client does. */
  battlefield: () => string | null;
  /** Somebody's animal is dead, and the village it belonged to finds out. */
  rustled: (beast: Entity) => string;
  /** A creature is out of the world: whatever was watching for that one is told. */
  fell: (kind: string, x: number, z: number) => void;
  troubleKilled: (kind: string, x: number, z: number) => void;
  /** Old Nettle is beaten rather than killed, and this is the scene where he goes down. */
  heWentDown: () => boolean;
  /** Coin off a body, shared with whoever is walking with you. */
  takeShare: (gold: number) => void;
  persist: () => void;
}

/**
 * How near a wind-up has to be to be worth hearing. Far enough to turn round in, near enough that
 * a wood full of distant wolves is not a racket.
 */
const HEARD_WINDING = 14;

export function createBlows(ctx: Fighting) {
  const {
    seed, state, player, places, chunks, entities, structures, standing, breath, magic, mines,
    online, duel, warband, hires, sailing, skies, sound, director, talking, typing, flash, hurt,
    converse, fightingInAMine, battlefield, rustled, fell, troubleKilled, heWentDown, takeShare,
    persist,
  } = ctx;

  let swingCooldown = 0;
  let drawCooldown = 0;
  /** Seconds left of the moment after a blow in which nothing else can land on the hero. */
  let reeling = 0;

  /** What a blow on this creature sounds like: bone rattles, armour rings, everything else gives. */
  const madeOf = (e: Entity): 'flesh' | 'bone' | 'plate' => {
    const id = e.kind.id;
    if (id === 'skeleton' || id === 'wight') return 'bone';
    if (id === 'nettle' || e.trade === 'constable') return 'plate';
    return 'flesh';
  };

  /** Roughly how big a thing is against a person, which is what pitches its voice. */
  const heftOf = (e: Entity): number => e.kind.scale * (e.kind.hp ? 1 : 0.7);

  /**
   * Killing something in a mine, told to anybody else playing in this world.
   *
   * The running total goes on the wire rather than the handful just killed: the delta log keeps one
   * entry per mine and a later one replaces the earlier, so an increment would be swallowed. A
   * total survives that, arrives in any order, and can be applied twice without counting twice.
   */
  const reportCleared = (id: string | null, many: number) => {
    mines.slain(id, many);
    if (id) online.report({ kind: 'cleared', mine: id, many: mines.clearedIn(id) });
  };

  /**
   * Every blow the hero throws, from the arm going out to the world hearing about it.
   *
   * Out of doors the world throws the blow itself — we say how hard and how far, it says what was
   * in the arc — and what is drawn here is the guess that keeps a hit feeling like one. That
   * telling used to be four lines copied beside each kind of blow, which is four chances to leave
   * it out; a swing nobody else is told about lands on this screen and on no other, and looks
   * from the far end like a monster taking no damage at all.
   */
  const thrown = <T extends SwingResult>(
    resolve: (manager: EntityManager, world: TileWorld) => T,
    /** What the world is to measure: how hard, how far, how wide, and whether it stops in the first thing. */
    reach: { damage: number; range: number; arc: number; first?: boolean },
  ): T => {
    const world = places.underground?.world ?? chunks;
    const manager = places.underground?.monsters ?? entities;
    const res = resolve(manager, world);
    // the ledger moves on every deed, not only on the ones that change what people call you
    state.standing = standing.value;
    const field = battlefield();
    if (field) online.swing(field, reach.damage, reach.range, reach.arc, reach.first);
    return res;
  };

  /**
   * What follows from a kill, whatever landed it. Nothing here cares whether it was a sword, an
   * arrow or a word said out loud, which is the point: a creature is dead the same way each time.
   *
   * @returns what the last village to lose an animal was heard to say, for whoever wants to
   * put it on the screen, and nothing when none of them was anybody's.
   */
  const felled = (killed: readonly Entity[]): string | null => {
    // what lived in the workings is what made them dangerous, so killing it is the one thing a
    // player can do that moves a village's whole economy. Anybody on the register is not what
    // lived down there — he is the village's own, at the face, and cutting him down makes a mine
    // emptier of people rather than emptier of trouble. Counting him would let a player make a
    // hole "safe" by murdering the crew that works it, which is the economy read backwards.
    const lurking = killed.filter((e) => e.person === '').length;
    if (lurking > 0) reportCleared(fightingInAMine(), lurking);
    let rustling: string | null = null;
    for (const e of killed) {
      fell(e.kind.id, e.x, e.z);
      troubleKilled(e.kind.id, e.x, e.z);
      if (e.kind.owned === true) rustling = rustled(e);
    }
    return rustling;
  };

  const attack = () => {
    if (talking() || swingCooldown > 0) return;
    swingCooldown = COMBAT.COOLDOWN;
    player.entity.attackCooldown = 0.45;
    // what the hero throws: a blade is swung, and a bare hand alternates fist and boot so a
    // flurry is not the same arm four times
    const held = state.worn('hand');
    const blow: Blow = held && (held.attack ?? 0) > 0
      ? 'swing'
      : (player.entity.offhandBlow ? 'kick' : 'punch');
    throwBlow(player.entity, blow);
    // a swing costs breath whether or not it finds anything, which is what makes swinging at air
    // a decision rather than a free action
    const might = breath.swing();
    if (might < 1) flash('You are swinging on empty.');
    /**
     * What this particular swing is worth, breath and all.
     *
     * Creatures get this through `swing()`, which scales the damage itself. Another player is hit
     * through the duel and warband paths instead, and those were reading `state.attack` straight —
     * so against a person you paid the breath and still swung at full strength, and the rule that
     * a flurry has an end quietly did not apply to the only opponent who could notice.
     *
     * Both the local prediction and the number that goes on the wire use this, so the two sides of
     * a bout never disagree about how hard you hit.
     */
    const landed = Math.max(1, Math.round(state.attack * might));

    if (duel.active) {
      const them = online.players.get(duel.opponent);
      if (them && duel.inReach(them, player.x, player.z, player.entity.yaw, COMBAT.ARC)) {
        duel.landed(landed);
        online.duelHit(landed);
        sound.thud();
        return;
      }
    }
    // a fight with sides lands the same way, except that whatever they have paid for is in front
    // of them and takes it first
    if (warband.active && warband.mayStrike(online.id, warband.opponent, hires)) {
      const them = online.players.get(warband.opponent);
      if (them && duel.inReach(them, player.x, player.z, player.entity.yaw, COMBAT.ARC)) {
        warband.landed({ damage: landed, sword: false });
        online.warbandHit(landed, false);
        sound.thud();
        return;
      }
    }
    // Old Nettle is beaten rather than killed: the blow that would finish him raises the choice
    // instead, which is the whole design. He must never reach nought.
    const cornered = entities.within(player.x, player.z, COMBAT.RANGE)
      // against the blow actually being thrown, not against a full-strength one: a winded swing
      // must not trigger the scene where he goes down, because it would not have put him there
      .some((e) => e.kind.id === 'nettle' && !e.dead && e.hp <= landed);
    if (cornered && heWentDown()) { sound.thud(); return; }

    const res = thrown(
      (manager, world) => swing(state, manager, world, player.x, player.z, player.entity.yaw, seed, true, standing, null, might),
      { damage: landed, range: COMBAT.RANGE, arc: COMBAT.ARC },
    );
    if (res.hit.length === 0) {
      sound.miss();
      // a blade that finds nothing where something plainly stands has to say why, or the rule
      // that a sword is no answer to a wight reads as a broken game rather than as the point.
      // Two rules look the same from behind a sword and are not.
      const near = entities.within(player.x, player.z, COMBAT.RANGE);
      if (near.some((e) => !canBeCut(e.kind))) flash('Your blade passes through it.');
      else if (near.some((e) => !e.kind.hp && !PEOPLE_KINDS.has(e.kind.id))) {
        flash('It is somebody\'s livestock. You have no quarrel with it.');
      }
      return;
    }
    sound.hit(madeOf(res.hit[0]));
    director.saw('fight');
    // swinging at things teaches you to swing at things: practice, weighted by what you swung at
    for (const e of res.hit) {
      const grew = state.practised(e.kind.dangerous ?? 0, res.killed.includes(e));
      if (grew) flash(grew);
    }
    if (res.killed.length > 0) {
      sound.voice(heftOf(res.killed[0]), true);
      const rustling = felled(res.killed);
      const names = res.killed.map((e: Entity) => e.kind.label).join(', ');
      const won = [res.gold > 0 ? `${res.gold} gold` : '', ...res.loot.map((id) => ITEMS[id]?.name ?? id)].filter(Boolean);
      flash(won.length ? `Defeated ${names} (+${won.join(', ')})` : `Defeated ${names}`);
      // said after the kill, because what the village now thinks of you outlasts the meat
      if (rustling) flash(rustling);
      persist();
    }
    // said last so it is the line left on the screen: crossing into a worse standing is the more
    // important of the two things that just happened
    if (res.regard) { flash(`You are ${res.regard}.`); persist(); }
  };

  /**
   * Loose an arrow. A shot reaches things a swing cannot, because it measures its range as a
   * slant rather than along the ground: an eagle nine tiles up is nine tiles away to a bow and
   * out of the world to a sword.
   */
  const loose = (): void => {
    if (talking() || drawCooldown > 0) return;
    if (!canShoot(state)) {
      flash(bowInHand(state) ? 'Your quiver is empty.' : 'You need a bow in your hand for that.');
      return;
    }
    drawCooldown = BOW.COOLDOWN;
    player.entity.attackCooldown = BOW.COOLDOWN;
    // an arrow is one arrow, so the world takes the first thing it would reach rather than the arc
    const res = thrown(
      (manager, world) => shoot(state, manager, world, player.x, player.z, player.entity.yaw, seed, true, standing),
      { damage: state.attack, range: BOW.RANGE, arc: BOW.ARC, first: true },
    );
    if (res.hit.length === 0) { sound.select(); flash(`Missed. ${quiver(state)} arrows left.`); return; }
    sound.thud();
    if (res.killed.length > 0) {
      sound.chime();
      const rustling = felled(res.killed);
      const names = res.killed.map((e: Entity) => e.kind.label).join(', ');
      const won = [res.gold > 0 ? `${res.gold} gold` : '', ...res.loot.map((id) => ITEMS[id]?.name ?? id)].filter(Boolean);
      flash(won.length ? `Shot ${names} (+${won.join(', ')})` : `Shot ${names}`);
      if (rustling) flash(rustling);
      persist();
    }
    if (res.regard) { flash(`You are ${res.regard}.`); persist(); }
  };

  /** Say a spell, and put whatever came of it on the screen. */
  const conjure = (id: SpellId): void => {
    if (talking() || typing()) return;
    const cast = magic.cast(id, state);
    flash(cast.words);
    if (!cast.spell) { sound.select(); return; }
    sound.chime();
    if (!cast.blow) return;
    // a spell that strikes is a swing with a longer arm: same arc, same loot, same ledger, so
    // nothing about killing a thing depends on what killed it
    const res = thrown(
      (manager, world) => swing(state, manager, world, player.x, player.z, player.entity.yaw, seed, true, standing, cast.blow),
      { damage: cast.blow.damage, range: cast.blow.range, arc: COMBAT.ARC },
    );
    if (res.killed.length > 0) {
      const rustling = felled(res.killed);
      flash(`Withered ${res.killed.map((e: Entity) => e.kind.label).join(', ')}`);
      if (rustling) flash(rustling);
      persist();
    }
    if (res.gold > 0) takeShare(res.gold);
    if (res.regard) { flash(`You are ${res.regard}.`); persist(); }
  };

  /**
   * Running out of hearts, wherever it happened and whatever did it.
   *
   * Every source of damage ends here, which is the point of it being one function: a blow that
   * empties the hearts and then returns to whatever called it leaves the hero conscious at nought,
   * with no death, no waking up and nothing on screen — which is how the whale used to sink you.
   *
   * It stops the world with a dialogue rather than a flash. Losing a fight is a thing that
   * happened to you, and three seconds of text at the top of the screen is not enough to tell
   * somebody why they are suddenly standing in a village they have never seen.
   */
  const knockOut = (cause: string) => {
    const below = places.underground !== null;
    const den = below ? places.underground!.poi.name : '';
    if (below) places.exitDungeon();
    else if (sailing.sailing) sailing.abandon();   // whatever happened at sea, you are not at sea now

    const woke = carriedTo(structures.villages, player.x, player.z);
    const lost = costOf(state.inventory.gold, GAMEPLAY.KO_GOLD_LOSS);
    state.inventory.gold -= lost;
    state.hp = state.maxHpTotal;
    breath.refill();
    state.version++;
    // underground you are left at the mouth of the place you went into; above ground somebody
    // carries you home. Either way you are somewhere you can walk away from.
    if (!below && woke) {
      player.teleport(woke.x + 2, woke.z + 2);
      // and the world is told, or it goes on holding him where he fell and hauls him back to it
      online.stood(player.x, player.z, 'carried');
    }

    const pages = saidOfKnockout(cause, woke, lost, below);
    if (below && den) pages[1] = `Somebody dragged you up out of the ${den} and left you at the mouth of it. You are alive.`;
    sound.thud();
    converse({ speaker: 'Knocked out', emoji: '💫', pages, choices: [{ label: 'Get up', next: () => null }] });
    persist();
  };

  /**
   * Say a blow out loud at the moment it is thrown, rather than when it arrives.
   *
   * The voice used to sound on the hit, which is the report of damage already taken — no use to
   * anybody. The wind-up is a warning only if it can be perceived, and the animation is worth
   * nothing at all for something standing behind you, which is precisely the case a warning is
   * worth most. A growl at your back is now something you can turn and answer.
   *
   * Only for things close enough to matter, so a wood full of distant wolves is not a racket.
   */
  const announceWindUps = (crowd: EntityManager) => {
    for (const e of crowd.within(player.x, player.z, HEARD_WINDING)) {
      if (e.winding <= 0) { e.warned = false; continue; }
      if (e.warned || e.dead) continue;
      e.warned = true;
      sound.voice(heftOf(e));
    }
  };

  const onAttack = (attacker: Entity, dmg: number) => {
    if (talking()) return;
    // Nothing on the ground reaches somebody standing on a sky island. Every distance in this game
    // is measured in x and z with no height in it — which is right for a world that is one
    // heightfield, and wrong for the one place where two pieces of ground share the same
    // coordinates — so without this a wolf on the island below walks to the square underneath the
    // village in the clouds and bites whoever is up in it. The pack is still simulated, because
    // the island below is meant to be alive when you look down at it; it simply cannot land a blow
    // on somebody a hundred feet over its head.
    if (skies.aloft) return;
    // A blow buys you a moment. Without it a swarm lands every one of its hits in the same
    // instant and a full-health hero dies before the screen has finished flashing, which is
    // not a fight, it is an announcement.
    if (reeling > 0) return;

    /**
     * The arm goes up, or it does not. A guard raised in the fraction of a second after the thing
     * in front of you commits turns the blow aside completely and leaves whoever threw it
     * flat-footed; one that has been held since before the swing started only takes the edge off.
     * Holding the key down deliberately gets you the worse of the two.
     */
    const answered = breath.answer(
      true,
      // and only if it is coming at a side of you the arm is on. Being hit turns you to face the
      // thing, so a second blow from the same quarter is one you can answer — an ambush costs you
      // the first and no more.
      guardCovers(player.entity.yaw, attacker.x - player.x, attacker.z - player.z),
    );
    if (answered === 'parried') {
      // it went past you, and it is now standing there with its weight in the wrong place
      attacker.hurt = BREATH.STAGGER;
      attacker.attackCooldown = BREATH.STAGGER;
      attacker.winding = 0;
      const px = attacker.x - player.x, pz = attacker.z - player.z;
      const gap = Math.hypot(px, pz) || 1;
      attacker.x += (px / gap) * BEHAVIOUR.KNOCKBACK;
      attacker.z += (pz / gap) * BEHAVIOUR.KNOCKBACK;
      // no shape of its own: the arm comes across, which is what a deflection looks like anyway
      throwBlow(player.entity, 'swing');
      sound.chime();
      flash('Parried.');
      director.saw('fight');
      return;
    }
    const taken = Breath.after(answered, dmg);
    if (answered === 'blocked') { sound.thud(); flash('Blocked.'); }

    reeling = GAMEPLAY.REELING;

    // and it knocks you back, which is the space you get to react in
    const dx = player.x - attacker.x, dz = player.z - attacker.z;
    const len = Math.hypot(dx, dz) || 1;
    player.shove((dx / len) * GAMEPLAY.KNOCKED_BACK, (dz / len) * GAMEPLAY.KNOCKED_BACK);
    // and it turns you to face whatever did it. A swing only covers the arc in front of you, so
    // being bitten from behind used to leave you hitting air with no idea which way to look;
    // wheeling round on the thing is what a person does anyway, and it is now the difference
    // between answering an ambush and standing in one.
    player.entity.yaw = yawFor(attacker.x - player.x, attacker.z - player.z);
    throwBlow(player.entity, player.entity.blow);   // the hero flinches with everything else
    player.entity.hurt = BEHAVIOUR.HURT_TIME;

    hurt();
    sound.thud();
    if (sailing.sailing && !sailing.overboard && attacker.kind.behaviour === 'circle') {
      // it came up under the hull: over the side, and now you are in the water with it
      sailing.throwOverboard();
      sound.splash();
      flash(`${attacker.kind.label} hits the boat. You are in the water.`);
    }
    if (!struck(state, taken, magic.ward)) return;
    knockOut(attacker.kind.label);
  };

  return {
    attack, loose, conjure, onAttack, announceWindUps, knockOut,
    /**
     * What a blow costs in time, counted before the frame decides where the hero is standing.
     *
     * All three of these used to be counted down at the bottom of the outdoor path, past the two
     * early returns — so underground and indoors they were set once and never came off again. For
     * the two cooldowns that meant exactly one swing per visit however long you stayed, which made
     * clearing a mine out impossible; that was found by trying to fight a cave empty and hitting a
     * rat once, and fixed. `reeling` was left behind in the same place, and it fails the other way
     * round: the moment of grace a blow buys you never expires, so one bite from a rat makes the
     * hero untouchable for the rest of the visit. A mine you cannot be hurt in is not a fight
     * either. They are counted together now so that the next thing of this kind cannot be added to
     * one list and forgotten in the other.
     */
    cooled: (dt: number): void => {
      swingCooldown = Math.max(0, swingCooldown - dt);
      drawCooldown = Math.max(0, drawCooldown - dt);
      reeling = Math.max(0, reeling - dt);
    },
  };
}
