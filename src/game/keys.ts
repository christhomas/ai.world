import type { Input } from '../core/input';
import type { Player } from '../entities/player';
import type { IsoCamera } from '../render/camera';
import type { SceneRig } from '../render/scene';
import type { Sound } from './audio';
import type { SpellId } from './magic';
import type { Online } from './online';
import type { Places } from './places';
import type { Screen } from './screen';
import { PING_LIFE } from '../../server/protocol';

/**
 * What every key does, in one place.
 *
 * It is a map of the whole game read sideways — every verb the player has is on this page, and
 * nothing that is not here can be reached from the keyboard at all. That is worth having as one
 * file because the interesting question about a binding is never what it does but what else is
 * already on that key, and the only way to answer it is to see them together.
 *
 * The one thing it does not do is know what a panel is. Everything it opens, closes or steps
 * through it asks of a `Screen`, which the game declares and the interface satisfies — see
 * `screen.ts` for why that is not merely tidiness.
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

  /** Everything a key does to the screen, in the game's own words. */
  screen: Screen;

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
  /**
   * Open the canvas wing, if he is carrying one and is in the air. False when nothing happened,
   * which is what makes Space mean "jump" the rest of the time.
   */
  takeToTheAir: () => boolean;
  /** Rally points last a few seconds and are drawn on both maps. */
  rally: Array<{ x: number; z: number; name: string; left: number }>;
  /** How many are walking with you, which decides who a rally point is for. */
  partySize: () => number;
}

