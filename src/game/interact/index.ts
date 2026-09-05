import { GAMEPLAY } from '../../core/config';
import { villageInteractions } from './village';
import { wildInteractions } from './wild';
import { travelInteractions } from './travel';
import { peopleInteractions } from './people';
import { craftInteractions } from './craft';
import { campInteractions } from './camp';
import { herbInteractions } from './herbs';
import { jailInteractions } from './jail';
import { wildCampInteractions } from './wildcamps';
import { hireInteractions } from './hire';
import { giftInteractions } from './gifts';
import { rescueInteractions } from './rescue';
import { nemesisInteractions } from './nemesis';
import type { Surroundings } from './context';

export type { Surroundings } from './context';

/**
 * Everything the Enter key can do, in the order it is tried. The order is the design: the thing
 * you are standing closest to wins, and talking to whoever is nearby is the fallback when nothing
 * else answers.
 *
 * A person adding an interaction writes it in the file for where it happens — a settlement, the
 * open country, or the water — and adds one line to the chain below.
 */
export function createInteractions(ctx: Surroundings) {
  const village = villageInteractions(ctx);
  const wild = wildInteractions(ctx);
  const travel = travelInteractions(ctx);
  const people = peopleInteractions(ctx);
  const craft = craftInteractions(ctx);
  const camp = campInteractions(ctx);
  const herbs = herbInteractions(ctx);
  const jail = jailInteractions(ctx);
  const wildcamps = wildCampInteractions(ctx);
  const hire = hireInteractions(ctx);
  const gifts = giftInteractions(ctx);
  const rescue = rescueInteractions(ctx);
  const nettle = nemesisInteractions(ctx);
  const { player, places, dialogue, hud, entities, skies, startTalk } = ctx;

  const talkNearest = () => {
    // the choice outranks every door in the game: there is a clock on it and people in the water
    if (nettle.tryChoice()) return;
    if (places.indoors) {
      const inside = places.interactIndoors();
      if (inside === 'keeper') startTalk(places.indoors.keeper!);
      else if (inside === null) hud.flash('Stand at the door to leave, or at the counter to talk.');
      return;
    }
    if (places.underground) {
      const below = places.interactUnderground();
      if (below === 'locked') hud.flash('The door is locked. A key must be down here somewhere.');
      else if (below === 'descent') {
        dialogue.start({ speaker: 'Stairs Down', emoji: '🕳️', pages: ['The steps go further down, into colder air. Follow them?'], choices: [
          { label: 'Go deeper', next: () => { places.descend(); return null; } },
          { label: 'Not yet', next: () => null },
        ] });
      }
      else if (below === 'stairs') {
        dialogue.start({ speaker: 'Stairs', emoji: '🪜', pages: ['Climb back up to the daylight?'], choices: [
          { label: 'Climb out', next: () => { places.exitDungeon(); return null; } },
          { label: 'Stay', next: () => null },
        ] });
      } else if (below === null) hud.flash('Nothing here');
      return;
    }
    // Up on a sky island the whole ground-level chain is wrong, and dangerously so: the hero is
    // standing twenty-six units directly above an island with its own villages, doors, shrines and
    // diggable hillsides, every one of which would answer an Enter press meant for a crag.
    if (skies.aloft) {
      if (travel.trySky()) return;
      hud.flash('Nothing here but cloud. The crag on the rim is where the bird waits.');
      return;
    }
    // a body under your feet is the most specific thing there is, so it beats the village
    // furniture standing around it: a rabbit dropped in the square was unskinnable without this
    if (camp.trySkin()) return;
    if (travel.tryBoat()) return;
    if (travel.tryEagle()) return;   // a crag with a bird on it, before anything else up here
    // and the birds at the foot of a fall coming out of the sky, which is the way up to a village
    // nobody can walk to. Ahead of the village furniture: an island under a sky island has houses
    // on it, and losing the only way up to a doorway you can reach from twenty other tiles would
    // be the worst trade in the chain.
    if (travel.trySkyward()) return;
    if (village.tryHorse()) return;
    if (wild.tryFarm()) return;
    if (village.tryLuxury()) return;
    if (village.tryStall()) return;
    if (nettle.tryScheme()) return;
    if (village.tryBoard()) return;
    if (jail.tryCell()) return;   // the station door is a grille to look through, not a way in
    if (village.tryDoor()) return;
    if (wild.tryShrine()) return;
    if (wild.tryRemains()) return;
    if (wild.tryWreck()) return;
    if (wildcamps.tryWildCamp()) return;   // somebody else's camp: banked fire, or torn open
    if (wild.tryCampfire()) return;
    if (craft.tryCook()) return;
    if (craft.tryKindle()) return;
    if (village.trySignpost()) return;
    if (travel.tryFerry()) return;
    if (wild.tryFish()) return;
    // digging comes last of the ground-level things: a shovel in the pack should never swallow an
    // Enter press meant for a person, a door or a line in the water
    if (wild.tryDig()) return;
    if (craft.tryFell()) return;
    if (herbs.tryPick()) return;
    if (herbs.tryGrind()) return;
    if (camp.tryCamp()) return;
    if (rescue.tryRescue()) return;   // an elder burying too many asks before anything else does
    if (hire.tryHire()) return;
    const e = entities.nearest(player.x, player.z, GAMEPLAY.TALK_RANGE);
    if (e) startTalk(e); else hud.flash('No one close enough to talk to');
  };

  return {
    atHand: talkNearest,
    fell: camp.fell,
    onTheft: wildcamps.onTheft,
    campsAround: wildcamps.campsAround,
    campEmptied: wildcamps.emptied,
    takeShare: hire.takeShare,
    musterHires: hire.muster,
    hireFallen: hire.fallen,
    hireMenu: hire.hireMenu,
    // deliberately not in the Enter chain: giving would swallow every press meant for a hello
    tryGive: gifts.tryGive,
    runClock: nettle.runClock,
    heWentDown: nettle.heWentDown,
    wordOfHim: nettle.wordOfHim,
    troubleKilled: rescue.onKill,
    villageNights: rescue.nightfall,
    villageWelcome: rescue.welcomeAt,
    onVisitor: camp.onVisitor,
    ageCamps: camp.age,
    carcasses: camp.bodies,
    noticeStall: village.noticeStall,
    sailFerries: travel.sailFerries,
    aboard: travel.aboard,
    offerTrade: people.offerTrade,
    showOffer: people.showOffer,
    partyMenu: people.partyMenu,
  };
}
