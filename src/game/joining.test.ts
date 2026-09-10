import { describe, expect, it } from 'vitest';
import { inviteTo } from './joining';

/**
 * "Come and play in mine", as a link.
 *
 * The whole of what an invite has to get right is that following it lands somebody in the same
 * world on the same server — and that it does not carry across anything about the sender that a
 * guest should not inherit, which is where a link like this usually goes wrong.
 */
describe('an invite link', () => {
  it('carries the world and the server, and nothing else from the sender', () => {
    const href = inviteTo('https://example.com/ai.world/?seed=3&x=240&z=-118#somewhere', 7, 'wss://example.com:10081');
    const url = new URL(href);
    expect(url.searchParams.get('seed'), 'a guest would land in a different world').toBe('7');
    expect(url.searchParams.get('server')).toBe('wss://example.com:10081');
    // where the sender happens to be standing is not part of the invitation
    expect(url.searchParams.get('x')).toBe(null);
    expect(url.searchParams.get('z')).toBe(null);
    expect(url.hash).toBe('');
    expect(url.pathname, 'the page it points at moved').toBe('/ai.world/');
  });

  it('leaves the server out when there is none, which is the link to a world played alone', () => {
    const url = new URL(inviteTo('http://localhost:5173/?seed=1', 1, ''));
    expect(url.searchParams.get('server'), 'invited somebody to a server that does not exist').toBe(null);
    expect(url.searchParams.get('seed')).toBe('1');
  });

  it('hands out the address as written, localhost and all', () => {
    // A browser cannot see the address its machine has on the network, so there is nothing here
    // that could turn `localhost` into something a friend could reach. What it can do is be plain
    // about it — which is why the link is on the screen and not only on the clipboard.
    const url = new URL(inviteTo('http://localhost:5173/', 4, 'ws://localhost:8787'));
    expect(url.searchParams.get('server')).toBe('ws://localhost:8787');
  });
});
