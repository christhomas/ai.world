# 138 — Local Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make what a meal costs a reading of what the village holds, charged to villagers and to the hero alike.

**Architecture:** One new pure module, `src/world/prices.ts`, that turns a village's store and its people into a price. `eat()` is handed that price for the morning instead of naming `FOOD.MEAL` itself; `aDaysDinner` works it out once per morning; the hero's counter scales the catalogue by the same reading. No told facts, no stock, no new state anywhere.

**Tech Stack:** TypeScript, vitest, `pnpm test`. No dependencies added.

**Spec:** `docs/138-local-prices.md`

## Global Constraints

- **A coin leaving one purse arrives in another.** A price changes the size of a transfer, never its direction. `deeds.ts` is not edited by this plan.
- **`purses.ts` stays the only place a villager's purse is written.** Nothing here bypasses it.
- **No told facts.** A price must be a pure function of the register on the morning it is charged, so a replayed village derives it without being told. Stock, depletion and purchases are item 139.
- **Gear is untouched.** Only food has a supply the sim knows about; a sword keeps `items.ts`'s constant until item 140.
- **`FOOD.MEAL` is 1** and stops meaning "what dinner costs"; it means "what dinner costs at even cover".
- **`FOOD.KEEPS_DAYS` is 12**, and `cellarCap(people)` is `Math.max(12, people.length * 12)`.
- Existing behaviour at even cover must be within rounding of today's, or the bench's hundred-day results become unreadable.

---

## File Structure

- **Create `src/world/prices.ts`** — cover, the curve, the meal price, the dearness multiplier. Pure; no imports from `src/game`.
- **Create `src/world/prices.test.ts`** — the curve on its own.
- **Modify `src/world/food.ts`** — `eat()` takes the day's price.
- **Modify `src/world/food.test.ts`** — dearness reaches the dinner table.
- **Modify `src/world/livelihoods.ts`** — `aDaysDinner` reads the price once for the morning.
- **Modify `src/world/livelihoods.test.ts`** — a hungry village pays its growers more.
- **Modify `src/game/talk.ts`** — `asking()` scales edibles by the village's dearness.
- **Create `src/game/shopprice.test.ts`** — the hero pays what the village charges.

---

### Task 1: The price module

**Files:**
- Create: `src/world/prices.ts`
- Test: `src/world/prices.test.ts`

**Interfaces:**
- Consumes: `FOOD`, `cellarCap` from `./food`; `Person` from `./people`.
- Produces: `PRICES`, `coverOf(store: number, people: readonly Person[]): number`, `priceOfAMeal(store: number, people: readonly Person[]): number`, `dearnessOfFood(store: number, people: readonly Person[]): number`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { FOOD } from './food';
import { PRICES, coverOf, dearnessOfFood, priceOfAMeal } from './prices';
import type { Person } from './people';

const soul = (trade = 'farmer'): Person => ({
  id: `p${Math.random()}`, name: 'Maren', village: 'Ashford', sex: 'woman', trade, born: -30, lives: 70,
  mother: '', father: '', knows: [], memories: [], opinions: [], purse: 50, hungry: 0,
});

