import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { encodePng } from './png';
import { Surface } from './surface';
import { compare } from './compare';
import { supportOf } from './terminal';
import { drawText, textWidth } from './font';

/**
 * The art tools are only worth having if what you approve is what the game will draw, so what is
 * tested is the chain that guarantees it: the pixels go where they are asked, the file that comes
 * out is a real PNG, and a comparison keeps its panels apart.
 */
describe('drawing a picture', () => {
  it('puts a colour exactly where it was asked to', () => {
    const surface = new Surface(4, 3, '#000000');
    surface.fill(1, 1, 2, 1, '#ff8800');

    const at = (x: number, y: number): string =>
      [...surface.rgba.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 3)]
        .map((v) => v.toString(16).padStart(2, '0')).join('');
    expect(at(1, 1)).toBe('ff8800');
    expect(at(2, 1)).toBe('ff8800');
    expect(at(0, 1)).toBe('000000');
    expect(at(1, 0)).toBe('000000');
  });

  it('does not draw outside itself, however far it is pushed', () => {
    const surface = new Surface(3, 3, '#000000');
    expect(() => {
      surface.fill(-40, -40, 100, 100, '#ffffff');
      surface.fill(90, 90, 10, 10, '#ff0000');
    }).not.toThrow();
    expect(surface.rgba.length).toBe(3 * 3 * 4);
  });

  it('blends a colour that is partly see-through', () => {
    const surface = new Surface(1, 1, '#000000');
    surface.fill(0, 0, 1, 1, '#ffffff80');
    expect(surface.rgba[0]).toBeGreaterThan(100);
    expect(surface.rgba[0]).toBeLessThan(160);
  });

  it('magnifies by whole pixels, so the art stays square-edged', () => {
    const small = new Surface(2, 1, '#000000');
    small.fill(0, 0, 1, 1, '#ff0000');
    const big = new Surface(6, 3, '#000000');
    big.blit(small, 0, 0, 3);

    const red = (x: number): boolean => big.rgba[x * 4] === 255;
    expect([red(0), red(1), red(2)]).toEqual([true, true, true]);
    expect(red(3)).toBe(false);
  });
});

describe('the file it writes', () => {
  it('is a PNG, with the size it says it is', () => {
    const png = encodePng(2, 2, new Uint8Array(2 * 2 * 4).fill(200));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    expect(png.toString('ascii', png.length - 8, png.length - 4)).toBe('IEND');   // then its checksum
  });

  it('holds back the pixels it was given', () => {
    const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
    const png = encodePng(2, 1, rgba);

    // find the IDAT chunk and unzip it: a row is a filter byte then the pixels
    const at = png.indexOf(Buffer.from('IDAT', 'ascii'));
    const length = png.readUInt32BE(at - 4);
    const raw = inflateSync(png.subarray(at + 4, at + 4 + length));
    expect([...raw]).toEqual([0, 1, 2, 3, 255, 4, 5, 6, 255]);
  });
});

describe('the comparison', () => {
  const panelOf = (colour: string): Surface => {
    const art = new Surface(20, 10, colour);
    return art;
  };

  it('keeps every panel, side by side, with a rule between them', () => {
    const sheet = compare([
      { label: 'committed', art: panelOf('#ff0000') },
      { label: 'working', art: panelOf('#0000ff') },
    ]);
    expect(sheet.width).toBeGreaterThan(40);

    // the red panel sits to the left of the blue one, wherever the header and padding put them
    const reds: number[] = [];
    const blues: number[] = [];
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) {
        const at = (y * sheet.width + x) * 4;
        const [r, , b] = [sheet.rgba[at], sheet.rgba[at + 1], sheet.rgba[at + 2]];
        if (r === 255 && b === 0) reds.push(x);
        if (b === 255 && r === 0) blues.push(x);
      }
    }
    expect(reds.length).toBe(20 * 10);
    expect(blues.length).toBe(20 * 10);
    expect(Math.max(...reds)).toBeLessThan(Math.min(...blues));
  });

  it('makes room for a single panel just the same, so one thing can be looked at alone', () => {
    const sheet = compare([{ label: 'working', art: panelOf('#00ff00') }]);
    expect(sheet.width).toBeGreaterThan(20);
    expect(sheet.height).toBeGreaterThan(10);
  });
});

describe('the lettering', () => {
  it('has a shape for every letter it will be asked to draw', () => {
    const marks: string[] = [];
    drawText((x, y, w, h) => marks.push(`${x},${y},${w},${h}`), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 0, 0, '#fff');
    expect(marks.length).toBeGreaterThan(300);
  });

  it('draws two different letters differently, so a label can be read', () => {
    const of = (letter: string): string => {
      const marks: string[] = [];
      drawText((x, y) => marks.push(`${x},${y}`), letter, 0, 0, '#fff');
      return marks.join('|');
    };
    const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(of);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it('measures a line at the width it actually draws it', () => {
    const marks: number[] = [];
    drawText((x, _y, w) => marks.push(x + w), 'HELLO', 0, 0, '#fff', 2);
    expect(Math.max(...marks)).toBeLessThanOrEqual(textWidth('HELLO', 2));
  });
});

describe('knowing what the terminal can do', () => {
  it('recognises the terminals that can show a picture', () => {
    expect(supportOf({ TERM_PROGRAM: 'iTerm.app' } as NodeJS.ProcessEnv)).toBe('iterm');
    expect(supportOf({ GHOSTTY_RESOURCES_DIR: '/x' } as NodeJS.ProcessEnv)).toBe('kitty');
    expect(supportOf({ KITTY_WINDOW_ID: '1' } as NodeJS.ProcessEnv)).toBe('kitty');
  });

  it('says no when it has no reason to think it can', () => {
    expect(supportOf({ TERM: 'dumb' } as NodeJS.ProcessEnv)).toBe('none');
    expect(supportOf({} as NodeJS.ProcessEnv)).toBe('none');
  });
});
