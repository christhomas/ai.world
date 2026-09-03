import * as THREE from 'three';
import type { SceneRig } from './scene';
import { smoothstep } from '../game/state';
import type { SeasonTint } from '../game/seasons';

const DAY_SKY = new THREE.Color(0x8fc1e6);
const DUSK_SKY = new THREE.Color(0xe89a6a);
const NIGHT_SKY = new THREE.Color(0x0b1230);
const DAY_SUN = new THREE.Color(0xfff3dc);
const DUSK_SUN = new THREE.Color(0xffa060);
const NIGHT_SUN = new THREE.Color(0x7080c0);
const DAY_HEMI_SKY = new THREE.Color(0xcfe6ff);
const NIGHT_HEMI_SKY = new THREE.Color(0x1a2450);
const DAY_HEMI_GROUND = new THREE.Color(0x6f8f4f);
const NIGHT_HEMI_GROUND = new THREE.Color(0x141a2a);
const DAY_AMBIENT = new THREE.Color(0xc9dcff);
const NIGHT_AMBIENT = new THREE.Color(0x26305a);
const WINDOW_DAY = new THREE.Color(0x9fd4ef);
const WINDOW_NIGHT = new THREE.Color(0xffc45a);

export interface DayCycleInput {
  /** Season tint applied to sky and sun. */
  season: SeasonTint;
  /** 0 = clear, 1 = heavy rain or snow: dims and greys the light. */
  wet: number;
  /** Fraction of the day: 0 midnight, 0.5 noon. */
  time: number;
  /** Camera target, so the sun keeps orbiting the view. */
  focusX: number;
  focusZ: number;
  heroX: number;
  heroY: number;
  heroZ: number;
  lanternOn: boolean;
}

/**
 * Drives sun, sky and window glow from the time of day. Pure colour/intensity lerps,
 * so the low-poly look survives the night instead of turning to mud.
 */
export class DayCycle {
  /** Unlit material shared by every window-glow instance. */
  readonly glowMaterial = new THREE.MeshBasicMaterial({ color: WINDOW_DAY });
  /** Follows the hero; lit when they carry a lantern at night. */
  readonly lantern = new THREE.PointLight(0xffb060, 0, 9, 1.6);
  private readonly tmp = new THREE.Color();
  private readonly tmp2 = new THREE.Color();
  private daySunIntensity: number;
  private dayHemiIntensity: number;
  private dayAmbientIntensity: number;

  constructor(private readonly rig: SceneRig) {
    this.daySunIntensity = rig.sun.intensity;
    this.dayHemiIntensity = rig.hemi.intensity;
    this.dayAmbientIntensity = rig.ambient.intensity;
    rig.scene.add(this.lantern);
  }

  /** Call when the options sliders change so the cycle scales the new daytime values. */
  setDayIntensities(sun: number, hemi: number): void {
    this.daySunIntensity = sun;
    this.dayHemiIntensity = hemi;
  }

  /** Returns the night factor in [0,1]. */
  apply({ time, focusX, focusZ, heroX, heroY, heroZ, lanternOn, season, wet }: DayCycleInput): number {
    const ang = (time - 0.25) * Math.PI * 2;
    const sunH = Math.sin(ang);
    const day = smoothstep(-0.12, 0.25, sunH);
    const night = 1 - day;
    const dusk = (1 - Math.min(1, Math.abs(sunH) / 0.35)) * day;

    const { sun, hemi, ambient, scene } = this.rig;
    // sun orbits east → west; at night it stays low as faint moonlight
    const r = 60;
    sun.position.set(
      focusX + Math.cos(ang) * r,
      18 + Math.max(0.1, sunH) * 62,
      focusZ + 26,
    );
    // the night floor is moonlight: dark enough to want a lantern, bright enough to walk by
    sun.intensity = this.daySunIntensity * (0.22 + 0.78 * day) * (1 - wet * 0.45);
    this.tmp.copy(DAY_SUN).lerp(DUSK_SUN, dusk).lerp(NIGHT_SUN, night);
    this.tmp.multiply(this.tmp2.setRGB(season.sky[0], season.sky[1], season.sky[2]));
    sun.color.copy(this.tmp);

    hemi.intensity = this.dayHemiIntensity * (0.55 + 0.45 * day) * (1 - wet * 0.2);
    hemi.color.copy(this.tmp.copy(DAY_HEMI_SKY).lerp(NIGHT_HEMI_SKY, night));
    hemi.groundColor.copy(this.tmp.copy(DAY_HEMI_GROUND).lerp(NIGHT_HEMI_GROUND, night));
    ambient.intensity = this.dayAmbientIntensity * (0.62 + 0.38 * day);
    ambient.color.copy(this.tmp.copy(DAY_AMBIENT).lerp(NIGHT_AMBIENT, night));

    this.tmp.copy(DAY_SKY).lerp(DUSK_SKY, dusk).lerp(NIGHT_SKY, night);
    this.tmp.multiply(this.tmp2.setRGB(season.sky[0], season.sky[1], season.sky[2]));
    if (wet > 0) this.tmp.lerp(this.tmp2.setHex(0x6a7480), wet * 0.55 * day);
    (scene.background as THREE.Color).copy(this.tmp);

    // windows warm up as the light fades
    this.glowMaterial.color.copy(this.tmp2.copy(WINDOW_DAY).lerp(WINDOW_NIGHT, smoothstep(0.3, 0.8, night)));

    // a faint glow follows the hero after dark even without a lantern, so you are never lost
    this.lantern.position.set(heroX, heroY + 1.4, heroZ);
    this.lantern.intensity = (lanternOn ? 14 : 3.5) * smoothstep(0.2, 0.7, night);
    return night;
  }
}
