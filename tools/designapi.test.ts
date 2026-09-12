import { describe, expect, it } from 'vitest';
import { parse, textOf } from './designapi';

/**
 * Talking to Claude Design.
 *
 * The service speaks MCP over HTTP at `api.anthropic.com/v1/design/mcp` and takes an ordinary
 * Anthropic API key — which was worth finding out rather than assuming. Probed with a deliberately
 * bad key it answers the platform's own error shape; probed with a bad bearer token it answers a
 * bare `unauthorized`. Two doors, and a script can hold a key to the first.
 *
 * What is tested here is the half that does not need the network: reading a reply. A server may
 * answer one call with `application/json` or with a single `data:` line of `text/event-stream`, and
 * which it picks is its business — a client that insists on one of the two works until the day it
 * does not.
 */

describe('reading what the service said', () => {
  it('takes a plain JSON reply', () => {
    expect(parse('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}')).toEqual({
      jsonrpc: '2.0', id: 1, result: { tools: [] },
    });
  });

  it('takes an event stream, which is the same reply with a label on it', () => {
    const stream = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
    expect((parse(stream) as { result: { ok: boolean } }).result.ok).toBe(true);
  });

  it('says nothing rather than throwing when a reply is empty', () => {
    // a notification is answered with no body at all, which is not a failure
    expect(parse('')).toBeNull();
    expect(parse('   \n')).toBeNull();
  });

  it('hands back nothing for a stream with no data line in it', () => {
    expect(parse('event: ping\n\n')).toBeNull();
  });
});

describe('what a tool answered', () => {
  it('is the text out of the envelope, in order', () => {
    const said = textOf({ content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] });
    expect(said).toBe('one\ntwo');
  });

  it('ignores the parts that are not text, because a terminal cannot show them', () => {
    const said = textOf({ content: [{ type: 'image' }, { type: 'text', text: 'a name' }] });
    expect(said).toBe('a name');
  });

  it('is empty for a tool that answered with nothing at all', () => {
    expect(textOf({})).toBe('');
    expect(textOf(null)).toBe('');
  });
});
