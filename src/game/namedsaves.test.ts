import { describe, expect, it } from 'vitest';
import { claimed, serverOf } from './joining';


/**
 * A name is only unique on the server that issued it.
 *
 * Two people can each run a world called Ashford. A browser save keyed on the name alone hands the
 * second one the first one's progress, and the country underneath it is a different country — so
 * the hero walks out of a house that is not there, in a village nobody named.
 */
describe('which server a link points at', () => {
  const link = (server: string): URL =>
    new URL(`https://play.example/?world=Ashford&server=${encodeURIComponent(server)}`);

  it('is the server, not the path it was written with', () => {
    expect(serverOf(link('wss://box.example/play'))).toBe(serverOf(link('wss://box.example/')));
  });

  it('reads a websocket address as the site it is', () => {
    expect(serverOf(link('wss://box.example'))).toBe('https://box.example');
    expect(serverOf(link('ws://box.example:8787'))).toBe('http://box.example:8787');
  });

  it('tells two servers apart, which is the whole point', () => {
    expect(serverOf(link('wss://mine.example'))).not.toBe(serverOf(link('wss://yours.example')));
  });

  it('does not care how somebody typed the host', () => {
    expect(serverOf(link('wss://BOX.example'))).toBe(serverOf(link('wss://box.example')));
  });

  it('keeps a port apart from no port, because they are two servers', () => {
    expect(serverOf(link('wss://box.example:9000'))).not.toBe(serverOf(link('wss://box.example')));
  });

  it('has an answer for a link with no server on it at all', () => {
    expect(serverOf(new URL('https://play.example/?world=Ashford'))).toBe('here');
  });

  it('does not throw on something that is not an address', () => {
    expect(() => serverOf(link('not a url'))).not.toThrow();
  });
});

/**
 * And the race a recipient used to lose.
 *
 * Publishing a named link also claims the name, and the claim is a round trip. The link was shown
 * and copied in the same breath as the connect that claims it, so a recipient quick enough asked
 * the server for a name it did not have yet and was told the world was not there — while the sender
 * saw nothing wrong at all.
 */
describe('waiting for the name to be claimed', () => {
  const instantly = async (): Promise<void> => {};

  it('goes on as soon as it is claimed', async () => {
    expect(await claimed(() => true, instantly, 1000, 100)).toBe(true);
  });

  it('waits for a claim that takes a moment', async () => {
    let asked = 0;
    expect(await claimed(() => ++asked > 3, instantly, 1000, 100)).toBe(true);
    expect(asked, 'it kept asking rather than giving up on the first no').toBeGreaterThan(3);
  });

  /*
   * Bounded, because somebody is looking at a button they have just pressed, and a server that is
   * slow is indistinguishable from one that is not there.
   */
  it('gives up rather than waiting for ever', async () => {
    let asked = 0;
    expect(await claimed(() => { asked++; return false; }, instantly, 500, 100)).toBe(false);
    expect(asked, 'and it asked a bounded number of times').toBeLessThan(10);
  });

  it('asks once more at the end, so a claim landing on the deadline still counts', async () => {
    let asked = 0;
    expect(await claimed(() => ++asked >= 6, instantly, 500, 100)).toBe(true);
  });
});
