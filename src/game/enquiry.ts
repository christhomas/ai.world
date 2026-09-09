import type { DialogueChoice, DialogueNode, Speaker } from '../ui/dialogue';
import type { Register } from '../world/register';
import { theBirths, theStones, type Ledger } from './records';

/**
 * Asking to see a book.
 *
 * `records.ts` works out what a village's books say. This is the counter they are read across:
 * which book a building keeps, what anybody may hear about it for nothing, and what the rest of
 * it costs. The split is the whole of the design — the gist is public because a parish record is
 * public, and the detail is paid for because that is what makes looking somebody up a decision
 * rather than a menu you idly open.
 *
 * The keeper is barely involved. A priest reads out his own churchyard and an apothecary her own
 * book of births, but neither of them decides anything: the building holds the book, so the same
 * three functions below will serve a town hall and a watch house the day either one exists
 * without being told a thing about them.
 */

/** Who is doing the reading, in the terms the dialogue box needs to draw them. */
export interface Keeper {
  speaker: string;
  emoji: string;
  face?: Speaker;
}

/** One book somebody keeps: what asking for it is called, and how to work it out. */
export interface Book {
  /** The row at the counter, as the player reads it: "Ask about the dead". */
  ask: string;
  /**
   * The book, worked out at the moment it is opened rather than held.
   *
   * Everything in `records.ts` is derived from the register, and the register is alive while the
   * conversation runs: a village can bury somebody between the gist and the fee.
   */
  open: () => Ledger;
}

/** A counter with books behind it, and the purse that pays to see one. */
export interface Enquiry {
  books: Book[];
  /** What the hero has on them, asked afresh each time because it moves during a conversation. */
  purse: () => number;
  /** Hand the fee over. */
  pay: (fee: number) => void;
  /**
   * Which of these books have been paid for already.
   *
   * A fee buys a sitting with the book rather than a subscription to it: it lasts as long as you
   * are stood at the counter and no longer. The alternative was either charging somebody a second
   * time for backing out of a page they had already bought, or writing "has read the stones of
   * Elderton" into a save that would then carry one of those per village per book for ever.
   */
  paid: Set<string>;
}

/**
 * Which building keeps which book.
 *
 * The church has its own dead and the apothecary its own newborns, and neither will read you the
 * other's. That is what makes them places to walk into rather than four entries on one menu.
 *
 * The roll and the charge sheet want a town hall and a watch house, and there is no such building
 * in the world yet. When there is, each is one more line here and nothing else: nowhere below this
 * knows what kind of room it is standing in.
 */
export function booksKeptIn(kind: string, village: string, register: Register, today: number): Book[] {
  switch (kind) {
    case 'church':
      return [{ ask: 'Ask about the dead', open: () => theStones(register, village, today) }];
    case 'apothecary':
      return [{ ask: 'Ask about the births', open: () => theBirths(register, village, today) }];
    default:
      return [];
  }
}

/**
 * Lines of a book read out at a time.
 *
 * The panel types its words at fifty-five characters a second and does not scroll, so a book
 * handed over whole would be both a wall and a long wait. Three lines is about a page of it, and
 * turning pages is what being read to out of a book is.
 */
const LINES_A_PAGE = 3;

/**
 * The rows a keeper's books add to whatever else they were offering.
 *
 * `back` is where a player who has finished with the books lands — the shop counter, or the
 * priest's opening — so this knows nothing about the conversation it is being fitted into.
 */
export function bookRows(who: Keeper, enquiry: Enquiry, back: () => DialogueNode | null): DialogueChoice[] {
  return enquiry.books.map((book) => ({
    label: book.ask,
    next: () => theGist(who, enquiry, book, back),
  }));
}

/** What anybody may hear standing at the counter, and the offer of the rest of it. */
function theGist(who: Keeper, enquiry: Enquiry, book: Book, back: () => DialogueNode | null): DialogueNode {
  const ledger = book.open();
  const choices: DialogueChoice[] = [];
  // an empty book is free and there is nothing to charge for, which the fee already says; offering
  // to sell a look at nought pages is how a keeper stops being somebody worth asking
  if (ledger.detail.length > 0) choices.push(theOffer(who, enquiry, book, ledger, back));
  choices.push({ label: 'Back', next: back });
  return said(who, [ledger.gist.join(' ')], choices);
}

/** The row that opens the book: paid for once, and then simply open. */
function theOffer(who: Keeper, enquiry: Enquiry, book: Book, ledger: Ledger, back: () => DialogueNode | null): DialogueChoice {
  if (enquiry.paid.has(book.ask)) return { label: 'Read on', next: () => readOut(who, ledger, back) };
  return {
    label: ledger.fee > 0 ? `See the book itself (${ledger.fee} gold)` : 'See the book itself',
    next: () => {
      const purse = enquiry.purse();
      if (purse < ledger.fee) {
        // said plainly, with both numbers in it, because "you cannot afford that" leaves a player
        // guessing at which of the two they got wrong
        return said(who, [`${ledger.title} is ${ledger.fee} gold to read, and you have ${purse}.`], [
          { label: 'Back', next: () => theGist(who, enquiry, book, back) },
        ]);
      }
      enquiry.pay(ledger.fee);
      enquiry.paid.add(book.ask);
      return readOut(who, ledger, back);
    },
  };
}

/** The book itself, a few lines at a time. */
function readOut(who: Keeper, ledger: Ledger, back: () => DialogueNode | null): DialogueNode {
  const pages: string[] = [];
  for (let at = 0; at < ledger.detail.length; at += LINES_A_PAGE) {
    pages.push(ledger.detail.slice(at, at + LINES_A_PAGE).join('\n'));
  }
  return said(who, pages, [{ label: 'Back', next: back }]);
}

/** One thing said across a counter, and whatever the player may say back to it. */
function said(who: Keeper, pages: string[], choices?: DialogueChoice[]): DialogueNode {
  const node: DialogueNode = { speaker: who.speaker, emoji: who.emoji, pages };
  if (who.face) node.face = who.face;
  if (choices) node.choices = choices;
  return node;
}
