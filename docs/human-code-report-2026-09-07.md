# Human-code pass — 7 September 2026

**Scope:** the whole codebase, surveyed against the human-code smell list — magic numbers, god
functions, duplication, dense expressions, deep nesting, comments that explain *what* rather than
*why*, opaque names, long parameter lists, and code written for callers that never came.

**Counts:** 9 items found, 7 fixed, 2 left by agreement. The seven are everything the survey rated
High or Medium; the two left are in the last section with the reason each one stays.

The work ran as three jobs at once — one on `main.ts`, one on the shop conversation and the verb
table, one on the HUD — which is why it arrives as five commits rather than one. One real bug fell
out of it, and a second is described at the end but not touched.

---

## 1. `main.ts` was 2,513 lines, and the rule had an exception with its name on it

**Severity:** High. **Commit:** `11e7dfd`. **Files:** [`src/main.ts`](../src/main.ts) and fourteen
new ones.

`startGame()` was 2,342 lines in a single scope: 217 locals, 308 closures, holding the frame loop,
the console, the debug handles, the day turning over in villages nobody is standing in, and every
blow anyone throws. The architecture test that fails any file over 700 lines exempted this one file
by name.

```ts
// before — src/architecture.test.ts
// main.ts is assembly and the frame loop, and is allowed to be the longest thing here; the
// rest of the codebase is not
).toEqual(['src/main.ts']);
```
```ts
// after
// Nothing is exempt. main.ts used to be, because it was one 2,500-line function that held the
// whole game; putting a name back here is an admission, not a setting.
).toEqual([]);
```

`main.ts` is now 634 lines and `startGame` is assembly. Fourteen subjects moved out, each to a file
named for what it is about rather than what layer it sits in:

| Subject | File | Lines |
|---|---|---|
| The ground, and what was settled on it before anybody arrived | `src/game/country.ts` | 112 |
| The save, opened out and packed back up | `src/game/keeping.ts` | 123 |
| Which half of the game is the authority | `src/game/authority.ts` | 157 |
| Every blow thrown, and every blow that lands on the hero | `src/game/blows.ts` | 463 |
| What the world does about what the hero just did | `src/game/consequences.ts` | 123 |
| Stopping in front of somebody | `src/game/meeting.ts` | 155 |
| What stands up round the hero as they walk | `src/game/watch.ts` | 254 |
| The day turning over where the hero is not | `src/game/tidings.ts` | 183 |
| One frame, in its three shapes | `src/game/frame.ts` | 452 |
| The console, and everything the game can be told to do | `src/game/console.ts` | 332 |
| Whose world you are playing in | `src/game/joining.ts` | 109 |
| The `window.__*` debug handles | `src/game/probes.ts` | 325 |
| How much water is within earshot | `src/game/earshot.ts` | 30 |
| What every key does | `src/ui/keys.ts` | 158 |

**Why it's better:** a reader looking for how a blow is resolved opens a file called `blows.ts`
rather than scrolling a two-thousand-line function hoping to recognise it. And the file-length rule
now applies to everything, which is the only state a rule is worth having in — an exemption with a
filename in it teaches everyone that the limit is negotiable.

**One judgement call:** the key bindings went to `src/ui/keys.ts`, not `src/game/`. They drive eight
ui panels and nothing else, and filing them under `game` would have bought eight more `game -> ui`
crossings for wiring that is the ui's own work. The `game -> ui` allowance went 12 to 19 — twelve was
the exact count before, so nothing could come out of `main.ts` and still touch a panel. Four of the
fourteen new files reach for the ui; the rest take narrow callbacks (`flash`, `hurt`, `say`,
`reveal`) in the style `places.ts` already used.

## 2. A comment that was two drafts of itself

**Severity:** High (cheap, and corrosive). **Commit:** `11e7dfd`. **File:**
[`src/game/blows.ts`](../src/game/blows.ts).

Two attempts at the same sentence, both left in the file:

```ts
// a blade that finds nothing where something plainly stands has to say why, or the rule
// that a sword is no answer to a wight reads as a broken game rather than as the point
// a swing that finds nothing where something plainly stands has to say why, or a rule
// reads as a broken game. Two rules look the same from behind a sword and are not.
```

