/**
 * The other side of a counter.
 *
 * Split out of `talk.ts`, which was at the seven hundred lines `architecture.test.ts` allows. The
 * seam is the obvious one: everything here is about a shop, needs only a `Counter` to work from,
 * and `talk.ts` reaches it through the single door `shopDialogue` — so a conversation with a
 * villager and a conversation across a trestle no longer share a file merely because both are
 * conversations.
 */
import { capitalise, pick, stepWithin } from './dials';
import { personTill } from './tills';
import { bookRows } from './enquiry';
import { saidOfAChart } from './cartography';
import { AWAY, buy, give, holds } from '../world/deeds';
import { isDaytime, type Entity } from '../entities/entity';
import type { DialogueChoice, DialogueNode, Speaker } from '../ui/dialogue';
import { askingFor, offTheShelf } from './shopprice';
import { ITEMS, SHOP_DEFS, type ShopDef, itemSummary, sellPrice, sellableAt } from './shops';
import { WOOD_ITEM } from './items';
import { paidAtACounter } from './furs';
import { faceFor, type TalkCtx } from './talk';

/** Gold that rides along with a parcel, so a gift can be more than a thing. */
const PARCEL_GOLD = 10;

/**
 * Everything one conversation across a counter is about: who is talking, what they deal in, and
 * how many of a thing the player has dialled up to sell.
 *
 * It exists so each turn of the conversation below is a function you can read on its own. The tree
 * used to be one function of nested closures, so the shape of the conversation was only visible as
 * the shape of the code and buying a lantern lived thirty columns in from the margin.
 */
interface Counter {
  e: Entity;
  ctx: TalkCtx;
  def: ShopDef;
  /** What the panel puts above the words, and the face it draws beside them. */
  speaker: string;
  emoji: string;
  face: Speaker | undefined;
  /** Where this counter stands, for the small talk. */
  village: string;
  /**
   * How many of each thing the player means to sell, keyed by item.
   *
   * It has to outlive a single menu because the sell list is rebuilt from scratch every time an
   * arrow nudges a number, and the number is the whole point of the arrows.
   */
  wanted: Map<string, number>;
}

/** One thing said across the counter, and whatever the player may say back to it. */
function across(s: Counter, pages: string[], choices?: DialogueChoice[]): DialogueNode {
  const node: DialogueNode = { speaker: s.speaker, emoji: s.emoji, face: s.face, pages };
  if (choices) node.choices = choices;
  return node;
}

/**
 * A shopkeeper, from hello to goodbye.
 *
 * The conversation is a handful of rooms with doors between them: the counter itself, and from
 * there the stock, the trestle you sell off, the post shelf, a bed, or the weather. Each is a
 * function below, and every door is a `next` that names the room it opens onto — so the tree is
 * read by following the names rather than by counting braces.
 */
export function shopDialogue(e: Entity, ctx: TalkCtx): DialogueNode {
  const def = SHOP_DEFS[e.shop!];
  const counter: Counter = {
    e, ctx, def,
    speaker: `${e.name}, ${def.title}`,
    emoji: e.kind.emoji,
    face: faceFor(e, ctx),
    village: e.herd.tag || 'town',
    wanted: new Map(),
  };
  return isDaytime(ctx.time) ? shopRoot(counter) : afterHours(counter);
}

/**
 * A shop after dark, which is a closed door — except at an inn, where the beds are the reason it
 * is open at all, so the innkeeper answers and takes your money for one.
 */
function afterHours(s: Counter): DialogueNode {
  const { ctx } = s;
  if (s.e.shop === 'inn' && ctx.room) {
    return across(s, ['The kitchen is cold and the taps are off, but the beds are made and the door locks.'], [
      { label: `Take a room (${ctx.room.price}g)`, next: () => bedMenu(s) },
      { label: 'Back out into the dark', next: () => null },
    ]);
  }
  return across(s, [`The ${s.def.name.toLowerCase()} is shut for the night. Come back after dawn.`]);
}

/** The counter itself: everything this keeper can be asked for, in one list. */
function shopRoot(s: Counter): DialogueNode {
  const { ctx } = s;
  const innkeeper = s.e.shop === 'inn';
  return across(s, [pick(ctx.rng, s.def.greetings)], [
    { label: 'Buy', next: () => buyMenu(s) },
    { label: 'Sell', next: () => sellMenu(s) },
    ...(innkeeper && ctx.room ? [{ label: `Take a room (${ctx.room.price}g)`, next: () => bedMenu(s) }] : []),
    ...(innkeeper && ctx.post ? [{ label: 'The post shelf', next: () => postMenu(s) }] : []),
    // an apothecary keeps the parish's births beside the jars, and the row for it sits with the
    // rest of what is on offer rather than being hidden under the small talk
    ...(ctx.enquiry ? bookRows(s, ctx.enquiry, () => shopRoot(s)) : []),
    { label: 'Chat', next: () => chatMenu(s) },
    { label: 'Leave', next: () => null },
  ]);
}

