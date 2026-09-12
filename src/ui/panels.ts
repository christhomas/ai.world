import { Roster } from './roster';
import { rememberCutaway } from '../render/cutaway';
import type * as THREE from 'three';
import type { Screen } from '../game/screen';
import type { Places } from '../game/places';
import type { Chat } from './chat';
import type { DialogueBox } from './dialogue';
import type { Hud } from './hud';
import type { Journal, JournalInput } from './journal';
import type { KinPanel } from './kin';
import type { PhotoMode } from './photo';
import type { PlayerList } from './players';
import type { Rucksack } from './rucksack';
import type { WorldMap, WorldMapInput } from './worldmap';

/**
 * Where every panel in the game is kept, and what "close everything" means.
 *
 * `game/screen.ts` declares what the game may ask of a screen — open the journal, say a line, put
 * everything away — and says nothing about how any of it is done. This is the other side of that
 * seam: the one place that knows a journal is a `Journal`, that a conversation is a `DialogueBox`,
 * and that leaving whatever you are in means closing seven particular panels.
 *
 * It lived in `main.ts` until that file went past the seven hundred lines this codebase holds a
 * module to, and it is the right thing to have taken out rather than the convenient one. Everything
 * else in `main.ts` is assembly — build a world, build a renderer, hand them to each other — and
 * this is a translation, from a vocabulary the game speaks to a set of objects it must not know
 * about. Nothing else in that file is a translation, and nothing here is assembly.
 *
 * Given the panels rather than reaching for them, because `main.ts` owns their lifetimes: they are
 * built there, disposed there, and handed to half a dozen other things there.
 */
export interface Panels {
  hud: Hud;
  /** The hole kept open in front of the hero, which both a key and the Options switch turn on. */
  cutaway: { on: boolean; show: (on: boolean) => void };
  chat: Chat;
  dialogue: DialogueBox;
  journal: Journal;
  rucksack: Rucksack;
  worldMap: WorldMap;
  kinPanel: KinPanel;
  roster: Roster;
  playerList: PlayerList;
  photo: PhotoMode;
  places: Places;
  /** For the photograph, which is taken of whatever the renderer last drew. */
  canvas: THREE.WebGLRenderer;
  seed: number;
  /** What each panel wants to be shown, asked at the moment it is opened rather than held. */
  journalInput: () => JournalInput;
  mapInput: () => WorldMapInput;
  companyInput: () => Parameters<PlayerList['toggle']>[0];
}

export function screenOf(p: Panels): Screen {
  return {
    /*
     * Who has the keyboard, in the order they take it.
     *
     * Typing beats everything, because a player writing a message must be able to write the letter
     * `m` without the map opening. A conversation beats a panel for the same reason a person in
     * front of you beats a book. And both maps count as reading — the world's, and a village's
     * descent — because a key that walks the hero while a full-screen panel is up is a hero walking
     * into a wall you cannot see.
     */
    busy: () => (p.chat.isTyping ? 'typing'
      : p.dialogue.isOpen ? 'talking'
      : p.photo.active ? 'framing'
      : p.worldMap.isOpen || p.kinPanel.isOpen || p.roster.isOpen ? 'reading'
      : null),
    say: (line) => p.hud.flash(line),
    toggleJournal: () => p.journal.toggle(p.journalInput),
    toggleRucksack: () => p.rucksack.toggle(),
    toggleRoster: () => p.roster.toggle(),
    toggleSeeThrough: () => {
      const on = !p.cutaway.on;
      p.cutaway.show(on);
      rememberCutaway(on);
      // the switch in Options is the same switch, so it has to move too
      p.hud.setSeeThrough(on);
      return on;
    },
    toggleOptions: () => p.hud.toggleOptions(),
    toggleMap: () => {
      // whichever map the hero is standing in: a dungeon has its own, and it is the one that is
      // any use while you are in it
      p.worldMap.dungeon = p.places.underground?.map ?? null;
      p.worldMap.toggle(p.mapInput());
    },
    toggleCompany: () => p.playerList.toggle(p.companyInput()),
    togglePhoto: () => p.photo.toggle(),
    toggleConsole: () => p.chat.toggleConsole(),
    openChat: () => p.chat.open(),
    closeEverything: () => {
      p.hud.closeOptions(); p.dialogue.close(); p.journal.close();
      p.rucksack.close(); p.worldMap.close(); p.playerList.close(); p.kinPanel.close();
      p.roster.close();
    },
    advanceTalk: () => p.dialogue.advance(),
    moveTalk: (by) => p.dialogue.move(by),
    nudgeTalk: (by) => p.dialogue.nudge(by),
    centreMap: (x, z) => p.worldMap.centre(x, z),
    zoomMap: (by) => p.worldMap.zoomBy(by),
    takePhoto: () => p.photo.save(p.canvas.domElement, p.seed),
  };
}
