/**
 * A screenshot begins with the renderer's first frame, before streamed country has been meshed.
 * Daily news reads the village register once and remembers what it said. Letting that first frame
 * choose the news makes worker completion order choose which village is visible in the reference.
 * The capture harness opens this gate after the authoritative ground has settled.
 */
export function captureTidings<T extends { theDaysNews: () => void }>(tidings: T): T {
  const clock = (window as Window & { __shotClock?: { newsReady: boolean } }).__shotClock;
  if (!clock) return tidings;
  return { ...tidings, theDaysNews: () => { if (clock.newsReady) tidings.theDaysNews(); } };
}
