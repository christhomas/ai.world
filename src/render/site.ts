import * as THREE from 'three';
import { Biome, PropKind } from '../world/biomes';
import { addPropInstances, disposeInstances } from './instancing';
import type { PropLibrary } from './props';
import { WORLD } from '../core/config';

/**
 * How far a building site can be from the hero before it stops being drawn.
 *
 * Wider than the crops use, because a house is a landmark and a crop is not: the whole point of
 * having one built is seeing it from the road on the way back, and a house that only came into
 * existence once you were standing on it would be a nasty surprise rather than a homecoming.
 */
const DRAW_RANGE = 140;

/**
 * A plot with something on it, in the terms drawing needs and no others.
 *
 * The crop field next door reads its plantings straight out of `Plots` and works out their
 * ripeness itself, and this would happily do the same with commissions — but the architecture
 * test only has room for so many places where drawing reaches up into the rules, and it says so
 * in as many words. So the caller does the one subtraction that decides which stage a house is at
 * and hands the answer down. The union below is the same one `building.ts` calls `Stage`, and the
 * compiler will say so at the call site the day the two stop agreeing.
 */
export interface Site {
  id: string;
  x: number;
  z: number;
  /** Which way the front of it looks, in radians. */
  rot?: number;
  stage: 'marked' | 'begun' | 'nearly' | 'done';
  /** What is being built. Absent means a house, which is what every plot was before there was a list. */
  what?: string;
  /** How many floors a finished house is standing at: two once a storey has been added to it. */
  storeys?: number;
}

/**
 * Which prop stands on the plot at each stage of each kind of work.
 *
 * Every kind has its own three unfinished states, told in the order the work would actually be
 * done in — a pool is marked out, then a hole, then a dry stone tank; a fountain is a circle in the
 * turf, then a basin, then a column with nothing running. They used to share the house's pegs and
 * string for all three, which meant that for every kind but one the whole wait looked the same and
 * riding past a second time told you nothing.
 *
 * A storey is still the awkward one and is worth reading the entry twice. It is not a thing
 * standing beside a house, it *is* the house — both commissions are drawn, on the same tile — so
 * what goes here is seen around a cottage that is already finished. A frame would be a timber
 * skeleton inside a room a player can walk into. Scaffolding is not: it goes round the outside of
 * a building that is already there, which is exactly what is true, and it comes down on the last
 * morning leaving the house a floor taller. The finished row is empty for the same reason it
 * always was — there is nothing left standing beside the house to draw.
 */
const LOOKS: Record<string, Partial<Record<Site['stage'], PropKind>>> = {
  house: {
    marked: PropKind.HousePegs,
    begun: PropKind.HouseFrame,
    nearly: PropKind.HouseRoof,
    done: PropKind.HouseYours,
  },
  pool: {
    marked: PropKind.PoolMarked,
    begun: PropKind.PoolDug,
    nearly: PropKind.PoolLined,
    done: PropKind.Pool,
  },
  fountain: {
    marked: PropKind.FountainMarked,
    begun: PropKind.FountainBasin,
    nearly: PropKind.FountainDry,
    done: PropKind.Fountain,
  },
  storey: {
    marked: PropKind.StoreyTimber,
    begun: PropKind.StoreyScaffold,
    nearly: PropKind.StoreyRaised,
  },
  /*
   * And a boat, which is the other awkward one and is awkward the opposite way round.
   *
   * A storey has no site of its own because the thing it alters is already standing there. A boat
   * has a site and then stops having one: she is built on stocks above the tide line and, the
   * morning she is paid for, slid into the water and tied to the jetty. So all four rows here are
   * of a hull out of the water, `done` included — that row is the boat finished and waiting for
   * the tide, which is a real morning and the only part of this wait anybody would call waiting.
   *
   * What happens after it is not this table's business and cannot be: a floating boat is a `THREE`
   * object that follows the player about, not a prop on a tile. The commission carries the day she
   * was launched and `frame.ts` stops handing her site down once it is set, which is why there is
   * no fifth row for "gone".
   */
  boat: {
    marked: PropKind.BoatKeel,
    begun: PropKind.BoatFrames,
    nearly: PropKind.BoatPlanked,
    done: PropKind.BoatReady,
  },
  /*
   * A jetty, whose last row stays — which makes it the ordinary case the boat was the exception to.
   *
   * It is the other kind of awkward: not a thing with no site of its own, and not a thing that
   * leaves, but a thing whose site is the tile at the landward end while everything about it is out
   * over water. That costs this table nothing at all — a prop is drawn at its tile's height with
   * parts wherever its parts are — and it is what lets the whole of item 23 be four rows here.
   */
  jetty: {
    marked: PropKind.JettyPiles,
    begun: PropKind.JettyDriven,
    nearly: PropKind.JettyBearers,
    done: PropKind.JettyDone,
  },
};

