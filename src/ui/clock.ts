import { $ } from './dom';
import { SEASON_NAMES, seasonOf } from '../game/seasons';
import type { GameState } from '../game/state';

/** What the sky is doing, for the icon and the tint of the day bar. */
export type Phase = 'night' | 'dawn' | 'day' | 'dusk';

interface PhaseLook { icon: string; name: string; colour: string }

const PHASES: Record<Phase, PhaseLook> = {
  night: { icon: '🌙', name: 'Night', colour: '#5566aa' },
  dawn: { icon: '🌅', name: 'Dawn', colour: '#e8a05a' },
  day: { icon: '☀️', name: 'Day', colour: '#ffd76a' },
  dusk: { icon: '🌇', name: 'Dusk', colour: '#e8785a' },
};

/** Boundaries of the day, as fractions: dawn, full day, dusk, night. */
const DAWN = 0.22, MORNING = 0.32, EVENING = 0.72, NIGHTFALL = 0.82;

export function phaseAt(time: number): Phase {
  if (time < DAWN || time >= NIGHTFALL) return 'night';
  if (time < MORNING) return 'dawn';
  if (time < EVENING) return 'day';
  return 'dusk';
}

/**
 * The clock that sits over the minimap: the hour in large type, the day and season under it,
 * a phase icon, and a bar showing how far through the day you are with a marker where you stand.
 */
export class Clock {
  private readonly timeEl = $('clockTime');
  private readonly dateEl = $('clockDate');
  private readonly iconEl = $('clockIcon');
  private readonly barEl = $('clockBar');
  private readonly markerEl = $('clockMarker');
  private readonly weatherEl = $('clockWeather');
  private lastMinute = -1;
  private lastPhase: Phase | null = null;

  /** Cheap enough to call every frame: the DOM is only touched when the minute or phase changes. */
  update(state: GameState): void {
    const minutes = Math.floor(state.time * 24 * 60);
    const phase = phaseAt(state.time);
    this.markerEl.style.left = `${state.time * 100}%`;

    if (minutes === this.lastMinute && phase === this.lastPhase) return;
    this.lastMinute = minutes;

    const h = Math.floor(minutes / 60), m = minutes % 60;
    this.timeEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.dateEl.textContent = `Day ${state.day} · ${SEASON_NAMES[seasonOf(state.day)]}`;

    if (phase === this.lastPhase) return;
    this.lastPhase = phase;
    const look = PHASES[phase];
    this.iconEl.textContent = look.icon;
    this.iconEl.title = look.name;
    this.timeEl.style.color = look.colour;
    this.barEl.style.background = `linear-gradient(90deg, #2a3560 0%, #2a3560 ${DAWN * 100}%, #e8a05a ${MORNING * 100}%, #ffd76a 50%, #e8785a ${EVENING * 100}%, #2a3560 ${NIGHTFALL * 100}%, #2a3560 100%)`;
  }

  /** A rain or snow glyph beside the phase icon, or nothing at all. */
  setWeather(glyph: string): void {
    if (this.weatherEl.textContent !== glyph) this.weatherEl.textContent = glyph;
  }
}