/** A bed for the night: the sensible answer to a dark road and no hearts left. */
function bedMenu(s: Counter): DialogueNode {
  const room = s.ctx.room!;
  const purse = s.ctx.state.inventory.gold;
  if (purse < room.price) {
    return across(s, [`A room is ${room.price} gold, and you have ${purse}.`], [
      { label: 'Back', next: () => shopRoot(s) },
    ]);
  }
  // a bed that costs nothing is one somebody decided you were not to be charged for, and saying
  // so is the whole point of having earned it
  const settled = room.price === 0 ? 'Your money is no good here, not after what you did. ' : '';
  const upstairs = room.shared
    ? 'Upstairs, first on the left. The night is the night — it will pass at its own pace — but you will pass it warm and safe.'
    : 'Upstairs, first on the left. Sleep as long as you like; I will wake you at dawn.';
  return across(s, [settled + upstairs], [
    { label: 'Sleep', next: () => slept(s, room.take()) },
    { label: 'Not tonight', next: () => shopRoot(s) },
  ]);
}

/** How long the sleep menu waits before deciding for you, in seconds. */
const BEFORE_DAWN = 30;

/**
 * The morning after, and the only place this game offers to stop playing.
 *
 * Not a save prompt — the room has already been paid for and written down, and `persist` ran inside
 * `take`. It says *you are safe here, and this is the moment to go if you are going*, which is a
 * different thing and worth a menu of its own: a bed is the one place a body can be left somewhere
 * that can be described, and #262 has to put it back exactly there.
 *
 * It counts down to *wake up* rather than to *leave*, because a menu that quits the game on its own
 * would be a menu that quit the game while somebody was reading it. And the count stops the moment
 * anything is pressed: after that the choice is theirs, however long they take over it.
 */
function slept(s: Counter, said: string): DialogueNode {
  const node = across(s, [said], [
    { label: 'Up and out', next: () => null },
    { label: 'Leave the world here', next: () => { s.ctx.room!.leave(); return null; } },
  ]);
  node.expires = { after: BEFORE_DAWN, label: 'up and out in %ss', next: () => null };
  return node;
}

/**
 * Names and things fit on the shelf menu. Beyond this a list stops being a list you can read and
 * starts being one you scroll, and the post shelf is not worth a scrollbar.
 */
const SHELF_ROWS = 8;

/** The inn's shelf: take what is addressed to you, or leave something for somebody else. */
function postMenu(s: Counter): DialogueNode {
  const post = s.ctx.post!;
  return across(s, ['Parcels go on the shelf behind me. Anything left is handed over at any inn in the land.'], [
    { label: 'Anything for me?', next: () => { post.collect(); return null; } },
    { label: 'Leave a parcel', next: () => parcelMenu(s) },
    { label: 'Back', next: () => shopRoot(s) },
  ]);
}

/** What is going on the shelf, out of what is in the pack. */
function parcelMenu(s: Counter): DialogueNode {
  const post = s.ctx.post!;
  const carried = [...s.ctx.state.inventory.items.entries()].filter(([id]) => ITEMS[id]);
  if (carried.length === 0 || post.folk.length === 0) {
    const why = carried.length === 0 ? 'You have nothing to send.' : 'No one else has passed through this world yet.';
    return across(s, [why], [{ label: 'Back', next: () => postMenu(s) }]);
  }
  return across(s, ['What are you sending?'], [
    ...carried.slice(0, SHELF_ROWS).map(([id]) => ({
      label: `${ITEMS[id].emoji} ${ITEMS[id].name}`,
      next: () => addressMenu(s, id),
    })),
    { label: 'Back', next: () => postMenu(s) },
  ]);
}

/** Who the parcel is for, out of everybody this world has seen. */
function addressMenu(s: Counter, itemId: string): DialogueNode {
  const post = s.ctx.post!;
  return across(s, [`${ITEMS[itemId].name}, and ${PARCEL_GOLD} gold for the carriage. Who is it for?`], [
    ...post.folk.slice(0, SHELF_ROWS).map((name) => ({
      label: name,
      // the carriage is paid if it can be afforded and waived if it cannot, because a parcel that
      // refuses to go for want of ten gold is a feature nobody meets twice
      next: () => { post.send(name, itemId, s.ctx.state.inventory.gold >= PARCEL_GOLD ? PARCEL_GOLD : 0); return null; },
    })),
    { label: 'Never mind', next: () => postMenu(s) },
  ]);
}

