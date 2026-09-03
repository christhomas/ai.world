import { $ } from './dom';

/** One thing worth pointing at, with where it is from here. */
export interface CompassTarget {
  label: string;
  x: number;
  z: number;
  /** The one the errand is about, drawn brighter. */
  primary?: boolean;
}

const DIRECTIONS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

export function bearing(dx: number, dz: number): string {
  return DIRECTIONS[Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) & 7];
}

/**
 * A strip under the area name pointing at what you are meant to be doing: the errand first,
 * then the nearest town, so the map is a plan rather than a lookup. Hidden when there is nothing
 * to point at, and only redrawn when the text actually changes.
 */
export class Compass {
  private readonly el = $('compass');
  private shown = '';

  update(playerX: number, playerZ: number, targets: CompassTarget[]): void {
    const parts = targets.slice(0, 3).map((t) => {
      const dx = t.x - playerX, dz = t.z - playerZ;
      const tiles = Math.round(Math.hypot(dx, dz));
      const arrow = ARROWS[Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) & 7];
      return `<span class="${t.primary ? 'c-primary' : ''}">${arrow} ${t.label} · ${bearing(dx, dz)} ${tiles}</span>`;
    });
    const html = parts.join('');
    if (html === this.shown) return;
    this.shown = html;
    this.el.innerHTML = html;
    this.el.style.display = parts.length ? 'flex' : 'none';
  }
}

/** Arrow glyphs in the same order as the compass points, starting east. */
const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
