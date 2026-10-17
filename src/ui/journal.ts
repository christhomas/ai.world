import { $ } from './dom';
import { ITEMS, SLOTS, itemSummary } from '../game/items';
import { journalView, type JournalReading } from '../game/journal-view';

/** What the journal is drawn from; `game/journal-view.ts` says what it shows. */
export type JournalInput = JournalReading;

/** The J panel: what you carry, what you owe, what you have found, when the next boat leaves. */
export class Journal {
  private readonly el = $('journal');
  private open = false;

  toggle(input: () => JournalInput): void {
    this.open = !this.open;
    this.el.classList.toggle('show', this.open);
    if (this.open) this.render(input());
  }

  close(): void {
    this.open = false;
    this.el.classList.remove('show');
  }

  get isOpen(): boolean { return this.open; }

  refresh(input: () => JournalInput): void {
    if (this.open) this.render(input());
  }

  private render(d: JournalInput): void {
    const { state } = d;
    const view = journalView(d);
    const quests = view.errands.map((e) => {
      const where = e.tiles !== null ? ` — ${e.village}, ${e.tiles} tiles ${e.bearing}` : '';
      return `<li class="list-row">${e.done ? '✅' : '📜'} ${e.what}${where}</li>`;
    });
    const found = view.found.map((p) => `<li class="list-row">${p.icon} ${p.name} — ${p.tiles} tiles ${p.bearing}</li>`);
    const boats = view.ferries.map((line) =>
      `<li class="list-row">⛵ ${line.from} ↔ ${line.to} — ${line.where}, next arrival ${line.nextArrival}</li>`);

    const wornList = SLOTS.map((slot) => state.worn(slot)).filter((i) => i !== null)
      .map((i) => `<li class="list-row">${i!.emoji} ${i!.name} — ${itemSummary(i!) || i!.desc}</li>`);
    const carried = [...state.inventory.items.entries()]
      .map(([id, n]) => { const item = ITEMS[id]; return item ? `<li class="list-row">${item.emoji} ${item.name}${n > 1 ? ` ×${n}` : ''} — ${itemSummary(item) || item.desc}</li>` : ''; })
      .filter(Boolean);

    this.el.innerHTML = `
      <h2>Journal</h2>
      <div class="j-line">Day ${view.day}, ${view.season} · ${view.hp}/${view.maxHp} hearts · ⚔ ${view.attack} · 🛡 ${view.defence} · 💰 ${view.gold} gold</div>
      <div class="j-line">${view.placesFound} places found · ${view.errandsDone} errands finished · ${view.cellsWalked} map cells walked</div>
      ${section('Errands', quests, 'Nothing promised. Village elders stand near their wells.')}
      ${section('Worn', wornList, 'Nothing but your own clothes.')}
      ${section('Carried', carried, 'Empty-handed.')}
      ${section('Places found', found, 'Nothing yet. Follow the roads.')}
      ${section('Ferries', boats, 'No crossings known.')}
      <h3>Map key</h3>
      <ul class="j-key">
        <li><span class="sw" style="background:#ff4d4d"></span>you</li>
        <li><span class="sw" style="background:#ffffff"></span>town</li>
        <li><span class="sw" style="background:#2ecc71"></span>errand</li>
        <li><span class="sw" style="background:#f1c40f"></span>landmark</li>
        <li><span class="sw" style="background:#b07fd6"></span>cave</li>
        <li><span class="sw" style="background:#d68f5a"></span>wreck</li>
        <li><span class="sw" style="background:#6fd3ff"></span>ferry</li>
      </ul>
      <div class="j-hint">Enter talks, opens, boards and casts · X swings · M map · J or Escape to close</div>`;
  }
}

function section(title: string, items: string[], empty: string): string {
  const body = items.length ? `<ul>${items.join('')}</ul>` : `<div class="j-empty">${empty}</div>`;
  return `<h3>${title}</h3>${body}`;
}
