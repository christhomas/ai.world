import { $ } from './dom';

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

  /** Called with a finished line when the player presses Enter. */
  onSend: ((text: string) => void) | null = null;

  constructor() {
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
    // the key that opened the box would otherwise land in it
    window.setTimeout(() => { this.input.value = ''; }, 0);
  }

  /** Whether the console is up, as opposed to the one-line chat input. */
  get isConsole(): boolean { return this.typing && this.asConsole; }

  /** The console key: down if it is up, up if it is down. */
  toggleConsole(): void {
    if (this.isConsole) this.close(); else this.open(true);
  }

  private close(): void {
    this.typing = false;
    this.asConsole = false;
    this.input.classList.remove('show');
    this.panel.classList.remove('console');
    this.input.blur();
  }

  line(text: string, kind: 'chat' | 'sys' = 'chat'): void {
    const el = document.createElement('div');
    if (kind === 'sys') el.className = 'sys';
    el.textContent = text;
    this.log.appendChild(el);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    this.show();
  }
}
