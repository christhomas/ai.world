import type { Input } from '../core/input';
import type { Player } from '../entities/player';
import type { IsoCamera } from '../render/camera';
import type { SceneRig } from '../render/scene';
import type { Sound } from './audio';
import type { SpellId } from './magic';
import type { Online } from './online';
import type { Places } from './places';
import { PING_LIFE } from '../../server/protocol';
import type { Chat } from '../ui/chat';
import type { DialogueBox } from '../ui/dialogue';
import type { Hud } from '../ui/hud';
import type { Journal } from '../ui/journal';
import type { PhotoMode } from '../ui/photo';
import type { PlayerList } from '../ui/players';
import type { Rucksack } from '../ui/rucksack';
import type { WorldMap } from '../ui/worldmap';

/**
 * What every key does, in one place.
 *
 * It is a map of the whole game read sideways — every verb the player has is on this page, and
 * nothing that is not here can be reached from the keyboard at all. That is worth having as one
 * file because the interesting question about a binding is never what it does but what else is
 * already on that key, and the only way to answer it is to see them together.
 *
 * The guards repeat on purpose: a conversation and the console both take the keyboard, and a key
 * that forgets to check is a spell cast into a shop menu.
 */
export interface Keys {
  seed: number;
  input: Input;
  rig: SceneRig;
  iso: IsoCamera;
  player: Player;
  places: Places;
  online: Online;
  sound: Sound;

  // the panels a key opens, closes or steps through
  hud: Hud;
  dialogue: DialogueBox;
  chat: Chat;
  journal: Journal;
  rucksack: Rucksack;
  worldMap: WorldMap;
  photo: PhotoMode;
  playerList: PlayerList;

  // and what the game itself is being told to do
  attack: () => void;
  loose: () => void;
  conjure: (id: SpellId) => void;
  talkNearest: () => void;
  partyMenu: () => void;
  hireMenu: () => void;
  offerTrade: () => void;
  /** Hand something to whoever is standing in front of you. False when nobody is. */
  tryGive: () => boolean;
  toTitle: () => void;
  persist: () => void;
  /** Rally points last a few seconds and are drawn on both maps. */
  rally: Array<{ x: number; z: number; name: string; left: number }>;
  /** How many are walking with you, which decides who a rally point is for. */
  partySize: () => number;
  /** Asked at the moment the map opens, because it is a picture of where the hero is now. */
  mapInput: () => Parameters<WorldMap['toggle']>[0];
  journalInput: Parameters<Journal['refresh']>[0];
  playerListInput: Parameters<PlayerList['toggle']>[0];
}

export function bindKeys(ctx: Keys): void {
  const {
    seed, input, rig, iso, player, places, online, sound,
    hud, dialogue, chat, journal, rucksack, worldMap, photo, playerList,
    attack, loose, conjure, talkNearest, partyMenu, hireMenu, offerTrade, tryGive, toTitle,
    persist, rally, partySize, mapInput, journalInput, playerListInput,
  } = ctx;

  input.onKey('k', () => { if (!dialogue.isOpen && !chat.isTyping) partyMenu(); });
  input.onKey('l', () => {
    if (dialogue.isOpen || chat.isTyping) return;
    if (!online.connected) { hud.flash('Join a world online to see who else is about.'); return; }
    playerList.toggle(playerListInput);
  });
  input.onKey('r', () => {
    if (dialogue.isOpen || chat.isTyping) return;
    if (!online.connected) { hud.flash('Join a world online to rally anybody.'); return; }
    online.ping(player.x, player.z);
    rally.push({ x: player.x, z: player.z, name: 'your', left: PING_LIFE });
    hud.flash(partySize() ? 'Rally point marked for your party' : 'Rally point marked for everyone here');
  });
  input.onKey('o', () => hud.toggleOptions());
  input.onKey('f', () => { player.mode = player.mode === 'follow' ? 'free' : 'follow'; });
  input.onKey('t', () => { if (online.connected && !dialogue.isOpen && !chat.isTyping) chat.open(); });
  // the same gesture either way: hand something over. A villager takes precedence because they
  // are the one standing in front of you; a player offer is what it falls back to.
  input.onKey('g', () => { if (!dialogue.isOpen && !chat.isTyping && !tryGive()) offerTrade(); });
  input.onKey('y', () => { if (!dialogue.isOpen && !chat.isTyping) hireMenu(); });

  input.onKey('p', () => {
    const on = photo.toggle();
    player.mode = on ? 'free' : 'follow';
    if (!on) hud.flash('Photo mode off');
  });
  input.onKey('m', () => {
    worldMap.dungeon = places.underground?.map ?? null;
    worldMap.toggle(mapInput());
  });
  input.onKey('c', () => { if (worldMap.isOpen) worldMap.centre(player.x, player.z); });
  input.onKey('+', () => { if (worldMap.isOpen) worldMap.zoomBy(1.25); });
  input.onKey('=', () => { if (worldMap.isOpen) worldMap.zoomBy(1.25); });
  input.onKey('-', () => { if (worldMap.isOpen) worldMap.zoomBy(0.8); });

  input.onKey('x', attack);
  // q and e are held down to turn the camera, so no spell may live on them
  input.onKey('z', loose);
  input.onKey('b', () => conjure('ward'));
  input.onKey('h', () => conjure('blight'));
  input.onKey('u', () => conjure('light'));
  input.onKey('v', () => conjure('draught'));
  input.onKey('n', toTitle);
  // Escape leaves whatever you are in, and nothing more. It closes the console too, but that is
  // handled by the input box, which has the keyboard while the console is up.
  input.onKey('escape', () => { hud.closeOptions(); dialogue.close(); journal.close(); rucksack.close(); worldMap.close(); playerList.close(); });
  input.onKey('j', () => { if (!dialogue.isOpen) journal.toggle(journalInput); });
  input.onKey('i', () => { if (!dialogue.isOpen) rucksack.toggle(); });
  // The console lives on the key it has been on since Quake: one row under Escape, and spare in
  // every other game. Both of the characters that live on it, because a keyboard laid out for
  // another country puts the other one under the same thumb.
  //
  // Having its own key is what leaves everything else alone: Enter and Space still talk, open and
  // board, and Escape still means nothing but "leave what I am in".
  for (const key of ['`', '~']) input.onKey(key, () => {
    if (dialogue.isOpen || photo.active || worldMap.isOpen) return;
    chat.toggleConsole();
  });
  for (const key of ['enter', ' ']) input.onKey(key, () => {
    if (chat.isTyping) return;
    if (photo.active) {
      // draw one more frame so the buffer holds exactly what is on screen, then read it back
      rig.renderer.render(rig.scene, iso.camera);
      const name = photo.save(rig.renderer.domElement, seed);
      sound.chime();
      window.setTimeout(() => hud.flash(`Saved ${name}`), 50);
      return;
    }
    if (dialogue.isOpen) dialogue.advance(); else talkNearest();
  });
  for (const key of ['arrowup', 'w']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(-1); });
  for (const key of ['arrowdown', 's']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(1); });
  // left and right change the highlighted row rather than leaving it: how many of a thing you mean
  // to sell, on a menu that offers a number. Rows without one simply ignore it.
  for (const key of ['arrowleft', 'a']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.nudge(-1); });
  for (const key of ['arrowright', 'd']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.nudge(1); });
  window.addEventListener('resize', () => { rig.resize(); iso.resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
}
