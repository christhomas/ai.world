import type { SceneRig } from '../render/scene';
import { ITEMS } from '../game/shops';
import type { GameState } from '../game/state';
import type { Quest } from '../game/quests';

import { $ } from './dom';

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
  private readonly clockEl = $('clock');
  private readonly hurtEl = $('hurt');
  private hurtTimer = 0;
  private shownVersion = -1;
  /** Set by main: called with an item id when the player clicks it in the inventory. */
  onUseItem: ((id: string) => void) | null = null;
  /** Options sliders moved: (sun, hemisphere) daytime intensities. */
  onLightChange: ((sun: number, hemi: number) => void) | null = null;

  constructor(rig: SceneRig, seed: number) {
    const sun = $<HTMLInputElement>('sunlightSlider');
    const hemi = $<HTMLInputElement>('hemisphereSlider');
    const sunV = $('sunlightValue');
    const hemiV = $('hemisphereValue');
    sun.value = String(rig.sun.intensity);
    hemi.value = String(rig.hemi.intensity);
    sunV.textContent = rig.sun.intensity.toFixed(1);
    hemiV.textContent = rig.hemi.intensity.toFixed(2);
    sun.addEventListener('input', () => { sunV.textContent = (+sun.value).toFixed(1); this.onLightChange?.(+sun.value, +hemi.value); });
    hemi.addEventListener('input', () => { hemiV.textContent = (+hemi.value).toFixed(2); this.onLightChange?.(+sun.value, +hemi.value); });
    $('seedValue').textContent = String(seed);
    const vol = $<HTMLInputElement>('volumeSlider');
    const volV = $('volumeValue');
    vol.addEventListener('input', () => { volV.textContent = `${Math.round(+vol.value * 100)}%`; this.onVolumeChange?.(+vol.value); });
    this.setVolume = (v: number) => { vol.value = String(v); volV.textContent = `${Math.round(v * 100)}%`; };
    $('titleButton').addEventListener('click', () => this.onReturnToTitle?.());
    this.invEl.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-item]')?.dataset.item;
      if (id) this.onUseItem?.(id);
    });
  }

  /** Redraw hearts + inventory when the state version changed. */
  syncState(state: GameState): void {
    if (state.version === this.shownVersion) return;
    this.shownVersion = state.version;
    const max = state.maxHpTotal;
    let hearts = '';
    for (let i = 0; i < max; i++) hearts += i < state.hp ? '♥' : '♡';
    this.heartsEl.textContent = hearts;
    const inv = state.inventory;
    const lines = [`<div>💰 ${inv.gold} gold</div>`];
    for (const [id, n] of inv.items) {
      const item = ITEMS[id];
      if (!item) continue;
      const usable = item.effect && item.effect.type !== 'passive';
      const cls = usable ? ' class="usable" title="Click to use"' : ` title="${item.effect?.type === 'passive' ? item.effect.note : ''}"`;
      lines.push(`<div data-item="${id}"${cls}>${item.emoji} ${item.name}${n > 1 ? ` ×${n}` : ''}</div>`);
    }
    this.invEl.innerHTML = lines.join('');
  }

  setVolume: (v: number) => void = () => {};

  setQuests(quests: Quest[], state: GameState): void {
    const lines: string[] = [];
    for (const q of quests) {
      const st = state.quests.get(q.id);
      if (st !== 'active') continue;
      const complete = q.kind === 'visit' ? state.discovered.has(q.target) : state.count(q.target) >= q.count;
      const what = q.kind === 'visit' ? `Visit the ${q.target}` : `Bring ${q.count}× ${ITEMS[q.target]?.name ?? q.target}`;
      lines.push(`<div>${complete ? '✅' : '📜'} ${what} → ${q.village}</div>`);
    }
    const html = lines.length ? `<div class="title">Quests</div>${lines.join('')}` : '';
    if (this.questEl.innerHTML !== html) this.questEl.innerHTML = html;
    this.questEl.style.display = lines.length ? 'block' : 'none';
  }

  setClock(text: string): void {
    if (this.clockEl.textContent !== text) this.clockEl.textContent = text;
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
