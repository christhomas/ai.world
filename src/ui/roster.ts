import { $ } from './dom';
import { ageOf, stageOf, type Person } from '../world/people';
import type { Register } from '../world/register';

/**
 * Everybody in the world, and how they are getting on.
 *
 * The game already knows a great deal about its people — what they do, who their parents are, what
 * they have put by, how long since they last ate — and until now the only way to learn any of it
 * was to walk up to one of them and talk. That is right for meeting somebody and useless for the
 * question this answers: *is the village economy working?* You cannot see a system by interviewing
 * one member of it.
 *
 * So: one page, every village, everybody in it, sorted by whatever the reader is asking about.
 * Deliberately a reading of the register rather than a copy — it is rebuilt from the live one each
 * time it is opened, so it is never out of date and there is nothing to keep in step.
 *
 * The family tree taught the shape of this: a thing you open, drag your eye down, and close.
 */

/** What the columns can be sorted by. */
export type By = 'village' | 'name' | 'age' | 'purse' | 'hunger';

const HUNGRY_ENOUGH_TO_SAY = 1;

export class Roster {
  private readonly el = $('roster');
  private open = false;
  private by: By = 'village';
  private read: (() => Register) | null = null;
  private countVillages: (() => number) | null = null;

  /**
   * Where the register lives, and how many villages the world has.
   *
   * The second one matters more than it looks. A village is founded the first time anybody goes
   * near it — and founding it depends on what the land there offers, so it cannot honestly be done
   * from a panel: a village founded on a trade list read from half-grown country is the same names
   * doing different jobs. So the roster shows who is known and says plainly how many places have
   * not been visited yet, rather than quietly inventing them.
   */
  reads(register: () => Register, villages: () => number): void {
    this.read = register;
    this.countVillages = villages;
  }

  get isOpen(): boolean { return this.open; }

  toggle(): void {
    this.open = !this.open;
    this.el.classList.toggle('show', this.open);
    if (this.open) this.draw();
  }

  close(): void {
    this.open = false;
    this.el.classList.remove('show');
  }

  /** Redraw while it is up, so a day passing changes what it says. */
  refresh(): void { if (this.open) this.draw(); }

  private draw(): void {
    const register = this.read?.();
    if (!register) return;
    const day = register.today;
    const folk = [...register.everybody()];
    folk.sort(orderBy(this.by, day));

    const villages = new Set(folk.map((p) => p.village));
    const purse = folk.reduce((sum, p) => sum + p.purse, 0);
    const hungry = folk.filter((p) => p.hungry >= HUNGRY_ENOUGH_TO_SAY).length;

    this.el.innerHTML = `
      <h2>The Roster</h2>
      <div class="j-line">
        Day ${day} · ${folk.length} alive in ${villages.size} ${villages.size === 1 ? 'village' : 'villages'}
        · ${purse} gold between them${hungry > 0 ? ` · <span class="ro-hungry">${hungry} going without</span>` : ''}
      </div>
      ${unvisited(this.countVillages?.() ?? villages.size, villages.size)}
      <div class="ro-sort">Sort: ${(['village', 'name', 'age', 'purse', 'hunger'] as By[])
        .map((by) => `<button data-by="${by}" class="${by === this.by ? 'on' : ''}">${by}</button>`).join('')}</div>
      <div class="ro-scroll"><table class="ro-table">
        <thead><tr><th>Name</th><th>Village</th><th>Trade</th><th>Age</th><th>Gold</th><th>Fed</th><th>Family</th></tr></thead>
        <tbody>${folk.map((p) => row(p, day)).join('')}</tbody>
      </table></div>
      <div class="j-hint">1 closes · everything here is the register, read live</div>`;

    for (const button of this.el.querySelectorAll<HTMLButtonElement>('.ro-sort button')) {
      button.addEventListener('click', () => {
        this.by = (button.dataset.by ?? 'village') as By;
        this.draw();
      });
    }
  }
}

/**
 * What the roster cannot tell you, said out loud.
 *
 * A village nobody has been to has no people yet — not because they are hidden, but because who
 * lives there is settled the first time somebody arrives, off the land around it. Saying so beats
 * an empty row, and beats founding them here to make the table look complete.
 */
function unvisited(known: number, settled: number): string {
  const rest = Math.max(0, known - settled);
  if (rest === 0) return '';
  return `<div class="j-line ro-family">${rest} more ${rest === 1 ? 'village has' : 'villages have'} not been visited yet — nobody is on the register until somebody goes there.</div>`;
}

/** One line about one person. */
function row(p: Person, day: number): string {
  const years = ageOf(p, day);
  const stage = stageOf(p, day);
  const parents = p.mother || p.father ? `${firstOf(p.mother)} & ${firstOf(p.father)}` : '—';
  const fed = p.hungry === 0 ? '<span class="ro-fed">fed</span>'
    : `<span class="ro-hungry">${p.hungry}d</span>`;
  return `<tr>
    <td>${p.name}</td>
    <td>${p.village}</td>
    <td>${p.trade || (stage === 'adult' ? '—' : stage)}</td>
    <td>${years}</td>
    <td>${p.purse}</td>
    <td>${fed}</td>
    <td class="ro-family">${parents}</td>
  </tr>`;
}

/** A parent, as a name people would say rather than as a record. */
function firstOf(name: string): string {
  return name ? name.split(' ')[0] : '—';
}

/**
 * How the list is ordered, given what is being asked about.
 *
 * Descending for the two that are questions — who has the most, who has gone longest without —
 * and ascending for the three that are labels, because a list of names you are looking somebody up
 * in wants to be in the order you would look them up.
 */
export function orderBy(by: By, day: number): (a: Person, b: Person) => number {
  switch (by) {
    case 'name': return (a, b) => a.name.localeCompare(b.name);
    case 'age': return (a, b) => ageOf(b, day) - ageOf(a, day);
    case 'purse': return (a, b) => b.purse - a.purse;
    case 'hunger': return (a, b) => b.hungry - a.hungry || b.purse - a.purse;
    case 'village': return (a, b) => a.village.localeCompare(b.village) || a.name.localeCompare(b.name);
  }
}
