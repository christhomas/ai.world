/**
 * RPG-style dialogue box: portrait, name, typewriter text, paged, with optional choices.
 * Keyboard: Enter/Space advance or select, Up/Down move, Escape close. Click also advances.
 */
export interface DialogueChoice {
  label: string;
  /** Return the next node, or null to close. */
  next: () => DialogueNode | null;
}

export interface DialogueNode {
  speaker: string;
  emoji: string;
  pages: string[];
  choices?: DialogueChoice[];
}

const CPS = 55; // characters per second

export class DialogueBox {
  private readonly el: HTMLDivElement;
  private readonly portrait: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly choicesEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private node: DialogueNode | null = null;
  private page = 0;
  private typed = 0;
  private acc = 0;
  private choice = 0;
  private onClose: (() => void) | null = null;
  /** Fires as characters appear (for a typewriter blip) and when a choice moves. */
  onType: (() => void) | null = null;
  onMove: (() => void) | null = null;
  private typedSinceBlip = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'dialogue';
    this.el.innerHTML = `
      <div class="dlg-portrait"></div>
      <div class="dlg-body">
        <div class="dlg-name"></div>
        <div class="dlg-text"></div>
        <div class="dlg-choices"></div>
        <div class="dlg-hint">▼</div>
      </div>`;
    document.body.appendChild(this.el);
    this.portrait = this.el.querySelector('.dlg-portrait')!;
    this.nameEl = this.el.querySelector('.dlg-name')!;
    this.textEl = this.el.querySelector('.dlg-text')!;
    this.choicesEl = this.el.querySelector('.dlg-choices')!;
    this.hintEl = this.el.querySelector('.dlg-hint')!;
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const idx = target.dataset.choice;
      if (idx !== undefined) { this.choice = Number(idx); this.select(); return; }
      this.advance();
    });
  }

  get isOpen(): boolean { return this.node !== null; }

  start(node: DialogueNode, onClose?: () => void): void {
    if (onClose) this.onClose = onClose;
    this.node = node;
    this.page = 0;
    this.typed = 0;
    this.acc = 0;
    this.choice = 0;
    this.portrait.textContent = node.emoji;
    this.nameEl.textContent = node.speaker;
    this.choicesEl.innerHTML = '';
    this.el.classList.add('show');
    this.render();
  }

  close(): void {
    if (!this.node) return;
    this.node = null;
    this.el.classList.remove('show');
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  update(dt: number): void {
    if (!this.node) return;
    const full = this.node.pages[this.page].length;
    if (this.typed >= full) return;
    this.acc += dt * CPS;
    const n = Math.floor(this.acc);
    if (n > 0) {
      this.acc -= n;
      this.typed = Math.min(full, this.typed + n);
      this.typedSinceBlip += n;
      if (this.typedSinceBlip >= 3) { this.typedSinceBlip = 0; this.onType?.(); }
      this.render();
    }
  }

  advance(): void {
    if (!this.node) return;
    const full = this.node.pages[this.page].length;
    if (this.typed < full) { this.typed = full; this.render(); return; }
    if (this.page < this.node.pages.length - 1) {
      this.page++; this.typed = 0; this.acc = 0;
      this.render();
      return;
    }
    if (this.node.choices && this.node.choices.length > 0) { this.select(); return; }
    this.close();
  }

  move(dir: number): void {
    if (!this.node?.choices || !this.atChoices()) return;
    const n = this.node.choices.length;
    this.choice = (this.choice + dir + n) % n;
    this.onMove?.();
    this.render();
  }

  private atChoices(): boolean {
    if (!this.node) return false;
    return this.page === this.node.pages.length - 1 && this.typed >= this.node.pages[this.page].length && !!this.node.choices?.length;
  }

  private select(): void {
    if (!this.node?.choices) return;
    const c = this.node.choices[this.choice];
    const next = c.next();
    if (next) this.start(next);
    else this.close();
  }

  private render(): void {
    if (!this.node) return;
    const text = this.node.pages[this.page];
    this.textEl.textContent = text.slice(0, this.typed);
    const done = this.typed >= text.length;
    const showChoices = this.atChoices();
    this.hintEl.style.visibility = done && !showChoices ? 'visible' : 'hidden';
    if (showChoices) {
      const items = this.node.choices!.map((c, i) =>
        `<div class="dlg-choice${i === this.choice ? ' sel' : ''}" data-choice="${i}">${i === this.choice ? '▶ ' : '  '}${c.label}</div>`);
      this.choicesEl.innerHTML = items.join('');
    } else if (this.choicesEl.innerHTML !== '') {
      this.choicesEl.innerHTML = '';
    }
  }
}
