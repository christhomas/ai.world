import { Simulation, type SimOptions } from '../../server/sim';
import type { Vault } from '../../server/vault';
import type { HostClock } from '../../server/host-clock';
import type { Parcel } from '../net/link-contract';
import { worldDoor } from '../workers/simdoor';

export interface LocalWorldPorts {
  vault: Vault;
  clock: HostClock;
  post(parcel: Parcel): void;
  closed(): void;
}

/** One private authority, driven by the same messages as a network server. */
export class LocalWorldHost {
  private live = true;
  private readonly tasks = new Set<() => void>();
  private readonly simulation: Simulation;
  private readonly player: ReturnType<Simulation['attach']>;
  private readonly door: (parcel: unknown) => void;

  constructor(private readonly ports: LocalWorldPorts,
    options: Pick<SimOptions, 'dataDir' | 'ground' | 'prepare' | 'prepareTimeout' | 'reach' | 'timeout'> = {},
    capturing = false) {
    const clock: HostClock = {
      now: () => ports.clock.now(), yield: () => ports.clock.yield(),
      after: (callback, milliseconds) => this.schedule(callback, milliseconds, false),
      every: (callback, milliseconds) => this.schedule(callback, milliseconds, true),
    };
    this.simulation = new Simulation({ dataDir: 'worlds', ground: true, ...options,
      localAuthoring: true, vault: ports.vault, clock });
    const host = this;
    this.player = this.simulation.attach({
      get open() { return host.live; },
      send: (parcel) => { if (this.live) ports.post(parcel); },
      close: () => this.dispose(),
    });
    this.door = worldDoor({
      start: () => this.simulation.start(),
      stop: () => this.simulation.stop(true),
      tick: (now) => this.simulation.tick(now),
    }, (text) => this.player.receive(text), capturing, (parcel) => { if (this.live) ports.post(parcel); });
    if (capturing) this.simulation.captureAt(0);
    else this.simulation.start();
  }

  get isDisposed(): boolean { return !this.live; }

  private schedule(callback: () => void, milliseconds: number, repeat: boolean): () => void {
    let active = true;
    const cancel = () => {
      if (!active) return;
      active = false;
      this.tasks.delete(cancel);
      release();
    };
    const invoke = () => {
      if (!active || !this.live) return;
      if (!repeat) { active = false; this.tasks.delete(cancel); }
      callback();
    };
    const release = repeat ? this.ports.clock.every(invoke, milliseconds) : this.ports.clock.after(invoke, milliseconds);
    this.tasks.add(cancel);
    return cancel;
  }

  receive(parcel: unknown): void {
    if (this.live) this.door(parcel);
  }

  /** Fence delivery first, flush and detach even if storage fails, then report every failure. */
  dispose(): void {
    if (!this.live) return;
    this.live = false;
    const failures: unknown[] = [];
    for (const release of [() => this.simulation.stop(true), () => this.player.leave(),
      ...this.tasks, () => this.ports.closed()]) {
      try { release(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Could not close the local world cleanly');
  }
}
