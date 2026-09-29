interface Disposable { dispose(): void }

interface GameLifetime {
  stop(): void;
  controls: Disposable[];
  disconnect(): void;
  clear(): void;
  resources: Disposable[];
}

/** Put the running world away before returning to the title screen. */
export function shutDownGame({ stop, controls, disconnect, clear, resources }: GameLifetime): void {
  stop();
  for (const control of controls) control.dispose();
  disconnect();
  clear();
  for (const resource of resources) resource.dispose();
}

/** Return to a clean title page after all of this world's resources have been released. */
export function returnToTitle(persist: () => void, shutDown: () => void): void {
  persist();
  shutDown();
  window.setTimeout(() => { window.location.href = window.location.pathname; }, 150);
}

/** Stand down workers and audio while the page is hidden. */
export function suspendWhenHidden(
  loop: { stop(): void; start(): void },
  chunks: { pause(): void; resume(): void },
  sound: { quiet(hidden: boolean): void },
  online: { quiet(hidden: boolean): void },
): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { loop.stop(); chunks.pause(); sound.quiet(true); online.quiet(true); }
    else { chunks.resume(); sound.quiet(false); loop.start(); online.quiet(false); }
  });
}
