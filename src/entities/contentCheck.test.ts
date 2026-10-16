import { describe, expect, it } from 'vitest';
import { inventory, type ContentRecord } from '../core/content';
import { DEFAULT_CONTENT } from '../core/contentDefaults';
import { checkContent } from './contentCheck';

const defaults = inventory(DEFAULT_CONTENT);

/** The bundled records with one body replaced, or removed when the body is undefined. */
const changed = (id: string, body: unknown): ContentRecord[] => {
  expect(defaults.some((record) => record.id === id), `${id} is a bundled record`).toBe(true);
  return body === undefined ? defaults.filter((record) => record.id !== id)
    : defaults.map((record) => record.id === id ? { ...record, body } : record);
};
const bodyOf = <T>(id: string): T => defaults.find((record) => record.id === id)!.body as T;

describe('checking proposed content with the game\'s own readers', () => {
  it('finds nothing wrong with what the game ships', () => {
    expect(defaults.length).toBeGreaterThan(100);
    expect(checkContent(defaults)).toEqual([]);
  });

  it('refuses a model part with two shapes, naming the model file', () => {
    const wolf = bodyOf<{ parts?: unknown[] }>('model:wolf');
    const problems = checkContent(changed('model:wolf', { ...wolf, parts: [{ box: [0.1, 0.1, 0.1], ico: [0.1], at: [0, 0, 0], color: '#ffffff' }] }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('models/creatures/wolf.json');
  });

  it('refuses a behaviour tree with a verb the game does not have', () => {
    const problems = checkContent(changed('behaviour:grazer', { do: 'grazee' }));
    expect(problems.join('\n')).toContain('no such action "grazee"');
  });

  it('refuses a spawn weight written as a word', () => {
    const problems = checkContent(changed('spawning:deep', { kinds: { shark: 'lots', orca: 3 } }));
    expect(problems.join('\n')).toContain('deep.kinds.shark');
  });

  it('refuses a blow that lasts longer than the motion file allows', () => {
    const blows = bodyOf<Record<string, Record<string, unknown>>>('motion:blows');
    expect(blows.swing.lasts).toBeLessThan(4);
    const problems = checkContent(changed('motion:blows', { ...blows, swing: { ...blows.swing, lasts: 10 } }));
    expect(problems.join('\n')).toContain('blows.swing.lasts');
  });

  it('checks a creature\'s blow against the proposed motion file, not the bundled one', () => {
    const blows = bodyOf<Record<string, unknown>>('motion:blows');
    expect(bodyOf<{ blow?: string }>('creature:bear').blow).toBe('rear');
    const { rear: _rear, ...withoutRear } = blows;
    const problems = checkContent(changed('motion:blows', withoutRear));
    expect(problems.join('\n')).toContain('"rear" is not one of');
  });

  it('refuses a creature that no behaviour tree drives, and a model with no creature', () => {
    // Wolves prowl and have no tree under their own name, so the prowler tree is all that drives them.
    expect(bodyOf<{ behaviour: string }>('creature:wolf').behaviour).toBe('prowl');
    expect(defaults.some((record) => record.id === 'behaviour:wolf')).toBe(false);
    const undriven = checkContent(changed('behaviour:prowler', undefined));
    expect(undriven).toContain('creature:wolf behaves as "prowl", and no behaviour tree drives that');

    const shark = defaults.find((record) => record.id === 'model:shark')!;
    const orphan = checkContent([...defaults, { ...shark, id: 'model:kraken', source: 'models/creatures/kraken.json' }]);
    expect(orphan).toContain('model:kraken draws a creature that nothing in properties/ says anything about');
  });

  it('says so when every record of a one-file kind has been deleted', () => {
    const problems = checkContent(defaults.filter((record) => record.kind !== 'motion'));
    expect(problems).toContain('expected the motion records to come from one file, found 0');
  });
});