/** What they are asking today, which is the price plus whatever they think of you. */

function asking(s: Counter, item: { price: number; effect?: unknown; slot?: unknown }): number {
  const register = s.ctx.register ?? null;
  return askingFor(
    item,
    register?.larderOf(s.village) ?? 0,
    register?.living(s.village) ?? [],
    s.ctx.markup ?? 0,
  );
}

/** What is in the purse, said aloud, because a list of prices is no use on its own. */
function purseLine(s: Counter): string {
  return `You have ${s.ctx.state.inventory.gold} gold.`;
}

/**
 * The stock, with today's price against each thing, a tick beside what you already own, and what
 * each one actually does written underneath it.
 *
 * The shelf used to be names and prices, which asks a player to buy a thing to find out what it is
 * for. Every one of these notes was already on screen somewhere else — the rucksack and the journal
 * both show it — so a shop that withheld it was not being mysterious, it was the one place that
 * forgot.
 */
function buyMenu(s: Counter): DialogueNode {
  const dear = (s.ctx.markup ?? 0) > 0;
  const greeting = dear
    ? `Here's the stock, and my prices are my prices. ${purseLine(s)}`
    : `Here's the stock. ${purseLine(s)}`;
  return across(s, [greeting], [
    ...s.def.items.map((id) => {
      const item = ITEMS[id];
      // a map is ticked when it is this valley you have already bought, not when you own the thing
      const owned = s.ctx.state.owns(id) || (item.charts && s.ctx.state.hasChart(s.e.x, s.e.z)) ? ' ✓' : '';
      return {
        label: `${item.emoji} ${item.name} — ${asking(s, item)}g${owned}`,
        // what it gives you, and failing that what it is: a sack of ore grants nothing and still
        // wants a line, or the row reads as an item whose note went missing
        note: itemSummary(item) || item.desc,
        next: () => buyOne(s, item.id),
      };
    }),
    { label: 'Back', next: () => shopRoot(s) },
  ]);
}

/** Purchases go into the rucksack; a map charts country instead, for which see `cartography.ts`. */
function buyOne(s: Counter, id: string): DialogueNode {
  const { ctx } = s;
  const item = ITEMS[id];
  const price = asking(s, item);
  // he will not sell you the country round his own shop twice, and says so before any money is out
  if (item.charts && ctx.state.hasChart(s.e.x, s.e.z)) {
    return across(s, [saidOfAChart(s.village, true)],
      [{ label: 'Back', next: () => buyMenu(s) }, { label: 'Leave', next: () => null }]);
  }
  if (ctx.state.inventory.gold < price) {
    return across(s, [`That's ${price} gold, friend. You've only got ${ctx.state.inventory.gold}.`], [
      { label: 'Back', next: () => buyMenu(s) },
      { label: 'Leave', next: () => null },
    ]);
  }
  // food comes off the village's own shelf, and if it is not there it is not for sale. Asked
  // before the money moves; see `offTheShelf` in `shopprice.ts` for why that order matters
  if (!offTheShelf(ctx.register ?? null, s.village, item)) {
    return across(s, [`We're out of that, friend. ${s.village} has none to spare today.`], [
      { label: 'Back', next: () => buyMenu(s) },
      { label: 'Leave', next: () => null },
    ]);
  }
  // the shopkeeper is paid, and he is somebody: `e.person` is his row on the register, which
  // outlives the body behind the counter
  buy(holds(ctx.state.inventory), personTill(ctx.register ?? null, s.e.person, s.village), price);
  // the province the counter stands in, which is the country the map is of
  if (item.charts) ctx.state.chart(s.e.x, s.e.z);
  else ctx.state.give(item.id, 1);
  ctx.onInventoryChange();
  const note = itemSummary(item);
  return across(s, [
    `${item.name}, good choice. That's ${price} gold.`,
    item.charts ? saidOfAChart(s.village, false) : `It's in your pack.${note ? ` ${capitalise(note)}.` : ''}`,
  ], [
    { label: 'Buy more', next: () => buyMenu(s) },
    { label: 'Sell something', next: () => sellMenu(s) },
    { label: 'Done', next: () => null },
  ]);
}

