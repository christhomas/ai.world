# 140 — Somebody makes it

Design for worklist item 140. Depends on 138's price and 139's shelf.

## What is wrong today

`structures.ts` has had `ShopType = 'store' | 'smith' | 'inn' | 'apothecary'` for as long as
villages have had shops, and it places them. `TRADES` holds fourteen trades and neither smith nor
apothecary is one of them — which `prosperity.ts` already records from the other side, as the
reason its higher wage once reached nobody: the set naming the better-paid trades named *shops*,
and four of those five were not jobs anybody in this world could hold.

So the game sells swords that nobody in the world makes, out of buildings that nobody works in.

## What is already built

Most of this item is joins rather than machinery:

- **The building stands.** A village with a smithy already has one, placed at founding.
- **A trade already declares what it needs.** `seller` needs `market`, `innkeeper` needs `inn`,
  `doctor` needs `doctor`. A `smith` needing `smith` is a sentence of the same shape.
- **Staffing is automatic.** `vacancies.ts` reads `weight`, compares a village's establishment
  against who actually works, and raises the next adult into the gap. Nothing has to be told to
  hire a smith, and a village with no smithy never gets one.
- **The inputs have producers.** A miner brings up ore; a woodcutter fells timber.
- **Material as a price has a precedent.** `farmbuilds.ts` prices a stable in wood out of a yard,
  and item 100 settled when a build is priced in material and when it is priced in days.

## The one new idea

**A good made out of other goods.**

Every livelihood in the game today turns a *day* into a good: a farmer's day is four meals, a
miner's day is ore, a hunter's day is three meals carried out of the woods. A smith's day turns ore
and timber into gear.

That is one function, and it belongs beside the other four in `livelihoods.ts`: inputs taken from
the village's store, output onto the shelf 139 gave it, refusing where the inputs are not there.
The refusal should read like the builder's refusal in item 100 — a yard with no lengths in it
cannot sell you what it has not got — because it is the same sentence about a different trade.

## Both a rate and a commission, and which one depends on who is asking

Decided, and the reason the answer is two things is that there are two different acts here rather
than one act with a choice of mechanism.

**A smith's day is a rate**, like a farmer's four meals. He works, gear appears on the shelf, and
that happens in every village with a smithy whether or not a player has ever walked into it. A
smith who only ever worked to order would stock no shelf, and a village nobody visits would have a
smithy that never made anything. The shelf is the point of this item, so the rate is the part that
cannot be left out.

**A specific thing, ordered by somebody, is a commission.** `works.ts` is already right about what
one is: you pay, he builds, and later you are handed the thing — every way it differs from `buy`
follows from the delay rather than from the work. A player asking a named smith for a particular
sword is exactly that, and so, in time, is a villager asking for one.

The two do not compete, because they answer different questions. The rate says what a village has
in stock; the commission says what one person asked for. What joins them is the smith's day: a day
spent on somebody's order is a day not spent stocking the shelf, which is what stops a commission
being free extra output and makes a busy smith a real constraint on a village's supply.

`works.ts` already runs deposit, balance and delivery, so the commission side needs no new
machinery — only the smith's day being a thing that can be spent one way or the other.

## Prices come free

Gear stops being a constant in `items.ts` and becomes a reading of stock against demand, by 138's
rule, because by then it has stock. No special case for the things a player buys.

## What it does to the economy

This is the point of the item rather than a side effect. A village with a seam, a wood and a smithy
makes swords out of its own ground and sells them; a village on a rock buys them or goes without.

That is the first good in the world whose supply is geographic. It is also the first answer to the
thing the bench has been reporting since it was written: the mines are the only source of new money
in the world, and every other village merely redistributes. A village that makes something people
elsewhere want has a second answer, and carriers moving goods between settlements — the natural
141 — is what would let it reach them.

## Scope

**In:** the `smith` trade, the making function, gear onto the shelf, gear priced by 138, and a
smith's day being spendable on a `works.ts` commission instead of on the shelf.

**Out:** `apothecary`. Same shape, different inputs, building likewise already standing empty, and
it should follow immediately — but as its own item, because "the same again for a second trade" is
a thing to do once the first one has met the bench. Doing both at once means tuning two sets of
inputs against one hundred-day run and not knowing which moved what.

## Testing

- A village with a smithy, ore and timber makes gear; the same village without ore makes none and
  says so.
- `vacancies.ts` raises a smith in a village with a smithy and never in one without.
- Gear on the shelf obeys 138 and 139: it runs out, and its price moves with what is left.
- The economy bench: a village with a smithy should end a hundred days better off than the same
  village without one, and no village anywhere should mint a sword out of nothing.
