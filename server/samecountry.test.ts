import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/config';
import { Manifest } from '../src/world/manifest';
import { Patchwork } from '../src/world/patchwork';
import { elevationFor, endlessStamp, growPatch, whyCountriesDiffer } from '../src/world/growworld';
import type { Highland } from '../src/world/highland';
import { mountainAt } from '../src/world/ranges';
import { TileType } from '../src/world/terrain';
import { tilesOf } from '../src/world/tiles';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import type { Wire } from './rooms';
import { Simulation } from './sim';
import { Forgetful } from './vault';
import { manifestIn, worldPath } from './world';

/**
 * One authored world, grown on both sides of the wire, and made to answer the same.
 *
 * `twohalves.test.ts` is the bench this is shaped after and it asks the same question of the same
 * two halves: the page grows the country to draw it, the world grows it to walk heroes and
 * creatures across it, and everything after that assumes the two are the same country. What that
 * bench cannot ask is this one, because it stands both halves up by hand from a seed — and the
 * fault #377 is about is not in either generator. It is in the *calling*: `Simulation.groundOf`
 * built `new Patchwork(seed, growPatch)` and left the fourth argument at its default, so the
 * server grew every world from the seed alone while the page grew it from the seed and the layer
 * list in its manifest.
 *
 * It was inert only because no world had a list. The moment one does, the page draws a range and
 * the server grows the plain underneath it — and the server is the half that decides where a hero
 * may stand, where a creature walks and what the ground under a village is. A hero would walk
 * through a hillside the page had drawn.
 *
 * So this stands both halves up **from one manifest**: the server reads it off the world's file
 * the way a real server would, the page reads it through `elevationFor` the way `growCountry`
 * does, and the tile heights are held against each other.
 *
 * ## The precondition comes first, on purpose
 *
 * The classic way to pass a determinism test is for both sides to have computed nothing. A world
 * with no layers agrees with a world with no layers perfectly, and that is exactly the state this
 * change is meant to end. So before anything is asserted about the two halves agreeing, the same
 * country is grown *without* the list and the ground is shown to have moved — and moved by about
 * what the layer asked for. Only then is it worth anything that both halves moved it alike.
 *
 * ## What it costs
 *
 * Three squares of country, one for each half and one for the flat world underneath them, at
 * something like fourteen seconds apiece on a loaded four-core Pi. Everything is inside the square
 * at the origin so that the patch the simulation grows for a joining player and the patch this
 * reads heights from are the same square rather than two.
 */

/** The world this is all about. Endless, like every world the server grows. */
const SEED = 4242;

/** Where the range was authored, near the middle of the square at the origin. */
const CENTRE = { x: 256, z: 256 };

/** How far it reaches and how high it lifts, in tiles and in terraces. */
const LAYER = { reach: 300, lift: 24 };

/** The world's manifest: one `highland` anchor with a shape on it, which is one elevation layer. */
function authored(): Manifest {
  const manifest = new Manifest(SEED);
  const anchor = manifest.ensure('highland:the-range', 'highland', CENTRE.x, CENTRE.z);
  anchor.layer = { ...LAYER };
  return manifest;
}

/**
 * The page's half: a patchwork of its own, painted chunk by chunk, read a tile at a time.
 *
 * Deliberately the page's own arithmetic rather than a second `GroundWorld` — one of those beside
 * the server's would be the same twenty lines run twice and would prove nothing about the page.
 * This is what `ChunkManager` does: the patch the chunk falls in paints it, `tilesOf` unpacks it,
 * and the rock standing over the ground is the higher of the two. `twohalves.test.ts` reads its
 * page the same way and for the same reason.
 */
