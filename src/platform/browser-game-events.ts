interface Events {
  isLive(): boolean;
  resize(): void;
  persist(): void;
  say(message: string): void;
}

/** Browser callbacks and delayed photo notices have the same owner as the world they concern. */
export function createBrowserGameEvents(ports: Events) {
  let disposed = false;
  const timers = new Set<number>();
  const live = (): boolean => !disposed && ports.isLive();
  const resize = (): void => { if (live()) ports.resize(); };
  const hidden = (): void => { if (live() && document.hidden) ports.persist(); };
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', hidden);
  return {
    isLive: live,
    afterPhotoSaved(name: string): void {
      if (!live()) return;
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (live()) ports.say(`Saved ${name}`);
      }, 50);
      timers.add(timer);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', hidden);
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    },
  };
}
