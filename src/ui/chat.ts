import { $ } from './dom';

const MAX_LINES = 60;

/**
 * The chat log and its one-line input. The log shows itself whenever something arrives and stays
 * visible while you are online; the input only appears while you are actually typing, so the
 * keyboard belongs to the game the rest of the time.
 */
export class Chat {
  private readonly panel = $('chatPanel');
  private readonly log = $('chatLog');
  private readonly input = $<HTMLInputElement>('chatInput');
  private typing = false;

  /** Called with a finished line when the player presses Enter. */
  onSend: ((text: string) => void) | null = null;

  constructor() {
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        this.input.value = '';
        this.close();
        if (text) this.onSend?.(text);
      } else if (e.key === 'Escape') {
        this.input.value = '';
        this.close();
      }
    });
  }

  get isTyping(): boolean { return this.typing; }

  show(): void { this.panel.classList.add('show'); }

  hide(): void { this.panel.classList.remove('show'); this.close(); }

  /** Start typing: the input takes the keyboard until Enter or Escape. */
  open(): void {
    this.typing = true;
    this.show();
    this.input.classList.add('show');
    this.input.focus();
    // the key that opened the box would otherwise land in it
    window.setTimeout(() => { this.input.value = ''; }, 0);
  }

  private close(): void {
    this.typing = false;
    this.input.classList.remove('show');
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
