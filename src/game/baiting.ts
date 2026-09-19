import { hash3, mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { CAMP } from './camp';
import { EYRIE, cragName, type Eyrie } from './eyries';
import type { Anchor, Manifest } from '../world/manifest';
import type { Massif } from '../world/mountains';
import type { Within } from '../world/window';

/**
 * Baiting an eyrie: fixing a world by playing it rather than by editing it.
 *
 * A country can be broken for the want of a crag with a bird on it. `EYRIE.MOST` gives a square two
 * crossings however many ranges are in it, so a range with a village in the clouds over it and no
 * eagle on it is a place you can see from the ground and cannot get to. The editor's answer is to
 * open a tool and place a nest. This one is to carry a carcass up a mountain and leave it there,
 * which ends in the same nest and the same line in the manifest, and is a thing that happens *in*
 * the world instead of to it.
 *
 * ## The roll happens once, and it is written down
 *
 * This is the whole difficulty and it is the same door `lodged` and the register's oaths go
 * through. Whether the eagle came is a **told** fact: nothing about the seed implies it, because
 * nothing about the seed knows a hunter walked up there with a dead goat. So the answer is made
 * once, at the moment the carcass goes down, and the making of it is the only place a roll happens
 * anywhere in this file. What the rest of the game reads afterwards is `nestsOn`, which asks the
 * manifest and rolls nothing.
 *
 * Get that wrong and the fault is not subtle: a village re-lived from its seed re-rolls whether the
 * eagle came, and the nest is there on Tuesday, gone on Wednesday and back on Thursday.
 *
 * The rule is #324's, decided there for the whole family of things a player can put into a world:
 * the dice are thrown once, what they gave becomes an entry in `manifest.anchors` with its own seed
 * and generator version, and the country is the base seed plus that list for ever on every machine.
 * **The stored anchor is the stored roll.** There is deliberately no second record of whether the
 * eagle came — no flag beside the anchor saying it did — because a fact kept in two places is a
 * fact that can disagree with itself. The anchor exists or it does not, exactly as it is for an
 * island, a wreck and a village in the clouds, and it is pinned out of reach of anything that
 * changes the mountains underneath it. That last part is #322's point: anything derived from
 * terrain can be orphaned by an edit, and anything pinned cannot.
 *
 * The nest's own appearance comes off the anchor's seed for the same reason and not off the world's
 * — so what a crag is called is stable without being re-derived from where it happens to stand.
 *
 * ## A refused bait writes nothing, and what follows from that
 *
 * There is no record of a meal an eagle ate and flew away from, which means a spot the bird turned
 * down and a spot nobody has ever tried are the same state to this file. That is on purpose, and it
 * decides the re-baiting question: another carcass may be laid on the same ledge. What stops it
 * being a button is that the roll is keyed to the *day* — lay a second one this afternoon and the
 * same morning answers, so the only way to try again is to go away and come back with another
 * carcass tomorrow. Which is the shape the failure was asked to have: come back next week, having
 * learned something about the height.
 *
 * ## And somewhere an eagle would actually nest
 *
 * A carcass in a village square is a carcass in a village square. The conditions here are the ones
 * the world already applies when it places a crag of its own — a range worth flying over, footing
 * somebody could stand on, and nobody living within earshot — so a bait is allowed exactly where
 * the generator would have been allowed, and nowhere else.
 *
 * Every refusal says which condition fell shortest, and that is not politeness. A failure that
 * names its reason is a hint system made entirely out of the fiction: you laid a carcass on the
 * skirt of the range, the eagle came down and ate it and went home, and what you learned is that
 * the skirt is not high enough. The next one goes higher. Nobody had to be shown a tutorial.
 */

const BAIT = {
  /**
   * What the odds are at the foot of a range worth flying, and at the top of one.
   *
   * The issue asks for seventy-five per cent and that number is kept, as the middle: a carcass
   * left halfway in from the skirt is taken three times in four, and the ramp either side of it is
   * what makes the ground worth reading. Chance rather than certainty even at the summit, because
   * an eagle that always comes is a button; and never nought once the ground has said yes, because
   * a player who has climbed a mountain with a carcass has already paid.
   */
  AT_THE_SKIRT: 0.55,
  AT_THE_PEAK: 0.95,
  /**
   * Below this share of the way up, a failure is blamed on the height rather than on the bird.
   *
   * Half, which is the site that gets the issue's seventy-five per cent. Above it the ground is
   * good and the answer really was luck, and saying "not high enough" there would teach a lie.
   */
  BLAME_THE_GROUND: 0.5,
} as const;

/** What a hunter is told, and whether there is a nest there now. */
export interface Bait {
  /** The nest, written into the manifest, or null when there is not one. */
  nest: Anchor | null;
  /** What the world says happened. Never silent: a bad site has to be learnable. */
  said: string;
  /** The site's own odds, nought where the ground refused before any roll was made. */
  chance: number;
}

/** How far in from the skirt of a range a point lies, as a share of its reach. */
function upTheRange(massif: Massif, x: number, z: number): number {
  const away = Math.hypot(massif.x - x, massif.z - z);
  return (massif.radius - away) / massif.radius;
}

/**
 * Leave a carcass here and see what comes.
 *
 * Pure in everything it is handed, and the roll is of the seed, the tile and the day — the same
 * stream shape a night under canvas uses, and for the same reason: two players in one world who
 * bait the same crag on the same day get the same eagle without a word crossing the wire.
 *
 * @param toVillage tiles to the edge of the nearest village, Infinity where there is not one
 * @param land whether somebody could stand at a point, which is the sampler's own answer
 */
export function layTheCarcass(
  manifest: Manifest,
  seed: number,
  day: number,
  massifs: readonly Massif[],
  land: (x: number, z: number) => boolean,
  toVillage: number,
  x: number,
  z: number,
): Bait {
  const nothing = (said: string): Bait => ({ nest: null, said, chance: 0 });

  if (!land(x, z)) {
    return nothing('There is nowhere here to lay it down that it would not go straight off the edge.');
  }
  /*
   * Which range it is on, and the best of them where they overlap.
   *
   * Best rather than nearest: two massifs can cover one tile, and a hunter standing where a great
   * one and a small one meet is standing on the great one as far as anything with wings is
   * concerned. Ranked by how far up it puts him, which is the only thing the odds are read off.
   */
  let range: Massif | null = null;
  let up = 0;
  let onAHill = false;
  for (const massif of massifs) {
    const share = upTheRange(massif, x, z);
    if (share <= 0) continue;
    if (massif.radius < EYRIE.WORTH_FLYING) { onAHill = true; continue; }
    if (range === null || share > up) { range = massif; up = share; }
  }
  if (range === null) {
    return nothing(onAHill
      ? 'An eagle turns once over the hill and goes back to the mountains. This is a hill.'
      : 'You leave it in the open. Nothing comes: there is no high ground here worth a bird\'s while.');
  }
  if (toVillage < CAMP.LONELY) {
    return nothing('Crows have it inside the hour, and the dogs of the village have it off them. '
      + 'An eagle will not nest where people are.');
  }

  const chance = BAIT.AT_THE_SKIRT + (BAIT.AT_THE_PEAK - BAIT.AT_THE_SKIRT) * Math.min(1, up);
  /*
   * And the one roll in this file.
   *
   * Keyed to the tile and the day rather than to a stream anything else advances, so it is a fact
   * about that crag on that morning: asked twice it answers the same, and asked by somebody else's
   * machine it answers the same again. What happens to the answer afterwards is the whole of the
   * item — it is written into the manifest below, and never asked a second time.
   */
  const roll = mulberry32(hash3(derive(seed, SALT.EYRIE), Math.round(x), Math.round(z), day));
  if (roll() >= chance) {
    return {
      nest: null, chance,
      said: up < BAIT.BLAME_THE_GROUND
        ? 'It came down, ate well, and went back up the mountain without a second look at the ledge. '
          + 'It is not high enough here.'
        : 'It came down, ate well, and left. Picked over and abandoned, for no reason you could see.',
    };
  }

  /*
   * And the record, which is the anchor and nothing besides it.
   *
   * `ensure` fills in the seed and the generator version as well as the place, so the nest is a
   * first-class entry in the seed tree rather than a note in the margin of one — #324's rule, and
   * what makes the nest survive the tab closing, travel with the save, and stay put when the
   * mountains under it are regrown.
   */
  const nest = manifest.ensure(`eyrie:${Math.round(x)},${Math.round(z)}`, 'eyrie', Math.round(x), Math.round(z));
  return {
    nest, chance,
    said: `It came down, and it stayed. By evening there are sticks on the ledge above ${cragName(nest.seed, nest.x, nest.z)}.`,
  };
}

/**
 * The nests somebody baited, as crags with birds on them, for the square being stood on.
 *
 * Rolls nothing and decides nothing. Every one of these exists because a carcass was left and an
 * eagle came, and that was settled the day it happened — so all this does is read the manifest and
 * dress each entry as the same kind of thing `planEyries` hands back.
 *
 * `within` narrows it to the square in a country with no edge, for the reason `HighCountry` exists
 * at all: a hero two squares along must not be standing under crags that belong to country behind
 * him. Null for a world that has an edge, where there is only ever the one square.
 *
 * The name comes off the anchor's own seed, which is the seed the manifest minted for it when the
 * eagle came. A crag is called the same thing for ever on every machine, and the thing it is called
 * follows from the record rather than from a second derivation off the world seed that would have
 * to be kept agreeing with it.
 *
 * ## Who a baited bird will carry you to
 *
 * The nearest other crag on the square, planned or baited, and the fare by the same rule a planned
 * pair charges. One way, deliberately: a planned pair are two halves of one range and each names
 * the other, and rewriting one of them to name a nest somebody baited last week would break the
 * crossing the world was built with. So a bait adds a way over rather than moving one.
 *
 * Two baits therefore name each other, which is the thing worth having: `EYRIE.MOST` allows a
 * square two crossings however many ranges are in it, and this is how a player makes a third.
 *
 * A crag near enough to be standing on is not a crossing, so one that close is passed over. Two
 * carcasses left on the same ledge would otherwise sell a flight of two tiles for eighteen gold,
 * and the hero would be within `EYRIE.REACH` of both ends of it at once.
 */
export function nestsOn(
  manifest: Manifest,
  within: Within | null,
  planned: readonly Eyrie[],
): Eyrie[] {
  const here = manifest.byKind('eyrie').filter((a) => !within
    || (a.x >= within.x0 && a.x < within.x1 && a.z >= within.z0 && a.z < within.z1));
  const nests: Eyrie[] = here.map((a) => ({
    id: a.id, name: cragName(a.seed, a.x, a.z), x: a.x, z: a.z, partner: '', fare: 0,
  }));

  const all = [...planned, ...nests];
  for (const nest of nests) {
    let partner: Eyrie | null = null;
    let across = Infinity;
    for (const other of all) {
      if (other.id === nest.id) continue;
      const away = Math.hypot(other.x - nest.x, other.z - nest.z);
      if (away <= EYRIE.REACH * 2 || away >= across) continue;
      across = away; partner = other;
    }
    if (!partner) continue;
    nest.partner = partner.id;
    nest.fare = Math.round(EYRIE.FARE_BASE + (across / 10) * EYRIE.FARE_PER_TEN);
  }
  return nests;
}
