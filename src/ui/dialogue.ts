import { FACE, drawFace, faceOf, type Face, type Stage } from './portrait';

/**
 * The conversation screen: whoever is speaking on the left, you on the right, and the words in a
 * panel between them.
 *
 * The faces are drawn rather than loaded — see portrait.ts — so every villager on the register
 * has one, and the mouth moves while the words are still arriving. The side that is not speaking
 * is dimmed, which is the whole trick to making two portraits read as a conversation rather than
 * two pictures.
 *
 * Keyboard: Enter/Space advance or select, Up/Down move, Escape close. Click also advances.
 */
export interface DialogueChoice {
  label: string;
  /** Return the next node, or null to close. */
  next: () => DialogueNode | null;
}

/**
 * Who is speaking, in the only terms the game needs to know: an identity, a trade and how old
 * they are. Turning that into a face is this layer's business, not the game's.
 */
export interface Speaker {
  /** Anything stable and unique to them — their id on the village register, usually. */
  id: string;
  trade: string;
  stage: Stage;
}

export interface DialogueNode {
  speaker: string;
  emoji: string;
  pages: string[];
  choices?: DialogueChoice[];
  /** Who to draw. Without one the emoji stands in, as it always did. */
  face?: Speaker;
}

const CPS = 55;              // characters per second
const MOUTH = 0.12;          // seconds a mouth shape holds while somebody is talking

export class DialogueBox {
  private readonly el: HTMLDivElement;
  private readonly theirFace: HTMLCanvasElement;
  private readonly theirEmoji: HTMLDivElement;
  private readonly myFace: HTMLCanvasElement;
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
  /** The hero's own face, set once and drawn on the right of every conversation. */
  private hero: Face | null = null;
  private mouthAcc = 0;
  private mouthOpen = false;
  /** The face being drawn on the left, built once per node rather than on every mouth movement. */
  private speaking: Face | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'dialogue';
    this.el.innerHTML = `
      <div class="dlg-side dlg-them">
        <canvas class="dlg-face"></canvas>
        <div class="dlg-emoji"></div>
        <div class="dlg-name"></div>
      </div>
      <div class="dlg-panel">
        <div class="dlg-text"></div>
        <div class="dlg-choices"></div>
        <div class="dlg-hint">▼</div>
      </div>
      <div class="dlg-side dlg-me">
        <canvas class="dlg-face"></canvas>
        <div class="dlg-name">You</div>
      </div>`;
    document.body.appendChild(this.el);
    this.theirFace = this.el.querySelector('.dlg-them .dlg-face')!;
    this.theirEmoji = this.el.querySelector('.dlg-emoji')!;
    this.myFace = this.el.querySelector('.dlg-me .dlg-face')!;
    this.nameEl = this.el.querySelector('.dlg-them .dlg-name')!;
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

  /** The hero's own face. Set it once at the start and whenever their gear changes. */
  setHero(who: Speaker): void {
    this.hero = faceOf(who.id, who.trade, who.stage);
    drawFace(this.myFace, this.hero);
  }

  start(node: DialogueNode, onClose?: () => void): void {
    if (onClose) this.onClose = onClose;
    this.node = node;
    this.page = 0;
    this.typed = 0;
    this.acc = 0;
    this.choice = 0;
    this.nameEl.textContent = node.speaker;
    this.choicesEl.innerHTML = '';
    this.showFace(node);
    this.el.classList.add('show');
    this.render();
  }

  /** A drawn face where there is one, and the emoji the game has always used where there is not. */
  private showFace(node: DialogueNode): void {
    this.speaking = node.face ? faceOf(node.face.id, node.face.trade, node.face.stage) : null;
    this.theirFace.style.display = this.speaking ? '' : 'none';
    this.theirEmoji.style.display = this.speaking ? 'none' : '';
    if (this.speaking) drawFace(this.theirFace, this.speaking);
    else this.theirEmoji.textContent = node.emoji;
    if (this.hero) drawFace(this.myFace, this.hero);
    this.myFace.style.display = this.hero ? '' : 'none';
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
    if (this.typed >= full) { this.stopTalking(); return; }

    this.talk(dt);
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

  /** The mouth moves while the words are still arriving, and shuts when they stop. */
  private talk(dt: number): void {
    if (!this.speaking) return;
    this.mouthAcc += dt;
    if (this.mouthAcc < MOUTH) return;
    this.mouthAcc = 0;
    this.mouthOpen = !this.mouthOpen;
    drawFace(this.theirFace, { ...this.speaking, talking: this.mouthOpen });
  }

  private stopTalking(): void {
    if (!this.speaking || !this.mouthOpen) return;
    this.mouthOpen = false;
    drawFace(this.theirFace, { ...this.speaking, talking: false });
  }

  advance(): void {
    if (!this.node) return;
    const full = this.node.pages[this.page].length;
    if (this.typed < full) { this.typed = full; this.stopTalking(); this.render(); return; }
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
    // whoever is not talking steps back, which is what makes the two sides read as a conversation
    this.el.classList.toggle('choosing', showChoices);
    if (showChoices) {
      const items = this.node.choices!.map((c, i) =>
        `<div class="dlg-choice${i === this.choice ? ' sel' : ''}" data-choice="${i}">${i === this.choice ? '▶ ' : '  '}${c.label}</div>`);
      this.choicesEl.innerHTML = items.join('');
    } else if (this.choicesEl.innerHTML !== '') {
      this.choicesEl.innerHTML = '';
    }
  }
}

/** The pixel grid a face is drawn on, so the stylesheet and the canvas agree about its shape. */
export const FACE_SIZE = FACE;
