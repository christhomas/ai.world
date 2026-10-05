import * as THREE from 'three';
import { fogReach } from './scene-math';
import type { SceneGraph } from '../core/scenegraph';
import type { SceneLighting } from './scene-state';
import { smoothstep } from '../game/state';
import type { SeasonTint } from '../game/seasons';

/**
 * How fast a carried fire wavers, in cycles per day.
 *
 * Driven off the clock rather than off frames so it looks the same whatever the machine manages,
 * and fast enough to read as fire: a day is a few minutes, so this is a few times a second.
 */
const TORCH_FLICKER = 5200;

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

type Linear = [number, number, number];

/**
 * A computed light colour exactly as it was worked out, for the graph to hand to the renderer —
 * written into channels the cycle keeps for that light, since it is worked out every frame.
 */
const linearOf = (colour: THREE.Color, into: Linear): Linear => {
  into[0] = colour.r; into[1] = colour.g; into[2] = colour.b;
  return into;
};

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
  /**
   * Where the light the hero is carrying is, when they are carrying one.
   *
   * The night light used to be pinned a metre and a half over the hero's feet, which is his head —
   * so at night he walked about lit from inside his own skull, with his shadow thrown out in every
   * direction from a point nobody could see. It now comes from the torch in his hand. Null falls
   * back to the old place, which is what happens where there is no hero to hold anything.
   */
  flame?: { x: number; y: number; z: number } | null;
}

/**
 * Drives sun, sky and window glow from the time of day. Pure colour/intensity lerps,
 * so the low-poly look survives the night instead of turning to mud.
 */
/**
 * When the shadows are worth drawing again.
 *
 * `STILL` is how far the sun may move and be called still, in world units. It sits at a fifth of a
 * tile because the sun is sixty units out and the shadow map is a couple of thousand pixels across
 * a hundred-odd tiles, so a fifth of a tile of light movement is comfortably under one pixel of
 * shadow movement — small enough that nobody could see the difference and large enough to catch the
 * sun's own crawl, which is a fortieth of a degree a frame.
 *
 * `FLOOR` is how long the shadows may stand while nothing at all moves, in milliseconds. A tenth of
 * a second: long enough to save five frames in six, short enough that a chunk arriving or a felled
 * tree is shadowed before anybody notices it was not.
 */
export const SHADOW = { STILL: 0.2, FLOOR: 100 } as const;

/**
 * The decision itself, kept apart from the light so it can be held to in a test.
 *
 * @param moved how far the sun has gone since the shadows were last drawn, in world units
 * @param since how long ago that was, in milliseconds
 */
export function shadowsWorthDrawing(moved: number, since: number): boolean {
  return moved >= SHADOW.STILL || since >= SHADOW.FLOOR;
}

export interface DaylightRig {
  graph: SceneGraph;
  lighting: SceneLighting;
  fitShadow(): void;
  redrawShadows(): void;
}

export class Daylight {
  /** Unclamped linear window color, shared with the host's material adapter. */
  private readonly windowLight = new THREE.Color(WINDOW_DAY);
  readonly glowLinear: [number, number, number] = [WINDOW_DAY.r, WINDOW_DAY.g, WINDOW_DAY.b];
  private readonly tmp = new THREE.Color();
  private readonly tmp2 = new THREE.Color();
  private readonly lightPoint = new THREE.Vector3();
  private readonly linear = { sun: [0, 0, 0] as Linear, sky: [0, 0, 0] as Linear,
    ground: [0, 0, 0] as Linear, ambient: [0, 0, 0] as Linear };
  private daySunIntensity: number;
  private dayHemiIntensity: number;
  private dayAmbientIntensity: number;
  /** Where the sun was when the shadows were last drawn, and when that was. */
  private readonly lastLight = new THREE.Vector3(NaN, NaN, NaN);
  private drawnAt = 0;
  private disposed = false;
  private night = 0;

  constructor(private readonly rig: DaylightRig, private readonly now: () => number) {
    this.daySunIntensity = rig.lighting.sun.intensity;
    this.dayHemiIntensity = rig.lighting.hemi.intensity;
    this.dayAmbientIntensity = rig.lighting.ambient.intensity;
  }

  /** Call when the options sliders change so the cycle scales the new daytime values. */
  setDayIntensities(sun: number, hemi: number): void {
    if (this.disposed) return;
    this.daySunIntensity = sun;
    this.dayHemiIntensity = hemi;
  }

