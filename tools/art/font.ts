/**
 * A three-by-five font, for labelling a comparison sheet.
 *
 * Small enough to hold in this file, large enough to read when it is drawn at double or triple
 * size, which is all a caption over a picture of faces needs to be. Uppercase, digits and a
 * handful of punctuation; anything else comes out as a blank.
 *
 * Each glyph is five rows of three bits, written as five hex digits from the top down.
 */
const GLYPHS: Record<string, string> = {
  A: '25755', B: '65656', C: '34443', D: '65556', E: '74647', F: '74644', G: '34553',
  H: '55755', I: '72227', J: '11152', K: '55655', L: '44447', M: '77555', N: '57775',
  O: '25552', P: '65644', Q: '25573', R: '65655', S: '34216', T: '72222', U: '55557',
  V: '55552', W: '55575', X: '55255', Y: '55222', Z: '71247',
  '0': '25752', '1': '62227', '2': '61247', '3': '61216', '4': '55711', '5': '74616',
  '6': '34653', '7': '71222', '8': '35253', '9': '35316',
  ' ': '00000', '-': '00700', '.': '00002', ':': '02020', '/': '11244',
  '+': '02720', '=': '07070', '(': '12221', ')': '42224', "'": '22000', '?': '61202',
  '!': '22202', ',': '00022', '<': '12421', '>': '42124', '*': '05250', '#': '57757',
};

export const GLYPH = { W: 3, H: 5, GAP: 1 } as const;

/** How wide a line of text will be, at a given scale. */
export function textWidth(text: string, scale = 1): number {
  return text.length * (GLYPH.W + GLYPH.GAP) * scale - GLYPH.GAP * scale;
}

/** Draw text, a pixel at a time, through whatever `put` does with a rectangle. */
export function drawText(
  put: (x: number, y: number, w: number, h: number, colour: string) => void,
  text: string, x: number, y: number, colour: string, scale = 1,
): void {
  let at = x;
  for (const letter of text.toUpperCase()) {
    const glyph = GLYPHS[letter] ?? GLYPHS[' '];
    for (let row = 0; row < GLYPH.H; row++) {
      const bits = parseInt(glyph[row], 16);
      for (let col = 0; col < GLYPH.W; col++) {
        if (bits & (1 << (GLYPH.W - 1 - col))) put(at + col * scale, y + row * scale, scale, scale, colour);
      }
    }
    at += (GLYPH.W + GLYPH.GAP) * scale;
  }
}
