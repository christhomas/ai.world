# Where the CPU goes — 12 September 2026

Asked: an Edge tab running the game was measured at **160 % CPU** (more than one core) while merely
open. This is what was found, ranked by how much of that 160 % each thing explains.

Everything below is either **MEASURED** (a number from a run described in *How this was measured*)
or **SUSPECTED** (read from the code, with no number behind it). Where something could not be
measured it says so rather than guessing.

---

## How this was measured

One headless Chrome at a time, driven over raw CDP (no playwright), against a vite dev server.
Three runs, each ending with a 10-second `Profiler` sample at 250 µs on the page target **and on
every worker target** (browser-level `Target.setAutoAttach`, so dedicated workers are profiled too).
Self time is the sum of `timeDeltas` for samples landing on each node. Frames are counted by
wrapping `requestAnimationFrame` and by reading `renderer.info.render.frame`; worker traffic by
wrapping `Worker.prototype.postMessage` and adding a `message` listener before any page script runs.

Two traps worth writing down, because both produced a false measurement first time:

- **The dev server's HMR reloaded the page mid-run.** Other agents were saving `src/game/frame.ts`
  during the second run, vite pushed a full reload, and the profile that came back showed the main
  thread doing 6.6 s of country generation with **zero frames drawn** in 10 s. That is real — it is
  what *booting* an endless world costs — but it is not steady state, and reading it as steady state
  would have been completely wrong. The fix was to serve a frozen snapshot:
  `git archive HEAD | tar -x -C <tmp>`, symlink `node_modules`, run vite from there. Blocking
  `/@vite/client` instead does **not** work — every transformed module imports it, and the game
  never boots.
- **Headless is not the machine the 160 % was measured on.** Software GL (swiftshader) offers only
  17–18 rAF/s, and `AutoQuality` drops the rig to `low` within seconds — *no shadows*,
  `pixelRatio 1`. So per-frame JS milliseconds below are honest and transfer; totals and anything
  raster-side do not. A real tab at 60 fps on `high` draws ~3.5× the frames at 4× the pixels with a
  2048² shadow pass per frame.

Runs: (1) `?world=road&seed=3`, hero teleported to Crossroads Town, 10 s visible + 10 s hidden.
(2) `?world=endless&seed=3`, hero in Blackby, three windows — invalidated mid-run by the reload
above, but window A is sound. (3) the same on the frozen snapshot, polled every 10 s for two
minutes then profiled. Plus two 40-second chat-counting runs.

---

## 1. The country worker burns a whole core for ~40 seconds every time the ring of patches moves

**MEASURED.** `src/workers/country.worker.ts:27`, `src/world/grower.ts:76`,
`src/world/patchcountry.ts:112`.

In the endless world, 24 s after the hero landed in a village and with him standing perfectly still:

| target | busy | of sampled |
|---|---|---|
| `country.worker.ts` | **10,034 ms** | 10,123 ms — **99.1 % of one core** |
| `sim.worker.ts` | 824 ms | 10,125 ms |
| `chunkgen.worker.ts` × 4 | 0 ms each | ~10,125 ms each |
| main thread | 1,287 ms | 10,002 ms |

Self time inside the country worker: `scattercells.ts standing` 4,847 ms, `scattercells.ts sitesIn`
1,837 ms, the arrow function in `localland.ts landOf` 1,676 ms, `terrain.ts waterAway` 182 ms,
`highland.ts highlandAt` 158 ms, `localroads.ts junctionsOf` 153 ms. `__country()` at that moment
reported `waiting: 7` more patches with `lastTook: 4746` ms apiece.

**It does stop.** Polled every 10 s for two minutes on the frozen snapshot, standing still:

```
t+  0s  holding 2  waiting 7  grown 1   country-worker messages 2/1
t+ 10s  holding 4  waiting 5  grown 3   4/3
t+ 20s  holding 6  waiting 3  grown 5   6/5
t+ 30s  holding 8  waiting 1  grown 7   8/7
t+ 40s  holding 9  waiting 0  grown 8   8/8
t+ 50s … t+120s   unchanged: holding 9, waiting 0, grown 8, 8/8
```

and the closing 10 s profile at t+130 s: **country worker busy 0 ms of 10,135 ms, 0 messages**.

