import { $ } from './dom';
import { greeting } from '../core/version';

const MAX_LINES = 60;

/**
 * The console: the chat log, its one-line input, and everything the game will tell you if you ask.
 *
 * It started as chat and became the place a question goes, because the alternative was the box of
 * keys that used to sit in the corner of the screen taking a fifth of the picture and never going
 * away. Now Enter opens this, `? keys` prints them, and the rest of the time the screen is the
 * game.
 *
 * Opened as a console it is taller and stays up while you read; opened to say something it is the
 * one line it always was. Escape closes either.
 */
export class Chat {
  private readonly panel = $('chatPanel');
  private readonly log = $('chatLog');
  private readonly input = $<HTMLInputElement>('chatInput');
  private typing = false;
  private asConsole = false;
  /**
   * Whether the log is following its newest line, kept rather than measured when a line arrives.
   *
   * Measuring it then was wrong whenever the log had no layout: lines that arrive while the HUD is
   * still hidden all measure as "at the bottom" of a box with no height, the scroll that should
   * pin them there does nothing, and the log comes up showing its oldest lines. Whether it did
   * depended on when the news arrived against when the HUD appeared, which is why two captures of
   * the same commit disagreed about the message panel (#535). Only a scroll changes this now.
   */
  private following = true;

  /** Called with a finished line when the player presses Enter. */
  onSend: ((text: string) => void) | null = null;

  constructor() {
    // The wheel over this box scrolls the box. Without this the game reads it as a zoom the moment
    // the pointer leaves the log — and, worse, a page that ever gets the event scrolls the world
    // behind a console somebody is reading.
    this.panel.addEventListener('wheel', (e) => e.stopPropagation());
    // a box with no layout has no bottom to be at, so it cannot say whether it is being followed
    this.log.addEventListener('scroll', () => { if (this.log.clientHeight > 0) this.following = this.atBottom; });
    // and when it gets a layout back, or a font arrives and the lines grow, it goes where it was
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.pin()).observe(this.log);
    document.fonts?.addEventListener?.('loadingdone', () => this.pin());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        this.input.value = '';
        // a console stays up between questions; a line said out loud is done with
        if (!this.asConsole) this.close();
        if (text) this.onSend?.(text);
      } else if (e.key === 'Escape') {
        this.input.value = '';
        this.close();
      } else if ((e.key === '`' || e.key === '~') && this.input.value === '') {
        // the key that dropped the console shuts it again, the way it does everywhere else. Only
        // on an empty line: somebody halfway through typing a backtick meant the character.
        e.preventDefault();
        this.close();
      }
    });
  }

  get isTyping(): boolean { return this.typing; }

  show(): void { this.panel.classList.add('show'); }

  hide(): void { this.panel.classList.remove('show'); this.close(); }

  /**
   * Start typing: the input takes the keyboard until Enter or Escape.
   *
   * As a console it stays open after a line is sent, because somebody asking `? keys` is usually
   * about to ask something else, and a box that shuts itself after every question is a box you
   * have to keep reopening. Said out loud, one line is one line, and it closes as it always did.
   */
  open(asConsole = false): void {
    this.typing = true;
    this.asConsole = asConsole;
    this.show();
    this.panel.classList.toggle('console', asConsole);
    this.input.classList.add('show');
    this.input.placeholder = asConsole ? 'Say something, ? for help, / for a command' : 'Say something, then Enter';
    this.input.focus();
    this.following = true;
    this.pin();
    // the key that opened the box would otherwise land in it
    window.setTimeout(() => { this.input.value = ''; }, 0);
  }

  /** Whether the console is up, as opposed to the one-line chat input. */
  get isConsole(): boolean { return this.typing && this.asConsole; }

  /** The console key: down if it is up, up if it is down. */
  toggleConsole(): void {
    if (this.isConsole) { this.close(); return; }
    // what this is and which build of it, every time the console comes up. A console is where you
    // go when something is wrong, and the first thing worth knowing then is what you are running
    this.line(greeting(), 'sys');
    this.open(true);
  }

  /**
   * Put the console away without hiding the log.
   *
   * For whoever is about to draw something worth looking at. A teleport is typed, so at the moment
   * the beam fires the panel is open and focused over the part of the picture the hero is standing
   * in — see `render/beam.ts`. `hide` is the wrong door for that: it drops the log as well, and the
   * log is where the answer to what was typed appears.
   */
  dismiss(): void { this.close(); }

  private close(): void {
    this.typing = false;
    this.asConsole = false;
    this.input.classList.remove('show');
    this.panel.classList.remove('console');
    this.input.blur();
  }

  /**
   * Whether the log is showing its newest line.
   *
   * Read when the log scrolls, to decide `following`. A line arriving pulls the log down to the
   * bottom, which is right until somebody has scrolled up to read what was said earlier — then it
   * is the box snatching itself out of their hands. Within a couple of pixels, because a scroll
   * position is a float and lands a hair short.
   */
  private get atBottom(): boolean {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 4;
  }

  /** Put the log on its newest line, if that is where it is being kept. */
  private pin(): void {
    if (this.following) this.log.scrollTop = this.log.scrollHeight;
  }

  line(text: string, kind: 'chat' | 'sys' = 'chat'): void {
    const el = document.createElement('div');
    if (kind === 'sys') el.className = 'sys';
    el.textContent = text;
    this.log.appendChild(el);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    this.show();
    this.pin();
  }
}
