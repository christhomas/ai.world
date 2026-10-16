import type { ToolWorld } from './worlds';
import { LatestWorldReader } from './latest-reader';

interface ToolWorldAccess {
  worlds: ToolWorld[];
  selected(): string;
  select(key: string): void;
  survey(key: string, since: number): Promise<unknown>;
  preview(key: string, query: URLSearchParams): Promise<unknown>;
}
declare global {
  interface Window {
    toolsWorldsReady: Promise<ToolWorldAccess>;
    __toolsWorldsResolve(value: ToolWorldAccess): void;
    __toolsWorldsReject(error: Error): void;
  }
}

const picker = document.getElementById('tools-world') as HTMLSelectElement;
const status = document.getElementById('tools-world-status')!;
const reader = new LatestWorldReader(() => new Worker(new URL('./worlds.worker.ts', import.meta.url), { type: 'module' }));
const local = (action: string, fields: Record<string, unknown> = {}) => reader.request(action, fields);
window.addEventListener('pagehide', () => reader.close());
async function json(url: string): Promise<any> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Tools data could not be read (${response.status}). Sign in again if your session expired.`);
  return response.json();
}

async function open(): Promise<void> {
  const [served, kept] = await Promise.allSettled([json('/tools/registry/data?worlds=1'), local('list')]);
  const worlds: ToolWorld[] = [
    ...(served.status === 'fulfilled' ? served.value.worlds.map((row: Omit<ToolWorld, 'key' | 'source'>) =>
      ({ ...row, key: `server:${row.seed}`, source: 'server' as const })) : []),
    ...(kept.status === 'fulfilled' ? kept.value as ToolWorld[] : []),
  ];
  const errors = [served, kept].filter(result => result.status === 'rejected')
    .map(result => (result as PromiseRejectedResult).reason instanceof Error ? (result as PromiseRejectedResult).reason.message : 'World storage is unavailable.');
  picker.replaceChildren(new Option(worlds.length ? 'Choose a world…' : 'No saved worlds on this server or browser', ''),
    ...worlds.map(world => new Option(`${world.name ?? `Seed ${world.seed}`} · ${world.source === 'browser' ? 'This browser' : 'Server'}`, world.key)));
  const url = new URL(location.href);
  const oldSeed = url.searchParams.get('world') ?? url.searchParams.get('seed');
  const wanted = url.searchParams.get('selected-world') ?? (oldSeed ? `server:${oldSeed}` : '');
  picker.value = worlds.some(world => world.key === wanted) ? wanted : worlds.length === 1 ? worlds[0].key : '';
  function select(key: string): void {
    picker.value = worlds.some(world => world.key === key) ? key : '';
    const current = new URL(location.href);
    current.searchParams.delete('world'); current.searchParams.delete('seed');
    if (picker.value) current.searchParams.set('selected-world', picker.value); else current.searchParams.delete('selected-world');
    history.replaceState(null, '', current);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.tools-nav a,.tools-cards a')) {
      const target = new URL(link.href);
      if (picker.value) target.searchParams.set('selected-world', picker.value); else target.searchParams.delete('selected-world');
      link.href = target.toString();
    }
    const world = worlds.find(row => row.key === picker.value);
    const explanation = world?.source === 'browser' ? world.checkpoint
      ? 'Saved in this browser. Read-only snapshot; nothing uploaded.'
      : 'No world authority checkpoint. Survey is seed-derived from the saved entry.'
      : world ? 'Shared server world.' : 'Worlds are read from this server and this browser.';
    status.textContent = [explanation, ...errors].join(' ');
  }
  const access: ToolWorldAccess = {
    worlds, selected: () => picker.value, select,
    async survey(key, since) {
      const world = worlds.find(row => row.key === key);
      if (!world) throw new Error('Choose a world first.');
      return world.source === 'browser' ? local('survey', { key })
        : json(`/tools/registry/data?seed=${world.seed}&since=${since}`);
    },
    async preview(key, query) {
      const world = worlds.find(row => row.key === key);
      if (!world) throw new Error('Choose a world first.');
      if (world.source === 'browser') return local('preview', { key, x: Number(query.get('x') ?? 0), z: Number(query.get('z') ?? 0) });
      if (!world.name || world.kind === 'road') throw new Error('Terrain authoring needs a named endless server world. Its Domesday Book remains available.');
      query.set('name', world.name);
      return json(`/tools/world-editor/data?${query}`);
    },
  };
  picker.addEventListener('change', () => { select(picker.value); window.dispatchEvent(new Event('tools-world-change')); });
  select(picker.value);
  window.__toolsWorldsResolve(access);
}
void open().catch(error => {
  status.textContent = error instanceof Error ? error.message : 'Worlds could not be read.';
  window.__toolsWorldsReject(error);
});
