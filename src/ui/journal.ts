import { $ } from './dom';
import { ITEMS } from '../game/shops';
import type { GameState } from '../game/state';
import type { Quest } from '../game/quests';
import type { Poi, Village } from '../world/structures';
import type { FerryLine } from '../game/ferry';
import { formatCountdown, ferryStateAt } from '../game/ferry';
import { SEASON_NAMES, seasonOf } from '../game/seasons';

export interface JournalInput {
  state: GameState;
  quests: Quest[];
  villages: Village[];
  pois: Poi[];
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

    const found = d.pois.filter((p) => state.discovered.has(p.name))
      .map((p) => `<li>⭐ ${p.name} — ${dist(p.x, p.z)} tiles ${bearing(p.x, p.z)}</li>`);

    const boats = d.ferries.map((line) => {
      const st = ferryStateAt(line, d.seconds);
      const where = st.docked === 'from' ? line.fromName : st.docked === 'to' ? line.toName : 'at sea';
      return `<li>⛵ ${line.fromName} ↔ ${line.toName} — ${where}, next arrival ${formatCountdown(Math.min(st.arrivesIn.from, st.arrivesIn.to))}</li>`;
    });

    const carried = [...state.inventory.items.entries()]
      .map(([id, n]) => { const item = ITEMS[id]; return item ? `<li>${item.emoji} ${item.name}${n > 1 ? ` ×${n}` : ''} — ${item.effect?.type === 'passive' ? item.effect.note : item.desc}</li>` : ''; })
      .filter(Boolean);

    const done = d.quests.filter((q) => state.quests.get(q.id) === 'done').length;
    this.el.innerHTML = `
      <h2>Journal</h2>
      <div class="j-line">Day ${state.day}, ${SEASON_NAMES[seasonOf(state.day)]} · ${state.hp}/${state.maxHpTotal} hearts · 💰 ${state.inventory.gold} gold</div>
      <div class="j-line">${state.discovered.size} places found · ${done} errands finished · ${state.explored.size} map cells walked</div>
      ${section('Errands', quests, 'Nothing promised. Village elders stand near their wells.')}
      ${section('Carried', carried, 'Empty-handed.')}
      ${section('Places found', found, 'Nothing yet. Follow the roads.')}
      ${section('Ferries', boats, 'No crossings known.')}
      <div class="j-hint">J or Escape to close</div>`;
  }
}

function section(title: string, items: string[], empty: string): string {
  const body = items.length ? `<ul>${items.join('')}</ul>` : `<div class="j-empty">${empty}</div>`;
  return `<h3>${title}</h3>${body}`;
}
