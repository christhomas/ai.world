import { $ } from './dom';
import { ITEMS, itemSummary } from '../game/items';
import type { GameState } from '../game/state';
import type { Quest } from '../game/quests';
import type { Poi, Site, Village } from '../world/structures';
import type { FerryLine } from '../game/ferry';
import { formatCountdown, ferryStateAt } from '../game/ferry';
import { SEASON_NAMES, seasonOf } from '../game/seasons';
import { SLOTS } from '../game/items';

export interface JournalInput {
  state: GameState;
  quests: Quest[];
  villages: Village[];
  pois: Poi[];
  /** Caves and wrecks: named once found, like points of interest. */
  sites: Site[];
  ferries: FerryLine[];
  seconds: number;
  playerX: number;
  playerZ: number;
}

const compass = (dx: number, dz: number): string => {
  const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  return dirs[Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) & 7];
};

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
    const dist = (x: number, z: number) => Math.round(Math.hypot(x - d.playerX, z - d.playerZ));
    const bearing = (x: number, z: number) => compass(x - d.playerX, z - d.playerZ);

    const quests = d.quests.filter((q) => state.quests.get(q.id) === 'active').map((q) => {
      const done = q.kind === 'visit' ? state.discovered.has(q.target) : state.count(q.target) >= q.count;
      const what = q.kind === 'visit' ? `find the ${q.target}` : `bring ${q.count}× ${ITEMS[q.target]?.name ?? q.target}`;
      const village = d.villages.find((v) => v.name === q.village);
      const where = village ? ` — ${q.village}, ${dist(village.x, village.z)} tiles ${bearing(village.x, village.z)}` : '';
      return `<li>${done ? '✅' : '📜'} ${what}${where}</li>`;
    });

    const found = [
      ...d.pois.filter((p) => state.discovered.has(p.name)).map((p) => ({ name: p.name, x: p.x, z: p.z, icon: '⭐' })),
      ...d.sites.filter((s) => state.discovered.has(s.name)).map((s) => ({ name: s.name, x: s.x, z: s.z, icon: s.id.startsWith('cave') ? '🕳️' : '🚢' })),
    ].sort((a, b) => Math.hypot(a.x - d.playerX, a.z - d.playerZ) - Math.hypot(b.x - d.playerX, b.z - d.playerZ))
      .map((p) => `<li>${p.icon} ${p.name} — ${dist(p.x, p.z)} tiles ${bearing(p.x, p.z)}</li>`);

    const boats = d.ferries.map((line) => {
      const st = ferryStateAt(line, d.seconds);
      const where = st.docked === 'from' ? line.fromName : st.docked === 'to' ? line.toName : 'at sea';
      return `<li>⛵ ${line.fromName} ↔ ${line.toName} — ${where}, next arrival ${formatCountdown(Math.min(st.arrivesIn.from, st.arrivesIn.to))}</li>`;
    });

    const wornList = SLOTS.map((slot) => state.worn(slot)).filter((i) => i !== null)
      .map((i) => `<li>${i!.emoji} ${i!.name} — ${itemSummary(i!) || i!.desc}</li>`);
    const carried = [...state.inventory.items.entries()]
      .map(([id, n]) => { const item = ITEMS[id]; return item ? `<li>${item.emoji} ${item.name}${n > 1 ? ` ×${n}` : ''} — ${itemSummary(item) || item.desc}</li>` : ''; })
      .filter(Boolean);

    const done = d.quests.filter((q) => state.quests.get(q.id) === 'done').length;
    this.el.innerHTML = `
      <h2>Journal</h2>
      <div class="j-line">Day ${state.day}, ${SEASON_NAMES[seasonOf(state.day)]} · ${state.hp}/${state.maxHpTotal} hearts · ⚔ ${state.attack} · 🛡 ${state.defence} · 💰 ${state.inventory.gold} gold</div>
      <div class="j-line">${state.discovered.size} places found · ${done} errands finished · ${state.explored.size} map cells walked</div>
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
