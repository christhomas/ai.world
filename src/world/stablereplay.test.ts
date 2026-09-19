import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { herdRoomFor } from './stables';
import { ownedBy } from './holdings';

/**
 * A stable commissioned on the morning the register has already lived.
 *
 * The builder's morning runs beside the register rather than inside it: `tidings.ts` lives each
 * missed day — `builderDay(day)` and then `register.advance(day)` — and then, if no day was missed
 * at all, runs `builderDay(today)` once more so that a commission placed after the register's own
 * work still gets a morning.
 *
 * That last call is the one with the hole in it. `advance` lives every day *after* the one it is
 * standing on, so a purchase dated today, when the register is already on today, is never lived.
 * On a reopened save it appears out of nowhere: the founding is replayed, the day comes round
 * again, and the farmer is charged for a stable he commissioned in a session that has ended.
 *
 * The answer is to date it to the first morning the register has *not* lived, which in the missed-day
 * loop is the day being lived and after it is tomorrow. Both are one expression — `today + 1` —
 * and both are lived exactly once.
 */
/** What the farmer who bought it is holding, by the owner the purchase names. */
const purseOfFarmer = (book: Register, farmer: string): number =>
  book.living('Ashford').filter((one) => ownedBy(one) === farmer)
    .reduce((most, one) => most + one.purse, 0);

/** How many beasts this holding's rails will take, which is what a stable buys. */
const roomFor = (book: Register, holding: string): number =>
  herdRoomFor(book.worksOf('Ashford'), [holding]);

/*
 * Seed 44 at two hundred days, which is a village whose rails are full and whose farmers can
 * afford to widen them — `whichFarmerBuilds` refuses on both counts and most villages fail one.
 * Found by scanning rather than chosen: a seed where nothing is ever bought would let every
 * assertion below pass without measuring anything, which is its own kind of failure. Seeds 1 to 60
 * were lived to day two hundred and six of them buy; this one is picked from those six for having
 * the most room on *both* gates at once, which is the thing that keeps expiring.
 *
 * Re-scanned three times now, for the same reason every time. It was seed 1234 until bounded local
 * farm clearings (#126) changed what a village has built by day two hundred; then seed 10 until
 * local prices (#230) changed what a farmer can afford to have left over; then seed 11 until #384
 * stopped paying a farmer one number and feeding the village another. Each time the seed stopped
 * buying and four assertions here stopped measuring. A seed picked for a property is a seed that
 * has to be picked again when the property's inputs change, which is the cost of choosing one this
 * way and worth paying: the alternative is a village built by hand that no simulation ever
 * produces.
 *
 * **Which gate went last time is worth writing down, because nobody could tell from the failure.**
 * Seed 11 did not go broke. At day two hundred its herd stood at 88.81 against ninety beasts of
 * room, so `whichFarmerBuilds` returned on its very first line — *the rails have to be full before
 * anybody widens them* — and no purse was ever consulted. It had been 84.00 beasts in 84 of room,
 * exactly full, and #384 moved a farm's crop and with it the day a fifteenth farm was manned. The
 * same seed still buys at day three hundred with a farmer holding 3,038. So the margins are
 * recorded here for whoever scans next: on day two hundred this village holds **86.40 beasts
 * against 78 of room** and its richest farmer holds **1,605.39 against the 648 the bill wants**,
 * which is 8.4 spare on the rails and 2.5 times over on the purse.
 */
const aVillage = (): Register => {
  const book = new Register(44, 1);
  book.settle('Ashford', 8, ['farmer', 'seller', 'builder', 'woodcutter']);
  for (let day = 2; day <= 200; day++) book.advance(day);
  return book;
};

/** A yard with more timber in it than any stable costs, so the yard is never the thing refusing. */
const deepYard = () => {
  const held = new Map<string, number>();
  return {
    at: (village: string) => held.get(village) ?? 10_000,
    draw: (village: string, timber: number) => {
      held.set(village, (held.get(village) ?? 10_000) - timber);
      return true;
    },
  };
};

describe('a stable commissioned on a day already lived', () => {
  it('is dated the first morning the register has not lived, not the one it is standing on', () => {
    const book = aVillage();
    const yard = deepYard();
    const bought = book.commissionStable('Ashford', yard);
    expect(bought, 'this village was chosen because it buys one; a null here measures nothing')
      .not.toBeNull();
    expect(bought!.day, 'a purchase dated today is a purchase no advance will ever live')
      .toBeGreaterThan(book.today);
  });

  /*
   * The whole of it: the money moves and the paddock grows, in this session, without reopening.
   */
  it('is charged and built when the clock reaches that morning', () => {
    const book = aVillage();
    const yard = deepYard();
    const bought = book.commissionStable('Ashford', yard)!;
    expect(bought).not.toBeNull();

    const before = purseOfFarmer(book, bought.farmer);
    const roomBefore = roomFor(book, bought.holding);

    book.advance(book.today + 1);

    expect(purseOfFarmer(book, bought.farmer), 'the farmer paid for it').toBeLessThan(before);
    expect(roomFor(book, bought.holding), 'and the paddock holds more than it did')
      .toBeGreaterThan(roomBefore);
  });

  /*
   * And only once. The purchase is kept so a replay from the founding arrives at the same village,
   * which is the same reason a killing and a raising are kept — so the day it lands on must charge
   * for it exactly one time however often that day is lived.
   */
  it('is not charged twice when the same morning is asked for again', () => {
    const book = aVillage();
    const yard = deepYard();
    const bought = book.commissionStable('Ashford', yard)!;
    expect(bought).not.toBeNull();

    book.advance(book.today + 1);
    const once = purseOfFarmer(book, bought.farmer);
    book.advance(book.today);                 // the same day again, which a news cycle does
    expect(purseOfFarmer(book, bought.farmer),
      'a day lived twice must not be paid for twice').toBe(once);
  });

  it('refuses a second commission for the same village and morning', () => {
    const book = aVillage();
    const yard = deepYard();
    expect(book.commissionStable('Ashford', yard)).not.toBeNull();
    expect(book.commissionStable('Ashford', yard),
      'one village buys one stable a morning').toBeNull();
  });
});
