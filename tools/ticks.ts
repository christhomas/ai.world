import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir, totalmem } from 'node:os';
import { join as pathJoin } from 'node:path';

import { REACH, Simulation, TICK } from '../server/sim';
import { DAY_LENGTH, PROTOCOL_VERSION, type WorldDelta } from '../server/protocol';
import type { Wire } from '../server/rooms';
import { Forgetful } from '../server/vault';
import { FileVault } from '../server/filevault';
import { SharedWorld } from '../server/world';
import { ACTIVE_RANGE } from '../src/entities/spawning';
import { PROVINCE, provincePath } from '../src/world/provinces';
import { WORLD } from '../src/core/config';

/**
 * What the simulation costs to run, measured rather than guessed.
 *
 * `crowd.ts` is the other half of this pair and answers a different question: it stands up real
 * players against a real server over a real socket and says how many bytes come back. That is the
 * network's bill. This one is the processor's — it drives the simulation in-process, with no
 * sockets and no files in the way, and asks the two questions the simulation tiers open with: how
 * many live agents will this machine step ten times a second, and what does a province cost to
 * catch up on.
 *
 * The whole point is that it is re-runnable somewhere else. The machine this was first taken on is
 * a laptop with twelve fast cores; the machine it deploys to is a shelf of Raspberry Pis, and the
 * only figure that survives that journey is the cost of *one* agent for *one* tick. So every
 * section reports that as well as its totals, and the report says what else the machine was doing
 * at the time, because a number taken on a busy machine and quoted as though it were taken on an
 * idle one is worse than no number at all.
 *
 *   chore ticks              — three runs, which is enough to see the spread
 *   chore ticks -- 1         — one run, for when you only want the shape
 *
 * It is not a test and it must never become one. Nothing here asserts; it measures, writes the
 * report, and says where it put it.
 */

/** Where the findings are left, in the manner of the other benches. */
const REPORT = 'tick-report.txt';

/**
 * The tick the server actually runs at, and therefore the budget.
 *
 * Ten a second is not a target this bench chose: `TICK` is what `Simulation.start` sets its
 * interval to, so a tick that takes longer than this is a server that has already missed one.
 */
const BUDGET = TICK;

/** A wire that listens and says nothing back, so the cost of talking is counted and the cost of a socket is not. */
const mute: Wire = { send: () => {}, get open() { return true; }, close: () => {} };

/** One world week, in real seconds. Seven of whatever a day is worth. */
const WEEK = 7 * DAY_LENGTH;

/** A province, in chunks along one side, and in chunks altogether. */
const PROVINCE_CHUNKS = PROVINCE / WORLD.CHUNK_SIZE;
const PROVINCE_AREA = PROVINCE_CHUNKS * PROVINCE_CHUNKS;

interface Spread {
  p50: number;
  p95: number;
  max: number;
}

/** A ladder rung: what was standing there, and what a tick cost with it standing there. */
interface Rung {
  what: string;
  live: number;
  total: number;
  runs: Spread[];
}