So this is a *bounded burst*, not a runaway: ~8 patches × ~4.7 s = **~38 core-seconds of 100 % CPU**
per ring, then silence. But `PatchCountry.wants()` is called every frame with the hero's position
(`src/game/frame.ts`, the `if (endless && grower)` line), so the ring recentres the moment he
crosses a 512-tile patch edge and three fresh patches — ~15 core-seconds — are queued. A hero who is
walking keeps this worker busy a large fraction of the time. A hero who has just arrived anywhere
new pays the full 38 seconds.

This is the single biggest item and it alone is ~100 % of the 160 %.

*Fix:* make a patch cheaper rather than more parallel — `scattercells.standing` is 65 % of it and is
O(tries² × 9 cells) with a `spacing()` field probe per candidate (`src/world/scattercells.ts:75`),
so hoisting the spacing probe out of `candidates()` and replacing `refusedBy`'s linear neighbour
scan with a per-cell grid is the change that pays.

## 2. Twenty-seven chat lines a second, each forcing two synchronous layouts

**MEASURED.** `src/game/tidings.ts:68` and `:155`, `src/game/roaming.ts:658`, `src/ui/chat.ts:109`.

In the endless world, with the hero standing still: **540 lines appended to `#chatLog` in 20 s
(27.0/s)**, and they are the same two sentences over and over —

```
x15  Bears have been at Stonedale for days. We have buried people…
x15  The walking dead have been at Stonedale for days. We have buried…
```

In the 10-second steady-state profile this was **`Chat.line` 397 ms + `get atBottom` 16 ms of 969 ms
of main-thread busy time — 43 %**, i.e. 2.4 ms of every 5.8 ms frame.

The mechanism is exact. `Roaming.pressings()` returns one entry **per (band, village) pair**
(`roaming.ts:658`). `pressSaid` is keyed **by village alone** (`tidings.ts:68`), and the guard is
`pressSaid.get(press.village) !== press.said` (`tidings.ts:155`). With two bands leaning on
Stonedale, each frame each band's line differs from what the other band stored, so both are "new"
again, for ever. `Chat.line` then reads `scrollHeight/scrollTop/clientHeight` (`chat.ts:106`) and
writes `scrollTop = scrollHeight` (`chat.ts:115`) — two forced reflows — 27 times a second.

The same measurement in the road world: **0 lines in 20 s**. That is not a world difference, it is
luck: the road seed happened to have one band per village. The bug fires in either world the moment
two bands press the same place.

*Fix:* key the memo by band as well as village — `pressSaid.get(`${press.band.id}:${press.village}`)`.

## 3. `theDaysNews()` rebuilds every band in the country, every frame

**MEASURED.** `src/game/frame.ts` calls `tidings.theDaysNews()` unconditionally once a frame;
`src/game/roaming.ts:658` → `abroad()` → `roster()` → `bandFor()` (`roaming.ts:329`) → `isBroken()`
(`:595`) → `alive()` (`:581`).

Road world, 10 s, hero standing still, 181 frames: `/src/game/roaming.ts` totalled **90.9 ms of
584.4 ms of main-thread busy time (15.6 %)** — `bandFor` 32.4 ms, the anonymous callback in
`groundsOf` 21.1 ms, `pressings` 10.4 ms, `isBroken` 6.6 ms, `alive` 5.3 ms — plus
`/src/game/grounds.ts` (`holdsABand` 9.0 ms, `alone` 5.6 ms) another 14.6 ms. That is **0.50 ms per
frame, 30 ms per second at 60 fps**, to recompute from the seed an answer that changes once a game
day, and it allocates and sorts a fresh `Pressing[]` each time.

*Fix:* gate the whole of `theDaysNews()` on `state.day` changing (it already has `assessedOn` for
the one piece that was gated), and memoise `roster()` on `(day, era, lost.size)`.

## 4. The shadow map is re-rendered every frame even when nothing has moved

**SUSPECTED — not measured, and I say so plainly.** `shadowMap.autoUpdate` is never assigned
anywhere in `src/` (grepped), so it keeps three.js's default of `true`: the depth pass runs on every
`render()` call. `src/render/scene.ts:134` sets that at 1024² for `medium` and **2048² for `high`**,
and `high` is the default for anybody who has never chosen (`scene.ts:275`).