describe('what a meal costs where it is eaten', () => {
  const five = [soul(), soul(), soul(), soul(), soul()];

  it('reads cover as the store against what a cellar holds', () => {
    expect(coverOf(60, five)).toBeCloseTo(1);   // 5 people x 12 days
    expect(coverOf(30, five)).toBeCloseTo(0.5);
    expect(coverOf(0, five)).toBe(0);
  });

  it('is cheapest where the cellar is full', () => {
    expect(priceOfAMeal(60, five)).toBeCloseTo(FOOD.MEAL * PRICES.CHEAP);
  });

  it('is dearest where there is nothing', () => {
    expect(priceOfAMeal(0, five)).toBeCloseTo(FOOD.MEAL * PRICES.DEAR);
  });

  it('never goes below the floor however full the cellar is', () => {
    expect(priceOfAMeal(6000, five)).toBeCloseTo(FOOD.MEAL * PRICES.CHEAP);
  });

  it('falls as the cellar fills, with no step anywhere in it', () => {
    let last = Infinity;
    for (let store = 0; store <= 60; store += 5) {
      const now = priceOfAMeal(store, five);
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
  });

  it('answers for a village with nobody in it rather than dividing by nought', () => {
    expect(Number.isFinite(priceOfAMeal(0, []))).toBe(true);
  });

  it('reports dearness as what a meal costs against what it costs at even cover', () => {
    expect(dearnessOfFood(0, five)).toBeCloseTo(PRICES.DEAR);
    expect(dearnessOfFood(60, five)).toBeCloseTo(PRICES.CHEAP);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/world/prices.test.ts`
Expected: FAIL — `Failed to resolve import "./prices"`.

- [ ] **Step 3: Write the module**

```ts
import { FOOD, cellarCap } from './food';
import type { Person } from './people';

/**
 * What a meal costs where it is eaten, which until item 138 was the same number everywhere.
 *
 * `FOOD.MEAL` used to be what dinner cost. It is now what dinner costs at even cover — a full
 * cellar — and what is actually charged is this, read off the store the village is audited on
 * every morning anyway. Nothing new is measured here; a price simply stops being declared.
 *
 * Pure, and deliberately so. A price is a function of the register on the morning it is charged,
 * and `relive` rebuilds the register morning by morning, so a replayed village works out the same
 * prices without being told anything. See `docs/138-local-prices.md`.
 */
export const PRICES = {
  /** What a meal costs where the cellar is full, against `FOOD.MEAL`. */
  CHEAP: 0.6,
  /** And where there is nothing left. Both are measured against the bench, not chosen. */
  DEAR: 3,
} as const;

/** What a village holds against what its cellar is for: 1 is full, 0 is empty. */
export function coverOf(store: number, people: readonly Person[]): number {
  return Math.max(0, store) / cellarCap(people);
}

/** Smooth between the two ends, so no village crosses a cliff between two mornings. */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * What one meal costs in this village today.
 *
 * Clamped at both ends on purpose: free food would be a source, and an unbounded price would
 * starve people for a reason that is not about food.
 */
export function priceOfAMeal(store: number, people: readonly Person[]): number {
  const cover = smoothstep(coverOf(store, people));
  return FOOD.MEAL * (PRICES.DEAR + (PRICES.CHEAP - PRICES.DEAR) * cover);
}

/**
 * The same reading as a multiplier, for the things priced off a catalogue rather than in meals.
 *
 * A loaf on a shop's shelf is not counted in meals until item 139 gives the shelf a bottom, so
 * what the hero pays moves with the village by the same factor the village's own dinner does.
 */
export function dearnessOfFood(store: number, people: readonly Person[]): number {
  return priceOfAMeal(store, people) / FOOD.MEAL;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm vitest run src/world/prices.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/world/prices.ts src/world/prices.test.ts
git commit -m "A meal has a price where it is eaten"
```

---

### Task 2: `eat()` charges the day's price

**Files:**
- Modify: `src/world/food.ts` (`eat`, around line 246)
- Test: `src/world/food.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime — the price arrives as an argument, so `food.ts` does not import `prices.ts` and the two stay independently testable.
- Produces: `eat(people: readonly Person[], store: number, price?: number): Meal`, where `price` defaults to `FOOD.MEAL` so that every existing caller and test keeps its present meaning.

- [ ] **Step 1: Write the failing test**

Append to the `describe('eating', ...)` block in `src/world/food.test.ts`:

```ts
  it('charges the price it is given rather than the constant', () => {
    const folk = [soul('farmer', 10)];
    const meal = eat(folk, 5, 2.5);
    expect(meal.spent).toBe(2.5);
    expect(folk[0].purse).toBe(7.5);
  });

  it('turns away somebody who cannot afford today’s price but could afford yesterday’s', () => {
    const folk = [soul('farmer', 1.5)];
    const meal = eat(folk, 5, 2.5);
    expect(meal.fed).toBe(0);
    expect(meal.hungry).toBe(1);
    expect(folk[0].purse).toBe(1.5);
  });

  it('still feeds children for nothing when the price is high', () => {
    const folk = [soul('', 0)];
    const meal = eat(folk, 5, 2.5);
    expect(meal.fed).toBe(1);
    expect(meal.spent).toBe(0);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/world/food.test.ts -t "charges the price it is given"`
Expected: FAIL — `expected 1 to be 2.5`, because the third argument is ignored.

- [ ] **Step 3: Change `eat`**

Replace the signature and the three places `FOOD.MEAL` appears inside it:

```ts
export function eat(people: readonly Person[], store: number, price: number = FOOD.MEAL): Meal {
  const meal: Meal = { fed: 0, hungry: 0, eaten: 0, spent: 0, starved: [] };
  let left = store;

  const order = [...people].sort((a, b) => b.purse - a.purse);
  for (const person of order) {
    // A child is fed by whoever is raising them and does not buy their own dinner. Without this
    // every village in the world dies out: children have no trade, so no income, so no way to pay
    // for bread, and they starve at seven days old while the adults around them eat.
    const dependent = !person.trade;
    const canPay = dependent || person.purse >= price;
    if (left >= 1 && canPay) {
      left -= 1;
      if (!dependent) { person.purse -= price; meal.spent += price; }
      person.hungry = 0;
      meal.fed++;
      meal.eaten += 1;
      continue;
    }
    // nothing to eat, or nothing to buy it with. A day without costs a heart, and the last one
    // costs him the rest
    person.hungry = (person.hungry ?? 0) + 1;
    meal.hungry++;
    if (heartsLeft(person) <= 0) meal.starved.push(person);
  }
  return meal;
}
```

Add to the doc comment above `eat`, which must say why the price is an argument:

```
 * The price is handed in rather than read, and that is the whole of item 138's join. A meal costs
 * what it costs in *this* village today, which `prices.ts` works out from the store; `eat` is not
 * the place that decides it, because the decision belongs to the morning rather than to the meal.
 * The default keeps every caller that has not been told about prices yet meaning what it meant.
```

- [ ] **Step 4: Run the file and watch it pass**

Run: `pnpm vitest run src/world/food.test.ts`
Expected: PASS — the three new tests and every existing one, unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/world/food.ts src/world/food.test.ts
git commit -m "Dinner is charged at the price it is given"
```

---

### Task 3: The morning sets one price for everybody

**Files:**
- Modify: `src/world/livelihoods.ts` (`aDaysDinner`, around line 527)
- Test: `src/world/livelihoods.test.ts`

**Interfaces:**
- Consumes: `priceOfAMeal` from Task 1; `eat(people, store, price)` from Task 2.
- Produces: no signature change. `aDaysDinner(people, store, work): Dinner` keeps its shape; what changes is that `meal.spent` is now larger in a hungry village, which `paidForFood` already divides among whoever fed the place.

- [ ] **Step 1: Write the failing test**

Add to `src/world/livelihoods.test.ts`:

```ts
describe('what a village pays for its own dinner', () => {
  it('spends more on the same meals where the cellar is nearly empty', () => {
    const folk = [soul('farmer'), soul('miner'), soul('seller')];
    const work = aDaysTrade(folk, 0, 0, { trades: [] });
    const full = aDaysDinner(folk.map(copy), 36, work);
    const bare = aDaysDinner(folk.map(copy), 3, work);
    expect(bare.paid.size).toBeGreaterThan(0);
    expect(total(bare.paid)).toBeGreaterThan(total(full.paid));
  });

  it('charges every villager the same price on one morning', () => {
    const rich = soul('miner', 400);
    const poor = soul('farmer', 4);
    const folk = [rich, poor];
    const before = { rich: rich.purse, poor: poor.purse };
    aDaysDinner(folk, 2, aDaysTrade(folk, 0, 0, { trades: [] }));
    expect(before.rich - rich.purse).toBeCloseTo(before.poor - poor.purse);
  });
});
```

Add the two helpers beside the file's existing ones if they are not already there:

```ts
const copy = (p: Person): Person => ({ ...p });
const total = (paid: ReadonlyMap<string, number>): number => [...paid.values()].reduce((a, b) => a + b, 0);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/world/livelihoods.test.ts -t "what a village pays for its own dinner"`
Expected: FAIL on the first test — the two totals are equal, because dinner costs `FOOD.MEAL` either way.

- [ ] **Step 3: Read the price once for the morning**

In `aDaysDinner`, after `food` is worked out and before `eat` is called:

```ts
  const spare = Math.max(0, all - food);
  // One price for the morning, read off the store as it opened. Not recomputed as the cellar
  // drains: `eat` feeds richest-first, so a price that rose through the queue would charge the
  // poorest most, every morning, as a side effect of an ordering chosen for something else.
  const meal = eat(people, food, priceOfAMeal(food, people));
```

and add the import at the top of `livelihoods.ts`:

```ts
import { priceOfAMeal } from './prices';
```

- [ ] **Step 4: Run the file and watch it pass**

Run: `pnpm vitest run src/world/livelihoods.test.ts`
Expected: PASS. Existing bounds in this file hold what a trade clears in a day — if any of them fail, do not relax them; record the numbers and carry them into Task 5, which is where they are re-measured.

- [ ] **Step 5: Commit**

```bash
git add src/world/livelihoods.ts src/world/livelihoods.test.ts
git commit -m "A village charges one price for a morning's dinner"
```

---

### Task 4: The hero pays what the village charges

**Files:**
- Modify: `src/game/talk.ts` (`asking`, line 507-510)
- Create: `src/game/shopprice.test.ts`

**Interfaces:**
- Consumes: `dearnessOfFood` from Task 1; `Register.larderOf(village)` and `Register.living(village)`, both already public.
- Produces: `asking` keeps its shape and gains a village reading for edibles.

Note for the implementer: `furs.ts` already carries the cautionary tale for this task. `paidAtACounter` exists because a fur's price was worked out in one place and paid in another, so the game quoted twenty-three gold and paid thirteen. Anything that quotes a price here must be the same call that charges it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { FOOD } from '../world/food';
import { PRICES } from '../world/prices';
import { ITEMS } from './items';
import { askingFor } from './talk';
import { Register } from '../world/register';

describe('what a shop asks for food', () => {
  const register = new Register(1);

  it('asks more for bread in a village with an empty cellar than in a full one', () => {
    register.settle('Ashford', 8, ['seller', 'farmer']);
    const people = register.living('Ashford');
    const dear = askingFor(ITEMS.bread, 0, people, 0);
    const cheap = askingFor(ITEMS.bread, cellarFull(people), people, 0);
    expect(dear).toBeGreaterThan(cheap);
  });

  it('leaves a sword alone, because nobody in the world makes one yet', () => {
    const people = register.living('Ashford');
    expect(askingFor(ITEMS.sword, 0, people, 0)).toBe(ITEMS.sword.price);
  });

  it('still adds what the shopkeeper thinks of you', () => {
    const people = register.living('Ashford');
    const plain = askingFor(ITEMS.bread, 0, people, 0);
    const surly = askingFor(ITEMS.bread, 0, people, 0.5);
    expect(surly).toBeGreaterThan(plain);
  });
});

const cellarFull = (people: readonly { id: string }[]): number => people.length * FOOD.KEEPS_DAYS;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/game/shopprice.test.ts`
Expected: FAIL — `askingFor` is not exported from `./talk`.

- [ ] **Step 3: Split the reading out of `asking` and export it**

In `src/game/talk.ts`, replace `asking`:

```ts
/**
 * What they are asking today: the catalogue, what the village has to spare, and what he thinks of
 * you — in that order, and worked out in one place.
 *
 * Edibles only. A loaf is the thing this village grows and eats, so its price moves with the
 * cellar; a sword is made by nobody here until item 140 and keeps the catalogue's number. Exported
 * because a quoted price and a charged price that are worked out separately drift apart — see
 * `paidAtACounter` in `furs.ts`, which exists because exactly that happened.
 */
export function askingFor(
  item: { price: number; effect?: unknown; slot?: unknown },
  larder: number, people: readonly Person[], markup: number,
): number {
  const edible = item.effect !== undefined && item.slot === undefined;
  const local = edible ? item.price * dearnessOfFood(larder, people) : item.price;
  return Math.round(local * (1 + markup));
}

function asking(s: Counter, item: Item): number {
  const register = s.ctx.register ?? null;
  return askingFor(
    item,
    register?.larderOf(s.village) ?? 0,
    register?.living(s.village) ?? [],
    s.ctx.markup ?? 0,
  );
}
```

with these imports added at the top of the file:

```ts
import { dearnessOfFood } from '../world/prices';
import type { Person } from '../world/people';
```

`buyOne` already calls `asking(s, item)` for both the quote and the charge, so nothing else moves.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm vitest run src/game/shopprice.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/game/talk.ts src/game/shopprice.test.ts
git commit -m "A shop asks what its own village can spare"
```

---

### Task 5: Hold the whole world to it, and re-measure what moved

**Files:**
- Modify: `src/game/economy.test.ts` (the bench)
- Modify: `src/world/prices.ts` (`PRICES`, if the bench says so)
- Modify: `src/world/prosperity.ts` (`PROSPER` thresholds, if the bench says so)

**Interfaces:**
- Consumes: everything above.
- Produces: a hundred-day run whose report is the evidence for the constants.

- [ ] **Step 1: Run the whole suite before touching the bench**

Run: `pnpm test`
Expected: the baseline for this branch is 296 files and 3092 tests passing. Anything failing here is this plan's doing and is fixed before going on.

- [ ] **Step 2: Run the bench and read it**

Run: `pnpm vitest run src/game/economy.test.ts` then read `economy-report.txt`.
Expected: the per-coin audits still PASS. Write down what moved: how many villages reach two storeys, how many a bath house, what the middle working villager holds, and how many funerals.

- [ ] **Step 3: Add the two assertions this item is for**

```ts
  it('charges more for dinner where there is less of it', () => {
    // two villages of the same size, one with a full cellar and one nearly out
    expect(priceOfAMeal(2, folk)).toBeGreaterThan(priceOfAMeal(cellarCap(folk), folk));
  });

  it('never makes a coin: what the village spent on dinner is what its growers were paid', () => {
    // over the hundred days, the sum of every purse either side of a morning is unchanged
    expect(mintedOverTheRun).toBe(0);
  });
```

- [ ] **Step 4: Retune against the report, not against taste**

If the bench shows villages starving where they used to survive, lower `PRICES.DEAR` before touching anything in `prosperity.ts` — the ceiling is this item's own number and `PROSPER`'s thresholds are somebody else's. If it shows a village reaching two storeys markedly sooner or later than the twelve-in-twenty-one the report last recorded, move `PROSPER.STOREY` and say in its comment that prices moved underneath it, which is the same sentence it already carries about the mines.

- [ ] **Step 5: Commit, with the numbers in the message**

```bash
git add src/game/economy.test.ts economy-report.txt src/world/prices.ts src/world/prosperity.ts
git commit -m "What a hundred days cost once dinner had a price"
```

---

## Self-Review

**Spec coverage.** The module, the curve and its floor and ceiling (Task 1); one price per morning and the reason it is not recomputed per person (Task 3); `eat()` charging it and `canPay` moving with it (Task 2); the hero reading the same number (Task 4); `aDaysDinner` needing no change beyond a larger pool (Task 3, by construction); the bench as the judge and the `PROSPER` retune (Task 5). The spec's out-of-scope list — stock, gear, `FOOD.ABROAD` — is named in the Global Constraints so no task reaches for it.

**Determinism.** No task adds a told fact, a `Change`, or any state. `prices.ts` holds none, which is what keeps `relive` correct without a test for it.

**Names.** `coverOf`, `priceOfAMeal`, `dearnessOfFood`, `PRICES.CHEAP`, `PRICES.DEAR`, `askingFor` — used identically in Tasks 1, 3, 4 and 5.

**One risk left deliberately open.** `eat()` feeds richest-first and dear food makes that harder, not gentler. Task 5 Step 2 is where it would show, as villages dying that used to live, and Step 4 says what to move first.