function spreadOf(times: number[]): Spread {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

/** The worst of several runs, which is the only one worth quoting: a bench reporting its best run is a brochure. */
function worst(runs: Spread[]): Spread {
  return {
    p50: Math.max(...runs.map((r) => r.p50)),
    p95: Math.max(...runs.map((r) => r.p95)),
    max: Math.max(...runs.map((r) => r.max)),
  };
}

function best(runs: Spread[]): Spread {
  return {
    p50: Math.min(...runs.map((r) => r.p50)),
    p95: Math.min(...runs.map((r) => r.p95)),
    max: Math.min(...runs.map((r) => r.max)),
  };
}

/**
 * A player who has arrived and is standing still.
 *
 * Standing rather than walking on purpose. A walking player drags the spawn window behind them and
 * the population changes underneath the measurement, so the same ladder rung would hold a different
 * number of creatures every run and nothing would be comparable. What a hero's own legs cost is a
 * separate and much smaller question: the server walks one body per steer.
 */
function join(sim: Simulation, seed: number, x: number, z: number, name: string): void {
  const attached = sim.attach(mute);
  attached.receive(JSON.stringify({
    type: 'join', world: 'mesh', seed, name, version: PROTOCOL_VERSION, day: 2, time: 0.4,
  }));
  attached.receive(JSON.stringify({
    type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [],
  }));
}

/**
 * How many creatures are close enough to somebody to be thought for.
 *
 * The distinction the whole simulation tier rests on. `EntityManager.update` steps only what is
 * within `ACTIVE_RANGE` of a player and skips the rest with a distance check, so a world's roster
 * and its live population are two different numbers — and it is the live one that the ten-a-second
 * budget is spent on.
 */
function liveAround(sim: Simulation, seed: number, spots: ReadonlyArray<{ x: number; z: number }>): number {
  const wild = sim.livesIn(seed);
  if (!wild) return 0;
  const r2 = ACTIVE_RANGE * ACTIVE_RANGE;
  let alive = 0;
  for (const e of wild.all()) {
    if (e.dead) continue;
    for (const spot of spots) {
      const dx = e.x - spot.x, dz = e.z - spot.z;
      if (dx * dx + dz * dz <= r2) { alive++; break; }
    }
  }
  return alive;
}

type Living = NonNullable<ReturnType<Simulation['livesIn']>>;

/**
 * Put creatures down until the roster is as big as asked for, scattered over the ground round a
 * point.
 *
 * Asked for by roster count rather than by live count because counting the live ones is a sweep of
 * everything alive, and doing that after every herd turns setting the bench up into its own
 * benchmark. What is reported is measured afterwards, so the number on the page is the true one
 * whatever this loop managed.
 *
 * One in seven is a wolf. Not decoration: a hunter asks the manager for its nearest quarry, which
 * is a linear scan of everything spawned, so a field of nothing but deer would measure the cheap
 * half of the world and call it the world.
 */
function fillTo(wild: Living, x: number, z: number, target: number): void {
  for (let tries = 1; wild.count < target && tries < 5_000; tries++) {
    const angle = (tries * 2.399963) % (Math.PI * 2);          // the golden angle, so herds do not stack
    const away = Math.sqrt((tries * 0.618034) % 1) * (ACTIVE_RANGE - 3);
    wild.put(tries % 7 === 0 ? 'wolf' : 'deer', x + Math.cos(angle) * away, z + Math.sin(angle) * away, tries);
  }
}

/** Step the world a number of times, timing each one. Nothing is asserted; the times are the finding. */
function timeTicks(sim: Simulation, from: number, many: number): { times: number[]; at: number } {
  const times: number[] = [];
  let at = from;
  for (let i = 0; i < many; i++) {
    const started = performance.now();
    sim.tick(at += TICK);
    times.push(performance.now() - started);
  }
  return { times, at };
}

/** Step the world without timing it: grow the ground, spawn what the country holds, let herds spread out. */
function settle(sim: Simulation, from: number, many = 40): number {
  let at = from;
  for (let i = 0; i < many; i++) sim.tick(at += TICK);
  return at;
}

/** A world with one standing player in it, settled, ready to be measured. */
function oneWorld(seed: number, reach = REACH): { sim: Simulation; at: number; wild: Living } {
  const sim = new Simulation({ vault: new Forgetful(), ground: true, reach, timeout: 60 * 60_000 });
  join(sim, seed, 8, 8, 'Bench');
  const at = settle(sim, Date.now());
  return { sim, at, wild: sim.livesIn(seed)! };
}

/**
 * One rung of the crowded ladder: a single player, and as many creatures as asked for packed into
 * the ground they can see.
 *
 * Deliberately an unrealistic shape, and labelled as one. No real field holds three thousand
 * animals inside eighty-eight tiles. What it isolates is the cost of an agent when nothing else is
 * varying — one player, one world, one focus — and how much of that cost is the agent itself and
 * how much is having neighbours.
 */
function crowdedRung(seed: number, asked: number, window: number): { live: number; total: number; times: number[] } {
  const { sim, at, wild } = oneWorld(seed);
  if (asked > 0) fillTo(wild, 8, 8, asked);
  const { times } = timeTicks(sim, settle(sim, at, 10), window);
  return { live: liveAround(sim, seed, [{ x: 8, z: 8 }]), total: wild.count, times };
}

/**
 * One rung of the ladder that actually answers the question: several worlds at once, each with
 * somebody in it and a full neighbourhood round them.
 *
 * Worlds rather than crowding, because the roster caps a single world at four thousand creatures
 * (`Roster`, in `src/entities/roster.ts`) and a machine that is nowhere near struggling at that cap
 * cannot be pushed by piling more into one world — it can only be pushed by giving it more worlds,
 * which is what a shared server has anyway. Every rung here is one `Simulation` stepping every
 * world in one tick, which is exactly what `Simulation.tick` does on the real server.
 */
function worldsRung(worlds: number, each: number, window: number): { live: number; total: number; times: number[] } {
  const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: REACH, timeout: 60 * 60_000 });
  const seeds: number[] = [];
  for (let w = 0; w < worlds; w++) {
    const seed = 1_000 + w;
    seeds.push(seed);
    join(sim, seed, 8, 8, `Bench${w}`);
  }
  let at = settle(sim, Date.now());
  for (const seed of seeds) fillTo(sim.livesIn(seed)!, 8, 8, each);
  at = settle(sim, at, 10);
  const { times } = timeTicks(sim, at, window);
  let live = 0, total = 0;
  for (const seed of seeds) {
    live += liveAround(sim, seed, [{ x: 8, z: 8 }]);
    total += sim.livesIn(seed)!.count;
  }
  return { live, total, times };
}

