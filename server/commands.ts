/**
 * The vocabulary: every named thing that can happen in this world, and how one is written down.
 *
 * This lives beside `protocol.ts` and for the same reason — both halves of the game have to agree
 * about it. The client parses a command typed into a console, the server parses one posted to its
 * operator endpoint, and a tool of ours writes one into a terminal; if any of the three had its own
 * idea of what `spawn wolf 20` means, the day they disagreed would be a day spent finding out why.
 *
 * A command is the only way the world is meant to change. That is worth stating as an intention
 * rather than as a fact, because today most of the game still changes itself directly and only the
 * debug surface goes through here. The plan it is working towards is `docs/server-authority.md`:
 * the simulation moves to the server, commands are what cross the wire, and the game issues them to
 * itself — a villager deciding to walk somewhere issues one exactly as a player does. What that
 * buys is that anything able to issue a command can drive the game: a player, a villager's mind, a
 * test, a quest, or somebody at a terminal.
 */

/** What an argument can be once it has been read. Nothing else crosses the wire. */
export type CommandArg = string | number;

/** One thing to do, and what to do it to. */
export interface Command {
  name: string;
  args: CommandArg[];
  /**
   * Who asked, when anybody knows: `player:<id>`, `operator`, `dev`, or a part of the game itself.
   * Carried rather than checked here — what an issuer is allowed to do is the server's business,
   * and the vocabulary has no opinion about it.
   */
  issuer?: string;
}

/** One argument a command takes. */
export interface ArgSpec {
  name: string;
  kind: 'number' | 'text';
  /** Optional arguments come last, and a command may have several. */
  optional?: boolean;
}

/** What a command is called, what it takes, and what it is for. */
export interface CommandSpec {
  name: string;
  /** One line, in the imperative: it is printed as help and read by people in a hurry. */
  help: string;
  args: ArgSpec[];
  /**
   * True when running it only reports and changes nothing.
   *
   * The distinction earns its place at the operator endpoint, where asking a running world a
   * question is a very different act from reaching into it and moving somebody.
   */
  reads?: boolean;
}

const spec = (name: string, help: string, args: ArgSpec[] = [], reads = false): CommandSpec =>
  ({ name, help, args, reads });

const num = (name: string, optional = false): ArgSpec => ({ name, kind: 'number', optional });
const text = (name: string, optional = false): ArgSpec => ({ name, kind: 'text', optional });

/**
 * Every command the game knows, by name.
 *
 * Deliberately a flat list rather than a tree of subcommands. `enter-inn` and `enter-shrine` read
 * worse than `enter inn` on a page and considerably better in a log, in a replay and in the code
 * that has to route them, because a name is then one string and not a path.
 */
export const COMMANDS: Record<string, CommandSpec> = {
  // Where the hero is
  teleport: spec('teleport', 'Put the hero at a place on the map', [num('x'), num('z')]),
  descend: spec('descend', 'Go down the stairs of the place you are standing in'),
  'climb-out': spec('climb-out', 'Leave the underground for the surface'),
  'enter-shrine': spec('enter-shrine', 'Step into the nearest shrine'),
  'enter-inn': spec('enter-inn', 'Step into the nearest inn'),
  'stand-at-counter': spec('stand-at-counter', 'Stand where a shopkeeper will talk to you'),

  // What is in the world
  spawn: spec('spawn', 'Put a creature into the world near the hero', [text('kind'), num('away', true)]),
  sow: spec('sow', 'Plant the crop in hand on a tile', [num('x'), num('z')]),
  drop: spec('drop', 'Drop what the hero is carrying where they stand'),
  discover: spec('discover', 'Name a place, so it is on the map', [text('place')]),
  thin: spec('thin', 'Take a number of villagers out of a village', [text('village'), num('many')]),
  hire: spec('hire', 'Take on a number of hands', [num('many')]),

  // The clock
  time: spec('time', 'Set the time of day, as a fraction of one: 0.5 is noon', [num('fraction')]),
  day: spec('day', 'Set which day of the world it is', [num('day')]),

  // Asking rather than doing
  where: spec('where', 'Say where the hero is standing and what that place is called', [], true),
  peaks: spec('peaks', 'List the mountains of this world, tallest first', [], true),
  entities: spec('entities', 'List what is alive near the hero', [], true),
  help: spec('help', 'List the commands, or explain one', [text('command', true)], true),
};

/** A parsed command, or the reason it could not be. */
export type ParseResult =
  | { ok: true; command: Command }
  | { ok: false; error: string };

/**
 * Read a command from a line of text.
 *
 * Quotes hold a text argument together — `discover "The Long Water"` is one argument, not three —
 * and everything else is split on spaces. Numbers are converted here rather than by whoever runs
 * the command, so a handler is handed the thing it asked for and never a string that looks like a
 * number.
 */
export function parseCommand(line: string, issuer?: string): ParseResult {
  const words = splitWords(line);
  if (words === null) return { ok: false, error: 'unclosed quote' };
  if (words.length === 0) return { ok: false, error: 'nothing to run' };

  const [name, ...rest] = words;
  const known = COMMANDS[name];
  if (!known) return { ok: false, error: `no such command: ${name}` };

  const needed = known.args.filter((a) => !a.optional).length;
  if (rest.length < needed || rest.length > known.args.length) {
    return { ok: false, error: `${name} takes ${usage(known)}` };
  }

  const args: CommandArg[] = [];
  for (let i = 0; i < rest.length; i++) {
    const want = known.args[i];
    if (want.kind !== 'number') { args.push(rest[i]); continue; }
    const value = Number(rest[i]);
    if (!Number.isFinite(value)) return { ok: false, error: `${want.name} must be a number, not ${rest[i]}` };
    args.push(value);
  }
  return { ok: true, command: { name, args, issuer } };
}

/** How a command is written down: the reverse of parsing it, and what a log records. */
export function formatCommand(command: Command): string {
  const args = command.args.map((a) => (typeof a === 'number' || !/[\s"]/.test(a) ? String(a) : JSON.stringify(a)));
  return [command.name, ...args].join(' ');
}

/** What a command takes, for saying so when somebody gets it wrong. */
export function usage(known: CommandSpec): string {
  if (known.args.length === 0) return 'no arguments';
  return known.args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`)).join(' ');
}

/**
 * Split a line into words, keeping anything in double quotes together.
 *
 * Null rather than a throw when a quote is left open: this reads lines typed by people and posted
 * by tools, and a mistake in one is an answer to give back, not an exception to handle.
 */
function splitWords(line: string): string[] | null {
  const words: string[] = [];
  let word = '';
  let quoted = false;
  let has = false;
  for (const ch of line.trim()) {
    if (ch === '"') { quoted = !quoted; has = true; continue; }
    if (!quoted && /\s/.test(ch)) {
      if (has || word.length > 0) words.push(word);
      word = ''; has = false;
      continue;
    }
    word += ch;
  }
  if (quoted) return null;
  if (has || word.length > 0) words.push(word);
  return words;
}
