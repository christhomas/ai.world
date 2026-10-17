import { describe, expect, it } from 'vitest';
import { composeGame } from '../game/compose';
import { savedInMemory } from '../save/memory';
import { systemClock } from '../../server/host-clock';
import { Forgetful } from '../../server/vault';
import { LocalWorldHost } from '../workers/local-world-host';
import { headlessGame } from '../platform/headless-game';
import type { Parcel } from '../net/link-contract';
import type { ParcelEvent } from '../../shared/mobile/host-contract';
import { ParcelLink } from './parcel-link';

type Asked = { link?: { connect?: string; close?: number; generation?: number }; outbox?: Array<{ text?: string; binary?: string }> };
const events = () => {
  const heard: Array<string | number[]> = [];
  const said: string[] = [];
  return {
    heard, said,
    events: {
      onOpen: () => said.push('open'),
      onMessage: (parcel: Parcel) => heard.push(typeof parcel === 'string' ? parcel : [...new Uint8Array(parcel)]),
      onClose: (why: string) => said.push(`close: ${why}`),
    },
  };
};
const open = (generation: number): ParcelEvent => ({ generation, event: 'open', text: null, binary: null, why: null });
const text = (generation: number, said: string): ParcelEvent => ({ generation, event: 'message', text: said, binary: null, why: null });
const bytes = (generation: number, sent: number[]): ParcelEvent =>
  ({ generation, event: 'message', text: null, binary: Buffer.from(sent).toString('base64'), why: null });

describe('a shared world through the app\'s socket', () => {
  it('asks the app to connect, sends through it, and hears back, binary parcels and all', () => {
    const parcels = new ParcelLink();
    const one = events();
    expect(parcels.connect('', one.events), 'the world in this engine is not reached through the app').toBeNull();
    const link = parcels.connect('wss://shared.example', one.events)!;
    expect(parcels.take()).toEqual({ link: { connect: 'wss://shared.example', generation: 1 } });
    expect(link.ready).toBe(false);
    parcels.deliver(open(1));
    expect(link.ready).toBe(true);
    expect(one.said).toEqual(['open']);
    for (const sent of [[], [7], [0, 1], [0, 1, 2, 255], [250, 251, 252, 253, 254]]) {
      link.send(new Uint8Array(sent).buffer);
      const { outbox } = parcels.take() as Asked;
      expect(Buffer.from(outbox![0].binary!, 'base64'), `${sent}`).toEqual(Buffer.from(sent));
      parcels.deliver(bytes(1, sent));
      expect(one.heard.at(-1), `${sent}`).toEqual(sent);
    }
    link.send('{"t":"hello"}');
    expect(parcels.take()).toEqual({ outbox: [{ text: '{"t":"hello"}' }] });
    parcels.deliver(text(1, '{"t":"welcome"}'));
    expect(one.heard.at(-1)).toBe('{"t":"welcome"}');
    parcels.deliver({ generation: 1, event: 'close', text: null, binary: null, why: 'server went away' });
    expect(one.said.at(-1)).toBe('close: server went away');
    expect(link.ready).toBe(false);
  });

  it('lets no socket the game has replaced or closed speak for the one after it', () => {
    const parcels = new ParcelLink();
    const first = events(), second = events();
    const old = parcels.connect('wss://one.example', first.events)!;
    old.send('queued before the change');
    const now = parcels.connect('wss://two.example', second.events)!;
    expect(parcels.take(), 'what the first had not sent goes with it').toEqual({ link: { connect: 'wss://two.example', generation: 2 } });
    parcels.deliver(open(1));
    parcels.deliver(text(1, 'late'));
    old.send('from a link the game has left');
    expect(first.said).toEqual([]);
    expect(second.heard).toEqual([]);
    expect(parcels.take()).toEqual({});
    parcels.deliver(open(2));
    now.close();
    expect(parcels.take()).toEqual({ link: { close: 2 } });
    parcels.deliver(text(2, 'after the game closed it'));
    expect(second.heard).toEqual([]);
  });

  it('joins a world through the app, as the page joins a server', async () => {
    const parcels = new ParcelLink();
    const toServer: Parcel[] = [];
    const fromServer: Parcel[] = [];
    // the same world a server runs, standing where the server would be, behind the app's socket
    const server = new LocalWorldHost({ vault: new Forgetful(), clock: systemClock, post: (parcel) => fromServer.push(parcel), closed: () => {} });
    const game = headlessGame({ viewport: { width: 1200, height: 540 }, clock: systemClock, now: () => performance.now(),
      random: Math.random, server: { url: 'wss://shared.example', link: parcels.connect } });
    const opened = composeGame({ store: savedInMemory(), slotKey: 'shared', saved: undefined, seed: 3, worldName: undefined, world: 'road' },
      game.platform);
    let generation = 0;
    try {
      const { online } = game.handles();
      for (let step = 0; step < 600 && !online.connected; step++) {
        game.frame(1000 / 30);
        await new Promise<void>((resume) => setTimeout(resume, 4));
        // what the app does with a reply: open the socket it is asked for, send what is in the outbox
        const asked = parcels.take() as Asked;
        if (asked.link?.connect) {
          expect(asked.link.connect).toBe('wss://shared.example');
          generation = asked.link.generation!;
          parcels.deliver(open(generation));
        }
        for (const parcel of asked.outbox ?? []) toServer.push(parcel.text ?? Uint8Array.from(Buffer.from(parcel.binary!, 'base64')).buffer);
        for (const parcel of toServer.splice(0)) server.receive(parcel);
        // and with what its socket hears: hand it back as a parcel request
        for (const parcel of fromServer.splice(0)) {
          if (typeof parcel === 'string') parcels.deliver(text(generation, parcel));
          else parcels.deliver(bytes(generation, [...new Uint8Array(parcel)]));
        }
      }
      expect(online.connected, `joined through the app: ${online.status}`).toBe(true);
      expect(online.away, 'a shared world, not the one in this engine').toBe(true);
    } finally {
      opened.dispose();
      server.dispose();
    }
  });
});
