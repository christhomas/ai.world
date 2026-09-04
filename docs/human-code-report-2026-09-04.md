# Human code report — 4 September 2026

**Scope:** everything written since the last two passes: `server/` (protocol, world, rooms,
messages, serve, worlds), `src/game/multiplayer.ts`, `src/game/interact/`, `coop.ts`, `market.ts`,
`party.ts`, `duel.ts`, `handover.ts`, `online.ts`, `src/ui/players.ts`, `src/ui/readouts.ts`.

**8 items found · 5 fixed · 3 skipped.** Two larger pieces of the same work — splitting the server
into four files and lifting 855 lines out of `main.ts` — were done before this sweep and are
recorded in the commits rather than here.

---

## Changes made

### 1. Wire limits were fifteen unnamed numbers — *magic numbers*

**Files:** [server/protocol.ts](../server/protocol.ts), [server/messages.ts](../server/messages.ts)

Before, in two files, with no way to tell which `60` was the same idea as another `60`:

```ts
p.place = String(message.place).slice(0, 60);
p.gear = message.gear.slice(0, 4).map((id) => String(id).slice(0, 24));
const kind = String(message.kind).slice(0, 12);
const id = String(message.stall).slice(0, 80);
damage: Math.max(0, Math.min(99, Math.floor(message.damage))),
```

After:

```ts
export const LIMITS = {
  CHAT: 160, NAME: 18, ITEM_ID: 24, PLACE: 60, THING_ID: 80, VILLAGE: 40, EMOTE: 12,
  GEAR: 4, PARCEL_ITEMS: 8, TRADE_ITEMS: 12, MONSTERS: 64, STACK: 99, PRICE: 9999, DAMAGE: 99,
} as const;

p.place = String(message.place).slice(0, LIMITS.PLACE);
damage: clamp(Math.floor(message.damage), 0, LIMITS.DAMAGE),
```

**Why it's better:** every one of these numbers exists for the same reason — a client could send
something enormous or strange — so they belong in one table that shows the whole shape of what may
cross the wire. A reader no longer has to guess whether the `24` clamping an item id is the same
rule as the `24` clamping a gear id (it is), and somebody adding a message finds the list rather
than inventing another number. `clamp` replaces four hand-rolled `Math.max(a, Math.min(b, …))`.

### 2. Three names for two constants — *duplicated code*

**Files:** [src/game/market.ts](../src/game/market.ts), [src/game/party.ts](../src/game/party.ts),
[src/game/duel.ts](../src/game/duel.ts), [server/protocol.ts](../server/protocol.ts)

```ts
// market.ts
export const RENT = STALL_RENT;      // one value, two names
// party.ts
export { PARTY_LIMIT };              // a re-export that hides where it comes from
// protocol.ts
export const MAX_CHAT = LIMITS.CHAT;
```

All three are gone; call sites import `STALL_RENT`, `PARTY_LIMIT` and `LIMITS.CHAT` from the
protocol, which is where the wire's own rules live.

**Why it's better:** searching for `STALL_RENT` now finds every place the rent matters. A reader
who meets `RENT` in a dialogue no longer has to discover that it is the same number as
`STALL_RENT` on the server, and nobody can change one and miss the other.

### 3. `tryStall` was three conversations in one 75-line function — *god function*

**File:** [src/game/interact/village.ts](../src/game/interact/village.ts)

Before: one function that checked the pitch, then built an empty-pitch dialogue, then a
your-stall dialogue with a nested stocking menu, then a somebody-else's-stall dialogue.

After:

```ts
const emptyPitch  = (pitch: Pitch): DialogueNode => …   // nobody holds it
const stockMenu   = (stall: Stall): DialogueNode => …   // what to put out
const myStall     = (stall: Stall): DialogueNode => …   // yours: takings, packing up
const theirStall  = (stall: Stall): DialogueNode => …   // somebody else's: buy a lot

const tryStall = (): boolean => {
  const pitch = market.nearest(structures.villages, player.x, player.z);
  if (!pitch) return false;
  if (!online.connected) { …; return true; }
  const stall = pitch.stall;
  dialogue.start(!stall ? emptyPitch(pitch) : stall.owner === online.name ? myStall(stall) : theirStall(stall));
  return true;
};
```

**Why it's better:** the rule that decides which conversation you get — who holds the pitch — is
now one line, and each conversation can be read without the other two around it. The two counts
buried in the code (`slice(0, 8)`, `slice(0, 6)`) became `STOCK_CHOICES` and `LOTS_SHOWN`.

### 4. The same test scaffolding, copied four times — *duplicated code*

**File:** [server/serve.test.ts](../server/serve.test.ts)

Four `describe` blocks each carried the same eleven lines: make a temporary directory, start a
server on port 0, close it, delete the directory. They are now one helper:

```ts
function aServer(label: string) { … }        // beforeEach/afterEach inside

describe('the market, over the wire', () => {
  const server = aServer('market');
  …
});
```

**Why it's better:** 343 lines instead of 365, and the setup is stated once. A reader looking at a
test now sees the test rather than the plumbing, and a change to how a test server is started
happens in one place.

### 5. Two doors to the same items — *misleading names*

**File:** [src/game/multiplayer.ts](../src/game/multiplayer.ts)

```ts
import { SLOTS } from './items';
import { ITEMS } from './shops';     // shops.ts only re-exports what items.ts owns
```
became
```ts
import { ITEMS, SLOTS } from './items';
```

**Why it's better:** one line instead of two, and it names the module that actually owns the item
table, so a reader following `ITEMS` lands where the data is rather than at a re-export.

---

## Items skipped

| Item | Reason |
|---|---|
| The 24-handler `new Online({…})` table in `multiplayer.ts` | *Acceptable pattern.* Every handler is short and named for its event. Hoisting them into 24 consts above the table would replace one readable index with a scroll. |
| `tryHorse` (49 lines) and `tryFarm` (52 lines) | *Acceptable pattern.* Each is a straight sequence of dialogue nodes with no branching to hide; splitting would add names without adding meaning. |
| `handle()` in `messages.ts` dispatching to seven subject functions | *False positive.* The switch is the index of the protocol, which is exactly what a reader wants first. |

## Test results

| | Before | After |
|---|---|---|
| Tests passing | 109 | 109 |
| Tests failing | 0 | 0 |
| Typecheck | clean | clean |
| Production build | clean | clean |
| Live check (two browsers) | market, mail, party, co-op | market re-run, unchanged |

Nothing in this pass changed behaviour; the wire limits are the same numbers under names, and the
stall conversation is the same three dialogues.