I could not measure it. The A/B I set up — profile, then `shadowMap.autoUpdate = false`, profile
again — landed in the window where the page had reloaded and was drawing nothing, so the two
numbers (6,641 ms and 6,725 ms busy, 0 frames drawn) are both measuring boot, not shadows. And
headless auto-dropped to `low`, where shadows are off entirely, so no run here ever had them on.
On a real tab at `high` this is a second full scene traversal and draw-call submission per frame.

*Fix:* `renderer.shadowMap.autoUpdate = false` and set `needsUpdate = true` only when the sun moves
or the chunk set changes.

## 5. Two thirds of the renderer process's CPU is not the main thread's JS

**MEASURED.** `Performance.getMetrics` deltas across the road-world 10 s window: `ProcessTime`
**3.286 s**, `ThreadTime` **0.749 s**, `TaskDuration` 0.597 s, `ScriptDuration` 0.392 s,
`LayoutDuration` 0.015 s, `RecalcStyleDuration` 0.006 s.

So even with every worker idle and the main thread only 7.5 % busy, the renderer process was using
**33 % of a core** — raster, compositor and the swiftshader GL threads. On a real tab that ratio is
what turns a modest main thread into a three-figure percentage, and it is also why "160 %" cannot be
attributed to JS alone. Main-thread JS per frame, for the record: **3.23 ms** in the road world
(584.4 ms over 181 rAF callbacks) and **5.8 ms** in the endless world (969 ms over 167).

*Fix:* nothing here is a bug; it is the price of `pixelRatio 2` plus a per-frame shadow pass. Item 4
is the lever.

## 6. Allocation is heavy enough for GC to be visible — but GC is not the sink

**MEASURED.** Road world, 10 s: **122 MB of JS heap allocated over 181 frames (~0.67 MB per
frame)**, with **18 drops of more than 1 MB in 41 samples** (≈1.8 minor collections a second,
sampling `performance.memory.usedJSHeapSize` at 4 Hz). Endless steady state: 15.5 ms of
`(garbage collector)` self time in 10 s.

But the profiler puts `(garbage collector)` at only **5.9 ms of 10 s** on the main thread in the road
world — **0.06 % of a core**. So the allocation is real and worth fixing for frame-time smoothness,
and it is *not* where the CPU is going.

The per-frame allocators are visible in `src/game/frame.ts`: `houses.entries().map(…)` rebuilding an
object per building, `standing.filter().map().join('|')` building a string, `dropsFor(carcasses(),
remains.all)`, `pressings()` (item 3), `markers()`, `iso.groundCorners()`, and a handful of fresh
arrow functions passed as `heightAt` callbacks — all once a frame.

*Fix:* hoist the closures and reuse the arrays; they are all rebuilt from state that changes rarely.

## 7. A hidden tab does stop drawing — an unfocused one does not, and the world worker never stops

**MEASURED.** With the tab pushed to the background (`Target.activateTarget` on a second page,
`document.hidden === true` confirmed):

| | visible 10 s | hidden 10 s |
|---|---|---|
| rAF callbacks | 181 | **0** |
| `renderer.info.render.frame` | +427 over the run | **+1** |
| `sim.worker` messages received | 204 | **202** |
| chunk-worker messages | 0 | 0 |

So the render loop *is* handled — `main.ts:456` stops it on `visibilitychange` — and the chunk
workers are genuinely idle. But:

- **The world simulation worker keeps running at full rate when hidden.** `src/workers/sim.worker.ts`
  hosts the real `Simulation`, whose `start()` arms `setInterval(() => this.tick(), TICK)` with
  `TICK = 100` (`server/sim.ts:302`, `:71`) and a second `setInterval` at `CLOCK_INTERVAL = 5000`.
  Nothing stops either on hide. Its CPU here was small (29 ms of 10 s in the endless steady state,
  10 ms in the road world) but it is not zero and it is not throttled.
- **There is no `blur` handler.** `visibilitychange` is the only lifecycle listener
  (`main.ts:456`, `keys.ts:226`; the `blur` listener in `core/input.ts:44` only clears held keys).
  A window that is visible but unfocused — another window in front of it, a second monitor — is
  throttled by neither the browser nor the game and keeps drawing at the full 60 fps. **This is the
  most likely reading of "160 % on a tab nobody is looking at"**, if the tab was visible rather than
  hidden.

