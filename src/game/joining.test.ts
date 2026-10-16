import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultServer, inviteTo } from './joining';

describe('joining the server that serves the deployed game', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
    vi.stubGlobal('window', { location: new URL('https://aiworld.antimatter-studios.com/') });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('uses the public HTTPS endpoint rather than an unreachable internal port', () => {
    expect(defaultServer(new URL('https://aiworld.antimatter-studios.com/')))
      .toBe('wss://aiworld.antimatter-studios.com');
  });

  it('uses default HTTP and explicitly served ports on the same origin', () => {
    expect(defaultServer(new URL('http://aiworld.homelab.local/'))).toBe('ws://aiworld.homelab.local');
    expect(defaultServer(new URL('https://world.example:9443/'))).toBe('wss://world.example:9443');
    expect(defaultServer(new URL('http://[::1]:8787/'))).toBe('ws://[::1]:8787');
  });

  it('keeps development and file-hosted games pointed at the world server port', () => {
    vi.stubEnv('DEV', true);
    expect(defaultServer(new URL('http://localhost:5174/'))).toBe('ws://localhost:8787');
    vi.stubEnv('DEV', false);
    expect(defaultServer(new URL('file:///game/index.html'))).toBe('ws://localhost:8787');
  });

  it('preserves a remembered server and gives an explicit invite address precedence', () => {
    vi.mocked(localStorage.getItem).mockReturnValue('wss://other.example:10081');
    expect(defaultServer(new URL('https://aiworld.antimatter-studios.com/'))).toBe('wss://other.example:10081');
    expect(defaultServer(new URL('https://aiworld.antimatter-studios.com/?server=wss%3A%2F%2Finvited.example')))
      .toBe('wss://invited.example');
  });
});

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
  it('uses the name as the whole remote invite and leaves the seed underneath', () => {
    const url = new URL(inviteTo(
      'https://example.com/ai.world/?seed=3&x=240&z=-118',
      7,
      'wss://example.com:10081',
      'Chris',
    ));
    expect(url.searchParams.get('world')).toBe('Chris');
    expect(url.searchParams.get('seed')).toBe(null);
    expect(url.searchParams.get('server')).toBe('wss://example.com:10081');
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
