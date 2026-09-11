import { levelFor } from '../game/prowess';

/**
 * How many blocks the health bar is drawn in.
 *
 * Twenty, which is twice what the hearts managed and about as fine as a row of characters can be
 * read at a glance. The number beside it carries the precision; this carries the shape.
 */
const HEALTH_PIPS = 20;

/**
 * A meter, as a row of blocks.
 *
 * Shared by health, breath and the sword arm because all three are one scale now and a reader
 * should not have to learn two. Exported so it can be held to that without standing up a HUD: it
 * is the only part of a readout that can be wrong without anybody noticing, since a bar that is a
 * block short at the top reads as full.
 */
export function meter(share: number): string {
  // a share worked out from a nought — a creature with no maximum, a state part-way through being
  // loaded — arrives as NaN, and `repeat(NaN)` is an empty string, so the bar would vanish rather
  // than read empty. An unreadable meter is worse than a wrong one: it looks like nothing is there
  const held = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
  const lit = Math.round(held * HEALTH_PIPS);
  return `${'█'.repeat(lit)}${'░'.repeat(HEALTH_PIPS - lit)}`;
}

/** Below this share of your own maximum, the bar says so in colour. */
const LOW_ON_HEALTH = 0.3;

import { describeGpu, type Quality, type SceneRig } from '../render/scene';
import { ITEMS, SLOTS } from '../game/items';
import type { GameState } from '../game/state';
import type { Quest } from '../game/quests';

import { $ } from './dom';
import { GAME } from '../core/version';
import { hasTheScreen, toggleFullScreen } from './sideways';

/** Area banner, debug readout, options panel, dialog box. Plain DOM, no framework. */
export class Hud {
  private readonly areaEl = $('areaName');
  private readonly debugText = $('debugText');
  private readonly loadingEl = $('loading');
  private readonly options = $('optionsPanel');
  private readonly invEl = $('inventory');
  private readonly questEl = $('quests');
  /** Volume slider moved (0..1). */
  onVolumeChange: ((v: number) => void) | null = null;
  onReturnToTitle: (() => void) | null = null;
  private lastArea = '';
  private debugAccum = 0;
  private readonly toast = $('toast');
  private toastTimer = 0;
  private readonly heartsEl = $('hearts');
  private readonly breathEl = $('breath');
  private readonly hurtEl = $('hurt');
  private hurtTimer = 0;
  private readonly linkEl = $('netlink');
  /** What the badge is doing, so a frame that changes nothing touches no DOM. */
  private linkShown = false;
  private shownVersion = -1;
  /** Clicking the pouch opens the rucksack. */
  onOpenRucksack: (() => void) | null = null;
  /** Options sliders moved: (sun, hemisphere) daytime intensities. */
  onLightChange: ((sun: number, hemi: number) => void) | null = null;
  /** How hard the renderer should work per frame. */
  onQualityChange: ((level: Quality) => void) | null = null;

