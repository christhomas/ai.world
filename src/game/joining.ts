import type { WorldKind } from '../save/store';
import type { Anchor } from '../world/manifest';
import { $ } from '../ui/dom';
import type { Online } from './online';
import type { GameState } from './state';

/** The world server's own port, which `chore world` also uses. */
const WORLD_PORT = 8787;

/**
 * Where to look for a world server, in the order somebody would expect: the address in the link,
 * then the one they used last, then the machine that served the page. Nobody should have to type
 * an address to play with the person sitting next to them.
 */
export function defaultServer(url: URL): string {
  const given = url.searchParams.get('server');
  if (given) return given;
  const remembered = localStorage.getItem('ai.world/server');
  if (remembered) return remembered;

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname || 'localhost';
  const servedPort = window.location.port;
  // A world server can hand out the game itself, and when it does, it is on the port the page
  // came from — the whole point of running one box at home. In development the page comes from
  // vite on another port, and the server is wherever it always is.
  const sameOrigin = !import.meta.env.DEV && servedPort !== '';
  return sameOrigin ? `${scheme}://${host}:${servedPort}` : `${scheme}://${host}:${WORLD_PORT}`;
}

/**
 * Whose world you are playing in.
 *
 * There is always one. The game is played against a simulation from the moment it starts — the
 * one in the next thread if nobody has asked for another — and the only question the options
 * panel ever asks is whose. That is what stops single player from being a second implementation
 * of everything; see `docs/server-authority.md`.
 */
export interface Joining {
  seed: number;
  /** Which country this seed grew here, so the server grows the same one. */
  world: WorldKind;
  /**
   * And where its islands hang, for the same reason and with a wrinkle of its own.
   *
   * The kind is a choice somebody made when the world was new. These are planned from the seed for
   * any world made today, but a world saved before that code existed keeps its own in its manifest
   * — so the seed is not enough to say where they are, and a server left to work it out would grow
   * a different country for such a save. See `growWorld`.
   */
  islands: readonly Anchor[];
  /**
   * Where the hero is standing at the moment of joining.
   *
   * Asked for as a function rather than a pair of numbers because joining happens twice — once at
   * boot and again whenever somebody types an address — and by the second time the hero has walked.
   * What the world does with it is have that country grown before it is asked for it.
   */
  where: () => { x: number; z: number };
  state: GameState;
  online: Online;
  /** The address bar's own copy of the link, which an invite is built back out of. */
  url: URL;
  /** Leaving a server drops everybody it had drawn for us. */
  forgetOthers: () => void;
  /** The console belongs to a shared world, so it comes and goes with one. */
  showChat: () => void;
  hideChat: () => void;
  flash: (message: string) => void;
}

/**
 * The link that puts somebody else in this world, on this server.
 *
 * A pure function of the three things it is made of, so it can be checked without a browser: where
 * the page is served from, which seed, and which world server. Everything else is stripped —
 * `?x=`/`?z=` say where the *sender* happens to be standing, and following an invite should not
 * put a guest in your shoes.
 *
 * The address is passed through as written rather than resolved: a page reached at
 * `example.com:10081` hands out that host, and a page reached at `localhost` hands out localhost,
 * which is right for a second window on the same machine and useless to anybody else. There is
 * nothing here that could know better — a browser cannot see the address a machine has on its own
 * network — so what this can do is be plain about what it produced, which is why the link is now
 * on the screen rather than only on the clipboard.
 */
export function inviteTo(here: string, seed: number, address: string): string {
  const invite = new URL(here);
  invite.search = '';                       // drop wherever the sender happens to be standing
  invite.hash = '';
  invite.searchParams.set('seed', String(seed));
  if (address) invite.searchParams.set('server', address);
  return invite.href;
}

export function joinAWorld(ctx: Joining): void {
  const { seed, world, islands, where, state, online, url, forgetOthers, showChat, hideChat, flash } = ctx;
  /** The rest of what a world has to be told at the door: which country, and which acre of it. */
  const here = () => ({ at: where(), islands });

  const serverInput = $('serverInput') as HTMLInputElement;
  const nameInput = $('nameInput') as HTMLInputElement;
  nameInput.value = localStorage.getItem('ai.world/name') ?? '';
  serverInput.value = defaultServer(url);

  /**
   * Play alone, against the world in the next thread.
   *
   * The simulation runs in a Web Worker beside the page: the same clock, the same market, the same
   * post shelf and the same code a shared world runs, with one player in it. Started at boot rather
   * than waiting for somebody to press connect, because a game whose world only exists once you ask
   * for it is a game with two ways of working — which is the whole thing this is here to stop.
   *
   * Joining a real server disconnects this first, and leaving one comes back to it.
   */
  const playAlone = (): void => {
    if (online.connected || online.status === 'connecting') return;
    online.connect('', seed, nameInput.value || 'Traveller', { day: state.day, time: state.time }, world, here());
  };
  playAlone();

  $('connectButton').addEventListener('click', () => {
    /*
     * Leaving a server goes back to the world in this tab rather than to no world at all: the game
     * is always played against a simulation now, and the only question is whose.
     *
     * `away` rather than `connected`, and that one word was the whole of multiplayer being broken.
     * A page is connected from the moment it opens — to the world in its own worker — so a button
     * that asked "are we connected?" always answered yes, always took this branch, and never once
     * used the address beside it.
     */
    if (online.away) { online.disconnect(); forgetOthers(); hideChat(); playAlone(); return; }
    // An empty address is the world in the next thread: the same simulation the server runs, in a
    // Web Worker beside the page. Playing alone is playing against the server, which is what stops
    // single player being a second implementation. See docs/server-authority.md.
    const address = serverInput.value.trim();
    localStorage.setItem('ai.world/name', nameInput.value);
    localStorage.setItem('ai.world/server', address);
    online.connect(address, seed, nameInput.value || 'Traveller', { day: state.day, time: state.time }, world, here());
    showChat();
  });

  /**
   * An invite is this world and this server in one link, because "come and play in mine" should
   * not mean reading a seed and an address down the phone. The page already reads both back out
   * of the query string on arrival, so whoever opens it lands in the same world on the same
   * server without touching the options at all.
   */
  const linkBox = $('inviteLink') as HTMLInputElement;
  // clicking the link selects the whole of it, because the reason it is on the screen at all is
  // for the times the clipboard is not available
  linkBox.addEventListener('focus', () => linkBox.select());
  linkBox.addEventListener('click', () => linkBox.select());

  $('inviteButton').addEventListener('click', () => {
    const href = inviteTo(window.location.href, seed, serverInput.value.trim());
    /*
     * Shown as well as copied.
     *
     * "Invite link copied" is a claim about somewhere the player cannot look. Browsers refuse the
     * clipboard for all sorts of reasons — a page that has not been clicked recently enough, a
     * permission never granted, an origin they do not trust — and when they do, the only thing that
     * had happened was a message saying the opposite. The field is the link itself: selectable,
     * readable, and answering the first question anybody asks of an invite, which is what is in it.
     */
    linkBox.value = href;
    linkBox.hidden = false;
    // a page served over https cannot open a plain ws:// socket, so an invite carrying one is a
    // dead link for everybody who follows it from the published site
    const blocked = window.location.protocol === 'https:' && href.includes('server=ws%3A%2F%2F');
    void navigator.clipboard.writeText(href)
      .then(() => flash(blocked ? 'Link copied, but a ws:// address will not open from an https page — use wss://' : 'Invite link copied'))
      .catch(() => { linkBox.select(); flash('Here is the link — copy it from the box'); });
  });
}
