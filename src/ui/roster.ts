import { $ } from './dom';
import type { Register } from '../world/register';
import { ROSTER_ORDERS, doingNear, rosterView, type RosterOrder, type RosterView, type Watching } from '../game/roster-view';

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

/** What the columns can be sorted by; `game/roster-view.ts` says what each means. */
export type By = RosterOrder;

export class Roster {
  private readonly el = $('roster');
  private open = false;
  private by: By = 'village';
  private read: (() => Register) | null = null;
  private countVillages: (() => number) | null = null;
  private crowd: Watching | undefined;
  private near: (() => { x: number; z: number }) | undefined;

  /**
   * Where the register lives, and how many villages the world has.
   *
   * The second one matters more than it looks. A village is founded the first time anybody goes
   * near it — and founding it depends on what the land there offers, so it cannot honestly be done
   * from a panel: a village founded on a trade list read from half-grown country is the same names
   * doing different jobs. So the roster shows who is known and says plainly how many places have
   * not been visited yet, rather than quietly inventing them.
   */
  reads(
    register: () => Register, villages: () => number,
    crowd?: Watching, near?: () => { x: number; z: number },
  ): void {
    this.read = register;
    this.countVillages = villages;
    this.crowd = crowd;
    this.near = near;
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
    // the rows are the game's (`rosterView`), which an installed app's roster shows as well; what
    // anybody the page has a body for is presently up to is blank for most of a village, because
    // seven of thirty are out and the rest are a row in a book
    const view = rosterView(register, this.by, this.countVillages?.() ?? 0, doingNear(this.crowd, this.near?.()));

    this.el.innerHTML = `
      <h2>The Roster</h2>
      <div class="j-line">
        Day ${view.day} · ${view.alive} alive in ${view.villages} ${view.villages === 1 ? 'village' : 'villages'}
        · ${view.purse} gold between them${view.hungry > 0 ? ` · <span class="ro-hungry">${view.hungry} going without</span>` : ''}
      </div>
      ${unvisited(view.unvisited)}
      <div class="ro-sort">Sort: ${ROSTER_ORDERS
        .map((by) => `<button data-by="${by}" class="${by === this.by ? 'on' : ''}">${by}</button>`).join('')}</div>
      <div class="ro-scroll list-scroll"><table class="ro-table">
        <thead><tr><th>Name</th><th>Village</th><th>Trade</th><th>Age</th><th>Gold</th><th>Fed</th><th>Doing</th><th>Family</th></tr></thead>
        <tbody>${view.people.map(row).join('')}</tbody>
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
function unvisited(rest: number): string {
  if (rest === 0) return '';
  return `<div class="j-line ro-family">${rest} more ${rest === 1 ? 'village has' : 'villages have'} not been visited yet — nobody is on the register until somebody goes there.</div>`;
}

/**
 * One line about one person.
 *
 * `doing` comes from whoever is standing in a street rather than from the register, because it is
 * not a fact about a person — it is a fact about the branch of a behaviour tree that claimed the
 * last tick, and the register has never seen a behaviour tree. Blank for everybody the page has no
 * body for, which is most of a village most of the time: a page is shown seven of a village's
 * thirty and the other twenty-three are a row in a book.
 *
 * It arrives over the wire. A page cannot work it out, because a villager's tree runs on the world
 * — which is the whole of why `VillagerSnap` carries it.
 */
function row(p: RosterView['people'][number]): string {
  /*
   * Old age said out loud, because it is the one stage a trade hides.
   *
   * The trade column falls back to the stage for anybody who has not taken one, which covers babies
   * and children and never covers an elder: an old man is a farmer in the register until the day he
   * is buried. So a village full of grandfathers read exactly like a village full of apprentices,
   * and the roster is where the player would otherwise first notice that the place had stopped
   * earning what it used to. Item #245.
   */
  const old = p.old ? ' <span class="ro-old">old</span>' : '';
  const fed = p.hungry === 0 ? '<span class="ro-fed">fed</span>'
    : `<span class="ro-hungry">${p.hungry}d</span>`;
  return `<tr class="list-row">
    <td>${p.name}</td>
    <td>${p.village}</td>
    <td>${p.trade}</td>
    <td>${p.age}${old}</td>
    <td>${p.purse}</td>
    <td>${fed}</td>
    <td class="ro-doing">${p.doing}</td>
    <td class="ro-family">${p.parents}</td>
  </tr>`;
}
