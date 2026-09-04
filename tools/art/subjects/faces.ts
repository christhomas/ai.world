import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Surface } from '../surface';
import type { Subject } from '../subject';

/**
 * The villager faces, drawn as a sheet.
 *
 * Nothing here knows how a face is made. It imports the game's own drawing function out of
 * whichever copy of the source it was pointed at, and hands it somewhere to put pixels — which is
 * what lets the same code render the committed version and the working one side by side without
 * either being a reimplementation of the other.
 */

/** How the sheet is laid out. */
const SHEET = {
  /** Whole-pixel magnification. Three is the smallest that lets you judge an eye. */
  ZOOM: 3,
  COLUMNS: 6,
  GAP: 6,
  CAPTION: 8,
  BACKGROUND: '#232d63',
  PANEL: '#46538f',
  LABEL: '#ffd76a',
} as const;

/** One of each, so a change to a hat or a collar is as visible as a change to a face. */
const TRADES = ['farmer', 'hunter', 'constable', 'doctor', 'soldier', 'sailor'];

export const faces: Subject = {
  name: 'faces',
  what: 'the villager portraits drawn in conversations',
  files: ['src/ui/portrait.ts', 'src/ui/portraitHair.ts', 'src/ui/pixels.ts'],

  async render(root: string): Promise<Surface> {
    const module = await import(pathToFileURL(join(root, 'src/ui/portrait.ts')).href) as {
      FACE: { W: number; H: number };
      faceOf: (id: string, trade: string, stage: 'adult' | 'child', talking?: boolean) => unknown;
      paint: (fill: (x: number, y: number, w: number, h: number, colour: string) => void, face: unknown) => void;
    };

    // a mix worth judging: a few trades, a few plain villagers, a child, and one mid-sentence
    const wanted: Array<[string, unknown]> = [
      ...TRADES.map((trade) => [trade, module.faceOf(`Ashford-${trade}`, trade, 'adult')] as [string, unknown]),
      ...Array.from({ length: 10 }, (_, i) =>
        [`villager ${i}`, module.faceOf(`Ashford-${i}`, '', 'adult')] as [string, unknown]),
      ['child', module.faceOf('kid-1', '', 'child')],
      ['talking', module.faceOf('Ashford-farmer', 'farmer', 'adult', true)],
    ];

    const cell = {
      w: module.FACE.W * SHEET.ZOOM,
      h: module.FACE.H * SHEET.ZOOM + SHEET.CAPTION,
    };
    const columns = SHEET.COLUMNS;
    const rows = Math.ceil(wanted.length / columns);
    const sheet = new Surface(
      columns * (cell.w + SHEET.GAP) + SHEET.GAP,
      rows * (cell.h + SHEET.GAP) + SHEET.GAP,
      SHEET.BACKGROUND,
    );

    wanted.forEach(([label, face], at) => {
      const x = SHEET.GAP + (at % columns) * (cell.w + SHEET.GAP);
      const y = SHEET.GAP + Math.floor(at / columns) * (cell.h + SHEET.GAP);

      sheet.fill(x, y, cell.w, module.FACE.H * SHEET.ZOOM, SHEET.PANEL);
      // draw the face into its own surface first, then magnify: scaling whole pixels afterwards
      // is what keeps the art square-edged instead of smeared
      const one = new Surface(module.FACE.W, module.FACE.H);
      module.paint(one.fill, face);
      sheet.blit(one, x, y, SHEET.ZOOM);
      sheet.centredText(label, x + cell.w / 2, y + module.FACE.H * SHEET.ZOOM + 2, SHEET.LABEL, 1);
    });
    return sheet;
  },
};
