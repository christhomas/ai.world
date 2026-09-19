import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/config';
import { Manifest, joinedManifest, type Anchor, type ManifestJson } from '../src/world/manifest';
import { Patchwork } from '../src/world/patchwork';
import { elevationFor, endlessStamp, growPatch, whyCountriesDiffer } from '../src/world/growworld';
import type { Highland } from '../src/world/highland';
import { mountainAt } from '../src/world/ranges';
import { TileType } from '../src/world/terrain';
import { tilesOf } from '../src/world/tiles';
import { Rooms } from './rooms';
import { Forgetful } from './vault';
import { worldPath } from './world';

/**
 * The layer list a world was authored with, travelling to the page that joined it.
 *
 * `samecountry.test.ts` stands both halves up from one manifest and they agree about every tile —
 * but only because the bench hands the same list to both. Nothing carried it. A page joining a
 * named world grew its country from whatever its own IndexedDB happened to hold under
 * `ai.world/named/<server>/<name>`, and a browser that had never opened the world held nothing, so
 * it grew the seed flat while the server grew the range. The two halves were *told* they differed —
 * that is what #377 delivered — and had no way to agree.
 *
 * So this follows one list across the seam it never crossed: out of the world's own file, through
 * the answer a named invite gets, into the manifest the page grows from, and into the ground.
 *
 * ## The preconditions come first, and there are two of them
 *
 * The classic way to pass a test like this is for both sides to have computed nothing: a world with
 * no layers agrees with a world with no layers perfectly, and a wire that carried an empty list
 * would look exactly like a wire that worked. So before a word is asserted about the two halves
 * agreeing, the list is shown to be a list at all, and the ground under the page is shown to
 * actually move when it arrives — by most of the lift the anchor asked for, at every point sampled.
 *
 * ## What it costs
 *
 * Two squares of country, at something like fourteen seconds apiece on a loaded four-core Pi: the
 * page as it joins, and the page as it was before this change — no list on the wire and nothing
 * saved, which is the flat world the fault produced. The server's own ground is not grown again
 * here; `samecountry.test.ts` already holds it against the page's given one list, and what is in
 * question here is whether it is one list.
 */

/** The world this is all about, and the name somebody gave it. */
const SEED = 4242;
const NAME = 'Ashford';

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

/** A server holding one named world, saved with a range in it, the way a real one would find it. */
function serverHolding(manifest: Manifest): Rooms {
  const vault = new Forgetful();
  vault.write(worldPath('', SEED), JSON.stringify({
    seed: SEED, clock: { day: 2, time: 0.4 }, deltas: [], manifest: manifest.toJSON(),
  }));
  vault.write('world-records.json', JSON.stringify([{ name: NAME, seed: SEED }]));
  return new Rooms('', vault);
}

/**
 * What the page actually receives, which is JSON and not an object.
 *
 * The invite crosses an HTTP request and comes back through `JSON.parse`, so it is round-tripped
 * here rather than handed over: a field that cannot survive that is a field the page never sees,
 * and this is the one bench positioned to notice.
 */
function asThePageReceivesIt<T>(sent: T): T {
  return JSON.parse(JSON.stringify(sent)) as T;
}

/**
 * The page's half: a patchwork of its own, painted chunk by chunk, read a tile at a time.
 *
 * The same reading `samecountry.test.ts` takes, and for the same reason — this is what
 * `ChunkManager` does, so it is the page's own arithmetic rather than a second ground world that
 * would prove nothing about the page.
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
 * assertion on one would pass while proving nothing — the trap `elevation.test.ts` names.
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

/** How the page reads a manifest it has assembled, which is the one reading there is. */
function grownFrom(assembled: ManifestJson): readonly Highland[] {
  return elevationFor(new Manifest(SEED, assembled));
}

const world = authored();
const rooms = serverHolding(world);
const invite = asThePageReceivesIt(rooms.invite(NAME));

