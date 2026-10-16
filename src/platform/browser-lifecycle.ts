import type { PrayerHost } from '../game/interact/context';

/** The web host keeps the existing saved roll and page-reload behavior. */
export function createPrayerHost(isLive: () => boolean): PrayerHost {
  return {
    isLive,
    randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0],
    restart: () => window.location.reload(),
  };
}

/** Browser navigation belongs to the page adapter, not to the portable game lifetime. */
export function returnToTitle(persist: () => void, shutDown: () => void): void {
  try { persist(); }
  finally {
    try { shutDown(); }
    finally { window.setTimeout(() => { window.location.href = window.location.pathname; }, 150); }
  }
}

/** Observe immediately as well as on changes; the returned owner must be released with the game. */
export function observeVisibility(activity: (active: boolean) => void): () => void {
  const changed = (): void => activity(!document.hidden);
  document.addEventListener('visibilitychange', changed);
  const unsubscribe = (): void => document.removeEventListener('visibilitychange', changed);
  try { changed(); }
  catch (error) { unsubscribe(); throw error; }
  return unsubscribe;
}
