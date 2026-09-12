import { HIRE } from './hire';
import { SEASON_LENGTH } from './seasons';
import { LIFE } from '../world/people';
import { PROVINCE } from '../world/provinces';

/**
 * What a map costs, and why it is the dearest paper anybody in this world sells.
 *
 * Until tonight a map was a twenty-five gold trinket that lifted the fog off everything there is.
 * That is the cheapest thing in the game removing the most expensive thing in it, which is the
 * reason to walk anywhere: a tenth of a boat bought you the whole country, once, for ever, and
 * every hill you had not seen yet stopped being worth the walk. Two things were wrong with it and
 * only one of them was the price. The other was the extent — in a world without an edge, "the
 * region" is not a thing one sheet of paper can be a map of.
 *
 * So there are two maps now. One covers a province, which is the square the world is kept in and
 * therefore the only honest unit of country there is; it is sold in the villages that stand in it,
 * and what it charts is the country round the shop that sold it. The other is the whole of it, and
 * it is priced the way a thing nobody should get hold of easily ought to be priced.
 *
 * ---
 *
 * **What a day of somebody's work is worth.** Not invented here. `hire.ts` already quotes it, in
 * the hero's own coin, because buying a soldier's day is the one place in this game where a grown
 * adult's time is sold over a counter: `ASKING_LEAST` in the poorest village in the world and
 * `ASKING_MOST` in the richest. A mapmaker is not a soldier, but neither of them is being paid for
 * what he carries — both are being paid for a day of walking about in country with wolves in it —
 * so a day of his goes for the middle of that range and nothing is picked.
 *
 * **How many days are in a map of one province.** A week. A province is five hundred and twelve
 * tiles square and a walker only ever sees a chunk either side of himself, so somebody filling one
 * in on foot walks about eleven lengths of it — five and a half thousand tiles, which a hero could
 * do in an afternoon. The week is not the walking. It is the measuring, the pacing out and the
 * drawing, which is precisely the part the hero cannot do for himself and precisely what he is
 * buying. Seven days, which in this world is a season: `SEASON_LENGTH` rather than a seven typed
 * out here, so the week the price is reckoned in is the game's own week.
 *
 * **And in a map of the whole country.** This one cannot be reckoned by the province, and it is
 * worth saying why rather than quietly picking a big number. There is no count of provinces to
 * multiply by: the world has no edge, and a price that read one would be exactly the bug
 * `EDGE_OF_THE_WORLD` warns about — a figure that is true of a world with a middle and means
 * nothing in a world grown a patch at a time. Any finite figure is a bargain to somebody who walks
 * far enough. So it is priced at the most work anybody could ever have put into one: a whole
 * working life of the same walking, from the day a person is grown to the shortest life anybody
 * here gets — `LIFE.CHILD_UNTIL` to `LIFE.SHORTEST_LIFE`, which is forty-four days.
 *
 * ---
 *
 * What those come to is 263 gold and 1,650, and both are worth checking against what else is on
 * sale. A province costs more than a horse and more than a boat and less than a house: it is a
 * purchase you make *instead* of a boat, which is the whole of what "dear enough to be a decision"
 * means. The whole country costs four houses, and nobody buys four houses on the way past.
 *
 * It also makes a survey found in a dungeon a serious treasure rather than a curio, since a shop
 * pays half of a sticker price — which is a better chest than the old one, and a real choice
 * between never seeing fog again and eight hundred gold.
 */
export const CARTOGRAPHY = {
  /**
   * Days of a mapmaker's work behind a map of one province: a week, which here is a season.
   *
   * See above for why it is the drawing rather than the walking that takes the week.
   */
  A_PROVINCE: SEASON_LENGTH,
  /**
   * And behind a map of the whole country: a working life of it, in days.
   *
   * From grown to dead at the short end of what anybody gets. The short end rather than the long
   * one because the figure wants to be the work a man could be *sure* of finishing, and because
   * the price is already the largest in the game without reaching for the generous reading of it.
   */
  A_COUNTRY: LIFE.SHORTEST_LIFE - LIFE.CHILD_UNTIL,
  /** Tiles down one side of what the smaller map covers, for saying so in its own description. */
  SIDE: PROVINCE,
} as const;

/**
 * What a day of a grown adult's work costs, in the hero's coin.
 *
 * The middle of what soldiers ask, which is the game's only quoted wage. A single number rather
 * than a price per village on purpose: what a mapmaker charges already moves with the village,
 * because every shop in the game marks its stock up or down by what its keeper thinks of you.
 */
const A_DAY = (HIRE.ASKING_LEAST + HIRE.ASKING_MOST) / 2;

/**
 * What a mapmaker asks for so many days of his work, in whole gold.
 *
 * Rounded for the reason the ferryman's fare is rounded: a price is a thing somebody says out
 * loud, and nobody has ever been charged two hundred and sixty-two and a half gold for anything.
 */
export function priceOfAMap(days: number): number {
  return Math.round(days * A_DAY);
}

/**
 * What a keeper says when he sells a map, and what he says when he will not sell you another.
 *
 * Here rather than at the counter because it is a sentence about maps, and `talk.ts` is already
 * six hundred lines of shop. Both lines name the village, because naming it is the whole of how a
 * player is told that what they have just bought is *this* valley and not the country at large.
 */
export function saidOfAChart(village: string, held: boolean): string {
  return held
    ? `You have that one already: ${village} and the country round it. I only draw it the once.`
    : `${village} and the country round it, as far as the paper goes. You will not lose your way in this valley again.`;
}
