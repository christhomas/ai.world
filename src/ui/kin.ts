import { $ } from './dom';
import type { Kin, Lineage, Placed } from '../game/lineage';

/**
 * A village's descent, drawn, and something you move around with your hands.
 *
 * Every other book a clerk sells is read out three lines at a time, which is right for a list and
 * wrong for a family: a roll is a column of names and a lineage is a *shape*, and the whole reason
 * to pay for one is to see at a glance that the miner at the face and the woman keeping the inn
 * had the same mother. Read aloud, that is thirty sentences nobody can hold in their head. Drawn,
 * it is one look.
 *
 * So this is the map's machinery pointed at people instead of country — drag to pan, scroll or
 * pinch to zoom, click somebody to see what the register knows about them. It is deliberately the
 * same gestures as the world map, because a player who has opened a map has already learned this.
 */

/** How big a person is drawn, in tree units, and how far apart the generations sit. */
const CARD = { w: 0.86, h: 0.42, row: 1.5 } as const;

/** Where the zoom starts and where it may go. A tree of five generations wants to fit at the start. */
const ZOOM = { MIN: 14, MAX: 120, STEP: 1.25 } as const;

/** The colours: the living, the buried, and the remembered, told apart at a glance. */
const INK = {
  living: '#e8e2d0',
  buried: '#8e97a6',
  remembered: '#5d6472',
  livingEdge: '#f4efe0',
  tie: 'rgba(200,196,180,0.35)',
  chosen: '#f1c40f',
  paper: '#14161c',
  text: '#1b1d24',
  faint: '#9aa0ad',
} as const;

export class KinPanel {
  private readonly el = $('kinpanel');
  private readonly canvas = $<HTMLCanvasElement>('kinCanvas');
  private readonly header = $('kinTitle');
  private readonly card = $('kinCard');
  private readonly ctx: CanvasRenderingContext2D;
  private tree: Lineage | null = null;
  private placed: Placed[] = [];
  private shown = false;
  /** The middle of the view, in tree units. */
  private cx = 0;
  private cy = 0;
  private zoom = 34;
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private pinchGap = 0;
  private dpr = 1;
  private chosen: Kin | null = null;

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('lineage 2d context');
    this.ctx = ctx;
    window.addEventListener('resize', () => { if (this.shown) { this.resize(); this.draw(); } });

