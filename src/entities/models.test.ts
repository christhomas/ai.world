import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { MODELS, MODEL_DIR, modelFile, readModel } from './models';
import { KINDS } from './animals';

/**
 * A directory of hand-written files and a game that has to agree with it.
 *
 * `models.ts` names its files rather than finding them, because the game is bundled for a browser
 * and a browser has no directory to walk — so the list in the source and the directory on disk are
 * two hand-maintained things, and two hand-maintained things drift. Both directions are checked
 * here: a file nobody imports is a rig somebody drew and nothing uses, and an import with no file
 * would not build at all, which is the cheap half.
 *
 * The other half is the complaining. These files are edited by a person and by Claude through the
 * character builder, and both make the same mistakes — a colour as a number, a misspelt `anim`
 * that quietly stops a leg swinging. Every one of those has to come back as a sentence naming the
 * file, the field and what was expected, because the alternative is a rig that loads wrong and a
 * fortnight of nobody noticing. So the messages themselves are the thing under test.
 */

/** A model file with one part in it, so a test can change one field and leave the rest correct. */
const oneBox = (part: Record<string, unknown>) => ({ parts: [{ box: [1, 1, 1], at: [0, 0, 0], color: '#ffffff', ...part }] });

/** What went wrong, as the person who has to fix it would read it. */
function complaint(contents: unknown): string {
  try {
    readModel('models/creatures/test.json', contents);
  } catch (err) {
    return (err as Error).message;
  }
  return 'nothing was wrong with it';
}

describe('the models directory', () => {
  it('has a file for every creature the game draws', () => {
    const missing = Object.keys(KINDS).filter((id) => !existsSync(modelFile(id)));
    expect(missing, `nothing in ${MODEL_DIR}/ draws ${missing.join(', ')}`).toEqual([]);
  });

  it('names a creature with every file in it', () => {
    const files = readdirSync(MODEL_DIR).filter((name) => name.endsWith('.json'));
    const orphans = files.map((name) => name.replace(/\.json$/, '')).filter((id) => !KINDS[id]);
    expect(orphans, `${MODEL_DIR}/ holds a body for ${orphans.join(', ')}, which nothing in the game is`)
      .toEqual([]);
  });

  it('reads every one of them into a body with something in it', () => {
    for (const [id, parts] of Object.entries(MODELS)) {
      expect(parts.length, `${modelFile(id)} draws nothing`).toBeGreaterThan(0);
      expect(KINDS[id].parts, `${id} is drawn with something other than its own file`).toBe(parts);
    }
  });

  it('reads the file on disk to the same body as the one bundled in', () => {
    // the game imports these through the bundler, so this is the only thing that ever proves the
    // bytes on disk are what it is drawing — a file edited and not saved would pass everything else
    for (const id of Object.keys(MODELS)) {
      const fromDisk = readModel(modelFile(id), JSON.parse(readFileSync(modelFile(id), 'utf8')));
      expect(fromDisk, `${modelFile(id)} on disk is not what the game has`).toEqual(MODELS[id]);
    }
  });

  it('says where a model lives without being asked to look', () => {
    expect(modelFile('wolf')).toBe('models/creatures/wolf.json');
    // it answers for a creature nobody has drawn yet, because "where would this go" is the same
    // question as "where is this" and is asked exactly when the file is not there
    expect(modelFile('badger')).toBe('models/creatures/badger.json');
  });
});

describe('a model file somebody has got wrong', () => {
  it('names the file and the field', () => {
    expect(complaint(oneBox({ color: 16777215 })))
      .toBe('models/creatures/test.json.parts[0].color: expected a colour like "#a06030", found number 16777215');
  });

  it('will not take a shape it does not have', () => {
    expect(complaint({ parts: [{ sphere: 1, at: [0, 0, 0], color: '#ffffff' }] }))
      .toContain('is not something a part has; try one of: anim, at, box, color, cone, cyl, ico, pivot, rot, tag, tint');
  });

  it('will not draw a part that is two shapes at once', () => {
    expect(complaint({ parts: [{ box: [1, 1, 1], ico: 1, at: [0, 0, 0], color: '#ffffff' }] }))
      .toBe('models/creatures/test.json.parts[0]: is box and ico at once, and a part is one shape');
  });

  it('will not draw a part that is no shape at all', () => {
    expect(complaint({ parts: [{ at: [0, 0, 0], color: '#ffffff' }] }))
      .toBe('models/creatures/test.json.parts[0]: has no shape: one of box, ico, cone, cyl says what it is and carries its size');
  });

  it('lists the parts of a body a walk knows how to move', () => {
    expect(complaint(oneBox({ anim: 'legl' })))
      .toBe('models/creatures/test.json.parts[0].anim: "legl" is not one of: armL, armR, cape, head, legL, legR, tail, wingL, wingR');
  });

  it('counts the numbers in a place', () => {
    expect(complaint(oneBox({ at: [0, 0] })))
      .toBe('models/creatures/test.json.parts[0].at: expected three numbers — x, y, z — found 2');
  });

  it('says what the two numbers of a cone are for', () => {
    expect(complaint({ parts: [{ cone: [0.3], at: [0, 0, 0], color: '#ffffff' }] }))
      .toBe('models/creatures/test.json.parts[0].cone: expected the radius of the base and the height, found 1 numbers');
  });

  it('takes an angle in radians or as a fraction of a turn, and nothing else', () => {
    expect(complaint(oneBox({ rot: [0, 0, 'sideways'] })))
      .toBe('models/creatures/test.json.parts[0].rot[2]: expected radians, or a fraction of a turn like "-1/4", found "sideways"');
  });

  it('will not take arguments for a generator nobody named', () => {
    expect(complaint({ with: { skin: '#ffdab9' } }))
      .toBe('models/creatures/test.json.with: is the arguments to a generator, but nothing here says what to build "from"');
  });

  it('lists the generators there are', () => {
    expect(complaint({ from: 'quadraped', with: {} }))
      .toBe('models/creatures/test.json.from: "quadraped" is not one of: biped, quadruped');
  });

  it('names the argument a generator is missing', () => {
    expect(complaint({ from: 'biped', with: { skin: '#ffdab9', hair: '#000000', shirtTint: 0 } }))
      .toBe('models/creatures/test.json.with.pantsColor: is missing');
  });

  it('will not take an argument a generator does not have', () => {
    expect(complaint({ from: 'quadruped', with: { legWidth: 0.1 } }))
      .toContain('models/creatures/test.json.with.legWidth: is not something a quadruped has; try one of: body,');
  });

  it('will not take a key a model does not have', () => {
    expect(complaint({ shapes: [] }))
      .toBe('models/creatures/test.json.shapes: is not something a model has; try one of: from, parts, with');
  });

  it('says so when a file draws nothing', () => {
    expect(complaint({}))
      .toBe('models/creatures/test.json: draws nothing: a model is "from" a generator, or a list of "parts", or both, and this is neither');
  });
});

describe('a fraction of a turn', () => {
  it('is the exact angle it replaced', () => {
    const turned = (fraction: string) => readModel('t', oneBox({ rot: [0, 0, fraction] }))[0].rot![2];
    // these are the only two the bestiary uses, and both have to land on the double the source
    // literal used to put there or every beak in the game moves by a fraction of a degree
    expect(turned('-1/4')).toBe(-Math.PI / 2);
    expect(turned('1/2')).toBe(Math.PI);
  });
});
