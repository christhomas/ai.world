import { PING_LIFE } from '../../server/protocol';
import { SLOTS } from './items';
import { ITEMS } from './shops';
import { spoils } from './combat';
import { Online, applyTrade, type Presence, type TradeOffer, type WorldDelta } from './online';
import { Coop } from './coop';
import { Market } from './market';
import { Party } from './party';
import { Duel } from './duel';
import { Handover } from './handover';
import { OtherPlayers } from '../render/others';
import { PlayerList } from '../ui/players';
import { compassDir } from '../world/structures';
import { $ } from '../ui/dom';
import type * as THREE from 'three';
import { damageEntity, type Entity } from '../entities/entity';
import type { EntityRenderer } from '../entities/pool';
import type { Player } from '../entities/player';
import type { GameState } from './state';
import type { Places } from './places';
import type { Plots } from './farming';
import type { Quest } from './quests';
import type { Mount } from './mount';
import type { Sailing } from './sailing';
import type { DialogueBox } from '../ui/dialogue';
import type { Hud } from '../ui/hud';
import type { Chat } from '../ui/chat';
import type { Sound } from './audio';
import type { MapMarker } from '../ui/mapbase';

/**
 * Everything that happens because other people are in your world: the connection, the market, the
 * post shelf, parties, duels, gestures, rally points, and the monsters on a floor two of you are
 * standing on.
 *
 * All of it is optional. With no server the game is exactly as it was, so every one of these
 * objects sits there costing nothing until somebody joins.
 */
export interface MultiplayerContext {
  player: Player;
  state: GameState;
  places: Places;
  plots: Plots;
  mount: Mount;
  sailing: Sailing;
  entityRenderer: EntityRenderer;
  camera: THREE.Camera;
  dialogue: DialogueBox;
  hud: Hud;
  chat: Chat;
  sound: Sound;
  questList: Quest[];
  /** Places the hero has named, shared with the rest of the game. */
  discovered: Set<string>;
  seed: number;
  /** Which world the hero is standing in: the surface, a dungeon floor, or a building. */
  placeName: () => string;
  persist: () => void;
  /** Name a place the first time anybody reaches it. */
  discover: (name: string) => void;
  /**
   * How an offer of goods is put to the player. The dialogue that answers it belongs to the
   * interaction layer, which is built after this one, so main.ts hands it over here.
   */
  showOffer: (offer: TradeOffer, fromName: string) => void;
}

