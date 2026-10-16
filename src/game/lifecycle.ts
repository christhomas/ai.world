interface Disposable { dispose(): void }

interface GameResources {
  stop(): void;
  controls: Disposable[];
  disconnect(): void;
  clear(): void;
  resources: Disposable[];
}

/** Put the running world away before returning to the title screen. */
export function shutDownGame({ stop, controls, disconnect, clear, resources }: GameResources): void {
  releaseAll([
    stop, ...controls.map((control) => () => control.dispose()), disconnect, clear,
    ...resources.map((resource) => () => resource.dispose()),
  ]);
}

interface SessionPorts {
  frame(dtSeconds: number, renderTimeSeconds: number): void;
  pause(): void;
  resume(): void;
  release(): void;
}

/** Own one running world's callbacks. Browser and installed hosts supply the same activity port. */
export class SessionLifetime {
  private active: boolean | null = null;
  private disposed = false;
  private readonly subscriptions = new Set<() => void>();

  constructor(private readonly ports: SessionPorts) {}

  /** Pending host operations must fence their continuations against this lifetime. */
  get isDisposed(): boolean { return this.disposed; }

  frame(dtSeconds: number, renderTimeSeconds: number): void {
    if (this.active === true && !this.disposed) this.ports.frame(dtSeconds, renderTimeSeconds);
  }

  setActive(active: boolean): void {
    if (this.disposed || active === this.active) return;
    if (active) {
      this.ports.resume();
      this.active = true;
    } else {
      this.active = false;
      this.ports.pause();
    }
  }

  /** A subscription arriving after disposal is released immediately, never attached to a new game. */
  own(unsubscribe: () => void): void {
    if (this.disposed) unsubscribe();
    else this.subscriptions.add(unsubscribe);
  }

  dispose(): void {
    if (this.disposed) return;
    // Fence first: an unsubscribe or port may synchronously deliver one last callback.
    this.disposed = true;
    this.active = false;
    const subscriptions = [...this.subscriptions];
    this.subscriptions.clear();
    releaseAll([...subscriptions, () => this.ports.release()]);
  }
}

function releaseAll(releases: ReadonlyArray<() => void>): void {
  const failures: unknown[] = [];
  for (const release of releases) {
    try { release(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Game cleanup failed');
}
