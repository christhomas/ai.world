# Human code review — 9 September 2026

Scope: everything written in the collision and synchronisation session, `bdf9cca..e449028` —
`src/world/solids.ts`, `footprints.ts`, `propstream.ts`, `chunkManager.ts`, `groundworld.ts`,
`src/entities/entity.ts`, `player.ts`, `src/game/wildlife.ts`, `authority.ts`, `doorways.ts`,
`probes.ts`, `src/interior/generate.ts`, `world.ts`, `src/render/footprint.ts`, `props.ts`,
`server/sim.ts`, `rooms.ts`, `protocol.ts`, `build.config.ts`.

Read with the question "what did I get away with yesterday", rather than for style. Four items
found, three fixed, one recorded on the work list because fixing it is a design change rather than
a tidy-up.

## Changes made

**1. A set allocated on every candidate of every slice of every move**

- **File:** [`src/world/solids.ts`](../src/world/solids.ts)
- **What changed:**

```ts
// before — gather the boxes under the step so a wide one cannot be tested twice
private along(x0, z0, x1, z1): Set<Solid> { … found.add(s) … }
crosses(x0, z0, x1, z1) { for (const s of this.along(x0, z0, x1, z1)) … }

// after — walk the buckets and test as we go
crosses(x0, z0, x1, z1) {
  for (let tz = lowZ; tz <= highZ; tz++) for (let tx = lowX; tx <= highX; tx++) {
    const bucket = this.buckets.get(tileKey(tx, tz));
    if (!bucket) continue;
    for (const s of bucket) if (segmentHitsBox(s, x0, z0, x1, z1)) return true;
  }
}
```

- **Why it is better:** `crosses` is called for three candidate directions on up to seven slices of
  one move — twenty-odd sets per walking frame per creature, on a machine whose whole point is that
  it is a Raspberry Pi. The set existed to stop a box wider than a tile being tested twice; testing
  it twice is a handful of arithmetic, and remembering that we already did costs an allocation and a
  hash. The answer is a boolean, so a duplicate test cannot change it.

**2. A measurement that flattered itself**

- **File:** [`src/game/wildlife.ts`](../src/game/wildlife.ts)
- **What changed:** the "how wrong was the screen" tally now runs only for a creature we were
  already drawing, not for one created from the snapshot being measured.
- **Why it is better:** a body built from a snapshot is standing exactly where the snapshot said, so
  every deer that crested a hill was counted as a perfect guess and pulled the average down. The
  number is the case for the whole change — it is what says a wolf was drawn two tiles from where
  the world had it — so it has to be honest against itself. It reads worse and truer now: within
  reach, 0.09 to 0.11 of a tile rather than 0.08.

**3. A list built sixty times a second for a reader that does not read it**

- **File:** [`src/game/wildlife.ts`](../src/game/wildlife.ts)
- **What changed:** `drift()` builds its list of stragglers only when it is being read as a
  measurement (`clear`), not when the debug overlay asks for the smoothed number every frame.
- **Why it is better:** the overlay wants one number. It was allocating an array and rounding a
  hundred distances into it, per frame, to throw them away.

## Items skipped

| item | reason |
|---|---|
| `boxedIn` re-asks `world.blocked` on every slice of a move | *Acceptable pattern.* It is a map lookup and one or two box tests, and hoisting it would make the escape rule wrong for the slice after the one that got out. |
| `Solids.drop` uses `indexOf` + `splice` per bucket | *Below threshold.* Ten to two hundred boxes a chunk, each in a handful of tiles; the cost is invisible beside generating the chunk. |
| `apply()` re-creates an `Entity` every snapshot for a creature the renderer's pool refused | *Pre-existing*, and it needs a decision about what a full pool should do rather than a tidy-up. |
| Props are `THREE` primitives, so measuring one needs a renderer | *Design change.* It is why the server bundle carries three. Written onto the work list instead. |

## Test results

| | before | after |
|---|---|---|
| tests passing | 1197 | 1197 |
| tests failing | 0 | 0 |
| typecheck | clean | clean |
| playtest (`tools/playtest.cjs`) | 9/9 | 9/9 |
| screen wrong by, within reach | 0.08 tiles (flattered) | 0.09–0.11 tiles (honest) |

Nothing here changed behaviour except the measurement, which is the point: the review was of code
written the same day, and the three faults it found were one allocation, one lie to myself, and one
piece of work done sixty times a second for nobody.
