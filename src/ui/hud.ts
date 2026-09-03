import type { SceneRig } from '../render/scene';
import { ITEMS, type Inventory } from '../game/shops';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** Area banner, debug readout, options panel, dialog box. Plain DOM, no framework. */
export class Hud {
  private readonly areaEl = $('areaName');
  private readonly debugEl = $('debug');
  private readonly loadingEl = $('loading');
  private readonly options = $('optionsPanel');
  private readonly invEl = $('inventory');
  private lastArea = '';
  private debugAccum = 0;
  private readonly toast = $('toast');
  private toastTimer = 0;

  constructor(rig: SceneRig, seed: number) {
    const sun = $<HTMLInputElement>('sunlightSlider');
    const hemi = $<HTMLInputElement>('hemisphereSlider');
    const sunV = $('sunlightValue');
    const hemiV = $('hemisphereValue');
    sun.value = String(rig.sun.intensity);
    hemi.value = String(rig.hemi.intensity);
    sunV.textContent = rig.sun.intensity.toFixed(1);
    hemiV.textContent = rig.hemi.intensity.toFixed(2);
    sun.addEventListener('input', () => { rig.sun.intensity = +sun.value; sunV.textContent = rig.sun.intensity.toFixed(1); });
    hemi.addEventListener('input', () => { rig.hemi.intensity = +hemi.value; hemiV.textContent = rig.hemi.intensity.toFixed(2); });
    $('seedValue').textContent = String(seed);
  }

  setInventory(inv: Inventory): void {
    const lines = [`💰 ${inv.gold} gold`];
    for (const [id, n] of inv.items) {
      const item = ITEMS[id];
      if (item) lines.push(`${item.emoji} ${item.name}${n > 1 ? ` ×${n}` : ''}`);
    }
    this.invEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
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
  }

  hideLoading(): void { this.loadingEl.style.display = 'none'; }
  setLoading(text: string): void { this.loadingEl.textContent = text; this.loadingEl.style.display = 'block'; }

  toggleOptions(): void { this.options.classList.toggle('show'); }
  closeOptions(): void { this.options.classList.remove('show'); }

}