export function createMultiplayer(ctx: MultiplayerContext) {
  const {
    player, state, places, plots, mount, sailing, entityRenderer, camera,
    dialogue, hud, chat, sound, questList, discovered, seed, placeName, persist, showOffer,
  } = ctx;
  const onlineStatus = $('onlineStatus');
  const duelBar = $('duelbar');

  const market = new Market();
  const party = new Party();
  const duel = new Duel();
  const handover = new Handover();
  const others = new OtherPlayers(entityRenderer);
  const playerList = new PlayerList();
  /** Rally points people have dropped, each fading in its own time. */
  const rally: Array<{ x: number; z: number; name: string; left: number }> = [];

  const online = new Online({
    onChat: (line) => chat.line(line),
    onSystem: (line) => { chat.line(line, 'sys'); hud.flash(line); },
    // the world's own time wins while you are in it, so everyone shares a dawn
    onClock: (clock) => { state.day = clock.day; state.time = clock.time; state.version++; },
    onDelta: (delta, catchingUp) => applyWorldDelta(delta, catchingUp),
    onMonsters: (place, snap, gone) => {
      const floor = places.underground;
      if (!floor) return;
      const mine = coop.applySnap(place, snap, gone, floor.monsters, (m) => floor.monsters.despawnEntity(m));
      // the floor's owner resolved the blow, so the spoils are handed out here instead
      for (const fallen of mine) creditKill(fallen);
    },
    onHit: (place, index, damage) => {
      // we own this floor, so a blow reported by somebody else is resolved here
      const floor = places.underground;
      if (!floor || !coop.hosting || place !== placeName()) return;
      const monster = floor.monsters.onRoster(index);
      if (!monster || monster.dead) return;
      if (damageEntity(monster, damage, monster.x + 1, monster.z, floor.world)) floor.monsters.despawnEntity(monster);
    },
    onStalls: (stalls) => { market.receive(stalls); handover.settle(); },
    onFolk: (names) => { if (names.length > 1) chat.line(`Known in this world: ${names.join(', ')}.`, 'sys'); },
    onMail: (letters) => {
      if (letters.length === 0) { hud.flash('Nothing on the shelf for you.'); return; }
      const named: string[] = [];
      for (const letter of letters) {
        state.inventory.gold += letter.gold;
        for (const [id, n] of letter.items) { state.give(id, n); named.push(`${n}× ${ITEMS[id]?.name ?? id}`); }
        if (letter.gold > 0) named.push(`${letter.gold} gold`);
        chat.line(`Parcel from ${letter.from}, posted on day ${letter.day}.`, 'sys');
      }
      state.version++;
      sound.jingle();
      hud.flash(`Collected ${named.join(', ')}`);
      persist();
    },
    onMailWord: (line, kind) => {
      // a parcel that could not be left comes back into your hands
      if (kind === 'refused') handover.giveBack(state);
      if (kind === 'sent') handover.settle();
      chat.line(line, 'sys');
      hud.flash(line);
    },
    onBought: (_stall, item, cost) => {
      state.inventory.gold = Math.max(0, state.inventory.gold - cost);
      state.give(item.id, item.count);
      state.version++;
      sound.jingle();
      hud.flash(`Bought ${ITEMS[item.id]?.name ?? item.id} for ${cost} gold`);
      persist();
    },
    onTakings: (_stall, gold) => {
      state.inventory.gold += gold;
      state.version++;
      if (gold > 0) sound.jingle();
      hud.flash(gold > 0 ? `Took ${gold} gold from the stall` : 'Nothing sold yet');
      persist();
    },
    onStallRefused: (_stall, reason) => {
      // put back whatever we handed over in hope: the stall would not take it
      handover.giveBack(state);
      hud.flash(reason);
    },
    onDuelWord: (line, challenge) => {
      if (!challenge) { chat.line(line, 'sys'); hud.flash(line); return; }
      dialogue.start({ speaker: challenge.name, emoji: '⚔️', pages: [line, 'Nothing is at stake but the bragging.'], choices: [
        { label: 'Draw your sword', next: () => { online.answerChallenge(challenge.from, true); return null; } },
        { label: 'Decline', next: () => { online.answerChallenge(challenge.from, false); return null; } },
      ] });
    },
    onDuelBegun: (withId, withName) => {
      duel.begin(withId, withName, state.maxHpTotal);
      sound.chime();
      chat.line(`A bout with ${withName} begins. First to run out of breath loses.`, 'sys');
      hud.flash(`Duel with ${withName}!`);
    },
    onDuelStruck: (damage) => {
      // the bout's standing is on screen the whole time, so a blow only needs to be heard
      if (!duel.struck(damage)) { sound.thud(); return; }
      // out of breath: say so, and the server tells both sides it is over
      online.yieldDuel();
      hud.flash(`${duel.opponentName} wins the bout.`);
    },
    onDuelOver: (winner, name) => {
      // `name` is whoever gave it up, which is you when you were the one who ran out of breath
      const opponent = duel.opponentName || 'your opponent';
      const line = winner === '' ? `${name} would rather not fight.`
        : winner === online.id ? `${name} yields. The bout is yours.`
        : `You yield. ${opponent} takes the bout.`;
      duel.end();
      chat.line(line, 'sys');
      hud.flash(line);
    },
    onEmote: (id, name, emoji, kind) => {
      others.emote(id, emoji);
      chat.line(`${name} ${kind}s. ${emoji}`, 'sys');
    },
    onPing: (x, z, name) => {
      rally.push({ x, z, name, left: PING_LIFE });
      sound.select();
      hud.flash(`${name} marked a rally point — ${compassDir(x - player.x, z - player.z)}, ${Math.round(Math.hypot(x - player.x, z - player.z))} tiles`);
    },
    onParty: (members) => {
      party.receive(members);
      chat.line(members.length ? `Party: ${members.map((m) => m.name).join(', ')}.` : 'You are travelling alone again.', 'sys');
      hud.flash(members.length ? `Travelling ${party.describe(online.id)}` : 'The party has broken up');
    },
    onPartyWord: (line, invite) => {
      if (!invite) { chat.line(line, 'sys'); hud.flash(line); return; }
      dialogue.start({ speaker: invite.name, emoji: '🧭', pages: [line], choices: [
        { label: 'Travel together', next: () => { online.answerInvite(invite.from, true); return null; } },
        { label: 'Not today', next: () => { online.answerInvite(invite.from, false); return null; } },
      ] });
    },
    onPartyDeed: (quest, from) => {
      // an errand a companion finished counts for us, if we had taken it on as well
      if (state.quests.get(quest) !== 'active') return;
      const errand = questList.find((q) => q.id === quest);
      if (!errand) return;
      state.quests.set(quest, 'done');
      state.inventory.gold += errand.reward;
      state.version++;
      sound.fanfare();
      hud.flash(`${from} finished the errand for ${errand.village} (+${errand.reward}g)`);
      persist();
    },
    onOffer: (offer, fromName) => showOffer(offer, fromName),
    onTradeResult: ({ accepted, offer, iSent }) => {
      if (!accepted) { chat.line('The trade was declined.', 'sys'); return; }
      const what = applyTrade(state, offer, iSent);
      chat.line(iSent ? `You handed over ${what}.` : `You received ${what}.`, 'sys');
      hud.flash(iSent ? `Gave ${what}` : `Received ${what}`);
      persist();
    },
  });

  const coop = new Coop({
    sendSnap: (place, snap, gone) => online.monsters(place, snap, gone),
    sendHit: (place, index, damage) => online.hit(place, index, damage),
  });

  /** Keep the bout's standing in front of the fighters while it lasts. */
  const showDuel = (): void => {
    duelBar.classList.toggle('show', duel.active);
    if (duel.active) duelBar.textContent = duel.readout();
  };

  /** Bank what a monster somebody else resolved for us left behind. */
  const creditKill = (fallen: Entity): void => {
    const won = spoils(state, fallen, seed);
    state.inventory.gold += won.gold;
    state.version++;
    sound.chime();
    const spoilsText = [won.gold > 0 ? `${won.gold} gold` : '', ...won.loot.map((id) => ITEMS[id]?.name ?? id)].filter(Boolean);
    hud.flash(spoilsText.length ? `Defeated ${fallen.kind.label} (+${spoilsText.join(', ')})` : `Defeated ${fallen.kind.label}`);
    persist();
  };

  /**
   * Something a player changed about the world: a chest opened, a vault unlocked, a crop sown or
   * lifted, a place named. Applying it locally is all it takes, because the rest of the world is
   * identical on every client.
   */
  const applyWorldDelta = (delta: WorldDelta, catchingUp: boolean): void => {
    switch (delta.kind) {
      case 'chest':
        state.opened.add(delta.id);
        places.underground?.scene.rebuildProps(state.opened);
        break;
      case 'key':
        state.keys.add(delta.id);
        if (places.underground?.world.anchorId.startsWith(delta.id)) places.underground.world.unlocked = true;
        break;
      case 'sow': {
        const [tx, tz] = delta.tile.split(',').map(Number);
        plots.plant(tx, tz, delta.crop, delta.day);
        break;
      }
      case 'reap': {
        const [tx, tz] = delta.tile.split(',').map(Number);
        plots.harvest(tx, tz, Number.MAX_SAFE_INTEGER);
        break;
      }
      case 'found':
        discovered.add(delta.name);
        break;
    }
    state.version++;
    if (!catchingUp) persist();
  };

  /**
   * Everything the server needs from us this frame, and everyone else drawn where they say they
   * are. It runs in every branch of the loop, because people underground are still people.
   */
  const syncOnline = (dt: number, heightAt: (x: number, z: number) => number | null): void => {
    others.age(dt);
    showDuel();
    for (let i = rally.length - 1; i >= 0; i--) {
      rally[i].left -= dt;
      if (rally[i].left <= 0) rally.splice(i, 1);
    }
    playerList.refresh(playerListInput);
    const standingIn = placeName();
    online.update(dt, {
      x: player.x, z: player.z, yaw: player.entity.yaw, walk: player.entity.walk,
      place: standingIn, riding: sailing.sailing ? 'boat' : mount.riding ? 'horse' : 'foot',
      gear: SLOTS.map((slot) => state.worn(slot)?.id ?? '').filter(Boolean),
    });
    others.sync(online.players.values(), standingIn);
    others.settle(heightAt);
    others.project(camera, window.innerWidth, window.innerHeight);
    onlineStatus.textContent = online.connected
      ? `online · ${online.count + 1} here${party.size ? ` · party of ${party.size}` : ''}`
      : online.status;
  };

  const playerListInput = () => ({
    players: [...online.players.values()],
    party: new Set(party.roster.map((m) => m.id)),
    x: player.x, z: player.z, place: placeName(), me: online.name,
  });

  /** Companions and rally points, for both maps. */
  const markers = (): MapMarker[] => {
    const out: MapMarker[] = [];
    for (const mate of party.companions(online.players.values(), online.id)) {
      out.push({ x: mate.x, z: mate.z, color: '#ff5ec4', label: mate.name, emphasis: true });
    }
    for (const point of rally) {
      out.push({ x: point.x, z: point.z, color: '#ff7a1a', label: `${point.name}'s rally`, emphasis: true });
    }
    return out;
  };

  return {
    online, market, party, duel, coop, others, handover, rally,
    playerList, playerListInput, markers,
    sync: syncOnline,
    applyDelta: applyWorldDelta,
  };
}
