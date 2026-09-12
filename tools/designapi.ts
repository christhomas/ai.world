import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * Claude Design, over its own API.
 *
 * Claude Design is reachable at `https://api.anthropic.com/v1/design/mcp`. It speaks MCP over
 * HTTP — JSON-RPC in, JSON or an event stream back — and it takes an ordinary Anthropic API key in
 * the `x-api-key` header. That last part was worth finding out rather than assuming: probed with a
 * deliberately bad key it answers `{"type":"error","error":{"type":"authentication_error",...}}`,
 * which is the platform's own error shape and means the platform's own credential opens it. Probed
 * with a bad bearer token it answers a bare `unauthorized`, which is the OAuth door the Claude Code
 * MCP client goes through. Two doors, and this takes the one a script can hold a key to.
 *
 * ## Why this exists beside `design.ts`
 *
 * `tools/design.ts` reads the canvas that is *in this repository* and checks it against the game.
 * This one reaches the designs that are not: a project on claude.ai that somebody is working in
 * right now. Neither replaces the other — one is a diff against the code, the other is a way to get
 * the drawing in the first place.
 *
 * ## What it deliberately does not do
 *
 * It does not guess. The whole interface is discovered: `tools/list` says what the service offers
 * and `chore design-api tools` prints it, so what this file knows about Claude Design is the name
 * of one URL and the shape of MCP. When the service grows a tool, this finds it without being
 * edited.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/design/mcp';
const PROTOCOL = '2025-06-18';

/**
 * Where a key is looked for, in order.
 *
 * The environment first, because that is what a CI job sets. Then a file in the home directory,
 * because that is what a person does once and forgets — and because a key pasted into a terminal
 * ends up in a shell history, in a transcript, and in whatever else was listening.
 */
const KEY_FILE = join(homedir(), '.config', 'anthropic', 'design-key');

function key(): string {
  const fromEnv = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_DESIGN_KEY;
  if (fromEnv) return fromEnv.trim();
  if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, 'utf8').trim();
  throw new Error(
    `no API key. Either export ANTHROPIC_API_KEY, or put one in ${KEY_FILE}:\n`
    + `  mkdir -p ${dirname(KEY_FILE)} && printf %s "sk-ant-..." > ${KEY_FILE} && chmod 600 ${KEY_FILE}`,
  );
}

/** One JSON-RPC call, and whatever came back. */
interface Rpc { jsonrpc: '2.0'; id?: number; method: string; params?: unknown }

/**
 * A conversation with the service.
 *
 * MCP over HTTP is a session: `initialize` hands back a session id in a header, and everything
 * after it carries that id. The reply may be JSON or an event stream depending on the call, so both
 * are read — an event stream here is one `data:` line rather than a long-running feed.
 */
export class DesignApi {
  private session: string | null = null;
  private next = 1;

  constructor(private readonly endpoint = ENDPOINT, private readonly apiKey = key()) {}

  /** Open the session. Must be first; everything else carries the id it hands back. */
  async open(): Promise<{ name?: string; version?: string }> {
    const { body, session } = await this.send({
      jsonrpc: '2.0', id: this.next++, method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'ai.world', version: '1' } },
    });
    this.session = session ?? this.session;
    // the handshake is not finished until the client says so, and a server may refuse work until it does
    await this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return (body?.result as { serverInfo?: { name?: string; version?: string } })?.serverInfo ?? {};
  }

  /** What the service can do, as it describes itself. Nothing here is written down in advance. */
  async tools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const { body } = await this.send({ jsonrpc: '2.0', id: this.next++, method: 'tools/list' });
    return (body?.result as { tools?: Array<{ name: string }> })?.tools ?? [];
  }

  /** Call one of them. The arguments are the service's business, not this file's. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const { body } = await this.send({
      jsonrpc: '2.0', id: this.next++, method: 'tools/call', params: { name, arguments: args },
    });
    if (body?.error) throw new Error(`${name}: ${JSON.stringify(body.error)}`);
    return body?.result;
  }

  private async send(rpc: Rpc): Promise<{ body: { result?: unknown; error?: unknown } | null; session: string | null }> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
    if (this.session) headers['mcp-session-id'] = this.session;
    const reply = await fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(rpc) });
    const session = reply.headers.get('mcp-session-id');
    const text = await reply.text();
    if (!reply.ok && !text.trim()) throw new Error(`${reply.status} ${reply.statusText}`);
    return { body: parse(text), session };
  }
}

/**
 * The reply, whichever of the two shapes it came in.
 *
 * A server may answer a single call with `application/json` or with one `data:` line of
 * `text/event-stream`, and which it picks is its business rather than ours. Reading both is three
 * lines; insisting on one is a client that works until the day it does not.
 */
export function parse(text: string): { result?: unknown; error?: unknown } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('data:')) return JSON.parse(line.slice(5).trim());
  }
  return null;
}

/** Pull whatever text a tool answered with out of the MCP content envelope. */
export function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
  return content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n');
}

// --- the command line ------------------------------------------------------------------------

async function main(): Promise<void> {
  const [what = 'tools', ...rest] = process.argv.slice(2);

  if (what === 'key') {
    // read from stdin rather than from an argument: an argument is in the shell history for ever
    const typed = readFileSync(0, 'utf8').trim();
    if (!typed) throw new Error('nothing on stdin. Try: printf %s "sk-ant-..." | chore design-api key');
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, typed, { mode: 0o600 });
    console.log(`kept in ${KEY_FILE}, readable by you alone`);
    return;
  }

  const api = new DesignApi();
  const server = await api.open();
  if (what === 'tools') {
    const tools = await api.tools();
    console.log(`${server.name ?? 'claude design'} ${server.version ?? ''} — ${tools.length} tools`);
    for (const tool of tools) {
      console.log(`\n  ${tool.name}`);
      const said = (tool.description ?? '').split('\n')[0];
      if (said) console.log(`    ${said.slice(0, 160)}`);
      const props = (tool.inputSchema as { properties?: Record<string, unknown> })?.properties;
      if (props) console.log(`    takes: ${Object.keys(props).join(', ')}`);
    }
    return;
  }

  if (what === 'call') {
    const [name, ...pairs] = rest;
    if (!name) throw new Error('usage: chore design-api call <tool> [key=value ...]');
    const args: Record<string, unknown> = {};
    for (const pair of pairs) {
      const at = pair.indexOf('=');
      if (at < 0) continue;
      const value = pair.slice(at + 1);
      args[pair.slice(0, at)] = value === 'true' ? true : value === 'false' ? false
        : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    }
    const said = textOf(await api.call(name, args));
    console.log(said || '(nothing said)');
    return;
  }

  console.log('usage: chore design-api [tools | call <tool> [key=value ...] | key]');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
