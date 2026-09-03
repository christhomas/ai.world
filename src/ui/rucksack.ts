import { $ } from './dom';
import { ITEMS, SLOTS, SLOT_ICONS, SLOT_NAMES, isConsumable, isEquippable, itemSummary, sellPrice, type EquipSlot } from '../game/items';
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

  private unequip(slot: EquipSlot): void {
    const item = this.state.unequip(slot);
    if (item) this.onChange?.(`Stowed the ${item.name}.`);
    this.render(true);
  }

  private useOrEquip(id: string): void {
    const item = ITEMS[id];
    if (!item) return;
    if (isEquippable(item)) {
      const worn = this.state.equip(id);
      if (worn) this.onChange?.(`Equipped the ${worn.name}.`);
    } else if (isConsumable(item)) {
      const message = this.state.use(id);
      if (message) this.onChange?.(message);
    } else {
      this.onChange?.(`${item.name}: ${item.desc} Worth ${sellPrice(item)} gold to the right buyer.`);
    }
    this.render(true);
  }

  private render(force: boolean): void {
    if (!force && this.state.version === this.shownVersion) return;
    this.shownVersion = this.state.version;
    const s = this.state;

    const dolls = SLOTS.map((slot) => {
      const item = s.worn(slot);
      const body = item
        ? `<div class="r-item worn" data-slot="${slot}" title="${itemSummary(item)}"><span class="r-emoji">${item.emoji}</span><span class="r-name">${item.name}</span></div>`
        : `<div class="r-item empty"><span class="r-emoji">${SLOT_ICONS[slot]}</span><span class="r-name">empty</span></div>`;
      return `<div class="r-slot"><div class="r-slot-name">${SLOT_NAMES[slot]}</div>${body}</div>`;
    }).join('');

    const carried = [...s.inventory.items.entries()]
      .map(([id, n]) => ({ item: ITEMS[id], n }))
      .filter((e) => e.item)
      .sort((a, b) => rank(a.item.slot) - rank(b.item.slot) || a.item.name.localeCompare(b.item.name))
      .map(({ item, n }) => {
        const action = isEquippable(item) ? 'wear' : isConsumable(item) ? 'use' : 'look';
        const note = itemSummary(item) || item.desc;
        return `<div class="r-item ${action}" data-item="${item.id}" title="${note}">
          <span class="r-emoji">${item.emoji}</span>
          <span class="r-name">${item.name}${n > 1 ? ` ×${n}` : ''}</span>
          <span class="r-note">${isEquippable(item) ? 'wear' : isConsumable(item) ? 'use' : `${sellPrice(item)}g`}</span>
        </div>`;
      });

    this.el.innerHTML = `
      <h2>Rucksack</h2>
      <div class="r-stats">
        💰 ${s.inventory.gold} gold · ♥ ${s.hp}/${s.maxHpTotal} · ⚔ ${s.attack} attack · 🛡 ${s.defence} defence
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

/** Sort order in the pack: weapons, armour, tools, then everything else. */
function rank(slot: EquipSlot | undefined): number {
  switch (slot) {
    case 'hand': return 0;
    case 'offhand': return 1;
    case 'head': return 2;
    case 'body': return 3;
    case 'feet': return 4;
    case 'trinket': return 5;
    default: return 6;
  }
}
