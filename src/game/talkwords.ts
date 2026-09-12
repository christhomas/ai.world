/**
 * What the people behind a counter say, which is not the same subject as how a counter works.
 *
 * The precedent is `roamwords.ts`, and the reason is the same one: a table of lines is a thing
 * somebody edits to change how the game sounds, and it should not be sitting in the middle of the
 * machinery that decides what a shop will pay for a pelt. `talk.ts` is that machinery, and it was
 * at the size this codebase holds a module to.
 */

/**
 * How to make a living, said by the people who make one.
 *
 * A world full of things to do teaches nobody anything if none of them is ever mentioned. These
 * are said only to somebody visibly short of money, and they name a thing that can be done with
 * what a beginner already has rather than with the tools they cannot afford yet.
 */
export const HOW_PEOPLE_GET_BY = [
  'Anybody can eat who can catch a rabbit. The store buys meat, and the hide off it too if you have a knife.',
  'There are deer in the open country. Slow work with a stick, but a hide is a hide.',
  'The herbs on the wet ground by the water are worth picking. The apothecary takes them, or grind them yourself if you have the bowl.',
  'Wolves pay better than deer, and cost more too. Wait until you have a proper blade.',
  'Ask the elder if there is anything wants doing. There generally is, and it pays.',
  'Whatever you take, carry it to a village that has none of it. That is the whole of trade.',
];

export const CONGREGATION_LINES = [
  'We gather here most mornings. It is quieter than the square.',
  'The chapel bell has not rung in years. We still come.',
  'Say a word for the travellers on the road, would you?',
  'The old priest planted that tree by the door. Or so they say.',
  'Peace be on your road, stranger.',
];

// What the two civic counters say before they are asked anything. Both tell you what the building
// is for without saying "you may read the roll here", because a greeting that is a menu is not a
// greeting; a clerk is proud of his book and a sergeant would rather you moved along, and that is
// the whole of the difference between them.
export const CLERK_LINES = [
  'The roll is kept here. Everybody in the parish, written down in one hand, and that hand is mine.',
  'Births, trades, what a man has put by. All of it in the book, and the book flatters nobody.',
  'Mind the ink. I have been at this since dawn and I would rather not begin again.',
  'You are not from here, so you are not on it. Ask anyway, if you like.',
];

export const SERGEANT_LINES = [
  'Watch house. State your business, or stand where I can see you.',
  'The sheet is a public record. What is on it is not always comfortable. That is not my doing.',
  'Cell is at the back. Empty more often than you would think, in a village this size.',
  'We write down everybody we take in. Everybody, and what it cost them.',
];
