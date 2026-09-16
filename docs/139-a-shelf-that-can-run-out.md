# 139 — A shelf that can run out

Design for worklist item 139. Depends on 138's price; 140 depends on this shelf.

## What is wrong today

A `ShopDef` in `shops.ts` is a list of item ids in the order they are offered, and that is the whole
of it. No counts, no depletion, no recovery. Buy every loaf in a hamlet and the hamlet has exactly
as many loaves as it started with, and is exactly as well fed.

With 138 alone this gets worse rather than better: prices would differ between villages and nothing
the hero did could move them, so the map would have a shape he could read and never change.

## What changes

The shelf becomes the village's own store. Buying takes from it; selling adds to it.

The list stays — it is what a shop *deals in*, which is a real fact about a village with a smithy
and no market. What it gains is a count that is not its own.

## Edible items say what they are worth in meals

`items.ts` prices an apple at 5 and bread at 8. The sim counts a cellar in meals, and `FOOD.MEAL`
is one. Those are two different units for the same substance, and the join has to exist somewhere.

One field beside `price`, on edible items only: what this is in meals. Buying bread takes that many
meals out of the cellar and pays 138's meal price times that number. Without it the hero's shelf
and the village's larder go on counting different things, which is how the two halves of this world
have disagreed before — see `soldAtMarket`, written because a watched hunter and an unwatched one
were paid out of two different economies for the same deer.

## Gear is untouched here

A sword has no maker until 140, so gear keeps its infinite shelf and its constant price in
`items.ts`. Saying that out loud is what keeps 139 finishable: this item is about produce, which is
the only thing in the world that currently has a supply.

## Then arbitrage limits itself

Nothing has to cap anything, and no rule anywhere says "you may not do this too much".

Buy a village's cellar down and 138 raises its price, because cover fell. Carry the food to the next
valley and selling it into their store lowers theirs. `SELL_SHARE`, which is 0.5, is the existing
spread and remains the reason a round trip is not free. A route can be worked and a route can be
exhausted, and both of those are the world responding rather than a limiter refusing.

## The told fact

A purchase is a thing one player did, so a replay cannot derive it. This is the same seam as a
violent death, a vote, an oath and a stable commission — all of which already go through
`register.apply` and are replayed by `relive`.

**It is not one fact per purchase.** Deaths are rare and purchases are not; a fact per click would
put thousands of entries in front of every `relive`. One fact per village per morning: what the
outside took out of this place today, netted against what it sold in. A day's trade is one scalar
per good, which is what makes it foldable.

### In `StableBook`'s image

`src/world/stablebook.ts` already does this exact job for stable commissions, and 139 should be a
second book of the same shape rather than a new mechanism:

- keyed by village and morning, so a replay cannot apply a day twice;
- `remember()` restores the book before the register catches up, so the day's trade replays in
  order with the works and the payments;
- the caller hands in the morning rather than "today", which is the fix `StableBook` documents at
  length and the failure it documents — a fact dated today, on a register already standing on
  today, never lived at all and then appeared out of nowhere on the next reopening.

On the wire and on disk it rides what already exists: `server/chronicle.ts` and
`server/durable/events.ts`, the parish book.

## Compaction

### What the problem actually is

`relive` deletes the village and calls `settle`, which founds it again and lives every day forward
to today. So a replay already costs days-since-founding times people, and it costs that with or
without a trade book: the book is consulted once per day, by key, the way `StableBook.on` is.

**A daily book does not make the replay slower. It makes the world bigger.** One entry per village
per morning, kept for ever, in memory, in every save, and in whatever a joining client is handed.
That is the growth to bound, and being clear about which problem is being solved decides what a
checkpoint has to contain.

Bounding replay *time* is a different and much larger job — it would need a snapshot of the whole
settlement, people, purses, memories, opinions and holdings together, where any field left out
diverges silently. That is not this item, and this item must not be written as though it were a
down payment on it.

### Why this book cannot checkpoint itself

The obvious answer is to keep a dated opening balance and drop the facts behind it. It does not
work, and the reason is worth writing down because two of us reached for it before noticing.

**Dropping a day's fact is only sound if the replay does not live that day.** `relive` lives every
one of them. A morning whose trade has been dropped is a morning the village was not short when it
really was: it eats differently, `paidForFood` pays differently, and by the horizon the purses are
not the purses that were there. The dropped days are not bookkeeping — they are days the village
lived.

Nor can the total stand in for them, because the trajectory is what matters and a total does not
carry it. Addition here is clamped at both ends: `deeds.ts` floors `take` at zero and ceilings
`give` at a cap, and `purseOf` applies `PROSPER.MOST` — four thousand — by default. A purse at 3900
given 200 and then taken 200 ends at 3800; the sum of those two facts says 3900. Running out and
being full are precisely the states this item is about, so precisely the cases where a total lies.

Worse than divergence: at the cap the surplus is not dropped, `purses.ts` hands it to the hall on
purpose, because a coin leaving one purse must arrive in another. A summed opening balance would
mint that difference back into a villager's hands and take it off the hall, and the bench would
report books that do not balance with no transaction anywhere to explain it — a fault that reads as
a bug in the audit rather than in the summary.

A checkpoint that is **the state reached at day D** is exact whatever clamps. But it is only usable
if the replay starts at day D, and starting there means holding the whole settlement — people,
purses, memories, opinions, holdings — where any field left out diverges silently. That is a
snapshot of a village, not a summary of a book.

### So 139 keeps every fact and bounds nothing

A decision rather than an omission. One small record per village per morning, and the growth
measured rather than guessed at: the implementation reports the book's size after a hundred days in
the bench, so the number is a fact before anybody argues about it.

**The dividing line still earns its keep**, because it says what could ever be snapshotted at all:
structural facts change what exists and must be kept one at a time, and a village's daily books are
the part of it that a state-at-a-day could stand for. What it does not license is folding anything
while the replay still re-lives the days.

The real fix bounds replay time and book size together, and it is a settlement snapshot: its own
item, after these three, and the place where the rules above belong — a snapshot is a replay result
and never a sum; it carries the day it was cut at; a client meeting one for a day it has not
reached ignores it rather than trusting it; and the cut is deterministic, computed from the replay
itself, so two machines cut on the same days. Get that last part wrong and it is item 88 again in a
new place.

## Testing

- The shelf empties, and refuses rather than selling what is not there.
- Price rises as stock falls, through 138.
- **Determinism:** buy on day 10, `relive` the village, and arrive at the same cellar and the same
  price. Then the same for a village whose store hit nought and whose purse hit `PROSPER.MOST` in
  between, because a test over unclamped numbers cannot tell a replay from a total.
- **Size:** the book's size after a hundred days, reported by the bench, so the growth this item
  accepts is a measured number rather than a claim.
- The bench's per-coin audit extended to goods: what left one store arrived in another or in a
  pack, every day, with nothing minted.

## Coordination

The hero on the register — owning a holding, employing villagers through `postings.ts`, earning
while offline — is a second daily book with the same growth and the same replay constraint, and is
being designed in another session. Neither book may fold itself while `relive` re-lives the days.
If the settlement snapshot is built, both bound at once and there should be one mechanism and one
description of it rather than two.