  constructor(rig: SceneRig, seed: number) {
    /*
     * What this build calls itself, said twice and written once.
     *
     * In the stats corner because that is where somebody is already looking when the game is
     * behaving oddly, and in the options because that is the panel anybody opens when they are
     * about to tell somebody else about it. The first question asked of a deployment that has just
     * gone out is which version is actually on the screen, and until now the answer was to read
     * the tag on the cluster and hope. The title screen has said it since it was built; the game
     * itself never did, and the game is where you are when you notice.
     */
    $('debugBuild').textContent = `${GAME.name} v${GAME.version}`;
    $('optionsBuild').textContent = `${GAME.name} v${GAME.version} · built ${GAME.builtOn}`;

    const sun = $<HTMLInputElement>('sunlightSlider');
    const hemi = $<HTMLInputElement>('hemisphereSlider');
    const sunV = $('sunlightValue');
    const hemiV = $('hemisphereValue');
    sun.value = String(rig.sun.intensity);
    hemi.value = String(rig.hemi.intensity);
    /*
     * Both to one decimal, which they were not.
     *
     * The sun read `2.6` and the sky read `1.00`, one above the other in the same column, because
     * each was rounded to the precision of its own slider's step rather than to what a person
     * reading two numbers together expects. Two decimals also buys nothing here: the sky's step is
     * a twentieth, so the second digit is only ever a nought or a five.
     */
    sunV.textContent = rig.sun.intensity.toFixed(1);
    hemiV.textContent = rig.hemi.intensity.toFixed(1);
    sun.addEventListener('input', () => { sunV.textContent = (+sun.value).toFixed(1); this.onLightChange?.(+sun.value, +hemi.value); });
    hemi.addEventListener('input', () => { hemiV.textContent = (+hemi.value).toFixed(1); this.onLightChange?.(+sun.value, +hemi.value); });
    $('seedValue').textContent = String(seed);
    const vol = $<HTMLInputElement>('volumeSlider');
    const volV = $('volumeValue');
    vol.addEventListener('input', () => { volV.textContent = `${Math.round(+vol.value * 100)}%`; this.onVolumeChange?.(+vol.value); });
    this.setVolume = (v: number) => { vol.value = String(v); volV.textContent = `${Math.round(v * 100)}%`; };
    const quality = $<HTMLSelectElement>('qualitySelect');
    quality.value = rig.quality;
    quality.addEventListener('change', () => this.onQualityChange?.(quality.value as Quality));

    // say what is really drawing this: a browser quietly rendering in software looks like a slow
    // computer, and nobody can tell the difference from inside the game
    const gpu = describeGpu(rig.renderer);
    const gpuEl = $('gpuName');
    gpuEl.textContent = gpu.accelerated ? gpu.name : `${gpu.name} — hardware acceleration is off`;
    gpuEl.classList.toggle('software', !gpu.accelerated);
    gpuEl.title = gpu.accelerated
      ? 'The graphics chip drawing this world'
      : 'Your browser is drawing this world on the processor. Turn hardware acceleration on in its settings for a much faster game.';

    /*
     * Full screen, asked for rather than taken.
     *
     * A phone is given the whole screen on the tap that enters a world, because a phone browser's
     * furniture is a fifth of the glass and the game cannot be played through it. A desktop is not
     * — grabbing the screen off somebody who clicked a save slot is a thing a page should not do.
     * That left no way to ask, so the game was played inside a window with a tab row, an address
     * bar and a bookmarks strip over a view of a landscape. Here is the way to ask.
     */
    const fullScreen = $('fullScreenButton');
    const sayScreen = () => { fullScreen.textContent = hasTheScreen() ? 'Leave full screen' : 'Full screen'; };
    fullScreen.addEventListener('click', () => { void toggleFullScreen().then(sayScreen); });
    // the player can leave by pressing Escape or F11, which we hear about only this way
    document.addEventListener('fullscreenchange', sayScreen);
    sayScreen();

    $('titleButton').addEventListener('click', () => this.onReturnToTitle?.());
    this.invEl.addEventListener('click', () => this.onOpenRucksack?.());
  }

  /** Redraw health and the carried summary when the state version changed. */
  syncState(state: GameState): void {
    if (state.version === this.shownVersion) return;
    this.shownVersion = state.version;
    /*
     * Health as a bar and a number, where it used to be a row of hearts.
     *
     * The hearts had to go, and not because they were twee. They were a *resolution* limit: ten of
     * them could say ten things, so every blow in the game had to be worth a tenth of the hero or
     * more, which is why a wolf could finish him in four bites. Health is a number on one scale for
     * everything alive now — a hundred is a fit adult — and a row of a hundred hearts is not a
     * readout, it is wallpaper.
     *
     * A bar keeps what the hearts were good at, which is being read without being counted; the
     * number beside it says the thing hearts could never say, which is how tough you have become.
     * That second half is the whole point of a scale that goes past a hundred: a hero who has grown
     * powerful is a hero with a larger maximum, and a percentage on its own throws that away.
     */
    const max = Math.max(1, state.maxHpTotal);
    const share = Math.max(0, Math.min(1, state.hp / max));
    const bar = meter(share);
    const low = share <= LOW_ON_HEALTH ? ' hud-hurt' : '';
    this.heartsEl.innerHTML =
      `<span class="hud-bar${low}">${bar}</span> <span class="hud-hp">${Math.ceil(state.hp)}/${max}</span>`;
    const worn = SLOTS.map((slot) => state.worn(slot)).filter((i) => i !== null);
    const lines = [`<div>💰 ${state.inventory.gold} gold</div>`];
    if (worn.length > 0) lines.push(`<div>${worn.map((i) => i!.emoji).join(' ')}</div>`);
    const skill = levelFor(state.practice);
    lines.push(`<div class="hud-stats">⚔ ${state.attack}${skill > 0 ? ` <span title="what practice has taught you">(+${skill})</span>` : ''} · 🛡 ${state.defence} · 🎒 ${state.inventory.items.size}</div>`);
    this.invEl.innerHTML = lines.join('');
  }

  setVolume: (v: number) => void = () => {};