function asThePageHasIt(layers: readonly Highland[]): (x: number, z: number) => number | null {
  const patches = new Patchwork(SEED, growPatch, undefined, layers);
  const painted = new Map<string, ReturnType<typeof tilesOf>>();
  const CS = WORLD.CHUNK_SIZE;
  return (x, z) => {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const key = `${cx},${cz}`;
    let tiles = painted.get(key);
    if (!tiles) {
      tiles = tilesOf(patches.forChunk(cx, cz).generateChunk(cx, cz));
      painted.set(key, tiles);
    }
    const i = (Math.floor(z) - cz * CS) * CS + (Math.floor(x) - cx * CS);
    const type = tiles.types[i] as TileType;
    // the three the ground world calls "not ground": a hole, the seabed, and the bed of a river
    if (type === TileType.Skip || type === TileType.Seabed || type === TileType.Water) return null;
    const ranges = patches.at(x, z).ranges;
    const rock = ranges ? mountainAt(ranges, x, z) : null;
    const ground = tiles.heights[i];
    return rock !== null && rock > ground ? rock : ground;
  };
}

/**
 * Where to look for ground, spiralling out from the middle of the range.
 *
 * Scanned rather than chosen, because a wet tile has no height on either side and a height
 * assertion on one would pass while proving nothing — the same trap `elevation.test.ts` names.
 * Coarse steps so that the points are spread over several chunks rather than all inside one.
 */
const SCAN: Array<[number, number]> = [];
for (let ring = 0; ring <= 6; ring++) {
  for (let dx = -ring; dx <= ring; dx++) {
    for (let dz = -ring; dz <= ring; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
      SCAN.push([dx * 17, dz * 17]);
    }
  }
}

class Pretend {
  readonly heard: ServerMessage[] = [];
  readonly wire: Wire;
  private readonly attached;

  constructor(sim: Simulation) {
    const player = this;
    this.wire = {
      send: (parcel) => { if (typeof parcel === 'string') player.heard.push(JSON.parse(parcel) as ServerMessage); },
      get open(): boolean { return true; },
      close: () => {},
    };
    this.attached = sim.attach(this.wire);
  }

  say(message: ClientMessage): void { this.attached.receive(JSON.stringify(message)); }