    this.canvas.addEventListener('mousedown', (e) => {
      this.dragging = true; this.moved = false;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    });
    const stop = (): void => { this.dragging = false; this.canvas.style.cursor = 'grab'; };
    this.canvas.addEventListener('mouseup', stop);
    this.canvas.addEventListener('mouseleave', stop);
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.pan(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    // a click is a press that did not turn into a drag, which is what keeps picking somebody out of
    // a tree from fighting with moving the tree
    this.canvas.addEventListener('click', (e) => { if (!this.moved) this.pick(e.clientX, e.clientY); });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAbout(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM.STEP : 1 / ZOOM.STEP);
    }, { passive: false });

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.dragging = true; this.moved = false;
        this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY;
      } else { this.dragging = false; this.pinchGap = gapBetween(e.touches); }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length >= 2) {
        const gap = gapBetween(e.touches);
        if (this.pinchGap > 0 && gap > 0) {
          const mid = midpoint(e.touches);
          this.zoomAbout(mid.x, mid.y, gap / this.pinchGap);
        }
        this.pinchGap = gap;
        return;
      }
      if (!this.dragging) return;
      const t = e.touches[0];
      this.pan(t.clientX - this.lastX, t.clientY - this.lastY);
      this.lastX = t.clientX; this.lastY = t.clientY;
    }, { passive: false });
    this.canvas.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        if (!this.moved && e.changedTouches.length === 1) {
          this.pick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        }
        this.dragging = false; this.pinchGap = 0;
      }
    });
  }

  get isOpen(): boolean { return this.shown; }

  /** Unroll a village's descent, framed so the whole of it is on the screen to start with. */
  show(tree: Lineage, placed: Placed[]): void {
    this.tree = tree;
    this.placed = placed;
    this.chosen = null;
    this.shown = true;
    this.el.classList.add('show');
    this.header.textContent = tree.people.length === 0
      ? `Nobody has kept a record at ${tree.village}`
      : `${tree.village}: ${tree.people.length} names over ${tree.generations} generations`;
    this.resize();
    this.frameAll();
    this.sayNothing();
    this.draw();
  }

  close(): void {
    this.shown = false;
    this.el.classList.remove('show');
  }

  private pan(dx: number, dy: number): void {
    if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    this.draw();
  }

  /** Zoom while keeping whatever is under the pointer under it, which is what makes it feel like paper. */
  private zoomAbout(clientX: number, clientY: number, by: number): void {
    const before = this.toTree(clientX, clientY);
    this.zoom = Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, this.zoom * by));
    const after = this.toTree(clientX, clientY);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.draw();
  }

  /** Fit the whole tree on the screen, which is how it should first appear. */
  private frameAll(): void {
    if (this.placed.length === 0) { this.cx = 0; this.cy = 0; return; }
    const xs = this.placed.map((p) => p.x), ys = this.placed.map((p) => p.y);
    const lowX = Math.min(...xs), highX = Math.max(...xs);
    const lowY = Math.min(...ys), highY = Math.max(...ys);
    this.cx = (lowX + highX) / 2;
    this.cy = ((lowY + highY) / 2) * CARD.row;
    const wide = (highX - lowX + 2), tall = (highY - lowY + 1) * CARD.row + 1;
    const rect = this.canvas.getBoundingClientRect();
    this.zoom = Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, Math.min(rect.width / wide, rect.height / tall)));
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
  }

  /** Screen point to tree units. */
  private toTree(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: this.cx + (clientX - rect.left - rect.width / 2) / this.zoom,
      y: this.cy + (clientY - rect.top - rect.height / 2) / this.zoom,
    };
  }

  /** Whoever was clicked, or nobody. */
  private pick(clientX: number, clientY: number): void {
    const at = this.toTree(clientX, clientY);
    const hit = this.placed.find((p) =>
      Math.abs(p.x - at.x) <= CARD.w / 2 && Math.abs(p.y * CARD.row - at.y) <= CARD.h / 2);
    this.chosen = hit ? hit.kin : null;
    if (hit) this.sayAbout(hit.kin); else this.sayNothing();
    this.draw();
  }

  /** What the register knows about one person, which is what the fee actually bought. */
  private sayAbout(kin: Kin): void {
    const lines: string[] = [];
    const stood = kin.standing === 'living' ? 'living'
      : kin.standing === 'buried' ? `died on day ${kin.died}`
      : 'remembered only as a parent';
    lines.push(`<strong>${kin.name}</strong>`);
    lines.push(`<span class="kin-note">${kin.trade || 'no trade'} · ${stood}</span>`);
    if (kin.age !== null) lines.push(`<span class="kin-note">${kin.age} years old${kin.died !== null ? ' when they died' : ''}</span>`);
    if (kin.born !== null) lines.push(`<span class="kin-note">born on day ${kin.born}</span>`);
    if (kin.purse !== null) lines.push(`<span class="kin-note">holds ${Math.round(kin.purse)} gold</span>`);
    const folk = [kin.mother, kin.father].filter(Boolean);
    if (folk.length > 0) lines.push(`<span class="kin-note">child of ${folk.join(' and ')}</span>`);
    const children = this.tree
      ? this.tree.people.filter((k) => k.mother === kin.name || k.father === kin.name).map((k) => k.name)
      : [];
    if (children.length > 0) lines.push(`<span class="kin-note">parent of ${children.join(', ')}</span>`);
    this.card.innerHTML = lines.join('<br>');
    this.card.classList.add('show');
  }

  private sayNothing(): void {
    this.card.innerHTML = '<span class="kin-note">Click somebody to see what the clerk has on them.</span>';
    this.card.classList.add('show');
  }

  private draw(): void {
    const { ctx } = this;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = INK.paper;
    ctx.fillRect(0, 0, w, h);
    if (this.placed.length === 0) return;

    // one transform for the whole drawing, so everything below is in tree units and reads as such
    const scale = this.zoom * this.dpr;
    ctx.setTransform(scale, 0, 0, scale, w / 2 - this.cx * scale, h / 2 - this.cy * scale);
    ctx.lineWidth = 1 / scale;

    const where = new Map(this.placed.map((p) => [p.kin.id, p]));
    ctx.strokeStyle = INK.tie;
    ctx.lineWidth = 2 / scale;
    for (const tie of this.tree?.ties ?? []) {
      const child = where.get(tie.child), parent = where.get(tie.parent);
      if (!child || !parent) continue;
      /*
       * An elbow rather than a straight line, and it matters at this size.
       *
       * Straight lines between two rows of people cross each other at every angle and the eye
       * cannot follow one across a village. Dropping halfway down from the parent, running across,
       * and dropping again gives every line the same two right angles — which is how a family tree
       * has been drawn since long before anybody had a screen to draw it on.
       */
      const fromY = parent.y * CARD.row + CARD.h / 2;
      const toY = child.y * CARD.row - CARD.h / 2;
      const midY = (fromY + toY) / 2;
      ctx.beginPath();
      ctx.moveTo(parent.x, fromY);
      ctx.lineTo(parent.x, midY);
      ctx.lineTo(child.x, midY);
      ctx.lineTo(child.x, toY);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const one of this.placed) {
      const y = one.y * CARD.row;
      const mine = this.chosen !== null && this.chosen.id === one.kin.id;
      ctx.fillStyle = one.kin.standing === 'living' ? INK.living
        : one.kin.standing === 'buried' ? INK.buried : INK.remembered;
      roundedBox(ctx, one.x - CARD.w / 2, y - CARD.h / 2, CARD.w, CARD.h, 0.08);
      ctx.fill();
      if (mine) {
        ctx.strokeStyle = INK.chosen;
        ctx.lineWidth = 4 / scale;
        ctx.stroke();
      }
      // the name only, and only when there is room for it: a card the size of a full stop with
      // four point text on it is worse than a card with nothing on it
      if (this.zoom > 26) {
        ctx.fillStyle = one.kin.standing === 'remembered' ? INK.faint : INK.text;
        ctx.font = `${(0.15).toFixed(3)}px ui-monospace, monospace`;
        const given = one.kin.name.split(' ')[0];
        const house = one.kin.name.split(' ').slice(1).join(' ');
        ctx.fillText(given, one.x, y - 0.06);
        if (house) ctx.fillText(house, one.x, y + 0.1);
      }
    }
  }
}

/** A card with its corners taken off, because a village of rectangles reads as a spreadsheet. */
function roundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const gapBetween = (touches: TouchList): number =>
  touches.length < 2 ? 0 : Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

const midpoint = (touches: TouchList): { x: number; y: number } => ({
  x: (touches[0].clientX + touches[1].clientX) / 2,
  y: (touches[0].clientY + touches[1].clientY) / 2,
});
