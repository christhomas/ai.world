import { describe, expect, it } from 'vitest';
import { mayAsk } from './askclaude';

/**
 * Who may run `claude` through the character builder's door.
 *
 * The only thing worth testing in that file, and the thing most worth getting right: what is on the
 * other side of the route is the owner's own shell permissions in their own repository. Loopback
 * was too narrow to be usable — the game is reached through a gateway on another box on this
 * network, so the builder refused the owner of the machine it was running on — and "anything
 * private" would be too wide, because a private address is what every device on a café's wifi has.
 * An address the owner names on the command line is the line between the two.
 */
describe('who may ask Claude', () => {
  const nobody = new Set<string>();

  it('lets this machine in, whichever way it spells itself', () => {
    for (const home of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(mayAsk(home, nobody), `${home} is this machine`).toBe(true);
    }
  });

  it('turns away anybody else, when nobody has been invited', () => {
    for (const other of ['192.168.1.20', '10.0.0.4', '203.0.113.7', '::ffff:192.168.1.20', '']) {
      expect(mayAsk(other, nobody), `${other} walked in`).toBe(false);
    }
  });

  it('lets in exactly who was named, in either spelling', () => {
    const invited = new Set(['192.168.1.20']);
    expect(mayAsk('192.168.1.20', invited)).toBe(true);
    // what node reports for that same caller when it arrives on a dual-stack listener
    expect(mayAsk('::ffff:192.168.1.20', invited)).toBe(true);
    expect(mayAsk('192.168.1.21', invited), 'the machine next door came too').toBe(false);
  });

  it('is not fooled by an address that merely ends the right way', () => {
    const invited = new Set(['192.168.1.20']);
    expect(mayAsk('10.9.192.168.1.20', invited)).toBe(false);
    expect(mayAsk('::ffff:10.0.0.1', invited)).toBe(false);
  });
});