Now one sentence, next to the rule it explains. **Why it's better:** every other comment in this
codebase asks the reader to trust it. One that visibly was not proofread makes that a worse bet.

## 3. Four attacks spelling out the same five steps

**Severity:** High. **Commit:** `11e7dfd`. **File:** [`src/game/blows.ts`](../src/game/blows.ts).

Sword, bow and spell each resolved the blow, moved the standing ledger, told the world, played a
sound and flashed the screen — in that order, written out three times.

```ts
// before, once per weapon
const res = swing(state, manager, world, player.x, player.z, player.entity.yaw, seed, true, standing, null, might);
// the ledger moves on every deed, not only on the ones that change what people call you
state.standing = standing.value;
const field = battlefield();
if (field) online.swing(field, Math.max(1, Math.round(state.attack * might)), COMBAT.RANGE, COMBAT.ARC);
```
```ts
// after
const res = thrown(
  (manager, world) => swing(state, manager, world, player.x, player.z, player.entity.yaw, seed, true, standing, null, might),
  { damage: landed, range: COMBAT.RANGE, arc: COMBAT.ARC },
);
```

**Why it's better:** the class of bug it removes is the one where a fourth weapon is added and
quietly forgets to tell the world it hit anything — which is invisible in single player and only
appears when somebody else is watching.

**Threshold note:** the triage said four sites; there were three. The duel and warband strikes look
the same from a distance and are not — they call `duel.landed` / `warband.landed`, never write
`state.standing`, and never go through `battlefield()`. Folding them in would have changed
behaviour, so they stay as they are.

## 4. The shopkeeper's conversation, 254 lines of nested closures

**Severity:** Medium. **Commit:** `9c28b69`. **File:** [`src/game/talk.ts`](../src/game/talk.ts).

Twenty-three lines sat at ten or more levels of indent, and the function opened by apologising for
its own shape:

```ts
// the root is defined below and reached lazily, because each menu needs the ones after it
const shopDialogue = (...) => { const buy = () => { const one = (item) => { ... } } }
```

It is now thirteen named top-level functions, the longest twenty-eight lines, and nothing at ten
levels: `shopRoot` → `buyMenu` → `buyOne`; `sellMenu` → `sellRow` → `sellSome` / `sellAll`;
`postMenu` → `parcelMenu` → `addressMenu`; plus the bed, the chat and the after-hours door. What each
branch needs travels in a `Counter` — who is speaking, their face, the stock, the village, and the
dial of what this shopkeeper wants to buy — and the node every branch was assembling by hand is
`across()`.

**Why it's better:** the apology is gone, because hoisting was always the answer. And a reader who
wants the parcel prices opens `parcelMenu` instead of counting braces.

## 5. The verb table, 375 lines of object literal

**Severity:** Medium. **Commit:** `9c28b69`. **File:** [`src/entities/verbs.ts`](../src/entities/verbs.ts).

Twenty-one verbs written inline made one unbroken stretch with no seam in it. They are now
twenty-one named functions under four headings — getting about, going for somebody, backing off and
getting over it, making a living — and the table is thirteen lines of shorthand in those same four
groups.

**Why it's better:** adding a verb is now "write a function of this shape and put its name in the
group it belongs to". Two of the verbs were also destructuring a field off the world with the same
name as the function they now live in, which would have shadowed it.

## 6. Sixty-three bare decimals in the game layer

**Severity:** Medium. **Commit:** `9c28b69`. **Files:** eleven under `src/game/`.

Down to forty-one, each named in the block that owns it: when a frame becomes a roof, the nine
numbers of a miner's dread, the two pressures at which a village is besieged or bled, what a
breaching whale does above the water, where the deck of a boat is.

```ts
if (progress > 0.25) frame(); else if (progress > 0.6) roof();
```
```ts
if (progress > BUILD.FRAME_AT) frame(); else if (progress > BUILD.ROOF_AT) roof();
```

Three had been written twice for one reason and now have one name each: a miner's dread was spelled
out in both `mining.ts` and `mines.ts`, a boat's beam is the same alongside in x and z, and the
height you surface at has to match in the teleport and in the camera.

