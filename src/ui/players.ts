import { $ } from './dom';
import { companyView, type CompanyInput } from '../game/company-view';

/** What the list is drawn from; `game/company-view.ts` reads it, for this page and an installed app. */
export type PlayerListInput = CompanyInput;

/** The L panel: everyone in this world, where they are, and how far off. */
export class PlayerList {
  private readonly el = $('players');
  private open = false;

  toggle(input: () => PlayerListInput): void {
    this.open = !this.open;
    this.el.classList.toggle('show', this.open);
    if (this.open) this.render(input());
  }

  close(): void {
    this.open = false;
    this.el.classList.remove('show');
  }

  get isOpen(): boolean { return this.open; }

  /** Redraw while the panel is up, so people move about in it. */
  refresh(input: () => PlayerListInput): void {
    if (this.open) this.render(input());
  }

  private render(input: PlayerListInput): void {
    const view = companyView(input);
    const rows = view.travellers.map((p) => {
      const mark = p.party ? '🧭 ' : '';
      const riding = p.riding === 'horse' ? ' · on horseback' : p.riding === 'boat' ? ' · under sail' : '';
      return `<li class="list-row">${mark}<b>${p.name}</b> — ${p.where}, ${p.away} tiles${riding}</li>`;
    });
    this.el.innerHTML = `
      <h2>Travellers</h2>
      <div class="j-line">You are ${view.me}, ${view.where}.</div>
      ${rows.length ? `<ul>${rows.join('')}</ul>` : '<div class="j-empty">Nobody else is in this world right now.</div>'}
      <div class="j-hint">L closes · K asks the nearest one along · R drops a rally point</div>`;
  }
}
