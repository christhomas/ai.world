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
   * The one guard, asked once — and now asked of every binding whether it remembers to or not.
   *
   * Almost every key means "do this, unless somebody else has the keyboard". That used to be
   * spelled out per binding as `!dialogue.isOpen && !chat.isTyping`, which is two of the four
   * things that can hold it — so a key that forgot the other two fired into a shop menu or over a
   * photograph. Asking the whole question once was the answer, and the handful of keys that mean
   * something while a panel is up say which panel they are for.
   *
   * The pattern was right and the enforcement was not: a binding could simply not ask, and several
   * did not. Item 118 reported two — `f` flipping the camera mid-sentence, `o` opening the options
   * — and the truth was wider. Typing `x` into the chat box swung a sword, `p` entered photo mode,
   * and `n` left the world for the title screen. The `!== 'talking'` guards were the same fault in
   * another spelling: a text box is not a conversation, so `i` opened the rucksack while you typed.
   *
   * So the guard moved into the *registering*. `bind` takes when a key may fire and there is no
   * other way to put a key on this keyboard, which makes forgetting a thing the compiler will not
   * let you write rather than a thing a reviewer has to notice.
   */
  /** When a binding may fire. Every one of them says which, because the failures were all silence. */
  type When =
    /** Nobody else has the keyboard: no panel, no map, no conversation, no text box. */
    | 'free'
    /**
     * Anything except a conversation and a text box. For the panels, which are allowed to open
     * over each other and over the map — a person standing in front of you beats a book, and a
     * letter typed into a box is a letter rather than a command.
     */
    | 'unless talking'
    /** The photo toggle: enter while free, or leave the photograph it opened. */
    | 'free or framing'
    /** The map is open, and this is one of the things you do to a map. */
    | 'reading the map'
    /** A conversation is up, and this is how you move about one. */
    | 'talking'
    /**
     * Whatever is on screen. Two keys only, and both are the sort that must work from inside
     * whatever they are getting you out of — so this is a decision written down rather than one
     * forgotten.
     */
    | 'always';

  const allowed = (when: When): boolean => {
    const who = screen.busy();
    if (when === 'always') return true;
    if (when === 'free') return who === null;
    if (when === 'free or framing') return who === null || who === 'framing';
    if (when === 'talking') return who === 'talking';
    if (when === 'reading the map') return who === 'reading';
    return who !== 'talking' && who !== 'typing';
  };

  /** Put a key on the keyboard, having said when it is allowed to mean anything. */
  const bind = (keys: string | string[], when: When, act: () => void): void => {
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      input.onKey(key, () => { if (allowed(when)) act(); });
    }
  };

  bind('k', 'free', partyMenu);
  bind('l', 'free', () => {
    if (!online.connected) { screen.say('Join a world online to see who else is about.'); return; }
    screen.toggleCompany();
  });
  bind('r', 'free', () => {
    if (!online.connected) { screen.say('Join a world online to rally anybody.'); return; }
    online.ping(player.x, player.z);
    rally.push({ x: player.x, z: player.z, name: 'your', left: PING_LIFE });
    screen.say(partySize() ? 'Rally point marked for your party' : 'Rally point marked for everyone here');
  });
  bind('o', 'unless talking', () => screen.toggleOptions());
  bind('f', 'free', () => { player.mode = player.mode === 'follow' ? 'free' : 'follow'; });
  bind('t', 'free', () => { if (online.connected) screen.openChat(); });
  // the same gesture either way: hand something over. A villager takes precedence because they
  // are the one standing in front of you; a player offer is what it falls back to.
  bind('g', 'free', () => { if (!tryGive()) offerTrade(); });
  bind('y', 'free', hireMenu);

  bind('p', 'free or framing', () => {
    const on = screen.togglePhoto();
    player.mode = on ? 'free' : 'follow';
    if (!on) screen.say('Photo mode off');
  });
  bind('m', 'unless talking', () => screen.toggleMap());
  bind('c', 'reading the map', () => screen.centreMap(player.x, player.z));
  bind('+', 'reading the map', () => screen.zoomMap(1.25));
  bind('=', 'reading the map', () => screen.zoomMap(1.25));
  bind('-', 'reading the map', () => screen.zoomMap(0.8));

  bind('x', 'free', attack);
  // q and e are held down to turn the camera, so no spell may live on them
  bind('z', 'free', loose);
  bind('b', 'free', () => conjure('ward'));
  bind('h', 'free', () => conjure('blight'));
  bind('u', 'free', () => conjure('light'));
  bind('v', 'free', () => conjure('draught'));
  bind('n', 'free', toTitle);
  // Escape leaves whatever you are in, and nothing more. It closes the console too, but that is
  // handled by the input box, which has the keyboard while the console is up.
  bind('escape', 'always', () => screen.closeEverything());
  bind('j', 'unless talking', () => screen.toggleJournal());
  bind('i', 'unless talking', () => screen.toggleRucksack());
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
  /*
   * The panels live on the digit row, and the letters are what they always were.
   *
   * They are a *set* — journal, rucksack, roster, party, who is here, photo, options — and a set
   * reads better as a row than as seven letters scattered across the keyboard by whatever was free
   * on the day each one was written. The letters keep working: they are in a good many fingers by
   * now and taking them away would be a change nobody asked for. What the digits buy is that the
   * row can be learnt as a row, and that the on-screen buttons have something to be numbered after.
   *
   * Verbs stay on letters, and that is the line: a digit opens something to look at, a letter does
   * something to the world. Swinging a sword is not a panel.
   */
  bind('1', 'unless talking', () => screen.toggleRoster());
  /*
   * And the hole in whatever is standing in front of him, on the next digit along.
   *
   * A key rather than only a switch in Options because it is the sort of thing you want *now* —
   * you are behind a wall, you cannot see yourself, and walking to a menu to fix it is the same
   * problem twice. It says which way it has gone, because a hole you cannot see through a clear
   * doorway is indistinguishable from one that did not turn on.
   */
  bind('2', 'unless talking', () => {
    screen.say(screen.toggleSeeThrough() ? 'Seeing through what is in front' : 'Solid walls again');
  });
  bind('3', 'unless talking', () => screen.toggleJournal());
  bind('4', 'unless talking', () => screen.toggleRucksack());
  bind('5', 'unless talking', () => screen.toggleMap());
  bind('6', 'free', partyMenu);
  bind('7', 'free', () => {
    if (!online.connected) { screen.say('Join a world online to see who else is about.'); return; }
    screen.toggleCompany();
  });
  bind('8', 'free or framing', () => {
    const on = screen.togglePhoto();
    player.mode = on ? 'free' : 'follow';
    if (!on) screen.say('Photo mode off');
  });
  bind('9', 'unless talking', () => screen.toggleOptions());
  // The console lives on the key it has been on since Quake: one row under Escape, and spare in
  // every other game. Both of the characters that live on it, because a keyboard laid out for
  // another country puts the other one under the same thumb.
  //
  // Having its own key is what leaves everything else alone: Enter and Space still talk, open and
  // board, and Escape still means nothing but "leave what I am in".
  bind(['`', '~'], 'unless talking', () => {
    // and not over the map or a photograph either: both are things you are looking at, and a
    // console dropped over one is in the way of the very thing you opened
    if (screen.busy() !== null) return;
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
  bind(' ', 'free', () => {
    // in the air it opens the wing, on the ground it is a jump: one key, and which one it is is
    // decided by whether his feet are on anything
    if (takeToTheAir()) return;
    if (player.jump()) sound.blip();
  });
  // Enter alone now: Space is the jump, and the wing. See the note on it above.
  bind('enter', 'always', () => {
    const who = screen.busy();
    // a text box takes Enter to send what is in it, which is the one thing this must not steal
    if (who === 'typing') return;
    if (who === 'framing') {
      // draw one more frame so the buffer holds exactly what is on screen, then read it back
      rig.draw(rig.scene, iso.camera);
      const name = screen.takePhoto();
      sound.chime();
      window.setTimeout(() => screen.say(`Saved ${name}`), 50);
      return;
    }
    if (who === 'talking') screen.advanceTalk(); else talkNearest();
  });
  bind(['arrowup', 'w'], 'talking', () => screen.moveTalk(-1));
  bind(['arrowdown', 's'], 'talking', () => screen.moveTalk(1));
  // left and right change the highlighted row rather than leaving it: how many of a thing you mean
  // to sell, on a menu that offers a number. Rows without one simply ignore it.
  bind(['arrowleft', 'a'], 'talking', () => screen.nudgeTalk(-1));
  bind(['arrowright', 'd'], 'talking', () => screen.nudgeTalk(1));
  window.addEventListener('resize', () => { rig.resize(); iso.resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
}
