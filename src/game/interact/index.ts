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
import { builderInteractions } from './builder';
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
/** One row in the Enter selector: the words and the act stay on the same row so they cannot reorder. */
export interface Interaction {
  verb: string | (() => string);
  attempt: (preview?: boolean) => boolean;
}

/** Ask or run the first interaction that claims the press, preserving the chain's load-bearing order. */
export function firstInteraction(interactions: readonly Interaction[], preview: boolean): string | null {
  for (const interaction of interactions) {
    if (!interaction.attempt(preview)) continue;
    return typeof interaction.verb === 'function' ? interaction.verb() : interaction.verb;
  }
  return null;
}
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
  const builder = builderInteractions(ctx);
  const { player, places, dialogue, hud, entities, skies, startTalk } = ctx;

  const ordered: readonly Interaction[] = [
    { verb: () => ctx.craft().flying ? 'Land the craft' : 'Board the craft', attempt: travel.tryDerelict },
    { verb: 'Skin the carcass', attempt: camp.trySkin },
    { verb: travel.ferryLabel, attempt: travel.tryFerry },
    { verb: () => ctx.sailing.sailing ? 'Step ashore' : 'Use the boat', attempt: travel.tryBoat },
    { verb: 'Fly over the mountains', attempt: travel.tryEagle },
    { verb: 'Fly to the sky island', attempt: travel.trySkyward },
    { verb: () => ctx.mount.riding ? 'Dismount' : 'Ride the horse', attempt: village.tryHorse },
    { verb: 'Open the chest', attempt: builder.tryChest },
    { verb: 'Tend the field', attempt: wild.tryFarm },
    { verb: 'Visit the village baths', attempt: village.tryLuxury },
    { verb: 'Visit the stall', attempt: village.tryStall },
    { verb: 'Hear what troubles the village', attempt: nettle.tryScheme },
    { verb: 'Ask the hall', attempt: village.tryHall },
    { verb: 'Read the notice board', attempt: village.tryBoard },
    { verb: 'Look into the cell', attempt: jail.tryCell },
    { verb: 'Open the door', attempt: village.tryDoor },
    { verb: 'Enter the shrine', attempt: wild.tryShrine },
    { verb: 'Search the fallen pack', attempt: wild.tryRemains },
    { verb: 'Search the wreck', attempt: wild.tryWreck },
    { verb: 'Search the camp', attempt: wildcamps.tryWildCamp },
    { verb: 'Rest by the fire', attempt: wild.tryCampfire },
    { verb: 'Cook over the fire', attempt: craft.tryCook },
    { verb: 'Light a fire', attempt: craft.tryKindle },
    { verb: 'Read the signpost', attempt: village.trySignpost },
    { verb: 'Fish', attempt: wild.tryFish },
    { verb: 'Dig here', attempt: wild.tryDig },
    { verb: 'Fell the tree', attempt: craft.tryFell },
    { verb: 'Pick herbs', attempt: herbs.tryPick },
    { verb: 'Grind herbs', attempt: herbs.tryGrind },
    { verb: 'Make camp', attempt: camp.tryCamp },
    { verb: 'Ask the elder', attempt: rescue.tryRescue },
    { verb: 'Speak about hire', attempt: hire.tryHire },
    // last because a waiting builder answers on any open patch of ground
    { verb: 'Place the building', attempt: builder.tryBuild },
  ];

  const actionAtHand = (preview: boolean): string | null => {
    // the choice outranks every door in the game: there is a clock on it and people in the water
    if (nettle.tryChoice(preview)) return 'Answer Old Nettle';

    if (places.indoors) {
      const inside = places.interactIndoors(preview);
      // the landlord first: in a pub the person behind the bar is the room
      if (inside === 'keeper' && village.tryLandlord(preview)) return 'Ask the landlord';
      if (inside === 'keeper') {
        if (!preview) startTalk(places.indoors.keeper!);
        return 'Talk to ' + places.indoors.keeper!.name;
      }
      // Leaving wins at the threshold; an empty house's bed answers everywhere else in the room.
      if (inside === 'left') return 'Leave the building';
      if (village.tryFreeBed(preview)) return 'Sleep until morning';
      if (!preview) hud.flash('Stand at the door to leave, or at the counter to talk.');
      return null;
    }

    if (places.underground) {
      const below = places.interactUnderground(preview);
      if (below === 'chest') return 'Open the chest';
      if (below === 'locked') {
        if (!preview) hud.flash('The door is locked. A key must be down here somewhere.');
        return 'Try the locked door';
      }
      if (below === 'descent') {
        if (!preview) dialogue.start({ speaker: 'Stairs Down', emoji: '🕳️', pages: ['The steps go further down, into colder air. Follow them?'], choices: [
          { label: 'Go deeper', next: () => { places.descend(); return null; } },
          { label: 'Not yet', next: () => null },
        ] });
        return 'Go deeper';
      }
      if (below === 'stairs') {
        if (!preview) dialogue.start({ speaker: 'Stairs', emoji: '🪜', pages: ['Climb back up to the daylight?'], choices: [
          { label: 'Climb out', next: () => { places.exitDungeon(); return null; } },
          { label: 'Stay', next: () => null },
        ] });
        return 'Climb out';
      }
      if (!preview) hud.flash('Nothing here');
      return null;
    }

    // On a sky island every ground-level answer directly below the hero is wrong.
    if (skies.aloft) {
      if (travel.trySky(preview)) return skies.atLoft(player.x, player.z) ? 'Ask for a flight' : 'Fly back down';
      if (!preview) hud.flash('Nothing here but cloud. The crag on the rim is where the bird waits.');
      return null;
    }

    const chosen = firstInteraction(ordered, preview);
    if (chosen) return chosen;
    const nearest = entities.nearest(player.x, player.z, GAMEPLAY.TALK_RANGE);
    if (nearest) {
      if (!preview) startTalk(nearest);
      return 'Talk to ' + nearest.name;
    }
    if (!preview) hud.flash('No one close enough to talk to');
    return null;
  };

  const talkNearest = (): void => { void actionAtHand(false); };

  return {
    atHand: talkNearest,
    action: () => actionAtHand(true),
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
    builderDay: builder.builderDay,
    sailFerries: travel.sailFerries,
    aboard: travel.aboard,
    offerTrade: people.offerTrade,
    showOffer: people.showOffer,
    partyMenu: people.partyMenu,
  };
}
