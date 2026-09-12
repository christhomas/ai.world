/**
 * What the game needs of a screen, in the game's own words.
 *
 * The keyboard used to reach straight into eight named widgets — the journal, the rucksack, the
 * world map, the chat box, the dialogue box, the hud, photo mode and the player list — and call
 * methods on each. That is backwards twice over.
 *
 * It is backwards as a dependency: a key press is a fact about the game, and the game should not
 * know that the thing it opens is a `<div>` in `ui/`. And it is backwards as a design, which is
 * the part worth fixing rather than counting: because there was no notion of *who has the
 * keyboard*, every binding had to work it out again from first principles. Twenty-eight of the
 * fifty-five things the keyboard did with the interface were the same question — "is somebody else
 * typing, or reading, or framing a photograph?" — asked in four different ways, once per binding,
 * and a binding that forgot one was a spell cast into a shop menu. There is one question here now,
 * and it is asked once.
 *
 * So the game declares this, and `main.ts` builds one out of the real panels. Nothing in `game/`
 * imports `ui/` to work a key, and what the keyboard is allowed to do to the screen is a list on
 * one page rather than whatever eight objects happen to expose.
 */

/** How far a highlighted row moves, or how much a number on it changes: one step either way. */
export type Step = -1 | 1;

export interface Screen {
  /**
   * Who has the keyboard, if not the player walking about.
   *
   * `typing` is a text box with a cursor in it and swallows everything. `talking` is a
   * conversation, which takes the arrows and Enter but leaves the rest. `reading` is the world map
   * open over the game. `framing` is photo mode, where Enter takes the picture.
   *
   * Named rather than boolean because the four are not the same: a key that must not fire while
   * somebody types may still be right during a conversation, and the old code could not say so
   * without naming a widget.
   */
  busy(): 'typing' | 'talking' | 'reading' | 'framing' | null;

  /** A line of news, in the corner. */
  say(line: string): void;

  /** Doors the keyboard opens. Each closes itself again if it is already open. */
  toggleJournal(): void;
  toggleRucksack(): void;
  /** Everybody in the world and how they are getting on. See `ui/roster.ts`. */
  toggleRoster(): void;
  toggleOptions(): void;
  toggleMap(): void;
  toggleCompany(): void;
  /** Photo mode answers whether it is now on, because the camera has to follow it. */
  togglePhoto(): boolean;
  /**
   * The hole in whatever stands between you and the camera. Answers whether it is now on, because
   * it is the sort of thing you want the game to tell you it has done.
   */
  toggleSeeThrough(): boolean;
  /** The console, which is the one door that is not on Escape. */
  toggleConsole(): void;
  /** Saying something to the other people in a shared world. */
  openChat(): void;

  /** Leave whatever is open. Escape means this and nothing else. */
  closeEverything(): void;

  /** Stepping through a conversation: on to the next page, or up and down its choices. */
  advanceTalk(): void;
  moveTalk(by: Step): void;
  /** Left and right on a row that carries a number — how many of a thing you mean to sell. */
  nudgeTalk(by: Step): void;

  /** The world map, while it is the thing being read. */
  centreMap(x: number, z: number): void;
  zoomMap(by: number): void;

  /** Take the picture, and say what it was called. */
  takePhoto(): string;
}