  /** Active errands, ticked when their condition is met. */
  setQuests(quests: Quest[], state: GameState): void {
    const lines: string[] = [];
    for (const q of quests) {
      if (state.quests.get(q.id) !== 'active') continue;
      const complete = q.kind === 'visit' ? state.discovered.has(q.target) : state.count(q.target) >= q.count;
      const what = q.kind === 'visit' ? `Visit the ${q.target}` : `Bring ${q.count}× ${ITEMS[q.target]?.name ?? q.target}`;
      lines.push(`<div>${complete ? '✅' : '📜'} ${what} → ${q.village}</div>`);
    }
    const html = lines.length ? `<div class="title">Quests</div>${lines.join('')}` : '';
    if (this.questEl.innerHTML !== html) this.questEl.innerHTML = html;
    // A class rather than an inline style. Written on the element, `display` outranks every rule in
    // the stylesheet, so the one screen that wants this panel gone — a phone, which has the errand
    // on the compass strip already — had to say `!important` to be heard at all.
    this.questEl.classList.toggle('has-errands', lines.length > 0);
  }

  hurt(): void {
    this.hurtTimer = 0.35;
    this.hurtEl.classList.add('show');
  }

  setArea(name: string): void {
    if (name === this.lastArea) return;
    this.lastArea = name;
    this.areaEl.textContent = name;
  }

  /** Throttled so the DOM is not rewritten every frame. */
  /**
   * Breath, and the seconds of warding left.
   *
   * Drawn every frame rather than on a version bump, because both are always moving and neither
   * is worth saving. Without it a spell is a line of text that has already gone: you cannot tell
   * whether you can afford to run, which is the only question the ward exists to answer.
   */
  /**
   * Whether the game is out of touch with the world it is playing in.
   *
   * One flashing glyph and no words. What it is telling you is that the game *knows* — a world that
   * has gone quiet freezes every animal exactly where it stood, which from the outside is
   * indistinguishable from a simulation that has broken, and the difference between the two is the
   * whole of what a player needs to be told. Shown only while there is a world to be out of touch
   * with: a game played alone has no connection to lose, and a badge that sits there for ever
   * saying so would be furniture.
   */
  setLink(reaching: boolean): void {
    if (reaching === this.linkShown) return;
    this.linkShown = reaching;
    this.linkEl.hidden = !reaching;
  }

  /**
   * Breath and the sword arm, on the same scale as everything else that can run out.
   *
   * They were ten dots each, which is what health was before the rescale and was wrong here for the
   * same reason: a ten-dot row can say ten things, so a reading is only ever a tenth of the way
   * right, and the two readouts stacked under each other disagreed about what a full meter looked
   * like. One is a bar and a number out of a hundred, the other a row of circles.
   *
   * Both are shares rather than counts — nothing in the game has a number of breaths — so a hundred
   * is the whole of it and the number is a percentage, which is the honest reading of a share.
   */
  setBreath(wind: number, warded: number, arm = 1, guarding = false): void {
    const row = (share: number) => {
      const held = Math.max(0, Math.min(1, share));
      // `breath` so the bar takes the colour of whatever it is in — the blue of a lungful, the
      // green of a rested arm, the orange of one that is spent — rather than the green of health
      return `<span class="hud-bar breath">${meter(held)}</span>`
        + ` <span class="hud-hp">${Math.round(held * 100)}/100</span>`;
    };
    const parts = [row(wind)];
    // the arm shows only when it is worth knowing about. A meter that sits full through every walk
    // across the country is furniture, and the one thing this readout must not become is furniture
    if (arm < 1 || guarding) parts.push(`<span class="${arm < 0.2 ? 'winded' : 'arm'}">${guarding ? '🛡' : '⚔'} ${row(arm)}</span>`);
    if (warded > 0) parts.push(`<span class="warded">🛡 ${warded.toFixed(1)}s</span>`);
    const html = parts.join(' ');
    if (this.breathEl.innerHTML !== html) this.breathEl.innerHTML = html;
  }

  /**
   * The stats corner, four times a second.
   *
   * The version is written once at boot and lives in its own node, rather than being pasted onto
   * the front of whatever each of the three callers happens to say. There are three of them —
   * outdoors, underground, indoors — and each builds its own lines, so a version prepended by the
   * caller is a version that is right in two places and forgotten in the third the day somebody
   * adds a fourth.
   */
  setDebug(dt: number, text: () => string): void {
    this.debugAccum += dt;
    if (this.debugAccum < 0.25) return;
    this.debugAccum = 0;
    this.debugText.textContent = text();
  }

  /** Short banner, e.g. "Discovered: Watchtower". */
  flash(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = 3;
  }

  tick(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this.hurtEl.classList.remove('show');
    }
  }

  hideLoading(): void { this.loadingEl.style.display = 'none'; }
  setLoading(text: string): void { this.loadingEl.textContent = text; this.loadingEl.style.display = 'block'; }

  toggleOptions(): void { this.options.classList.toggle('show'); }
  closeOptions(): void { this.options.classList.remove('show'); }

}