/** The trestle: everything in the pack this shop deals in, with a number against each. */
function sellMenu(s: Counter): DialogueNode {
  const { ctx } = s;
  // priced where the counter stands, so a row says what the sale will actually pay: a fur is worth
  // more in a country that has none of it. See `paidAtACounter`
  const stock = sellableAt(s.def, ctx.state.inventory.items.entries(),
    (id, item) => paidAtACounter(id, item.price, ctx.country));
  if (stock.length === 0) {
    const refusal = `Nothing in that pack I can use. ${s.def.name === 'Inn' ? 'Fish and food, mind.' : ''}`.trim();
    return across(s, [refusal], [{ label: 'Back', next: () => shopRoot(s) }]);
  }
  const all = stock.reduce((sum, row) => sum + row.price * row.count, 0);
  // anything sold, dropped or eaten since the last look can strand a number above what is in the
  // pack, and offering to sell nine of six is how a shop loses money
  for (const { item, count } of stock) {
    const asked = s.wanted.get(item.id);
    if (asked !== undefined) s.wanted.set(item.id, Math.max(1, Math.min(count, asked)));
  }
  return across(s, [`Let's see what you've got. ${purseLine(s)}`], [
    ...stock.map((row) => sellRow(s, row)),
    ...(stock.length > 1 || stock[0].count > 1 ? [{ label: `Sell the lot (${all}g)`, next: () => sellAll(s, stock) }] : []),
    { label: 'Back', next: () => shopRoot(s) },
  ]);
}

/**
 * One thing on the trestle, and the dial that says how many of it you mean.
 *
 * Selling a stack of twenty pelts used to mean twenty trips through the same three lines of
 * patter, and the only way out of that was "sell the lot", which empties the pack of everything —
 * no use at all when you are keeping four apples and selling the rest. Left and right on this row
 * set the number, so the common case is two taps rather than twenty.
 */
function sellRow(s: Counter, { item, count, price }: ReturnType<typeof sellableAt>[number]): DialogueChoice {
  const n = Math.max(1, Math.min(count, s.wanted.get(item.id) ?? 1));
  // the arrows are only worth drawing where there is more than one to argue about
  const dial = count > 1 ? `  ◀ ${n} of ${count} ▶` : '';
  return {
    label: `${item.emoji} ${item.name} — ${price * n}g${dial}`,
    next: () => sellSome(s, item.id, n),
    adjust: (dir: number): DialogueNode | null => {
      if (count <= 1) return null;
      // it wraps rather than stopping at the ends, for the reason stepWithin sets out below
      s.wanted.set(item.id, stepWithin(n, dir, count));
      return sellMenu(s);
    },
  };
}

/** Hand over some number of one thing and take the coin for it. */
function sellSome(s: Counter, id: string, n: number): DialogueNode {
  const { ctx } = s;
  const item = ITEMS[id];
  const sold = ctx.state.take(id, n);
  if (sold === 0) return sellMenu(s);
  const paid = paidAtACounter(id, item.price, ctx.country) * sold;
  if (id === WOOD_ITEM) ctx.yard?.(s.village, sold);   // it has reached this village; see `TalkCtx.yard`
  // from outside the valley rather than out of his purse: a villager holds tens of gold and you
  // walk in with hundreds of gold of pelts, which go on to a city this game never draws. Out of
  // his purse it is a village that will not buy your furs, or one a morning's hunting empties
  give(AWAY, holds(ctx.state.inventory), paid);
  ctx.onInventoryChange();
  // "4 × Wolf Pelt" rather than "4 Wolf Pelt": the names are singular and pluralising them
  // properly would mean a plural for every item in the game to avoid writing "4 Breads"
  const named = sold > 1 ? `${sold} × ${item.name}` : item.name;
  return across(s, [`${named} for ${paid} gold. Done.`], [
    { label: 'Sell more', next: () => sellMenu(s) },
    { label: 'Buy something', next: () => buyMenu(s) },
    { label: 'Done', next: () => null },
  ]);
}

/** Empty the pack of everything this shop deals in, in one go. */
function sellAll(s: Counter, stock: ReturnType<typeof sellableAt>): DialogueNode {
  const { ctx } = s;
  let paid = 0;
  // the same local price one sale gets: the lot must never be worth less than one at a time
  for (const { item, count } of stock) {
    const sold = ctx.state.take(item.id, count);
    paid += paidAtACounter(item.id, item.price, ctx.country) * sold;
    if (item.id === WOOD_ITEM) ctx.yard?.(s.village, sold);
  }
  give(AWAY, holds(ctx.state.inventory), paid);        // from outside the valley; see `sellSome`
  ctx.onInventoryChange();
  return across(s, [`The lot for ${paid} gold. Pleasure doing business.`], [
    { label: 'Buy something', next: () => buyMenu(s) },
    { label: 'Done', next: () => null },
  ]);
}

/** The weather, more or less: a keeper's own line, and how trade is treating them. */
function chatMenu(s: Counter): DialogueNode {
  return across(s, [s.e.line(s.ctx.rng), `Business is steady here in ${s.village}.`], [
    { label: 'Back', next: () => shopRoot(s) },
    { label: 'Leave', next: () => null },
  ]);
}

// where the sell dial's arithmetic lives now; re-exported so a caller need not care that it moved
