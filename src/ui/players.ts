import { $ } from './dom';
import type { Presence } from '../game/online';

export interface PlayerListInput {
  /** Everyone else the server says is in this world. */
  players: Presence[];
  /** Ids of the people travelling with you. */
  party: Set<string>;
  /** Where you are, so distances mean something. */
  x: number;
  z: number;
  /** The world you are standing in, so it can say who is beside you. */
  place: string;
  /** Your own name and how many parcels wait for you, for the heading. */
  me: string;
}

/** Which world somebody is standing in, said the way a person would. */
function whereabouts(place: string): string {
  if (place === 'surface') return 'out in the world';
  if (place.includes(':')) return `underground in ${place.split(':')[0]}`;
  return `inside ${place}`;
}

/** The same, for somebody other than you: standing beside you counts for more than the name. */
function relativeTo(place: string, mine: string): string {
  return place === mine ? 'here with you' : whereabouts(place);
}

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
    const rows = [...input.players]
      .sort((a, b) => Math.hypot(a.x - input.x, a.z - input.z) - Math.hypot(b.x - input.x, b.z - input.z))
      .map((p) => {
        const away = Math.round(Math.hypot(p.x - input.x, p.z - input.z));
        const mark = input.party.has(p.id) ? '🧭 ' : '';
        const riding = p.riding === 'horse' ? ' · on horseback' : p.riding === 'boat' ? ' · under sail' : '';
        return `<li>${mark}<b>${p.name}</b> — ${relativeTo(p.place, input.place)}, ${away} tiles${riding}</li>`;
      });
    this.el.innerHTML = `
      <h2>Travellers</h2>
      <div class="j-line">You are ${input.me}, ${whereabouts(input.place)}.</div>
      ${rows.length ? `<ul>${rows.join('')}</ul>` : '<div class="j-empty">Nobody else is in this world right now.</div>'}
      <div class="j-hint">L closes · K asks the nearest one along · R drops a rally point</div>`;
  }
}
