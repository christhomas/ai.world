import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldFile } from './world';

/**
 * What the server has kept, world by world. Everything else about a world comes back out of its
 * seed, so this is the whole of what would be lost if the directory were deleted.
 */
export function describeWorlds(dataDir: string): string[] {
  let files: string[];
  try {
    files = readdirSync(dataDir).filter((name) => /^\d+\.json$/.test(name)).sort();
  } catch {
    return [`No worlds saved yet in ${dataDir}.`];
  }
  if (files.length === 0) return [`No worlds saved yet in ${dataDir}.`];
  const names = namesBySeed(dataDir);
  return files.map((name) => describeWorld(join(dataDir, name), names.get(Number(name.slice(0, -5)))));
}

function describeWorld(path: string, name?: string): string {
  let world: WorldFile;
  try {
    world = JSON.parse(readFileSync(path, 'utf8')) as WorldFile;
  } catch {
    return `${path} — unreadable`;
  }
  const { seed, clock, deltas = [], stalls = [], letters = [], folk = [] } = world;
  const hour = String(Math.floor((clock?.time ?? 0) * 24)).padStart(2, '0');
  const parts = [
    ...(name ? [name] : []),
    `seed ${seed}`,
    `day ${clock?.day ?? 1}, ${hour}:00`,
    count(deltas.length, 'change'),
    count(stalls.length, 'stall'),
    count(letters.length, 'parcel'),
    folk.length ? `visited by ${folk.join(', ')}` : 'nobody has been yet',
  ];
  return parts.join('  ·  ');
}
function namesBySeed(dataDir: string): Map<number, string> {
  const names = new Map<number, string>();
  try {
    const records = JSON.parse(readFileSync(join(dataDir, 'world-records.json'), 'utf8')) as Array<{ name?: unknown; seed?: unknown }>;
    if (Array.isArray(records)) for (const record of records) {
      const seed = Number(record.seed);
      if (typeof record.name === 'string' && Number.isFinite(seed)) names.set(seed >>> 0, record.name);
    }
  } catch {
    // Servers from before named worlds have only the numeric files, which remain a complete list.
  }
  return names;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// run directly: chore worlds, or pnpm worlds
if (process.argv[1]?.endsWith('worlds.ts')) {
  for (const line of describeWorlds(process.argv[2] ?? 'server/data')) console.log(line);
}
