import type { Json } from '../../shared/mobile/host-contract';
import { WORLD } from '../core/config';
import type { GameState } from '../game/state';
import type { HeadlessGame } from '../platform/headless-game';
import { PROVINCE, provinceCorner } from '../world/provinces';
import { plainArrays } from './scene-packet';

const json = (value: unknown): Json => JSON.parse(JSON.stringify(value, plainArrays)) as Json;

/**
 * What an installed app's map is sent, and what it has been sent already (#575).
 *
 * Two models. `floor` is the floor the hero is on, sent when what has been seen of it changes and
 * null once he is back above ground. `map` is the country: what has newly been walked or charted,
 * every time, and the markers and title when they change, at most once a second, because a
 * ferry's marker moves every step. Walked and charted only ever grow, so the same size is nothing
 * new. A game opened is a new one of these, so nothing of another world is ever sent on.
 *
 * Both are read from what the page's map reads: the floor from `dungeon/floor-picture.ts`, the
 * markers and title from the readouts' `mapInput`, and the dark from `GameState.explored` and
 * `charted`, which the page's fog turns into squares with `knownSquares` (`world/map-ground.ts`).
 */
export class MapModels {
  private readonly chunks = new Set<string>();
  private readonly provinces = new Set<string>();
  private lastMap = '';
  private lastMapAt = -Infinity;
  private lastFloor: string | null = null;

  /** The models this reply carries: `map` and `floor` where either has news, and neither otherwise. */
  take(host: Pick<HeadlessGame, 'mapReading' | 'floor'>, state: Pick<GameState, 'explored' | 'charted'>,
    renderTimeMs: number): { map?: Json; floor?: Json | null } {
    const models: { map?: Json; floor?: Json | null } = {};
    const floor = host.floor();
    if ((floor?.changed ?? null) !== this.lastFloor) {
      this.lastFloor = floor?.changed ?? null;
      models.floor = floor ? json(floor.picture()) : null;
    }
    const walked = state.explored.size === this.chunks.size ? [] : [...state.explored].filter((key) => !this.chunks.has(key));
    const charted = state.charted.size === this.provinces.size ? [] : [...state.charted].filter((id) => !this.provinces.has(id));
    const reading = JSON.stringify(host.mapReading());
    if (walked.length > 0 || charted.length > 0 || (reading !== this.lastMap && renderTimeMs - this.lastMapAt >= 1000)) {
      for (const key of walked) this.chunks.add(key);
      for (const id of charted) this.provinces.add(id);
      this.lastMap = reading;
      this.lastMapAt = renderTimeMs;
      // a chunk by its key and a province by its corner, with the size of each, so the app can
      // take the dark off them without knowing how either is named
      models.map = json({ ...JSON.parse(reading) as object, chunk: WORLD.CHUNK_SIZE, province: PROVINCE, walked,
        charted: charted.map((id) => { const at = provinceCorner(id); return `${at.x},${at.z}`; }) });
    }
    return models;
  }
}