  /**
   * Ask for the shadow pass, but only when it would draw something different.
   *
   * The pass is a second traversal of the scene and a second set of draw calls — the most expensive
   * thing this renderer does after the picture itself — and three.js runs it every frame by
   * default. Almost always for nothing: the sun crosses the sky once every two hours of real time,
   * about a fortieth of a degree a frame, and a hero standing still in a village is looking at
   * country that did not move either.
   *
   * So it is drawn when the light has actually gone somewhere — which includes the camera moving,
   * because the sun is hung over whatever the camera is looking at — and otherwise at a slow floor,
   * so that a chunk arriving, a door opening or a tree coming down is never more than a tenth of a
   * second from being shadowed. Nothing in the game has to remember to ask.
   */
  private shadowsIfTheyHaveChanged(sun: THREE.Vector3): void {
    const now = this.now();
    // NaN on the first frame, which is a distance no comparison calls small: the shadows are drawn
    // once before anything has been remembered, which is what a first frame wants
    const moved = this.lastLight.distanceTo(sun);
    if (!shadowsWorthDrawing(Number.isNaN(moved) ? Infinity : moved, now - this.drawnAt)) return;
    this.lastLight.copy(sun);
    this.drawnAt = now;
    this.rig.redrawShadows();
  }

  /** Returns the night factor in [0,1]. */
  apply({ time, focusX, focusZ, heroX, heroY, heroZ, lanternOn, flame, season, wet }: DayCycleInput): number {
    if (this.disposed) return this.night;
    const ang = (time - 0.25) * Math.PI * 2;
    const sunH = Math.sin(ang);
    const day = smoothstep(-0.12, 0.25, sunH);
    const night = 1 - day;
    const dusk = (1 - Math.min(1, Math.abs(sunH) / 0.35)) * day;

    const { graph, lighting } = this.rig;
    // sun orbits east → west; at night it stays low as faint moonlight
    const r = 60;
    lighting.sun.position = [
      focusX + Math.cos(ang) * r,
      18 + Math.max(0.1, sunH) * 62,
      focusZ + 26,
    ];
    // the rig cut its shadow slab for wherever the sun was when the camera last moved, which was
    // before this; a low sun needs a far deeper slab than a high one, so it is cut again here
    this.rig.fitShadow();
    this.shadowsIfTheyHaveChanged(this.lightPoint.set(...lighting.sun.position));
    // the night floor is moonlight: dark enough to want a lantern, bright enough to walk by
    lighting.sun.intensity = this.daySunIntensity * (0.22 + 0.78 * day) * (1 - wet * 0.45);
    this.tmp.copy(DAY_SUN).lerp(DUSK_SUN, dusk).lerp(NIGHT_SUN, night);
    this.tmp.multiply(this.tmp2.setRGB(season.sky[0], season.sky[1], season.sky[2]));
    // as linear channels, not a hex: autumn's red of 1.04 takes a white sun past one, and a hex
    // would clamp the warmth out of every lit pixel before the intensity was applied
    lighting.sun.colour = linearOf(this.tmp, this.linear.sun);

    lighting.hemi.intensity = this.dayHemiIntensity * (0.55 + 0.45 * day) * (1 - wet * 0.2);
    lighting.hemi.sky = linearOf(this.tmp.copy(DAY_HEMI_SKY).lerp(NIGHT_HEMI_SKY, night), this.linear.sky);
    lighting.hemi.ground = linearOf(this.tmp.copy(DAY_HEMI_GROUND).lerp(NIGHT_HEMI_GROUND, night), this.linear.ground);
    lighting.ambient.intensity = this.dayAmbientIntensity * (0.62 + 0.38 * day);
    lighting.ambient.colour = linearOf(this.tmp.copy(DAY_AMBIENT).lerp(NIGHT_AMBIENT, night), this.linear.ambient);

    this.tmp.copy(DAY_SKY).lerp(DUSK_SKY, dusk).lerp(NIGHT_SKY, night);
    this.tmp.multiply(this.tmp2.setRGB(season.sky[0], season.sky[1], season.sky[2]));
    if (wet > 0) this.tmp.lerp(this.tmp2.setHex(0x6a7480), wet * 0.55 * day);
    graph.background = this.tmp.getHex();
    // and the far country goes to the same colour it is standing in front of. One reading rather
    // than two: a fog lerped on its own curve would seam against the sky at every hour where the
    // two disagreed, and dusk is exactly where they would
    graph.fog = { ...(graph.fog ?? fogReach()), colour: graph.background };

    // windows warm up as the light fades
    this.windowLight.copy(this.tmp2.copy(WINDOW_DAY).lerp(WINDOW_NIGHT, smoothstep(0.3, 0.8, night)));
    const glowColour = this.windowLight.getHex();
    linearOf(this.windowLight, this.glowLinear);
    for (const node of graph.nodes) {
      if (node.kind === 'prop-batch' && node.glowParts?.length) node.glowColour = glowColour;
    }

    // the light comes from what the hero is holding, and from his head only where there is nothing
    // in his hand to hold it — which after dark there always is
    lighting.lantern.position = flame
      ? [flame.x, flame.y, flame.z] : [heroX, heroY + 1.4, heroZ];
    // a torch is worth less than a lantern and more than nothing, and the fire wavers
    const carried = lanternOn ? 14 : flame ? 9 : 3.5;
    const waver = flame ? 1 + Math.sin(time * TORCH_FLICKER) * 0.06 : 1;
    lighting.lantern.intensity = carried * waver * smoothstep(0.2, 0.7, night);
    this.night = night;
    return night;
  }

  dispose(): void { this.disposed = true; }
}
