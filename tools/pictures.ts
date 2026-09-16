/**
 * Whether two pictures of the same place are the same picture.
 *
 * Nothing in this repository could answer that. `tools/shots.cjs` pins the world, the seed, the
 * camera and what has to happen first, so a shot can be retaken exactly — and then nothing ever
 * reads two of them. Not the script, and nothing in `checks.yml` looks at `docs/screenshots/`.
 *
 * That is the gap under every graphics item on the list. #249's acceptance is *"reference
 * screenshots before and after are identical"*, #250's is *"with the switch off, the G0 reference
 * screenshots are unchanged"*, and neither is currently a thing anybody can evaluate except by
 * opening two windows and squinting.
 *
 * And the risk #250 names is the one a person is worst at spotting that way: **shared tuning**. The
 * sun at 2.6, the ambient at 0.45, the shadow bias. Move one of them for a second render path and
 * the first path changes with it — by an amount nobody notices in two windows an hour apart, and
 * everybody notices a fortnight later when it is three changes deep.
 *
 * So this is a number, with a threshold that has a reason.
 */
export const PICTURES = {
  /**
   * How far one channel may move before that pixel counts as having changed, out of 255.
   *
   * Three. A PNG is lossless, so this is not compression — it is the renderer: the same scene drawn
   * twice on the same machine differs along an antialiased edge and wherever a float rounded the
   * other way. Three is under what anybody can see on a flat colour and well under what a prop
   * standing in a different place produces.
   */
  A_SHADE: 3,
  /**
   * The share of a picture that may differ before the two are a different picture.
   *
   * Half a percent. Above nought because a renderer is not deterministic to the bit and a check
   * that cries wolf is a check somebody turns off — the failure this codebase names in three other
   * places. Small enough that one prop in the wrong place fails it: a cottage is a good deal more
   * than half a percent of a screen, and so is a terrace that moved a level.
   */
  TOO_MUCH: 0.005,
} as const;

/** A decoded picture: raw RGBA, which is what a PNG comes back as. */
export interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** What two pictures came to. */
export interface Difference {
  /** The share of pixels that moved at all, nought to one. */
  share: number;
  /** How many did, for a report that has to name a number somebody can act on. */
  moved: number;
  of: number;
}

/**
 * How much of this picture is not that picture.
 *
 * A **share of pixels that moved**, rather than a mean difference, and the distinction is the whole
 * value of the check. One prop drawn in the wrong place is a handful of pixels wrong by a lot, and
 * in a mean it disappears into a million pixels that agree — a rounding error against a fault
 * anybody would see instantly. A share says *something is in a different place*. A mean says
 * *everything is very slightly different*, which is the answer to a question nobody asked.
 *
 * Refuses two pictures of different sizes rather than comparing what overlaps. A window that
 * resized is not a render that changed, and quietly scoring it as one is how a check earns its
 * reputation for lying.
 */
export function differenceBetween(before: Picture, after: Picture): Difference {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `pictures are a different size: ${before.width}x${before.height} against ${after.width}x${after.height}`,
    );
  }
  const of = before.width * before.height;
  let moved = 0;
  for (let at = 0; at < of; at++) {
    const px = at * 4;
    // alpha deliberately left out: a screenshot is opaque, and an alpha that moved is a fact about
    // the capture rather than about the picture
    const apart = Math.max(
      Math.abs(before.data[px] - after.data[px]),
      Math.abs(before.data[px + 1] - after.data[px + 1]),
      Math.abs(before.data[px + 2] - after.data[px + 2]),
    );
    if (apart >= PICTURES.A_SHADE) moved++;
  }
  return { share: of === 0 ? 0 : moved / of, moved, of };
}

/** Whether that difference is one somebody should be told about. */
export function tellsApart(share: number): boolean {
  return share > PICTURES.TOO_MUCH;
}