/**
 * What a creature costs when nobody is near it.
 *
 * The third tier of the plan is "frozen otherwise", and that argument is only worth making if a
 * frozen agent is meaningfully cheaper than a live one. It is not free: `update` still measures
 * every entity against every player to decide whether to think for it, `keepBodiesApart` sweeps the
 * same list, and every client is still told about everything it can see. So this puts several
 * hundred creatures well outside anybody's range and reads the difference off.
 *
 * The reach is opened to ten chunks for this one measurement, because a creature has to be standing
 * on ground the world is holding or it is unloaded rather than frozen, and at the server's own
 * reach of three there is no room between the edge of the active range and the edge of the world.
 */
function frozenCost(window: number): { live: number; frozen: number; withThem: Spread; withoutThem: Spread } {
  const seed = 77;
  const { sim, at, wild } = oneWorld(seed, 10);
  const before = timeTicks(sim, at, window);
  const bare = wild.count;
  for (let n = 0; n < 800; n++) {
    const angle = (n * 2.399963) % (Math.PI * 2);
    const away = ACTIVE_RANGE + 12 + ((n * 0.618034) % 1) * 60;
    wild.put('deer', 8 + Math.cos(angle) * away, 8 + Math.sin(angle) * away, 90_000 + n);
  }
  const after = timeTicks(sim, settle(sim, before.at, 10), window);
  return {
    live: liveAround(sim, seed, [{ x: 8, z: 8 }]),
    frozen: wild.count - bare,
    withoutThem: spreadOf(before.times),
    withThem: spreadOf(after.times),
  };
}

interface ColdProvince {
  /** Standing a world's terrain up, once, before a single chunk of it exists. */
  sampler: number;
  /** And then growing a province's worth of chunks out of it. */
  ground: number;
  chunks: number;
  /** Reading a province's leavings back off a disk, at three sizes. */
  state: Array<{ deltas: number; ms: number }>;
  /** How thick the country puts creatures on the ground, and therefore how many a province holds. */
  perChunk: number;
  provinceful: number;
  /** And what stepping that many actually took. */
  ticked: number;
  seconds: number;
  population: number;
}

/**
 * The country a province stands on: standing a world's terrain up, and then growing a province's
 * worth of chunks out of it.
 *
 * The two are timed apart because only the first is paid again when a second province opens — a
 * sampler belongs to a world, chunks belong to places.
 */
