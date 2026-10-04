/** Timer ownership supplied by the process, worker, or installed runtime. */
export interface HostClock {
  now(): number;
  after(callback: () => void, milliseconds: number): () => void;
  every(callback: () => void, milliseconds: number): () => void;
  yield(): Promise<void>;
}

/** Browser workers and the server already provide these standard JavaScript timers. */
export const systemClock: HostClock = {
  now: () => Date.now(),
  after: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
  every: (callback, milliseconds) => {
    const timer = setInterval(callback, milliseconds);
    return () => clearInterval(timer);
  },
  yield: () => new Promise<void>((resume) => setTimeout(resume, 0)),
};
