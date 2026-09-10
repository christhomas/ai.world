import { levelFor } from '../game/prowess';
import { describeGpu, type Quality, type SceneRig } from '../render/scene';
import { ITEMS, SLOTS } from '../game/items';
import type { GameState } from '../game/state';
import type { Quest } from '../game/quests';

import { $ } from './dom';
import { hasTheScreen, toggleFullScreen } from './sideways';

/** Area banner, debug readout, options panel, dialog box. Plain DOM, no framework. */
export class Hud {
  private readonly areaEl = $('areaName');
  private readonly debugEl = $('debug');
  private readonly loadingEl = $('loading');
  private readonly options = $('optionsPanel');
  private readonly invEl = $('inventory');
  private readonly questEl = $('quests');
  /** Volume slider moved (0..1). */
  onVolumeChange: ((v: number) => void) | null = null;
  onReturnToTitle: (() => void) | null = null;
  private lastArea = '';
  private debugAccum = 0;
  private readonly toast = $('toast');
  private toastTimer = 0;
  private readonly heartsEl = $('hearts');
  private readonly breathEl = $('breath');
  private readonly hurtEl = $('hurt');
  private hurtTimer = 0;
  private shownVersion = -1;
  /** Clicking the pouch opens the rucksack. */
  onOpenRucksack: (() => void) | null = null;
  /** Options sliders moved: (sun, hemisphere) daytime intensities. */
  onLightChange: ((sun: number, hemi: number) => void) | null = null;
  /** How hard the renderer should work per frame. */
  onQualityChange: ((level: Quality) => void) | null = null;

  constructor(rig: SceneRig, seed: number) {
    const sun = $<HTMLInputElement>('sunlightSlider');
    const hemi = $<HTMLInputElement>('hemisphereSlider');
    const sunV = $('sunlightValue');
    const hemiV = $('hemisphereValue');
    sun.value = String(rig.sun.intensity);
    hemi.value = String(rig.hemi.intensity);
    /*
     * Both to one decimal, which they were not.
     *
     * The sun read `2.6` and the sky read `1.00`, one above the other in the same column, because
     * each was rounded to the precision of its own slider's step rather than to what a person
     * reading two numbers together expects. Two decimals also buys nothing here: the sky's step is
     * a twentieth, so the second digit is only ever a nought or a five.
     */
    sunV.textContent = rig.sun.intensity.toFixed(1);
    hemiV.textContent = rig.hemi.intensity.toFixed(1);
    sun.addEventListener('input', () => { sunV.textContent = (+sun.value).toFixed(1); this.onLightChange?.(+sun.value, +hemi.value); });
    hemi.addEventListener('input', () => { hemiV.textContent = (+hemi.value).toFixed(1); this.onLightChange?.(+sun.value, +hemi.value); });
    $('seedValue').textContent = String(seed);
    const vol = $<HTMLInputElement>('volumeSlider');
    const volV = $('volumeValue');
    vol.addEventListener('input', () => { volV.textContent = `${Math.round(+vol.value * 100)}%`; this.onVolumeChange?.(+vol.value); });
    this.setVolume = (v: number) => { vol.value = String(v); volV.textContent = `${Math.round(v * 100)}%`; };
    const quality = $<HTMLSelectElement>('qualitySelect');
    quality.value = rig.quality;
    quality.addEventListener('change', () => this.onQualityChange?.(quality.value as Quality));

    // say what is really drawing this: a browser quietly rendering in software looks like a slow
    // computer, and nobody can tell the difference from inside the game
    const gpu = describeGpu(rig.renderer);
    const gpuEl = $('gpuName');
    gpuEl.textContent = gpu.accelerated ? gpu.name : `${gpu.name} — hardware acceleration is off`;
    gpuEl.classList.toggle('software', !gpu.accelerated);
    gpuEl.title = gpu.accelerated
      ? 'The graphics chip drawing this world'
      : 'Your browser is drawing this world on the processor. Turn hardware acceleration on in its settings for a much faster game.';

    /*
     * Full screen, asked for rather than taken.
     *
     * A phone is given the whole screen on the tap that enters a world, because a phone browser's
     * furniture is a fifth of the glass and the game cannot be played through it. A desktop is not
     * — grabbing the screen off somebody who clicked a save slot is a thing a page should not do.
     * That left no way to ask, so the game was played inside a window with a tab row, an address
     * bar and a bookmarks strip over a view of a landscape. Here is the way to ask.
     */
    const fullScreen = $('fullScreenButton');
    const sayScreen = () => { fullScreen.textContent = hasTheScreen() ? 'Leave full screen' : 'Full screen'; };
    fullScreen.addEventListener('click', () => { void toggleFullScreen().then(sayScreen); });
    // the player can leave by pressing Escape or F11, which we hear about only this way
    document.addEventListener('fullscreenchange', sayScreen);
    sayScreen();

    $('titleButton').addEventListener('click', () => this.onReturnToTitle?.());
    this.invEl.addEventListener('click', () => this.onOpenRucksack?.());
  }