describe('what a named invite answers with', () => {
  it('carries the world\'s own layer list, and says which country it grows', () => {
    expect(elevationFor(world), 'the world\'s manifest yielded no layer, so nothing below is about anything')
      .toEqual([{ x: CENTRE.x, z: CENTRE.z, reach: LAYER.reach, lift: LAYER.lift }]);

    expect(invite, 'the server did not answer about a world it is holding').toBeTruthy();
    expect(invite!.name).toBe(NAME);
    expect(invite!.seed).toBe(SEED);
    // the sibling half of the same wire change: the page chose `endless` for itself and hoped
    expect(invite!.kind, 'the invite does not say which country the server grows').toBe('endless');
    expect(invite!.layers, 'the invite does not carry the list the world was authored with')
      .toEqual(world.layers());
  });

  it('answers about a world nobody has opened, which is every world before its first join', () => {
    // the room is only opened by a join, and the invite is what a page reads *before* one
    expect(rooms.worldCount, 'a room was opened, so this is not the cold path at all').toBe(0);
    expect(invite!.layers, 'a world nobody has opened answered with no list').toHaveLength(1);
  });
});

describe('a page joining that world with nothing of its own', () => {
  it('grows the range, where before it grew the seed flat', () => {
    const joined = grownFrom(joinedManifest(SEED, undefined, invite!.layers));
    expect(joined, 'the list did not survive the wire into the page\'s manifest')
      .toEqual(elevationFor(world));

    /*
     * The other half of the page: what it grew before this change. No list on the wire and no save
     * to read one from is exactly `boot.ts` as it stood, and it is the flat world the fault
     * produced.
     */
    const alone = grownFrom(joinedManifest(SEED, undefined, undefined));
    expect(alone, 'the page without a list already had one, so the fault is not being reproduced')
      .toEqual([]);

    const page = asThePageHasIt(joined);
    const flat = asThePageHasIt(alone);

    /*
     * Dry on both, because a tile that is land in one country and river in the other is a real
     * difference rather than a broken sample, and the height comparison needs a number each side.
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
     * The precondition, before the behaviour: the list that arrived actually moves this ground.
     * A wire that carried an empty list would look exactly like a wire that worked, and every
     * agreement below it would be two halves agreeing about nothing.
     */
    const moved = points.filter((p) => Math.abs(p.lifted - p.bare) > 1e-6);
    expect(moved.length, 'the list that arrived moved no ground, so carrying it proves nothing')
      .toBe(points.length);
    const most = Math.max(...points.map((p) => p.lifted - p.bare));
    expect(most, 'the ground rose by nothing like the lift the anchor asked for')
      .toBeGreaterThan(LAYER.lift * WORLD.STEP * 0.5);
  });

  it('then holds the same fingerprint as the world it joined', () => {
    // what the server sends at the join: `readyFor`, reading the same manifest this invite came from
    const theirs = endlessStamp(SEED, elevationFor(rooms.manifestOf(SEED)));
    const mine = endlessStamp(SEED, grownFrom(joinedManifest(SEED, undefined, invite!.layers)));
    expect(whyCountriesDiffer(mine, theirs), 'the page that was handed the list is still told it differs')
      .toBeNull();
  });
});

/**
 * And the stamp can still say no, which is the thing that must not quietly stop being true.
 *
 * A fingerprint that cannot disagree is worse than none, because it reports agreement. Making the
 * two halves agree is the point of this change and it is also the way to make the exchange
 * decorative, so the disagreements that remain are asserted rather than assumed.
 */
describe('the fingerprint still disagrees when the lists genuinely differ', () => {
  it('tells a page joining an older server that grew a range it was never sent', () => {
    // a server built before this field sends the record and nothing else, so the page is on its own
    const old = grownFrom(joinedManifest(SEED, undefined, undefined));
    const theirs = endlessStamp(SEED, elevationFor(rooms.manifestOf(SEED)));
    const said = whyCountriesDiffer(endlessStamp(SEED, old), theirs);
    expect(said, 'a page growing the seed flat against a world with a range was told nothing')
      .toContain(theirs);
  });

  it('tells a page whose own list has a range the world does not', () => {
    const invented: Anchor[] = [{
      id: 'highland:not-in-this-world', kind: 'highland', x: 900, z: -400,
      seed: 7, parent: null, version: 1, layer: { reach: 200, lift: 9 },
    }];
    const mine = endlessStamp(SEED, grownFrom({ rootSeed: SEED, anchors: invented }));
    const theirs = endlessStamp(SEED, elevationFor(rooms.manifestOf(SEED)));
    expect(mine, 'two genuinely different lists hashed alike').not.toBe(theirs);
    expect(whyCountriesDiffer(mine, theirs)).toContain(mine);
  });
});