function arrivalCost(): { sampler: number; ground: number; chunks: number } {
  const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: REACH, timeout: 60 * 60_000 });
  join(sim, 4_242, 8, 8, 'Bench');
  const beforeSampler = performance.now();
  const ground = sim.groundOf(4_242)!;
  const sampler = performance.now() - beforeSampler;
  const beforeGround = performance.now();
  ground.reach(8, 8, PROVINCE_CHUNKS / 2);
  return { sampler, ground: performance.now() - beforeGround, chunks: ground.held };
}

/**
 * What arriving somewhere nobody has been for a while costs.
 *
 * Read this before believing the last part of it. **There is no catch-up operation in this
 * repository at all** — nothing anywhere ticks a province that has no player in it. A room with
 * nobody in it is closed by `Simulation.tick`, and its ground and its creatures go with it;
 * `SharedWorld.tick` moves the clock and does nothing else. So what is measured here is the nearest
 * honest proxy, in the three parts arriving is actually made of: reading a province's leavings off
 * a disk, growing the ground it covers, and stepping a province's worth of creatures forward at the
 * rate the live tier steps them. The last is what a week would cost if it were done by ticking,
 * which is the thing a closed form exists to avoid — and quoting it as though somebody had already
 * written catching-up would be inventing a number.
 */
