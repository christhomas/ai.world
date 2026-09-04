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
    files = readdirSync(dataDir).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [`No worlds saved yet in ${dataDir}.`];
  }
  if (files.length === 0) return [`No worlds saved yet in ${dataDir}.`];
  return files.map((name) => describeWorld(join(dataDir, name)));
}

function describeWorld(path: string): string {
  let world: WorldFile;
  try {
    world = JSON.parse(readFileSync(path, 'utf8')) as WorldFile;
  } catch {
    return `${path} — unreadable`;
  }
  const { seed, clock, deltas = [], stalls = [], letters = [], folk = [] } = world;
  const hour = String(Math.floor((clock?.time ?? 0) * 24)).padStart(2, '0');
  const parts = [
    `seed ${seed}`,
    `day ${clock?.day ?? 1}, ${hour}:00`,
    count(deltas.length, 'change'),
    count(stalls.length, 'stall'),
    count(letters.length, 'parcel'),
    folk.length ? `visited by ${folk.join(', ')}` : 'nobody has been yet',
  ];
  return parts.join('  ·  ');
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// run directly: chore worlds, or pnpm worlds
if (process.argv[1]?.endsWith('worlds.ts')) {
  for (const line of describeWorlds(process.argv[2] ?? 'server/data')) console.log(line);
}