/*
 * And the houses a village raised for itself, which are the one kind of work here nobody paid a
 * deposit for.
 *
 * Six rows rather than one, because a village builds in its own country's cottage — the same prop
 * the terrain draws the other ten houses with, picked the way everything else picks it, by adding
 * the biome to the plains kind. One `done` row each and no unfinished ones: the register keeps the
 * day a roof was *paid for* and not the morning it was begun, so there is no honest way to show a
 * frame going up. `game/villageroofs.ts` says what that costs and what would fix it.
 *
 * Deliberately not `HouseYours`: the one house in the world with a chimney on it is the player's,
 * and it is meant to be findable from the ridge without opening the map.
 */
for (let biome = Biome.Plains; biome <= Biome.Snow; biome++) {
  LOOKS[`raised-${biome}`] = { done: (PropKind.HousePlains + biome) as PropKind };
}

/** What to draw on one plot today, or nothing. */
export function propOf(site: Site): PropKind | null {
  const looks = LOOKS[site.what ?? 'house'] ?? LOOKS.house;
  const kind = looks[site.stage];
  if (kind === undefined) return null;
  // the one case where a finished building is drawn as something else: a house that has had a
  // storey put on it is the same commission, on the same plot, a floor taller
  if (kind === PropKind.HouseYours && (site.storeys ?? 1) > 1) return PropKind.HouseYoursTwo;
  return kind;
}

/**
 * Draws the houses somebody has had built, at whatever stage of building they have reached.
 *
 * Written on the same pattern as the crop field, and for the same reason: a commission changes
 * about once a day, so the meshes are rebuilt only when the set of visible plots or the stage any
 * of them is at actually changes. Between those moments this costs one string compare a frame.
 *
 * It draws from the commissions rather than from the world's structure list because these houses
 * are not in the world's structure list — they were not there when the terrain was generated, and
 * putting them there would mean laying a village out again every time somebody paid a deposit.
 */
export class BuildingSite {
  private readonly group = new THREE.Group();
  private signature = '';

  constructor(scene: THREE.Object3D, private readonly props: PropLibrary, private readonly glowMaterial: THREE.Material) {
    scene.add(this.group);
  }

  /** @param heightAt ground height, so a house sits on its plot rather than hanging over it */
  update(sites: readonly Site[], heroX: number, heroZ: number, heightAt: (x: number, z: number) => number | null): void {
    const near = sites
      .filter((s) => Math.hypot(s.x - heroX, s.z - heroZ) < DRAW_RANGE)
      .map((s) => ({ site: s, kind: propOf(s) }))
      .filter((s): s is { site: Site; kind: PropKind } => s.kind !== null);
    const signature = near.map((s) => `${s.site.id},${s.kind}`).sort().join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    this.group.clear();
    disposeInstances(this.group);
    addPropInstances(
      this.group, this.props,
      near.map(({ site, kind }) => ({
        kind,
        x: site.x,
        y: heightAt(site.x, site.z) ?? WORLD.STEP,
        z: site.z,
        rot: site.rot ?? 0,
      })),
      this.glowMaterial,
    );
  }

  dispose(): void {
    disposeInstances(this.group);
  }
}
