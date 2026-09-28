import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

type Answer = { seed: number; day: number; souls: number; standing: number; parishes: never[];
  happened: Array<{ kind: string; name: string; village: string; day: number }>; latest: number };

const book = (seed: number, name: string, latest: number): Answer => ({
  seed, day: 2, souls: 1, standing: 1, parishes: [], latest,
  happened: [{ kind: 'born', name, village: `Village ${seed}`, day: 2 }],
});

function openPage(
  reply: (seed: number, since: number, server: string) => Promise<Answer>,
  options: { pathname?: string; origin?: string; search?: string } = {},
) {
  const html = readFileSync(new URL('./registry.html', import.meta.url), 'utf8');
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw new Error('the Domesday page has no script to test');
  const listeners = new Map<string, () => Promise<void>>();
  const elements = new Map(['where', 'token', 'world', 'ask', 'live', 'note', 'happened', 'out'].map((id) => [id, {
    value: '', innerHTML: '', textContent: '', hidden: false, checked: false,
    addEventListener: (event: string, callback: () => Promise<void>) => listeners.set(`${id}:${event}`, callback),
  }]));
  const urls: string[] = [];
  let address = '';
  const fetch = vi.fn(async (url: string) => {
    urls.push(url);
    const params = new URL(url, 'http://portal.test').searchParams;
    if (params.has('worlds')) return { ok: true, json: async () => ({
      worlds: [{ seed: 1, name: 'Ashford' }, { seed: 2, name: 'Briar' }],
    }) };
    const answer = await reply(Number(params.get('seed')), Number(params.get('since')),
      new URL(url, 'http://portal.test').origin);
    return { ok: true, json: async () => structuredClone(answer) };
  });
  runInNewContext(script, {
    document: { getElementById: (id: string) => elements.get(id) ?? null },
    location: { pathname: options.pathname ?? '/tools/registry', search: options.search ?? '',
      origin: options.origin ?? 'http://portal.test' },
    history: { replaceState: (_state: unknown, _title: string, url: string) => { address = url; } },
    URLSearchParams, fetch, setInterval, clearInterval,
  });
  const element = (id: string) => elements.get(id)!;
  const choose = async (seed: number) => {
    element('world').value = String(seed);
    await listeners.get('world:change')!();
  };
  const open = async () => { await listeners.get('ask:click')!(); };
  return { element, choose, open, urls, get address() { return address; } };
}

describe('Domesday world selection', () => {
  it('starts the new world at its own event cursor and clears the previous history', async () => {
    const page = openPage(async (seed, since) => {
      if (seed === 2) expect(since, 'B must not inherit A\'s event cursor').toBe(0);
      return book(seed, seed === 1 ? 'Ari' : 'Bea', seed === 1 ? 90 : 4);
    });
    await vi.waitFor(() => expect(page.element('world').innerHTML).toContain('Ashford'));
    await page.choose(1);
    expect(page.element('happened').innerHTML).toContain('Ari');
    await page.choose(2);
    expect(page.element('happened').innerHTML).toContain('Bea');
    expect(page.element('happened').innerHTML).not.toContain('Ari');
    expect(page.address).toContain('world=2');
  });

  it('does not let a late answer for the old world replace the selected survey', async () => {
    let finishOld!: (answer: Answer) => void;
    const old = new Promise<Answer>((resolve) => { finishOld = resolve; });
    const page = openPage(async (seed) => seed === 1 ? old : book(2, 'Bea', 4));
    await vi.waitFor(() => expect(page.element('world').innerHTML).toContain('Ashford'));
    const first = page.choose(1);
    await vi.waitFor(() => expect(page.urls.some((url) => url.includes('seed=1'))).toBe(true));
    await page.choose(2);
    finishOld(book(1, 'Ari', 90));
    await first;
    expect(page.element('note').textContent).toContain('world 2');
    expect(page.element('happened').innerHTML).toContain('Bea');
    expect(page.element('happened').innerHTML).not.toContain('Ari');
  });

  it('loads worlds on a standalone page and opens a changed server from the button', async () => {
    const page = openPage(async (seed, _since, server) => book(seed, server, 4),
      { pathname: '/registry.html', origin: 'http://page.test' });
    await vi.waitFor(() => expect(page.urls).toContain('http://page.test/registry?worlds=1'));
    await vi.waitFor(() => expect(page.element('world').innerHTML).toContain('Ashford'));

    page.element('where').value = 'http://world.test';
    await page.open();
    expect(page.urls).toContain('http://world.test/registry?worlds=1');
    expect(page.element('note').textContent).toBe('Choose a world first');
    await page.choose(1);
    expect(page.element('happened').innerHTML).toContain('http://world.test');
    expect(page.address).toContain('world=1');
  });

  it('starts a new history when another server has the same seed', async () => {
    const page = openPage(async (seed, since, server) => {
      if (server === 'http://second.test') expect(since, 'B must not inherit A\'s cursor').toBe(0);
      return book(seed, server === 'http://first.test' ? 'Ari' : 'Bea',
        server === 'http://first.test' ? 90 : 4);
    }, { pathname: '/registry.html', origin: 'http://first.test' });
    await vi.waitFor(() => expect(page.element('world').innerHTML).toContain('Ashford'));
    await page.choose(1);
    expect(page.element('happened').innerHTML).toContain('Ari');

    page.element('where').value = 'http://second.test';
    await page.open();
    expect(page.urls).toContain('http://second.test/registry?worlds=1');
    expect(page.urls).toContain('http://second.test/registry?seed=1&since=0');
    expect(page.element('happened').innerHTML).toContain('Bea');
    expect(page.element('happened').innerHTML).not.toContain('Ari');
  });
});
