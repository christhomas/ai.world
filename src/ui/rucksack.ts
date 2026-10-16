import { $ } from './dom';
import { packView, stowWorn, takeFromPack } from '../game/pack';
import type { EquipSlot } from '../game/items';
import type { GameState } from '../game/state';

/**
 * The rucksack: what is on your body on the left, what you are carrying on the right.
 * Click a carried item to wear it or eat it; click a worn item to take it off. Nothing is
 * ever destroyed by equipping, so swapping gear always puts the old piece back in the pack.
 */
export class Rucksack {
  private readonly el = $('rucksack');
  private open = false;
  private shownVersion = -1;
  /** Set by main so the world can react (light, climbing, HUD) and the game can save. */
  onChange: ((message: string) => void) | null = null;

  constructor(private readonly state: GameState) {
    this.el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-slot], [data-item]');
      if (!target) return;
      if (target.dataset.slot) this.unequip(target.dataset.slot as EquipSlot);
      else if (target.dataset.item) this.useOrEquip(target.dataset.item);
    });
  }

  get isOpen(): boolean { return this.open; }

  toggle(): void {
    this.open = !this.open;
    this.el.classList.toggle('show', this.open);
    if (this.open) this.render(true);
  }

  close(): void {
    this.open = false;
    this.el.classList.remove('show');
  }

  /** Repaint when the state changed under us (a purchase, a chest, a fish). */
  refresh(): void {
    if (this.open) this.render(false);
  }

  // what a tap does is the game's, in `game/pack.ts`, so a phone's pack page does the same
  private unequip(slot: EquipSlot): void {
    const said = stowWorn(this.state, slot);
    if (said) this.onChange?.(said);
    this.render(true);
  }

  private useOrEquip(id: string): void {
    const said = takeFromPack(this.state, id);
    if (said) this.onChange?.(said);
    this.render(true);
  }

  private render(force: boolean): void {
    if (!force && this.state.version === this.shownVersion) return;
    this.shownVersion = this.state.version;
    const view = packView(this.state);

    const dolls = view.worn.map((worn) => {
      const body = worn.id
        ? `<div class="r-item list-row worn" data-slot="${worn.slot}" title="${worn.note}"><span class="r-emoji">${worn.emoji}</span><span class="r-name">${worn.name}</span></div>`
        : `<div class="r-item list-row empty"><span class="r-emoji">${worn.icon}</span><span class="r-name">empty</span></div>`;
      return `<div class="r-slot"><div class="r-slot-name">${worn.slotName}</div>${body}</div>`;
    }).join('');

    const carried = view.carried.map((thing) => `<div class="r-item list-row ${thing.verb}" data-item="${thing.id}" title="${thing.note}">
          <span class="r-emoji">${thing.emoji}</span>
          <span class="r-name">${thing.name}${thing.count > 1 ? ` ×${thing.count}` : ''}</span>
          <span class="r-note">${thing.verb === 'look' ? `${thing.price}g` : thing.verb}</span>
        </div>`);

    this.el.innerHTML = `
      <h2>Rucksack</h2>
      <div class="r-stats">
        💰 ${view.gold} gold · ♥ ${view.hp}/${view.maxHp} · ⚔ ${view.attack} attack · 🛡 ${view.defence} defence
      </div>
      <div class="r-columns">
        <div class="r-worn"><h3>Worn</h3>${dolls}</div>
        <div class="r-bag">
          <h3>Carried</h3>
          ${carried.length ? `<div class="r-grid">${carried.join('')}</div>` : '<div class="r-empty">Nothing but lint.</div>'}
        </div>
      </div>
      <div class="r-hint">Click carried gear to wear it, worn gear to stow it, food to eat it · I or Escape to close</div>`;
  }
}
