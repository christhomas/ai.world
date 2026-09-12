import { hash3, mulberry32 } from '../core/rng';
import { facing } from './civic';
import { StructureKind } from './kinds';
import type { Structure } from './structures';
import type { Biome } from './biomes';

/**
 * Where a village's *next* houses would stand.
 *
 * A village grows — it fills its houses, raises another, and grows into that — and until this
 * existed it did so entirely in its books: a place went from thirty-one souls to ninety-three with
 * the same ten roofs standing, because the houses that are *drawn* come from the founding's list
 * and nothing ever added to one.
 *
 * Three things about how it is done, each of which the first attempt got wrong:
 *
 * **Last, after everything else is placed.** Continuing the founding's own loop past its house
 * count seemed obvious and moved every village in every world, because placing a house *registers*
 * a footprint: the surplus plots pushed the shops, the chapel and the paddock aside. The golden
 * fingerprint caught it within a minute. Spare plots are found when everything that is actually
 * built is already standing, so they take what is left rather than competing for it.
 *
 * **On a stream of its own**, derived from where the village stands. Drawing from the village's own
 * rng would shift every roll after it, which is the same fault in a quieter coat.
 *
 * **Checked but not registered.** A plot is only a plot: nothing stands on it until a village pays
 * for a roof, so it must not block a door or a paddock in the meantime. It is held to the same
 * ground and footprint rules the founding uses, handed in by the caller — a raised roof cannot
 * stand anywhere the founding would have refused.
 */

/** The salt for the stream, so looking for an eleventh plot cannot shift a roll of the founding. */
const SPARE_PLOTS = 0x5ea7;

/** How many places are tried. The founding's own budget, for the same reason it has one. */
const TRIES = 80;

/** How far apart two spare plots must be, in tiles, so a village does not grow a terrace. */
const APART = 3;

/** Everything about a village that decides where another house could go. */
export interface Laying {
  seed: number;
  /** How far along the road the village spreads. */
  spread: number;
  roadWidth: number;
  biome: Biome;
  at: { x: number; z: number };
  /** The road's own direction, and the normal to it: houses sit off to one side or the other. */
  along: { ux: number; uz: number };
  across: { nx: number; nz: number };
  /** At most this many, which is the number the founding was willing to lay out. */
  most: number;
}

/**
 * What the founding already knows about a tile, handed in rather than worked out again here.
 *
 * `land` is the sampler's own probe — is this ground, and where is the road from it — and `fits` is
 * the founding's footprint rule, which knows about the square, the paths and everything already
 * standing. This file decides *where to look* and nothing else, so a spare plot is held to exactly
 * the rules a founded house was.
 */
export interface TheGround {
  land: (x: number, z: number) => { land: boolean; baseLevel: number; cx: number; cz: number } | null;
  fits: (tx: number, tz: number, hw: number, hd: number, level: number | null) => number | null;
}

export function sparePlots(laying: Laying, ground: TheGround): Structure[] {
  const { at, along, across, spread, roadWidth, biome } = laying;
  const plots = mulberry32(hash3(laying.seed, Math.round(at.x), Math.round(at.z), SPARE_PLOTS));
  const spare: Structure[] = [];
  for (let attempt = 0; attempt < TRIES && spare.length < laying.most; attempt++) {
    const side = plots() < 0.5 ? -1 : 1;
    const walk = (plots() - 0.5) * 2 * spread;
    const out = roadWidth + 3 + plots() * 4;
    const tx = Math.floor(at.x + along.ux * walk + across.nx * out * side);
    const tz = Math.floor(at.z + along.uz * walk + across.nz * out * side);
    const here = ground.land(tx + 0.5, tz + 0.5);
    if (!here || !here.land) continue;
    const level = ground.fits(tx, tz, 1, 1, here.baseLevel);
    if (level === null) continue;
    if (spare.some((p) => Math.abs(p.tx - tx) <= APART && Math.abs(p.tz - tz) <= APART)) continue;
    // the door faces the road, exactly as a founded house's does
    const { rot } = facing(Math.atan2(here.cz - (tz + 0.5), here.cx - (tx + 0.5)));
    spare.push({ kind: StructureKind.House, tx, tz, hw: 1, hd: 1, level, rot, biome, path: [] });
  }
  return spare;
}
