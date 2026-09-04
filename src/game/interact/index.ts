import { GAMEPLAY } from '../../core/config';
import { villageInteractions } from './village';
import { wildInteractions } from './wild';
import { travelInteractions } from './travel';
import { peopleInteractions } from './people';
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
  const { player, places, dialogue, hud, entities, startTalk } = ctx;

  const talkNearest = () => {
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
    if (travel.tryBoat()) return;
    if (village.tryHorse()) return;
    if (wild.tryFarm()) return;
    if (village.tryStall()) return;
    if (village.tryBoard()) return;
    if (village.tryDoor()) return;
    if (wild.tryShrine()) return;
    if (wild.tryWreck()) return;
    if (wild.tryCampfire()) return;
    if (village.trySignpost()) return;
    if (travel.tryFerry()) return;
    if (wild.tryFish()) return;
    const e = entities.nearest(player.x, player.z, GAMEPLAY.TALK_RANGE);
    if (e) startTalk(e); else hud.flash('No one close enough to talk to');
  };

  return {
    atHand: talkNearest,
    noticeStall: village.noticeStall,
    sailFerries: travel.sailFerries,
    aboard: travel.aboard,
    offerTrade: people.offerTrade,
    showOffer: people.showOffer,
    partyMenu: people.partyMenu,
  };
}
