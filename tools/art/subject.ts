import type { Surface } from './surface';

/**
 * A kind of artwork the pipeline knows how to draw.
 *
 * A subject renders itself from a given copy of the source rather than from the one it was
 * imported out of. That single rule is what makes a side-by-side possible at all: the committed
 * version and the working version are the same subject, pointed at two different trees.
 */
export interface Subject {
  /** What you type: `chore art <name>`. */
  name: string;
  /** One line, for the listing. */
  what: string;
  /**
   * The files this artwork is made of. Used to tell you what changed, and to know what a
   * candidate has to replace.
   */
  files: string[];
  /** Draw the sheet, importing the game's own code out of `root`. */
  render(root: string): Promise<Surface>;
}