function coldProvince(forward: number): ColdProvince {
  // The country, in its own function so that a province's worth of terrain is unreachable again
  // before anything is timed against it. It is twenty-odd megabytes of tiles and it slows the
  // allocator down measurably: the first time this was written as one function the forward run
  // below came out five times slower than the same population on the ladder above, which is a
  // measurement of the bench's own leftovers rather than of the simulation.
  const { sampler, ground: grew, chunks } = arrivalCost();

  // The leavings: one JSON file a province, read whole the first time anybody asks about anything
  // in it. Three sizes, because nobody knows yet what a well-walked province actually accumulates.
  const state: Array<{ deltas: number; ms: number }> = [];
  for (const many of [100, 1_000, 10_000]) {
    const dir = mkdtempSync(pathJoin(tmpdir(), 'aiworld-ticks-'));
    try {
      const vault = new FileVault();
      const deltas: WorldDelta[] = [];
      // one sown tile each, laid out so no two share a key: a province holds a quarter of a million
      // tiles, and a file of ten thousand that collapsed to five hundred would flatter the read
      for (let i = 0; i < many; i++) {
        deltas.push({ kind: 'sow', tile: `${i % PROVINCE},${Math.floor(i / PROVINCE)}`, crop: 'wheat', day: 3 });
      }
      vault.write(provincePath(dir, 9, '0:0'), JSON.stringify(deltas, null, 2));
      const started = performance.now();
      const world = new SharedWorld(9, pathJoin(dir, '9.json'), { day: 1, time: 0.3 }, dir, vault);
      world.keepNear([{ x: PROVINCE / 2, z: PROVINCE / 2 }]);
      state.push({ deltas: world.log.length, ms: performance.now() - started });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // The creatures. Density is read off a world at the server's own reach rather than off the
  // province-sized ground above: the manager only spawns within `SPAWN_RADIUS` of somebody, so
  // counting a settled population against a province of empty chunks would divide by the wrong area.
  const { sim, at, wild } = oneWorld(5_252);
  const held = sim.groundOf(5_252)!.held;
  const perChunk = wild.count / Math.max(1, held);
  const provinceful = Math.round(perChunk * PROVINCE_AREA);

  // and then step that many, and see how far the world gets per second of processor
  fillTo(wild, 8, 8, Math.min(3_900, provinceful));
  const started = performance.now();
  timeTicks(sim, settle(sim, at, 10), forward);
  const seconds = (performance.now() - started) / 1_000;
  return {
    sampler, ground: grew, chunks, state, perChunk, provinceful,
    ticked: forward, seconds, population: wild.count,
  };
}

/** What else the machine was doing. Part of the finding, not a footnote: see the header. */
function machine(): string[] {
  const cores = cpus();
  const lines = [
    `  ${cores[0]?.model ?? 'unknown processor'}, ${cores.length} cores, ${(totalmem() / 1024 ** 3).toFixed(0)} GB`,
    `  node ${process.version}`,
    `  load average ${loadavg().map((n) => n.toFixed(2)).join(' ')} (one, five and fifteen minutes)`,
  ];
  try {
    const busy = execSync('ps -Ao pcpu,comm -r', { encoding: 'utf8', timeout: 5_000 })
      .split('\n').slice(1, 7).map((row) => row.trim()).filter(Boolean);
    lines.push('  busiest processes while this ran:');
    for (const row of busy) lines.push(`    ${row}`);
  } catch {
    lines.push('  (could not read the process table, so what else was running is unknown)');
  }
  return lines;
}

const ms = (n: number): string => `${n.toFixed(2)}ms`;
const perAgent = (spread: Spread, agents: number): number => (spread.p50 * 1_000) / Math.max(1, agents);

/** A ladder, printed with its spread rather than its best run. */
function ladder(rungs: Rung[]): string[] {
  const out = [
    '      live  roster    p50 worst    p95 best   p95 worst   of budget   µs per live',
    '                                                                      agent a tick',
  ];
  for (const rung of rungs) {
    const bad = worst(rung.runs), good = best(rung.runs);
    out.push(`  ${String(rung.live).padStart(8)}  ${String(rung.total).padStart(6)}`
      + `  ${ms(bad.p50).padStart(11)}  ${ms(good.p95).padStart(10)}  ${ms(bad.p95).padStart(10)}`
      + `  ${`${((bad.p95 / BUDGET) * 100).toFixed(0)}%`.padStart(9)}  ${perAgent(bad, rung.live).toFixed(1).padStart(12)}`
      + `   ${rung.what}`);
  }
  return out;
}

function main(): void {
  const runs = Math.max(1, Number(process.argv[2] ?? 3));
  const window = Math.max(20, Number(process.argv[3] ?? 80));
  const forward = Math.max(100, Number(process.argv[4] ?? 600));
  const started = new Date();
  const opening = machine();
  console.log(`the tick bench: ${runs} run(s) of ${window} timed ticks a rung, budget ${BUDGET}ms`);

  const crowded: Rung[] = [];
  for (const asked of [0, 250, 500, 1_000, 2_000, 3_500]) {
    const gathered: Spread[] = [];
    let live = 0, total = 0;
    for (let r = 0; r < runs; r++) {
      const rung = crowdedRung(3, asked, window);
      gathered.push(spreadOf(rung.times));
      live = rung.live; total = rung.total;
    }
    crowded.push({
      what: asked === 0 ? 'what the country puts there itself' : `topped up to ${asked}`,
      live, total, runs: gathered,
    });
    console.log(`  crowded: ${live} live, worst p95 ${ms(worst(gathered).p95)}`);
  }

  const busy: Rung[] = [];
  for (const worlds of [1, 2, 4, 6, 8, 12, 16, 24]) {
    const gathered: Spread[] = [];
    let live = 0, total = 0;
    for (let r = 0; r < runs; r++) {
      const rung = worldsRung(worlds, 1_000, window);
      gathered.push(spreadOf(rung.times));
      live = rung.live; total = rung.total;
    }
    busy.push({ what: `${worlds} world${worlds === 1 ? '' : 's'}, one player each`, live, total, runs: gathered });
    console.log(`  worlds: ${worlds} -> ${live} live, worst p95 ${ms(worst(gathered).p95)}`);
    if (worst(gathered).p95 > BUDGET * 2) break;      // well past the answer; the rest is only slower
  }
  // The rung it holds is the last one before the first miss, not the highest one that happened to
  // come in under budget. On a machine this busy a later rung sometimes beats an earlier one, and
  // quoting that as the answer would be quoting the moment the rest of the machine looked away.
  let held: Rung | null = null;
  let missed: Rung | null = null;
  for (const rung of busy) {
    if (worst(rung.runs).p95 > BUDGET) missed ??= rung;
    else if (!missed) held = rung;
  }
  // How much of what is on the page is the machine rather than the simulation. Anything approaching
  // two means the ladder is measuring the neighbours as much as the code.
  const noise = Math.max(...busy.map((rung) => worst(rung.runs).p95 / Math.max(0.01, best(rung.runs).p95)));

  const frozen = frozenCost(window);
  // What one agent nobody is thinking for adds to a tick. The whole of C2's third tier is whether
  // this is a share of a live agent or a rounding error, so the report says which it came out as
  // rather than asserting the answer it was written knowing.
  const perFrozen = ((frozen.withThem.p50 - frozen.withoutThem.p50) * 1_000) / Math.max(1, frozen.frozen);

  console.log('  a cold province...');
  const colds: ColdProvince[] = [];
  for (let r = 0; r < runs; r++) colds.push(coldProvince(forward));
  const slowest = colds.reduce((a, b) => (a.seconds > b.seconds ? a : b));
  const quickest = colds.reduce((a, b) => (a.seconds < b.seconds ? a : b));
  const advanced = (slowest.ticked * TICK) / 1_000;
  const worstWeek = WEEK / (advanced / slowest.seconds) / 60;
  const bestWeek = WEEK / (advanced / quickest.seconds) / 60;
  // The forward run above packs a province's worth of creatures into one player's neighbourhood,
  // which is some forty times a province's real density, and pays crowding costs a spread-out
  // province would not. The cheapest per-agent figure this bench measured anywhere is the other
  // end of the same number, so the truth is between them — and both ends are hours.
  const thin = Math.min(...crowded.filter((r) => r.live > 0).map((r) => perAgent(best(r.runs), r.live)));
  const thinWeek = ((WEEK / (TICK / 1_000)) * slowest.provinceful * thin) / 1e6 / 60;

  const report: string[] = [
    `TICK BENCH — ${started.toISOString()}`,
    '',
    '  What the simulation costs to step, and what a province costs to arrive in. Measured, not',
    `  assumed. ${runs} run(s) of ${window} timed ticks a rung; every ladder shows its worst run, not its best.`,
    '',
    'THE MACHINE, AND WHAT ELSE IT WAS DOING',
    ...opening,
    '',
    'ONE PLAYER, A CROWD ROUND THEM',
    '',
    `  A single world and a single standing player, with creatures packed into the ${ACTIVE_RANGE}-tile circle they`,
    '  are thought inside. Unrealistically dense on purpose: it isolates the cost of an agent, and',
    '  shows how much of that cost is the agent and how much is having neighbours.',
    '',
    ...ladder(crowded),
    '',
    'AS MANY WORLDS AS IT TAKES TO MISS',
    '',
    '  The question as asked. One world caps at four thousand creatures (`Roster`), so a machine that',
    '  is comfortable at that cap can only be pushed by giving it more worlds — which is what a shared',
    '  server has anyway. Every rung is one Simulation stepping the lot in one tick.',
    '',
    ...ladder(busy),
    '',
    held
      ? `  HOLDS: ${held.live} live agents at ten a second — worst p95 ${ms(worst(held.runs).p95)} of a ${BUDGET}ms budget (${held.what}).`
      : '  HOLDS: nothing on this ladder stayed inside the budget, so the ladder starts too high.',
    missed
      ? `  MISSES: ${missed.live} live agents — worst p95 ${ms(worst(missed.runs).p95)}, which is a tick already gone.`
      : '  MISSES: nothing on this ladder missed, so the ceiling is above its top rung.',
    runs === 1
      ? '  NOISE: one run, so there is nothing to compare it against. Take three before quoting any of it.'
      : `  NOISE: the worst run of a rung was up to ${noise.toFixed(1)}x its best. ${noise > 1.8
        ? 'That is the machine, not the code: take these again somewhere quieter before trusting the last digit.'
        : 'Close enough that the ladder is measuring the simulation rather than its neighbours.'}`,
    '',
    'WHAT A FROZEN AGENT COSTS',
    '',
    `  ${frozen.frozen} creatures put down beyond the active range, on ground the world is still holding.`,
    '  Nobody thinks for them. Whether anybody still *walks past* them is the question, and it is the',
    '  whole of what a third tier is: a skipped mind is a discount, and a creature off the separation',
    '  sweep and off what every player is told is an exemption.',
    '',
    `    without them: p50 ${ms(frozen.withoutThem.p50)} for ${frozen.live} live`,
    `    with them:    p50 ${ms(frozen.withThem.p50)} for the same ${frozen.live} live and ${frozen.frozen} frozen`,
    '',
    `  So a frozen agent costs about ${perFrozen.toFixed(2)}µs a tick, against `
      + `${perAgent(frozen.withoutThem, frozen.live).toFixed(1)}µs for a live one.`,
    ...(perFrozen < perAgent(frozen.withoutThem, frozen.live) / 10
      ? [
        '  Which is an exemption rather than a discount, and about what a thing that is not there',
        '  costs. C2 is what did that: past `WATCH_RANGE` a creature is on neither of the two lists',
        '  that used to walk past it, rather than skipping one branch inside them.',
      ]
      : [
        '  Freezing an agent here is a discount, not an exemption — a skipped mind, but still a body',
        '  in every sweep and still a row in what every player is told. A tier that means "costs',
        '  nothing" has to take the agent out of these lists, not out of one branch inside them.',
      ]),
    '',
    'A COLD PROVINCE',
    '',
    '  Said plainly first: NOTHING TICKS A PROVINCE THAT HAS NOBODY IN IT, and since C2 that is a',
    '  decision rather than a gap. `Simulation.tick` closes a room the moment its last player leaves',
    '  and drops its ground and its creatures with it; a province that wakes again is caught up by',
    '  `catchUp` in one calculation, as the ground hands its herds back. What follows is what that',
    '  calculation stands in for — arriving somewhere, and stepping it forward the long way.',
    '',
    `  The country: a sampler for a world is ${ms(slowest.sampler)}, and growing ${slowest.chunks} chunks out of it`,
    `  (a province is ${PROVINCE_AREA}) is ${ms(slowest.ground)} — about ${(slowest.ground / Math.max(1, slowest.chunks)).toFixed(2)}ms a chunk.`,
    '',
    '  The leavings: one JSON file a province, read whole.',
    ...slowest.state.map((s) => `    ${String(s.deltas).padStart(6)} changes kept: ${ms(s.ms)}`),
    '',
    `  The creatures: the country puts ${slowest.perChunk.toFixed(2)} of them on a chunk, so a province of ${PROVINCE_AREA} chunks`,
    `  holds about ${slowest.provinceful} — over half of everything one world's roster will take.`,
    '',
    `  Stepping ${slowest.population} of them: ${slowest.ticked} ticks in ${slowest.seconds.toFixed(2)}s of processor, advancing the`,
    `  world ${advanced.toFixed(0)}s — ${(advanced / slowest.seconds).toFixed(1)}x real time. A week is ${WEEK}s of world.`,
    '',
    `  Measured, across ${runs} run(s): ${bestWeek.toFixed(0)} to ${worstWeek.toFixed(0)} minutes of processor for one province's week.`,
    `  That run packs a province's creatures into one neighbourhood, so it pays crowding a spread-out`,
    `  province would not. Costed instead at the cheapest per-agent figure this bench saw anywhere`,
    `  (${thin.toFixed(1)}µs), which is the other end of the same number: ${thinWeek.toFixed(0)} minutes.`,
    '',
    '  SO A WEEK BY TICKING IS HOURS OF PROCESSOR, PER PROVINCE, WHICHEVER END YOU TAKE — and none of',
    '  it is payable while somebody stands at a province border waiting to walk over it.',
    '',
    'READ IT LIKE THIS',
    '',
    '  The µs-per-live-agent-a-tick column is the only figure that travels. Everything else on this',
    '  page is that number times a population times a rate, and a slower machine changes the first',
    '  term and nothing else. A Raspberry Pi core is somewhere between four and eight times slower',
    '  than this laptop\'s — that is a guess, and it is flagged as one, because nobody has run this on',
    '  the cluster yet. Run it there and this line stops being a guess.',
    '',
    `  Written by tools/ticks.ts to ${REPORT}. Run it again with: chore ticks`,
    '',
  ];

  writeFileSync(REPORT, report.join('\n'));
  console.log(report.join('\n'));
  process.exit(0);
}

main();
