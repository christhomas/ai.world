import { ITEMS } from '../items';
import { askingPrice, lotLine, type Pitch } from '../market';
import { tradableItems } from '../online';
import { STALL_DAYS, STALL_RENT, type Stall } from '../../../server/protocol';
import { HORSE } from '../mount';
import { compassDir } from '../../world/structures';
import { GAMEPLAY } from '../../core/config';
import { faceFor } from '../talk';
import { REACH } from '../places';
import { errandDone, pubTalk } from '../pub';
import type { DialogueChoice, DialogueNode } from '../../ui/dialogue';
import type { Surroundings } from './context';

/**
 * What Enter does inside a settlement: step through a door, read the board, deal at a market
 * pitch, read a fingerpost, buy or mount a horse.
 */
export function villageInteractions(ctx: Surroundings) {
  const { player, state, structures, places, dialogue, hud, sound, market, online, mount, entities, entityRenderer, chunks, register, persist, questLine, quests, handover, discovered, seed } = ctx;

  /**
   * The pub. At its door you get the room before you get the doorway: what the regulars are
   * saying, and the one errand somebody in there wants doing. The errand is also settled here,
   * because whoever asked for it is the person still sitting inside.
   */
  const tryPub = (): boolean => {
    for (const village of structures.villages) {
      const pub = village.pub;
      if (!pub) continue;
      if (Math.hypot(pub.doorX + 0.5 - player.x, pub.doorZ + 0.5 - player.z) > REACH.BUILDING_DOOR) continue;
      const talk = pubTalk(village, structures, seed);
      if (!talk) continue;
      const errand = talk.errand;
      const status = errand ? state.quests.get(errand.id) : undefined;
      const settled = errand !== null && status === 'active' && errandDone(errand, state.discovered, (id) => state.count(id));

      const pages = [`${talk.name}, ${village.name}. ${talk.room}`, talk.rumours.join('\n')];
      if (!errand) pages.push('Nobody in here wants anything from you tonight.');
      else if (status === 'done') pages.push('Your errand here is long settled, and the room remembers it.');
      else if (status === 'active') pages.push(settled ? errand.done[0] : errand.reminder);
      else pages.push(...errand.intro);

      const choices: DialogueChoice[] = [];
      if (errand && status === undefined) {
        choices.push({ label: `Take it on (${errand.reward}g)`, next: () => {
          state.quests.set(errand.id, 'active');
          state.version++;
          sound.select();
          hud.flash(`Errand taken: ${questLine(errand)}`);
          persist();
          return null;
        } });
      }
      if (errand && settled) {
        choices.push({ label: `Collect ${errand.reward} gold`, next: () => {
          if (errand.kind === 'fetch') {
            const left = state.count(errand.target) - errand.count;
            if (left > 0) state.inventory.items.set(errand.target, left); else state.inventory.items.delete(errand.target);
          }
          state.inventory.gold += errand.reward;
          state.quests.set(errand.id, 'done');
          state.version++;
          sound.jingle();
          hud.flash(`${errand.reward} gold from ${talk.name}.`);
          persist();
          return null;
        } });
      }
      const door = structures.doors.find((d) => d.village === village.name && d.bx === pub.house.tx && d.bz === pub.house.tz);
      if (door) choices.push({ label: 'Get a drink', next: () => { places.enterBuilding(door); return null; } });
      choices.push({ label: 'Walk on', next: () => null });

      dialogue.start({ speaker: talk.name, emoji: '🍺', pages, choices });
      return true;
    }
    return false;
  };

  /** Enter/Space at a doorway steps inside. The pub answers first: its door is a conversation. */
  const tryDoor = (): boolean => {
    if (tryPub()) return true;
    for (const door of structures.doors) {
      if (Math.hypot(door.x - player.x, door.z - player.z) > REACH.BUILDING_DOOR) continue;
      places.enterBuilding(door);
      return true;
    }
    return false;
  };

  /**
   * Reading the village board: the errand posted here, taken or not, and what the village knows
   * about places nearby. Accepting from the board saves hunting for the elder.
   */
  const tryBoard = (): boolean => {
    for (const village of structures.villages) {
      if (!village.board) continue;
      if (Math.hypot(village.board[0] - player.x, village.board[1] - player.z) > 2.2) continue;
      const quest = quests.get(village.name);
      const status = quest ? state.quests.get(quest.id) : undefined;
      const nearby = [...structures.pois, ...structures.caves, ...structures.wrecks]
        .map((p) => ({ name: p.name, d: Math.hypot(p.x - village.x, p.z - village.z), x: p.x, z: p.z }))
        .filter((p) => p.d < 120)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map((p) => `${state.discovered.has(p.name) ? p.name : 'somewhere unnamed'} — ${compassDir(p.x - village.x, p.z - village.z)}, ${Math.round(p.d)} tiles`);

      const pages = [`Notices of ${village.name}.`];
      if (!quest) pages.push('Nothing posted but old nails and older paper.');
      else if (status === 'done') pages.push(`The elder's notice has been struck through: ${questLine(quest)}. Settled.`);
      else if (status === 'active') pages.push(`Posted: ${questLine(quest)}. You have taken this on.`);
      else pages.push(`Posted by the elder: ${questLine(quest)}. Reward ${quest.reward} gold.`);
      if (nearby.length) pages.push(`Roads from here:\n${nearby.join('\n')}`);

      const choices = quest && status === undefined
        ? [
            { label: `Take the errand (${quest.reward}g)`, next: () => {
              state.quests.set(quest.id, 'active');
              state.version++;
              sound.select();
              hud.flash(`Errand taken: ${questLine(quest)}`);
              persist();
              return null;
            } },
            { label: 'Leave it', next: () => null },
          ]
        : undefined;
      dialogue.start({ speaker: 'Notice Board', emoji: '📜', pages, choices });
      return true;
    }
    return false;
  };

  /** How many kinds of goods a trader is offered at once when stocking a pitch. */
  const STOCK_CHOICES = 8;
  /** How many lots a shopper is shown on one stall. */
  const LOTS_SHOWN = 6;
  const STALL = { speaker: 'Market Pitch', emoji: '🏪' };

  /** An empty pitch, waiting for somebody to take it on. */
  const emptyPitch = (pitch: Pitch): DialogueNode => ({
    ...STALL,
    pages: [`An empty pitch in ${pitch.village}. ${STALL_RENT} gold holds it for ${STALL_DAYS} days.`],
    choices: [
      { label: `Rent it (${STALL_RENT}g)`, next: () => {
        if (state.inventory.gold < STALL_RENT) { hud.flash(`You need ${STALL_RENT} gold for the pitch.`); return null; }
        handover.offer(state, null, STALL_RENT);
        online.rentStall(pitch.id, pitch.village);
        hud.flash('The pitch is yours. Put something out.');
        return null;
      } },
      { label: 'Leave it', next: () => null },
    ],
  });

  /** What to put out on a pitch of your own, and what it is worth. */
  const stockMenu = (stall: Stall): DialogueNode => {
    const carried = tradableItems(state).filter(([id]) => ITEMS[id]);
    return {
      ...STALL,
      pages: carried.length ? ['What goes out on the trestle?'] : ['Your pack is empty of anything worth selling.'],
      choices: [
        ...carried.slice(0, STOCK_CHOICES).map(([id]) => ({
          label: `${ITEMS[id].emoji} ${ITEMS[id].name} — ask ${askingPrice(id)}g`,
          next: () => {
            handover.offer(state, id);
            online.stockStall(stall.id, { id, price: askingPrice(id), count: 1 });
            hud.flash(`${ITEMS[id].name} is on the stall at ${askingPrice(id)} gold.`);
            return null;
          },
        })),
        { label: 'Never mind', next: () => null },
      ],
    };
  };

  /** Your own pitch: what is out, what it has earned, and whether to keep it. */
  const myStall = (stall: Stall): DialogueNode => ({
    speaker: `Your stall in ${stall.village}`,
    emoji: STALL.emoji,
    pages: [
      `Rent paid until day ${stall.until}. Takings: ${stall.takings} gold.`,
      stall.items.length ? stall.items.map(lotLine).join('\n') : 'Nothing out yet.',
    ],
    choices: [
      { label: 'Put something out', next: () => stockMenu(stall) },
      { label: `Take the takings (${stall.takings}g)`, next: () => { online.collectStall(stall.id); return null; } },
      { label: 'Pack up the stall', next: () => { online.closeStall(stall.id); hud.flash('The pitch is free again.'); return null; } },
      { label: 'Leave it be', next: () => null },
    ],
  });

  /** Somebody else's pitch: buy a lot, or walk on. */
  const theirStall = (stall: Stall): DialogueNode => ({
    speaker: `${stall.owner}'s stall`,
    emoji: STALL.emoji,
    pages: [stall.items.length ? 'Take your pick.' : 'The trestle is bare. Come back when the trader has been by.'],
    choices: [
      ...stall.items.slice(0, LOTS_SHOWN).map((lot, index) => ({
        label: lotLine(lot),
        next: () => {
          if (state.inventory.gold < lot.price) { hud.flash(`That costs ${lot.price} gold.`); return null; }
          online.buyFromStall(stall.id, index);
          return null;
        },
      })),
      { label: 'Walk on', next: () => null },
    ],
  });

  /**
   * A market pitch in a village square. Anyone online can rent one, put goods out at their own
   * price, and come back for the money; the goods stay out while the trader is away. Which of the
   * three conversations you get depends only on who holds the pitch.
   */
  const tryStall = (): boolean => {
    const pitch = market.nearest(structures.villages, player.x, player.z);
    if (!pitch) return false;
    if (!online.connected) {
      dialogue.start({ ...STALL, pages: ['A trestle and a striped awning, waiting for a trader. Join a world online to take it on.'] });
      return true;
    }
    const stall = pitch.stall;
    dialogue.start(!stall ? emptyPitch(pitch) : stall.owner === online.name ? myStall(stall) : theirStall(stall));
    return true;
  };

  /** Read a fingerpost: names and distances of the nearest settlements. */
  const trySignpost = (): boolean => {
    for (const post of structures.signposts) {
      if (Math.hypot(post.x - player.x, post.z - player.z) > 2.4) continue;
      const lines = post.directions.map((d) => `${d.name} — ${d.dir}, ${d.tiles} tiles`);
      dialogue.start({ speaker: 'Fingerpost', emoji: '🪧', pages: [lines.join('\n')] });
      return true;
    }
    return false;
  };

  /** Enter near a horse: buy a wild one, or get on and off your own. */
  const tryHorse = (): boolean => {
    if (mount.riding) {
      mount.dismount(player, chunks);
      hud.flash(`You dismount and tie up ${mount.name}.`);
      sound.select();
      persist();
      return true;
    }
    if (mount.near(player.x, player.z)) {
      mount.mount(player);
      hud.flash(`You swing up onto ${mount.name}.`);
      sound.chime();
      return true;
    }
    // horses in the field are half wild; the one you can buy is the stablehand's
    const hand = entities.within(player.x, player.z, GAMEPLAY.TALK_RANGE).find((e) => e.role === 'stablehand');
    if (!hand) return false;
    const price = HORSE.PRICE;
    const village = hand.herd.tag || 'the village';
    if (mount.owned) {
      dialogue.start({ speaker: `${hand.name}, the Stablehand`, emoji: '🧑‍🌾', face: faceFor(hand, { register, day: state.day }), pages: [`${mount.name} is a good horse. Mind the shoes.`] });
      return true;
    }
    dialogue.start({
      speaker: `${hand.name}, the Stablehand`, emoji: '🧑‍🌾', face: faceFor(hand, { register, day: state.day }),
      pages: [`I have ${mount.offer()} out back, saddle and all. ${price} gold and the halter is yours.`],
      choices: [
        { label: `Buy the horse (${price}g)`, next: () => {
          if (state.inventory.gold < price) {
            return { speaker: `${hand.name}, the Stablehand`, emoji: '🧑‍🌾', face: faceFor(hand, { register, day: state.day }), pages: [`Come back with ${price} gold.`] };
          }
          state.inventory.gold -= price;
          state.version++;
          const horse = mount.buy(hand.x + 1.5, hand.z, chunks, entityRenderer);
          sound.jingle();
          hud.flash(`${horse} is yours, stabled in ${village}. Press Enter beside them to ride.`);
          persist();
          return null;
        } },
        { label: 'Not today', next: () => null },
      ],
    });
    return true;
  };

  /** The pitch we last walked up to, so the same stall is only announced once. */
  let noticedPitch = '';

  /** Say whose stall this is as you come to it: a bare awning looks the same as a busy one. */
  const noticeStall = (): void => {
    const pitch = market.nearest(structures.villages, player.x, player.z);
    if (!pitch || !pitch.stall) { noticedPitch = pitch ? noticedPitch : ''; return; }
    if (pitch.id === noticedPitch) return;
    noticedPitch = pitch.id;
    const stall = pitch.stall;
    const lots = stall.items.length;
    hud.flash(stall.owner === online.name
      ? `Your stall — ${stall.takings} gold taken`
      : `${stall.owner}'s stall — ${lots ? `${lots} lot${lots === 1 ? '' : 's'} out` : 'nothing out'}`);
  };

  return { tryDoor, tryBoard, tryStall, trySignpost, tryHorse, noticeStall };
}
