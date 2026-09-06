import { COMMANDS, formatCommand, parseCommand, type Command, type CommandArg } from '../../server/commands';

/**
 * The bus every command goes through.
 *
 * One place where a named thing to do is turned into the thing happening. What that is worth is not
 * the indirection — it is that there is now a seam: everything crossing it can be logged, replayed,
 * refused, or sent somewhere else entirely. The last of those is the point. When the simulation
 * moves to the server (`docs/server-authority.md`), this is where a command stops being run here
 * and starts being sent there, and nothing that issues one has to know that happened.
 *
 * It is deliberately dumb about what commands mean. The vocabulary lives in `server/commands.ts`
 * because both halves need it; what each command does is registered by whoever owns that part of
 * the game, next to the thing it acts on.
 */

/** What running a command produced: a value to report, or the reason it did not run. */
export type CommandResult =
  | { ok: true; value?: unknown }
  | { ok: false; error: string };

/** What a command actually does. Anything returned is reported back to whoever asked. */
export type CommandHandler = (args: CommandArg[], command: Command) => unknown;

/** Somebody watching what goes through, for a log, a replay, or a test. */
export type CommandWatcher = (command: Command, result: CommandResult) => void;

export class CommandBus {
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly watchers: CommandWatcher[] = [];

  /**
   * Say what a command does.
   *
   * The name has to be one the vocabulary knows. That refusal is on purpose: a handler registered
   * under a name nobody can parse is a command that exists and can never be issued, which is the
   * sort of thing that is only ever found by somebody wondering why nothing happens.
   */
  define(name: string, run: CommandHandler): void {
    if (!COMMANDS[name]) throw new Error(`no such command in the vocabulary: ${name}`);
    this.handlers.set(name, run);
  }

  /** Whether anything has said what this command does yet. */
  knows(name: string): boolean {
    return this.handlers.has(name);
  }

  /** Every command that can actually be run here, in the order they are written down. */
  get names(): string[] {
    return Object.keys(COMMANDS).filter((name) => this.handlers.has(name));
  }

  /** Watch everything that goes through. Returns the way to stop watching. */
  watch(watcher: CommandWatcher): () => void {
    this.watchers.push(watcher);
    return () => {
      const at = this.watchers.indexOf(watcher);
      if (at >= 0) this.watchers.splice(at, 1);
    };
  }

  /**
   * Run a command, given either the line somebody typed or a command already parsed.
   *
   * Never throws. A command comes from a console, a socket or a script, and every one of those is
   * better served by an answer saying what was wrong than by an exception thrown into whatever
   * happened to be calling — which, for the socket, is the frame loop.
   */
  run(input: string | Command, issuer?: string): CommandResult {
    const parsed = typeof input === 'string' ? parseCommand(input, issuer) : { ok: true as const, command: input };
    if (!parsed.ok) return this.reported({ name: 'unparsed', args: [] }, { ok: false, error: parsed.error });

    const command = parsed.command;
    const handler = this.handlers.get(command.name);
    if (!handler) {
      // known to the vocabulary but nothing here does it: true of a command this half of the game
      // does not own, which will be the ordinary case once the server runs most of them
      return this.reported(command, { ok: false, error: `nothing here runs ${command.name}` });
    }
    try {
      const value = handler(command.args, command);
      return this.reported(command, value === undefined ? { ok: true } : { ok: true, value });
    } catch (cause) {
      return this.reported(command, { ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  private reported(command: Command, result: CommandResult): CommandResult {
    for (const watcher of this.watchers) watcher(command, result);
    return result;
  }
}

/** The one-line description of every command that can be run here: what `help` answers with. */
export function helpText(bus: CommandBus, name?: string): string {
  if (name) {
    const known = COMMANDS[name];
    if (!known) return `no such command: ${name}`;
    const args = known.args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`)).join(' ');
    return `${[known.name, args].join(' ').trim()} — ${known.help}`;
  }
  return bus.names.map((each) => {
    const known = COMMANDS[each];
    const args = known.args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`)).join(' ');
    return `${[each, args].join(' ').trim()} — ${known.help}`;
  }).join('\n');
}

/**
 * What a command's answer looks like written out for a person.
 *
 * A command hands back the thing it found — a list of towns, a peak, a place — because that is what
 * a script or a tool wants. A player reading the console wants sentences. JSON is neither: it is
 * the structure with all the punctuation of the structure, and `[{"name":"Silverholm","away":240}]`
 * is a worse answer than "Silverholm — away 240, heading north-west" for exactly the reason that
 * it is the same information.
 *
 * Deliberately shallow. Anything nested is printed as JSON rather than walked, because a command
 * that answers with something deep is a command that should be answering with less.
 */
export function describeResult(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return value.split('\n');
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) {
    if (value.length === 0) return ['nothing'];
    return value.map((row) => describeRow(row));
  }
  return [describeRow(value)];
}

/** One row: its name first if it has one, then the rest as `key value` pairs. */
function describeRow(row: unknown): string {
  if (row === null || typeof row !== 'object') return String(row);
  const fields = Object.entries(row as Record<string, unknown>);
  const named = fields.find(([key]) => key === 'name');
  const rest = fields.filter(([key]) => key !== 'name');
  const said = rest
    .map(([key, at]) => `${key} ${typeof at === 'object' && at !== null ? JSON.stringify(at) : String(at)}`)
    .join(', ');
  return named ? `${String(named[1])}${said ? ` — ${said}` : ''}` : said;
}

export { formatCommand, parseCommand };
export type { Command, CommandArg };