*Fix:* stop the sim worker's tickers on hide (post it a `pause`/`resume` alongside `chunks.pause()`),
and decide deliberately whether an unfocused window should drop to, say, 10 fps.

## 8. The coast field re-sweeps on a 400 ms timer with a stationary hero

**MEASURED, small.** `src/render/coastfield.ts:143` returns early only if the camera is still
*and* `now - atTime < COAST.REFRESH`, and `REFRESH` is 400 ms (`coastfield.ts:49`). So a hero who
has not moved still re-samples the ground, runs `spreadFromLand` and re-uploads a `DataTexture` two
and a half times a second: `spreadFromLand` 7.3 ms/10 s (road), 8.7 ms/10 s (endless), plus the
`texture.needsUpdate = true` upload at `coastfield.ts:156`.

*Fix:* drop the timer half of the condition — the field is a function of the ground, and the ground
under a stationary camera does not change.

## 9. `Patchwork` holds exactly as many patches as the grower asks for, with no slack

**SUSPECTED — a fragility, not an observed fault.** `KEEPS = 9` (`src/world/patchwork.ts:52`) is
exactly the ring `PatchCountry.wants()` names: the centre plus eight neighbours. `Grower.want()`
tests `patches.has(patch)` (`grower.ts:56`), which does **not** touch the LRU clock, while
`Patchwork.patch()` does (`patchwork.ts:107`). So any single access to a *tenth* patch — a chunk at
an awkward edge, a map probe, a far look-up — evicts a ring member that `want()` will immediately
re-request, at ~4.7 s of worker time, which on arrival evicts another. That is a permanent
regrow-evict loop and it would look exactly like "a worker that grows patches forever".

It was not observed in two minutes of standing still (holding stayed at 9, `grown` stayed at 8), so
this is a margin-of-one worry rather than a measured bug.

*Fix:* `KEEPS = 12`, or have `Grower.want()` touch the patch it finds so the ring cannot be evicted
from under itself.

---

## What was ruled out

- **The chunk workers.** MEASURED at **0 ms busy of ~10,130 ms sampled, all four of them**, in every
  steady-state window, visible and hidden. They are not part of this.
- **Material recompiles per frame.** `material.needsUpdate` is set in exactly one place that runs
  per frame-ish — `scene.ts:298`, inside `setQuality`, which runs on a quality change only. The rest
  (`instancing.ts:114`, `pool.ts:427`, `healthbars.ts`, `shafts.ts`, `swallows.ts`, `updraughts.ts`)
  are `instanceMatrix`/`instanceColor` uploads for things that actually moved, which is correct.
  `renderer.info.programs` stayed at 31 across a whole run — no shader churn.
- **Instance buffers rebuilt per frame.** `addPropInstances` (`instancing.ts:105`) runs when chunks
  are built, and the repack is distance-gated (`instancing.ts:130`).
- **Geometry rebuilt on a timer.** Nothing found.
- **`setInterval` in the page.** There is none. The only browser-side timers are three one-shot
  `setTimeout`s (`main.ts:449`, `chat.ts:75`, `keys.ts:213`). The title-screen canvas loop
  (`titlesky.ts:142`) is correctly cancelled when the game starts (`title.ts:101`). The only
  intervals in the whole client are the two inside the sim worker, item 7.

## What this adds up to

During a patch-growing burst in the endless world, measured on hardware that offers 18 fps:
**99 % (country worker) + 10 % (main thread) + ~25 % (renderer, non-JS) ≈ 135 % of a core**, with
shadows off and at a third of the frame rate a real tab runs at. Scaled to 60 fps on `high`, that
comfortably reaches and passes 160 %.

Which of the two stories the Edge tab actually was — an endless world mid-burst, or a road world at
60 fps with a per-frame shadow pass and 27 chat lines a second — cannot be settled from here without
knowing which world that tab had open. Items 1, 2 and 4 are the three that matter, in that order.

---

*Everything above is read-only: no source file was changed, nothing was committed, and the
throwaway vite server and snapshot used for the measurements were stopped.*
