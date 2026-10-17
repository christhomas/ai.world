import { FACE, faceFor, paint, type Sitter } from '../ui/portrait';

/**
 * A face as an installed app draws it (#574): the same rectangles the page's canvas is filled with,
 * in the order they are painted, so the two cannot draw anybody differently. Each fill is five
 * numbers, x, y, width, height and an index into `colours`; `talking` is the same face with its
 * mouth open, for the words that are still arriving.
 */
interface Portrait {
  w: number;
  h: number;
  colours: string[];
  still: number[];
  talking: number[];
}

/** What a sitter is drawn from, and so what tells one face from another. */
const portraitKey = (who: Sitter): string => `${who.id}/${who.trade}/${who.stage}`;

function painted(who: Sitter): Portrait {
  const colours: string[] = [];
  const fills = (talking: boolean): number[] => {
    const out: number[] = [];
    paint((x, y, w, h, colour) => {
      let index = colours.indexOf(colour);
      if (index < 0) index = colours.push(colour) - 1;
      out.push(x, y, w, h, index);
    }, { ...faceFor(who), talking });
    return out;
  };
  const still = fills(false);
  return { w: FACE.W, h: FACE.H, colours, still, talking: fills(true) };
}

/**
 * The faces an app has been sent. A face is painted and sent once; after that a conversation names
 * it by its key, as a scene names a geometry it has already sent.
 */
export class Portraits {
  private readonly sent = new Set<string>();
  private fresh: Record<string, Portrait> = {};

  /** The key an app draws this sitter by, painting the face first if the app has not had it. */
  name(who: Sitter | null | undefined): string | null {
    if (!who) return null;
    const key = portraitKey(who);
    if (!this.sent.has(key)) {
      this.sent.add(key);
      this.fresh[key] = painted(who);
    }
    return key;
  }

  /** The faces painted since the last reply, or nothing if there were none. */
  take(): Record<string, Portrait> | null {
    const fresh = this.fresh;
    this.fresh = {};
    return Object.keys(fresh).length > 0 ? fresh : null;
  }
}