  /** Redraw hearts and the carried summary when the state version changed. */
  syncState(state: GameState): void {
    if (state.version === this.shownVersion) return;
    this.shownVersion = state.version;
    const max = state.maxHpTotal;
    let hearts = '';
    for (let i = 0; i < max; i++) hearts += i < state.hp ? '♥' : '♡';
    this.heartsEl.textContent = hearts;
    const worn = SLOTS.map((slot) => state.worn(slot)).filter((i) => i !== null);
    const lines = [`<div>💰 ${state.inventory.gold} gold</div>`];
    if (worn.length > 0) lines.push(`<div>${worn.map((i) => i!.emoji).join(' ')}</div>`);
    const skill = levelFor(state.practice);
    lines.push(`<div class="hud-stats">⚔ ${state.attack}${skill > 0 ? ` <span title="what practice has taught you">(+${skill})</span>` : ''} · 🛡 ${state.defence} · 🎒 ${state.inventory.items.size}</div>`);
    this.invEl.innerHTML = lines.join('');
  }

  setVolume: (v: number) => void = () => {};

  /** Active errands, ticked when their condition is met. */
  setQuests(quests: Quest[], state: GameState): void {
    const lines: string[] = [];
    for (const q of quests) {
      if (state.quests.get(q.id) !== 'active') continue;
      const complete = q.kind === 'visit' ? state.discovered.has(q.target) : state.count(q.target) >= q.count;
      const what = q.kind === 'visit' ? `Visit the ${q.target}` : `Bring ${q.count}× ${ITEMS[q.target]?.name ?? q.target}`;
      lines.push(`<div>${complete ? '✅' : '📜'} ${what} → ${q.village}</div>`);
    }
    const html = lines.length ? `<div class="title">Quests</div>${lines.join('')}` : '';
    if (this.questEl.innerHTML !== html) this.questEl.innerHTML = html;
    // A class rather than an inline style. Written on the element, `display` outranks every rule in
    // the stylesheet, so the one screen that wants this panel gone — a phone, which has the errand
    // on the compass strip already — had to say `!important` to be heard at all.
    this.questEl.classList.toggle('has-errands', lines.length > 0);
  }

  hurt(): void {
    this.hurtTimer = 0.35;
    this.hurtEl.classList.add('show');
  }

  setArea(name: string): void {
    if (name === this.lastArea) return;
    this.lastArea = name;
    this.areaEl.textContent = name;
  }

  /** Throttled so the DOM is not rewritten every frame. */
  /**
   * Breath, and the seconds of warding left.
   *
   * Drawn every frame rather than on a version bump, because both are always moving and neither
   * is worth saving. Without it a spell is a line of text that has already gone: you cannot tell
   * whether you can afford to run, which is the only question the ward exists to answer.
   */
  setBreath(wind: number, warded: number, arm = 1, guarding = false): void {
    const row = (share: number) => {
      const full = Math.max(0, Math.min(10, Math.round(share * 10)));
      return `${'●'.repeat(full)}${'○'.repeat(10 - full)}`;
    };
    const parts = [row(wind)];
    // the arm shows only when it is worth knowing about. A meter that sits full through every walk
    // across the country is furniture, and the one thing this readout must not become is furniture
    if (arm < 1 || guarding) parts.push(`<span class="${arm < 0.2 ? 'winded' : 'arm'}">${guarding ? '🛡' : '⚔'} ${row(arm)}</span>`);
    if (warded > 0) parts.push(`<span class="warded">🛡 ${warded.toFixed(1)}s</span>`);
    const html = parts.join(' ');
    if (this.breathEl.innerHTML !== html) this.breathEl.innerHTML = html;
  }

  setDebug(dt: number, text: () => string): void {
    this.debugAccum += dt;
    if (this.debugAccum < 0.25) return;
    this.debugAccum = 0;
    this.debugEl.textContent = text();
  }

  /** Short banner, e.g. "Discovered: Watchtower". */
  flash(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = 3;
  }

  tick(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this.hurtEl.classList.remove('show');
    }
  }

  hideLoading(): void { this.loadingEl.style.display = 'none'; }
  setLoading(text: string): void { this.loadingEl.textContent = text; this.loadingEl.style.display = 'block'; }

  toggleOptions(): void { this.options.classList.toggle('show'); }
  closeOptions(): void { this.options.classList.remove('show'); }

}
