# 138 — A price from what a village holds

Design for worklist item 138. First of three: 139 needs this price, 140 needs 139's shelf.

## What is wrong today

There is no price model in this game. There are four separate places a price is decided, and none
of them can see the others:

- **`items.ts`** gives every item a `price` field. Bread is 8 everywhere in the world, for ever.
- **`FOOD.MEAL`**, which is 1, is what `eat()` charges every villager for dinner every morning
  whatever the cellar holds.
- **`FOOD.ABROAD`**, which is 0.45, is what a village's surplus fetches when it is carried to
  somebody else's market.
- **`soldAtMarket(people, sellerId, coin)`** takes the value of the thing as an argument, decided
  by whoever called it.

So a village with three farmers and no hunter sells meat at exactly the price of a village with
three hunters and no field, and a place that has been raided charges the same for bread as one with
a full granary. Nothing a village *is* reaches what it charges. Two consequences, and the second is
the one that matters: there is no reason to walk to the next valley to buy anything, and a bad
season shows up as hunger but never as a market.

## What changes

A price stops being declared and becomes a reading of the village it is charged in.

Nothing new is measured. The stock this reads is the stock the economy bench already audits to the
coin every morning: `food.ts` keeps the cellar and `cellarCap`, `fields.ts` answers `foodAt`,
`harvest.ts` runs the cattle and the fishing, and `holdings.ts` knows who works what.

## The module

`src/world/prices.ts`. World layer, no `THREE` in it, so `server/sim.ts` and
`src/workers/sim.worker.ts` both get it without a renderer. It holds no state: a price is a pure
function of the village as the register has it this morning.

```
priceOfAMeal(store: number, people: readonly Person[]): number
```

More goods follow the same shape as 139 and 140 give them stock. The signature deliberately takes
what it reads rather than a `Settlement`, so it can be called from the bench and from a test with
two numbers.

## The rule

**Cover** is what a village holds against what it needs: `store / cellarCap(people)`, where
`cellarCap` is `FOOD.KEEPS_DAYS` — twelve — a head. Cover of 1 is a full larder; cover of 0 is an
empty one.

`FOOD.MEAL` stops being what dinner costs and becomes **what dinner costs at even cover**. That is
the same demotion `rank.ts` gave the roof count when a vote became what made a town: the number
stays, and stops being the whole answer.

The curve, as a starting proposal for the bench to argue with:

- At cover of 1 or better, a meal costs `MEAL × CHEAP`, with `CHEAP = 0.6`.
- At cover of 0, a meal costs `MEAL × DEAR`, with `DEAR = 3.0`.
- Between them, `smoothstep`, so neither end has a cliff a villager could fall off between two
  mornings.
- Clamped at both ends. A price is never free, because free food is a source, and never unbounded,
  because a villager who cannot afford dinner at any price starves for a reason that is not about
  food.

Both constants are guesses and are expected to move. `livelihoods.test.ts` already holds every
trade in the game to clearing what a day costs it, and `prosperity.ts` records that its own two
thresholds have moved twice for exactly this kind of reason. The numbers are the output of the
bench, not an input to it.

## A price is set once for the morning

`eat()` walks the village feeding people one at a time, and the store falls as it goes. So there are
two readings of the rule, and only one of them is chosen: **the price is computed once, from the
store as the morning opened, and every villager pays the same.**

The alternative — recomputing as the cellar drains — is rejected for a reason that is not about
arithmetic. `eat()` feeds richest-first. A price that rose through the queue would therefore charge
the poorest most, every morning, in every village, as a side effect of an ordering chosen for quite
another purpose. Nobody would have decided that, and it is exactly the kind of rule that is
invisible until a player notices it.

## Who reads it

Three callers today, one number:

- **`eat()`** charges it instead of `FOOD.MEAL`, and tests affordability against it: `canPay` is
  currently `person.purse >= FOOD.MEAL` and becomes the same comparison against the day's price.
- **`aDaysDinner`** pays the growers out of `meal.spent`, which is already the pool that was
  actually paid rather than a rate — so it needs no change at all beyond the pool being larger in a
  hungry village. That is the behaviour worth having: food is worth more where there is less of it,
  and the people who grew it are the ones who get that money.
- **The hero's till.** `tills.ts` already lands his money in villagers' purses, so he pays what the
  village charges. A player paying by a different rule from the people around him would be two
  representations of one act.

## The hero

Decided, and 138 is designed against it: **the register knows him, the larder does not.** He has no
lifespan and does not starve, so he is not in the `eat()` queue, never pays `FOOD.MEAL` and never
appears in a village's dinner spend or displaces a villager at dinner.

He is still in the market. He buys, and once 139 gives the shelf a bottom, what he buys leaves the
cellar and moves the price for everybody else. Out of the queue, firmly in the market. A hero out
of both would be a money source with no goods cost, which is the fault the whole of `livelihoods.ts`
exists to have ended.

## What must not break

**A coin leaving one purse arrives in another.** A price changes the size of a transfer and never
its direction. `deeds.ts` is untouched: `buy`, `sell` and `transfer` already take a `price`, and all
that changes is that callers stop handing over a literal. `purses.ts` stays the only place a purse
is written, so the cap and the floor are still applied once and the surplus over `PROSPER.MOST`
still goes to the hall.

This is what makes the bench the judge of whether this is right: its per-coin audit over 1,655
village-days applies unchanged.

## Determinism

A price is a pure function of the register on the morning it is charged, and `relive` rebuilds the
register morning by morning. So a replayed village derives the same prices without being told
anything, and **138 introduces no told facts at all**.

That is worth stating plainly because it is exactly what stops being true in 139, and keeping this
item free of told facts is why the split runs in this order.

## Testing

- `src/world/prices.test.ts` — the curve itself: a full cellar, an empty one, cover beyond 1, a
  village of one person, and a village of none.
- `livelihoods.test.ts` — already holds every trade to clearing what a day costs it. Those bounds
  will move and must be re-measured rather than relaxed.
- The economy bench, `chore economy`, for the parts only a hundred days can show: that the sum of
  every purse is unchanged across a day at any price, that a village short of food charges more
  than one with a full cellar, and that the nine villages left alone still neither empty nor starve
  nor end broke.

## Known risk

`PROSPER`'s tuned numbers — the second-storey threshold at 85, the daily floor at 2 — were measured
in a world where dinner cost a constant. They will move. A retune pass against the bench is part of
this item rather than a surprise after it.

The second risk is sharper and wants watching in the bench rather than reasoning about here.
`eat()` feeds richest-first, and `food.ts:240` says in as many words that this means a village's
poor die first. Dear food makes that harder, not gentler. If a hundred days shows villages dying
where they used to survive, the answer is the curve's ceiling, not the queue.

## Out of scope

- Stock that can run out, and the hero moving it — 139.
- Gear, which has no maker and keeps its constant price until 140.
- `FOOD.ABROAD`, the price a surplus fetches in the next valley. It stays the flat 0.45 here.
  Making it a reading means reading a *neighbour's* cover, which is the first thing carriers
  between settlements will need — the natural 141 — and is not this item.