  of<T extends ServerMessage['type']>(type: T): Array<Extract<ServerMessage, { type: T }>> {
    return this.heard.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

const manifest = authored();
const layers = elevationFor(manifest);

/** A server whose world was saved with a range in it, the way a real one would find it. */
const vault = new Forgetful();
vault.write(worldPath('', SEED), JSON.stringify({
  seed: SEED, clock: { day: 2, time: 0.4 }, deltas: [], manifest: manifest.toJSON(),
}));
const sim = new Simulation({ vault, ground: true, timeout: 10 * 60_000 });

describe('a world the server grows from its own manifest', () => {
  it('has the layer in it at all, and the ground stands where the layer says', () => {
    expect(layers, 'the manifest did not yield a layer, so nothing below is about anything')
      .toEqual([{ x: CENTRE.x, z: CENTRE.z, reach: LAYER.reach, lift: LAYER.lift }]);
  });

  it('grows the same ground as the page grows from the same manifest', () => {
    const page = asThePageHasIt(layers);
    const flat = asThePageHasIt([]);

    /*
     * Dry on both, because a tile that is land in one country and river in the other is a real
     * difference rather than a broken sample — and the height comparison below needs a number on
     * each side of it. The scan takes the first dozen that answer twice.
     */
    const points: Array<{ x: number; z: number; lifted: number; bare: number }> = [];
    for (const [dx, dz] of SCAN) {
      if (points.length >= 12) break;
      const x = CENTRE.x + dx, z = CENTRE.z + dz;
      const lifted = page(x, z), bare = flat(x, z);
      if (lifted === null || bare === null) continue;
      points.push({ x, z, lifted, bare });
    }
    expect(points.length, 'the scan found no dry ground to compare at all').toBeGreaterThanOrEqual(8);

    /*
     * The precondition, before the behaviour. Both halves growing nothing would agree perfectly
     * and say nothing about whether the server read a manifest, so the layer is shown to have
     * moved this ground first: every point of it, and the middle of it by most of the whole lift
     * the anchor asked for. A terrace is `STEP` world units.
     */
    const moved = points.filter((p) => Math.abs(p.lifted - p.bare) > 1e-6);
    expect(moved.length, 'the layer moved no ground, so agreeing about it proves nothing')
      .toBe(points.length);
    const most = Math.max(...points.map((p) => p.lifted - p.bare));
    expect(most, 'the ground rose by nothing like the lift the anchor asked for')
      .toBeGreaterThan(LAYER.lift * WORLD.STEP * 0.5);

    /*
     * And now the question. The server's ground is grown by `groundOf`, which is where the fault
     * was: with the manifest unread it grows the `bare` column above and disagrees with the page
     * at every one of these points by most of a mountain.
     */
    const server = sim.groundOf(SEED);
    expect(server, 'the simulation grew no ground to compare').not.toBeNull();
    const differ: string[] = [];
    for (const p of points) {
      server!.reach(p.x, p.z, 0);
      const theirs = server!.heightAt(p.x, p.z);
      if (theirs === null) {
        differ.push(`${p.x},${p.z}: the page has ground here and the world has none`);
        continue;
      }
      if (Math.abs(theirs - p.lifted) > 1e-6) {
        differ.push(`${p.x},${p.z}: ${p.lifted.toFixed(3)} on the page and ${theirs.toFixed(3)} in the world`
          + ` (the world without the layer would say ${p.bare.toFixed(3)})`);
      }
    }
    expect(differ, `${differ.length} of ${points.length} points disagree`).toEqual([]);
  });

  /**
   * And the other half of the same gap: being *told*.
   *
   * The ground travelling down the wire is what keeps the two halves standing on the same tiles;
   * everything derived from the country — the villages, who lives in them, the doors, the eyries —
   * is worked out on each side from its own copy and is right only while the copies agree. The
   * fingerprint is the one cheap moment that can be proved, and for an endless world it said
   * nothing at all, so a server growing an authored range and a page growing the seed flat would
   * have exchanged two empty strings and agreed.
   */
  it('says what its country is, where it used to say nothing', () => {
    const rowan = new Pretend(sim);
    rowan.say({
      type: 'join', seed: SEED, name: 'Rowan', version: PROTOCOL_VERSION, day: 2, time: 0.4,
      x: CENTRE.x, z: CENTRE.z,
    });
    const [country] = rowan.of('country');
    expect(country, 'the world never told the page its country was grown').toBeTruthy();
    expect(country.stamp, 'an endless country said nothing about itself').not.toBe('');
    expect(country.stamp).toBe(endlessStamp(SEED, layers));

    // a page that read the same manifest hears nothing, which is the whole point of the exchange
    expect(whyCountriesDiffer(endlessStamp(SEED, layers), country.stamp)).toBeNull();

    // and a page that grew the same seed with no layers is told, rather than finding out as a hero
    const flat = endlessStamp(SEED, []);
    expect(flat).not.toBe(country.stamp);
    const said = whyCountriesDiffer(flat, country.stamp);
    expect(said).toContain(country.stamp);
    expect(said).toContain(flat);
  });
});

/**
 * The manifest of a world nobody has opened, which is not a corner of this.
 *
 * `Simulation.groundOf` grows a world's ground for a survey as readily as for a join, and keeps
 * whatever it grew for the rest of the process. A manifest reachable only through an open room
 * would therefore mean a country grown flat by whichever of the two asked first and handed, still
 * flat, to the player who arrived second — the original fault with a longer fuse.
 */
describe('reading a world\'s manifest off its file', () => {
  it('finds the layers a saved world was authored with', () => {
    const kept = new Forgetful();
    kept.write(worldPath('', SEED), JSON.stringify({
      seed: SEED, clock: { day: 1, time: 0 }, deltas: [], manifest: authored().toJSON(),
    }));
    expect(elevationFor(manifestIn(kept, worldPath('', SEED), SEED))).toEqual(layers);
  });

  it('is an empty manifest for a world that has none, and for one nobody can read', () => {
    const empty = new Forgetful();
    expect(manifestIn(empty, worldPath('', SEED), SEED).anchors.size).toBe(0);
    empty.write(worldPath('', SEED), '{ this is not json');
    expect(manifestIn(empty, worldPath('', SEED), SEED).anchors.size).toBe(0);
    // and a file that is some other world's is not this world's manifest either
    empty.write(worldPath('', SEED), JSON.stringify({
      seed: SEED + 1, clock: { day: 1, time: 0 }, deltas: [], manifest: authored().toJSON(),
    }));
    expect(manifestIn(empty, worldPath('', SEED), SEED).anchors.size).toBe(0);
  });
});