export function bindKeys(ctx: Keys): void {
  const {
    seed, input, rig, iso, player, places, online, sound, screen,
    attack, loose, conjure, talkNearest, partyMenu, hireMenu, offerTrade, tryGive, toTitle,
    persist, rally, partySize, takeToTheAir,
  } = ctx;
  void seed; void places;

  /*
   * The one guard, asked once.
   *
   * Almost every key means "do this, unless somebody else has the keyboard". That used to be
   * spelled out per binding as `!dialogue.isOpen && !chat.isTyping`, which is two of the four
   * things that can hold it — so a key that forgot the other two fired into a shop menu or over a
   * photograph. `free` is the whole question, and the handful of keys that mean something while a
   * panel is up say which panel they are for.
   */
  const free = (): boolean => screen.busy() === null;

  input.onKey('k', () => { if (free()) partyMenu(); });
  input.onKey('l', () => {
    if (!free()) return;
    if (!online.connected) { screen.say('Join a world online to see who else is about.'); return; }
    screen.toggleCompany();
  });
  input.onKey('r', () => {
    if (!free()) return;
    if (!online.connected) { screen.say('Join a world online to rally anybody.'); return; }
    online.ping(player.x, player.z);
    rally.push({ x: player.x, z: player.z, name: 'your', left: PING_LIFE });
    screen.say(partySize() ? 'Rally point marked for your party' : 'Rally point marked for everyone here');
  });
  input.onKey('o', () => screen.toggleOptions());
  input.onKey('f', () => { player.mode = player.mode === 'follow' ? 'free' : 'follow'; });
  input.onKey('t', () => { if (online.connected && free()) screen.openChat(); });
  // the same gesture either way: hand something over. A villager takes precedence because they
  // are the one standing in front of you; a player offer is what it falls back to.
  input.onKey('g', () => { if (free() && !tryGive()) offerTrade(); });
  input.onKey('y', () => { if (free()) hireMenu(); });

  input.onKey('p', () => {
    const on = screen.togglePhoto();
    player.mode = on ? 'free' : 'follow';
    if (!on) screen.say('Photo mode off');
  });
  input.onKey('m', () => screen.toggleMap());
  const reading = (): boolean => screen.busy() === 'reading';
  input.onKey('c', () => { if (reading()) screen.centreMap(player.x, player.z); });
  input.onKey('+', () => { if (reading()) screen.zoomMap(1.25); });
  input.onKey('=', () => { if (reading()) screen.zoomMap(1.25); });
  input.onKey('-', () => { if (reading()) screen.zoomMap(0.8); });

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
  input.onKey('escape', () => screen.closeEverything());
  input.onKey('j', () => { if (screen.busy() !== 'talking') screen.toggleJournal(); });
  input.onKey('i', () => { if (screen.busy() !== 'talking') screen.toggleRucksack(); });
  /*
   * The roster of everybody in the world.
   *
   * On a digit because the letters are gone: every one of them is a verb, a panel or a spell, and
   * `q` and `e` turn the camera. `1` is the first of a row nothing else uses, and a book of
   * everybody is the sort of thing a player opens rarely and deliberately.
   *
   * Not while a conversation is up, for the same reason as the rest: a person in front of you beats
   * a book.
   */
  input.onKey('1', () => { if (screen.busy() !== 'talking') screen.toggleRoster(); });
  /*
   * And the hole in whatever is standing in front of him, on the next digit along.
   *
   * A key rather than only a switch in Options because it is the sort of thing you want *now* —
   * you are behind a wall, you cannot see yourself, and walking to a menu to fix it is the same
   * problem twice. It says which way it has gone, because a hole you cannot see through a clear
   * doorway is indistinguishable from one that did not turn on.
   */
  input.onKey('2', () => {
    screen.say(screen.toggleSeeThrough() ? 'Seeing through what is in front' : 'Solid walls again');
  });
  // The console lives on the key it has been on since Quake: one row under Escape, and spare in
  // every other game. Both of the characters that live on it, because a keyboard laid out for
  // another country puts the other one under the same thumb.
  //
  // Having its own key is what leaves everything else alone: Enter and Space still talk, open and
  // board, and Escape still means nothing but "leave what I am in".
  for (const key of ['`', '~']) input.onKey(key, () => {
    const who = screen.busy();
    if (who === 'talking' || who === 'framing' || who === 'reading') return;
    screen.toggleConsole();
  });
  /*
   * Space jumps, and Enter is what talks.
   *
   * They used to be the same key, both meaning "do the thing in front of me", which left the most
   * universally understood key on a keyboard doing the second job of another one. A jump wants a
   * key nobody has to be told about, and everything Space did Enter still does — so what is given
   * up is a duplicate and what is gained is the verb.
   *
   * Not while a dialogue, the console or the map has the keyboard: Space is a page-down, an
   * advance and a shutter in those, and a hero who hopped every time you read a line of
   * conversation would be a joke at his own expense.
   */
  input.onKey(' ', () => {
    if (screen.busy() !== null) return;
    // in the air it opens the wing, on the ground it is a jump: one key, and which one it is is
    // decided by whether his feet are on anything
    if (takeToTheAir()) return;
    if (player.jump()) sound.blip();
  });
  // Enter alone now: Space is the jump, and the wing. See the note on it above.
  for (const key of ['enter']) input.onKey(key, () => {
    const who = screen.busy();
    if (who === 'typing') return;
    if (who === 'framing') {
      // draw one more frame so the buffer holds exactly what is on screen, then read it back
      rig.renderer.render(rig.scene, iso.camera);
      const name = screen.takePhoto();
      sound.chime();
      window.setTimeout(() => screen.say(`Saved ${name}`), 50);
      return;
    }
    if (who === 'talking') screen.advanceTalk(); else talkNearest();
  });
  const talking = (): boolean => screen.busy() === 'talking';
  for (const key of ['arrowup', 'w']) input.onKey(key, () => { if (talking()) screen.moveTalk(-1); });
  for (const key of ['arrowdown', 's']) input.onKey(key, () => { if (talking()) screen.moveTalk(1); });
  // left and right change the highlighted row rather than leaving it: how many of a thing you mean
  // to sell, on a menu that offers a number. Rows without one simply ignore it.
  for (const key of ['arrowleft', 'a']) input.onKey(key, () => { if (talking()) screen.nudgeTalk(-1); });
  for (const key of ['arrowright', 'd']) input.onKey(key, () => { if (talking()) screen.nudgeTalk(1); });
  window.addEventListener('resize', () => { rig.resize(); iso.resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
}
