/**
 * Putting a picture on the terminal.
 *
 * Ghostty, Kitty and WezTerm all speak the Kitty graphics protocol: base64 of a PNG, sent in
 * chunks, with an escape sequence around each one. Inside tmux that has to be wrapped again in a
 * passthrough sequence with every escape byte doubled, or tmux eats it — which is the single
 * detail that makes the difference between a picture and a screenful of rubbish. tmux also needs
 * `set -g allow-passthrough on`, which is off by default.
 *
 * iTerm2 speaks its own, simpler dialect. Anything else is told where the file is, which is not
 * as good but is never wrong.
 */

const ESC = '\x1b';
const BEL = '\x07';
/** Kitty wants the payload in chunks of at most this many base64 characters. */
const CHUNK = 4096;

export type Support = 'kitty' | 'iterm' | 'none';

export function supportOf(env: NodeJS.ProcessEnv = process.env): Support {
  if (env.TERM_PROGRAM === 'iTerm.app') return 'iterm';
  if (env.GHOSTTY_RESOURCES_DIR || env.KITTY_WINDOW_ID || env.WEZTERM_EXECUTABLE) return 'kitty';
  if (env.TERM_PROGRAM === 'ghostty' || env.TERM_PROGRAM === 'WezTerm') return 'kitty';
  // inside tmux the terminal's own variables usually survive; if they did not, assume the common case
  if (env.TERM?.startsWith('tmux') || env.TERM?.startsWith('screen')) return 'kitty';
  return 'none';
}

/** Wrap a sequence so tmux passes it through to the terminal underneath rather than eating it. */
function throughTmux(sequence: string, inTmux: boolean): string {
  if (!inTmux) return sequence;
  return `${ESC}Ptmux;${sequence.split(ESC).join(ESC + ESC)}${ESC}\\`;
}

/**
 * Write a PNG to the terminal. Returns false when the terminal cannot show one, so the caller can
 * fall back to saying where it put the file.
 */
export function showImage(png: Buffer, out: NodeJS.WritableStream = process.stdout, env = process.env): boolean {
  const support = supportOf(env);
  const inTmux = Boolean(env.TMUX) || Boolean(env.TERM?.startsWith('tmux'));
  const data = png.toString('base64');

  if (support === 'iterm') {
    out.write(throughTmux(`${ESC}]1337;File=inline=1;size=${png.length}:${data}${BEL}`, inTmux));
    out.write('\n');
    return true;
  }
  if (support === 'none') return false;

  // kitty: f=100 says the payload is a PNG, a=T says show it now, m=1 says more is coming
  for (let at = 0; at < data.length; at += CHUNK) {
    const piece = data.slice(at, at + CHUNK);
    const more = at + CHUNK < data.length ? 1 : 0;
    const keys = at === 0 ? `a=T,f=100,m=${more}` : `m=${more}`;
    out.write(throughTmux(`${ESC}_G${keys};${piece}${ESC}\\`, inTmux));
  }
  out.write('\n');
  return true;
}