**Why the other forty-one stay:** `audio.ts` is a synthesiser — its numbers are frequencies,
durations and gains handed to `tone(freq, dur, type, gain)`, whose parameters already name them, and
each call already says `// owl` or `// drip`. `OWL_HZ = 420` is a longer way of writing 420. The note
envelope in `music.ts` is an ADSR and wants a sentence, not four constants. The three numbers that
place a pod of whales only mean anything multiplied together. A tile centre is half a tile.

## 7. Thirty exports nothing outside their own file imports

**Severity:** Medium. **Commit:** `8dd7c99`. **Files:** nineteen across `game`, `world`, `ui`,
`core`, `dungeon`, `interior`.

`export` is a claim that other code depends on this. Twenty-four of these were false, so a reader
wanting to rename a constant had to go and check first. They are file-local now — the shop's parcel
price, the dig timings, the save-slot keys, the two dungeon floor levels, the words a rescuer says.

The other six were used nowhere at all, including inside their own file, and are gone: `FACE_SIZE`
(an alias for a constant one line above it), `NOTHING` (a pair of do-nothing behaviour nodes "for a
file that wants to say so plainly", which no file ever did), and four mountain helpers —
`inMountains`, `slopeAt`, `terracesAt`, `terracesOf`.

**Why it's better:** those four are the interesting ones. They are an API written for callers that
were coming and never came, and two carry careful docblocks about half-unit steps and rivers running
uphill for code that has never run — documentation that reads as a description of the system and
describes nothing.

---

## A bug this found

**`reeling` never expired anywhere but out of doors.** Fixed in `7ed1be6`.

Being hit makes the hero untouchable for half a second, so a pack cannot land every bite in the same
instant. That half second was counted down at the bottom of the out-of-doors path, past the returns
that end an indoor frame and an underground one — so in a mine or a building it was never counted
down at all. One bite from a rat and nothing in that place could touch you again for as long as you
stayed.

It is the same bug that was found and fixed for the swing and draw cooldowns, wearing the other
shoe: that one gave you one swing per visit and made clearing a mine impossible, this one makes the
mine unable to hurt you. Breaking up `main.ts` is what exposed it — the two call sites ended up a
hundred lines apart in different files, and the asymmetry became impossible not to see.

Two tests guard it: one stands a wolf in front of the hero, and one reads `frame.ts` and asserts the
countdown happens before the branch and before any early return. The second was checked by putting
the broken arrangement back — *expected 417 to be less than 270*.

## A bug this found and did not fix

**The spell splits its takings and the sword does not.** `conjure` ends with `if (res.gold > 0)
takeShare(res.gold)`, but `swing` inside `combat.ts` has already banked that gold into
`state.inventory.gold`, and neither `attack` nor `loose` calls `takeShare` at all. So killing with a
spell pays your hired men and killing with a blade does not.

Left alone deliberately: either answer is a change to what the game pays, which is a design decision
rather than a readability one.

---

## Items skipped

| # | Item | Reason |
|---|---|---|
| 8 | `props.ts`'s 504-line constructor | *Acceptable pattern.* It is a table of shapes, one per prop, read by looking at it — the same argument that kept the creature rigs in source rather than in data. |
| 9 | Six-parameter geometry functions (`corridor`, `grow`, `prism`) | *Acceptable pattern.* Positional and idiomatic for geometry; a struct per call would add ceremony without adding clarity. |

Two more were considered and rejected inside item 3 and item 6 rather than listed separately: the
duel and warband strikes (folding them into `thrown()` would have changed behaviour) and the forty-one
numbers that stay named by their parameters.

---

## Results

| | before | after |
|---|---|---|
| Tests passing | 1123 | 1126 |
| Tests failing | 0 | 0 |
| Test files | 110 | 111 |
| `tsc --noEmit` | clean | clean |
| Longest source file | 2,513 lines (`main.ts`) | 700-line limit, no exemptions |
| File-length exemptions | 1 | 0 |
| World fingerprint (`golden.test.ts`) | — | unmoved |

Coverage was not measured either side; this project has no coverage gate, and the three tests added
are the ones that pin the bug found above rather than an attempt to raise a number.

Every commit was proved on a detached worktree built from that commit alone, not from the working
tree — three jobs were writing files at once, and a working tree that passes says nothing about
whether any single commit does. `11e7dfd` additionally got a browser pass: the hero walks, every
panel opens, all four spells cast, a mine is fought in and climbed out of, and a production build
still tree-shakes the debug probes out of the bundle.
