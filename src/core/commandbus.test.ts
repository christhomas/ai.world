import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, formatCommand, parseCommand } from '../../server/commands';
import { CommandBus, helpText } from './commandbus';

/**
 * The bus and the vocabulary, which are the seam everything else will hang on: a command typed at
 * a terminal, sent down a socket and issued by the game itself all have to arrive as the same
 * thing. Most of what is checked here is the reading of a line, because that is where a mistake
 * turns into a wrong number rather than into an error somebody sees.
 */

describe('reading a command', () => {
  it('reads a name and its arguments, and knows a number from a word', () => {
    const read = parseCommand('sow 322 53');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.command.name).toBe('sow');
    expect(read.command.args).toEqual([322, 53]);
    // numbers arrive as numbers: a handler asked for a coordinate, not for the text of one
    expect(read.command.args.every((a) => typeof a === 'number')).toBe(true);
  });

  it('leaves teleport its two readings, because a place has a name and a point has numbers', () => {
    const point = parseCommand('teleport 322 53');
    expect(point.ok && point.command.args).toEqual(['322', 53]);
    const named = parseCommand('teleport silverholm');
    expect(named.ok && named.command.args).toEqual(['silverholm']);
    const spoken = parseCommand('teleport "The Long Water"');
    expect(spoken.ok && spoken.command.args).toEqual(['The Long Water']);
  });

  it('holds a quoted argument together', () => {
    const read = parseCommand('discover "The Long Water"');
    expect(read.ok && read.command.args).toEqual(['The Long Water']);
  });

  it('keeps optional arguments optional', () => {
    expect(parseCommand('spawn wolf').ok).toBe(true);
    const both = parseCommand('spawn wolf 30');
    expect(both.ok && both.command.args).toEqual(['wolf', 30]);
  });

  it('says what is wrong rather than throwing', () => {
    expect(parseCommand('')).toEqual({ ok: false, error: 'nothing to run' });
    expect(parseCommand('fly to the moon').ok).toBe(false);
    expect(parseCommand('teleport 1 2 3')).toEqual({ ok: false, error: 'teleport takes <place or x> [z]' });
    expect(parseCommand('teleport here 53').ok).toBe(true);   // "here" could be a place; the handler decides
    expect(parseCommand('teleport 322 here')).toEqual({ ok: false, error: 'z must be a number, not here' });
    expect(parseCommand('discover "unfinished')).toEqual({ ok: false, error: 'unclosed quote' });
  });

  it('writes a command back out the way it was read', () => {
    for (const line of ['teleport 322 53', 'spawn wolf 30', 'descend', 'discover "The Long Water"']) {
      const read = parseCommand(line);
      expect(read.ok && formatCommand(read.command)).toBe(line);
    }
  });

  it('carries who asked, without having an opinion about it', () => {
    const read = parseCommand('descend', 'operator');
    expect(read.ok && read.command.issuer).toBe('operator');
  });
});

describe('the bus', () => {
  it('runs what has been defined, and hands back what it returned', () => {
    const bus = new CommandBus();
    const seen: unknown[] = [];
    bus.define('sow', (args) => { seen.push(args); return { at: args }; });
    expect(bus.run('sow 10 20')).toEqual({ ok: true, value: { at: [10, 20] } });
    expect(seen).toEqual([[10, 20]]);
  });

  it('refuses a name the vocabulary does not have, at the point somebody defines it', () => {
    const bus = new CommandBus();
    expect(() => bus.define('conjure', () => 1)).toThrow(/vocabulary/);
  });

  it('answers rather than throws when a command has no handler here', () => {
    const bus = new CommandBus();
    expect(bus.run('descend')).toEqual({ ok: false, error: 'nothing here runs descend' });
  });

  it('turns a handler that throws into an answer', () => {
    const bus = new CommandBus();
    bus.define('drop', () => { throw new Error('nothing in hand'); });
    expect(bus.run('drop')).toEqual({ ok: false, error: 'nothing in hand' });
  });

  it('lets somebody watch everything that goes through, including what failed', () => {
    const bus = new CommandBus();
    const watcher = vi.fn();
    const stop = bus.watch(watcher);
    bus.define('descend', () => undefined);
    bus.run('descend');
    bus.run('teleport 1 2');
    expect(watcher).toHaveBeenCalledTimes(2);
    expect(watcher.mock.calls[0][1]).toEqual({ ok: true });
    expect(watcher.mock.calls[1][1].ok).toBe(false);
    stop();
    bus.run('descend');
    expect(watcher).toHaveBeenCalledTimes(2);
  });

  it('lists only the commands something here actually runs', () => {
    const bus = new CommandBus();
    expect(bus.names).toEqual([]);
    bus.define('descend', () => undefined);
    bus.define('teleport', () => undefined);
    // in the order the vocabulary is written, not the order they were defined
    expect(bus.names).toEqual(['teleport', 'descend']);
    expect(helpText(bus)).toContain('teleport <place or x> [z] —');
    expect(helpText(bus, 'spawn')).toContain('spawn <kind> [away]');
    expect(helpText(bus, 'conjure')).toBe('no such command: conjure');
  });
});

describe('the vocabulary itself', () => {
  it('names every command after the key it is filed under', () => {
    for (const [key, known] of Object.entries(COMMANDS)) expect(known.name).toBe(key);
  });

  it('puts optional arguments last, so a line can be read left to right', () => {
    for (const known of Object.values(COMMANDS)) {
      const first = known.args.findIndex((a) => a.optional);
      if (first < 0) continue;
      expect(known.args.slice(first).every((a) => a.optional), `${known.name}`).toBe(true);
    }
  });

  it('gives every command a line of help that says what it does', () => {
    for (const known of Object.values(COMMANDS)) {
      expect(known.help.length, `${known.name}`).toBeGreaterThan(10);
    }
  });
});
