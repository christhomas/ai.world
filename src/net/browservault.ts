import type { Vault } from '../../server/vault';

/**
 * Where a world is kept when the server is a thread in somebody's browser.
 *
 * `localStorage` rather than IndexedDB, and that is a considered choice rather than a shortcut: a
 * world file is a few kilobytes of JSON, the vault is synchronous by design, and IndexedDB is not.
 * Making the vault asynchronous to use a store nothing here needs would spread promises through the
 * clock, the market and the post shelf to buy storage nobody is running out of.
 *
 * A Worker can reach `localStorage` in every browser this game runs in. Where it cannot — a very
 * old one, or a page with site data blocked — the world simply lasts as long as the tab, which is
 * what a world kept nowhere always did.
 */
export class BrowserVault implements Vault {
  read(name: string): string | null {
    try {
      return self.localStorage?.getItem(`ai.world/${name}`) ?? null;
    } catch {
      return null;
    }
  }

  write(name: string, text: string): void {
    try {
      self.localStorage?.setItem(`ai.world/${name}`, text);
    } catch {
      // out of room, or a browser that will not keep anything: the world lasts as long as the tab,
      // and saying so in a log nobody reads would not make it last longer
    }
  }
}