/**
 * What happens to what the page already had, which is the decision this change turns on.
 *
 * The world's list wins, wholesale, and only the list. A shared world's country is the server's
 * fact — it decides where a hero may stand, where a creature walks and what the ground under a
 * village is — and nothing a page holds was ever built on the page's copy of it. What the page
 * *did* author for itself, an eyrie it baited or a place it pinned, is its own and is left alone.
 */
describe('a page whose stored manifest disagrees with the world\'s', () => {
  const stale: Anchor[] = [
    // a layer this world does not have: a save from before the range was moved, or another world's
    { id: 'highland:stale', kind: 'highland', x: -700, z: 120, seed: 3, parent: null, version: 1, layer: { reach: 150, lift: 30 } },
    // a place somebody pinned rather than a shape, which is the page's own and not a layer at all
    { id: 'highland:the-crag', kind: 'highland', x: 40, z: 40, seed: 5, parent: null, version: 1 },
    // and the one anchor in this game no seed can be asked about — see `manifest.ts` on `eyrie`
    { id: 'eyrie:carcass', kind: 'eyrie', x: 90, z: 12, seed: 11, parent: null, version: 1 },
  ];
  const saved: ManifestJson = { rootSeed: SEED, anchors: stale };

  it('takes the world\'s list and drops its own', () => {
    expect(grownFrom(saved), 'the stale save had no layer in it, so there is nothing to disagree about')
      .toEqual([{ x: -700, z: 120, reach: 150, lift: 30 }]);
    const after = joinedManifest(SEED, saved, invite!.layers);
    expect(grownFrom(after), 'the page kept growing a range the world it joined does not have')
      .toEqual(elevationFor(world));
  });

  it('leaves everything of its own that is not the list alone', () => {
    const after = joinedManifest(SEED, saved, invite!.layers);
    const ids = after.anchors.map((a) => a.id);
    expect(ids, 'an eyrie somebody baited was thrown away by a join').toContain('eyrie:carcass');
    expect(ids, 'a place the page had pinned was thrown away by a join').toContain('highland:the-crag');
    expect(ids, 'the world\'s own range did not arrive').toContain('highland:the-range');
    expect(ids, 'a layer the world does not have survived the join').not.toContain('highland:stale');
  });

  it('keeps its own list when the world says nothing, and clears it when the world says none', () => {
    // an older server sends no list at all, and silence is not an instruction to forget
    expect(grownFrom(joinedManifest(SEED, saved, undefined)).length)
      .toBe(1);
    // a world that says it has none is saying something, and a page holding one is holding it wrongly
    expect(grownFrom(joinedManifest(SEED, saved, []))).toEqual([]);
  });
});

/**
 * And that `boot.ts` is actually wired to any of this, which is read rather than run.
 *
 * `boot.ts` calls `boot()` at the top level, so importing it into a suite starts a game in a
 * process with no document in it. That is why there has never been a test of that file, and it is
 * also where the whole of this change either arrives or does not: everything above proves the list
 * survives the journey, and this proves the page takes the journey. The same answer
 * `twohalves.test.ts` gives to the same problem in `sim.ts` — assert on the line.
 */
describe('the page assembles a named world from what it was told', () => {
  it('grows a named join from the invite rather than from its own storage', () => {
    const boot = readFileSync('src/boot.ts', 'utf8');
    expect(boot, 'a named join no longer builds its manifest from what it was handed')
      .toContain('joinedManifest(seed, saved?.manifest, named.layers)');
    expect(boot, 'the page is choosing a country again instead of being told one')
      .toContain('world = kindOf(named.kind)');
    // and the save key is still scoped by server and name, which is what stops a list arriving for
    // one world overwriting the one saved for another of the same name — see #385's notes
    expect(boot).toContain('`ai.world/named/${serverOf(url)}/${named.name.toLocaleLowerCase(\'en-US\')}`');
  });
});
