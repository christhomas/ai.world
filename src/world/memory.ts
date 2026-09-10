import type { Memory, Person } from './people';

/**
 * What a villager comes to think of somebody, once the particular things have gone.
 *
 * A villager's memory today is a list of two — the last couple of things that happened around him,
 * newest first — and everything before that was dropped on the floor. That is affordable in a world
 * with an edge, where nothing anybody remembers is ever written down. It is not affordable in an
 * endless one: a province's saved leavings are everything anybody has ever done there, so a list
 * that only grows is a world that eventually cannot be kept.
 *
 * But bounding it by dropping the oldest is not the fix, it is the bug. A man who watched you rob
 * him eleven times does not hold eleven memories and he does not hold none either: he holds a low
 * opinion of you, and probably the one time it was worst. Ten slights become one opinion, and the
 * opinion is cheap to hold and still true.
 *
 * So the list stops being the whole of a memory. Beside it a villager keeps an opinion per name:
 * how he feels, how many things went into feeling that way, and the one that struck hardest, kept
 * whole. That is the compaction, and it is a summary rather than an eviction — the sense of what
 * happened survives losing the detail of it.
 *
 * The opinion is formed the moment the thing happens rather than when the memory is pushed out of
 * the list, which is both truer to how anybody forms a view and much simpler: nothing has to be
 * marked as already counted, and nothing is ever lost by the list being short. The list is the last
 * two things he would say out loud unasked; the opinions are what he actually holds.
 *
 * WHAT IS ACTUALLY HERE TO COMPACT, stated plainly because it surprised the person who wrote this.
 * A villager records six things — a death, a birth, a rescue, a robbery on the road, a gift, and a
 * bad day down a mine — and only two of them are about the player at all. There is no word in that
 * vocabulary for "you killed my brother". What the player does wrong lands on `game/standing.ts`
 * and `game/grudge.ts`, which are the *player's* own save, not the villager's; a village's opinion
 * of you is currently kept by you. So the negative half of the weights below is nearly empty, and
 * that is the state of the game rather than an oversight of this file. This is the shape C5 fills
 * when villagers move to the server and get a private memory worth disagreeing about.
 */

export const MIND = {
  /**
   * How many names a villager holds an opinion about at once.
   *
   * Eight is the five neighbours he actually deals with — `LIFE.KNOWS` — and three for whoever is
   * passing through, which is where the players are. Fewer, and the man who was robbed forgets it
   * the moment two other things happen, which is the failure this whole item exists to stop. More,
   * and a province's saved state grows with everybody who has ever walked over it, which is the
   * unbounded growth wearing a different hat.
   */
  OPINIONS: 8,
  /**
   * How much of an opinion a day takes off, on a scale where a hundred is as strongly as anybody
   * ever feels about anybody.
   *
   * Slower than a village letting go of a grudge (`GRUDGE.FORGIVEN_A_DAY`, 1.2 a day), because that
   * is a place going off the boil about a dead cow and this is one man's view of another. At three
   * quarters a day the strongest feeling there is takes four months of not being seen to come to
   * nothing, and one kindness is spent in a fortnight. Faster, and the world reads as amnesiac: you
   * pull a man out from under a wolf and he nods at you the next week. Slower, and nothing ever
   * falls below `FAINTEST`, so the bound below does all of the work and does it by throwing away
   * whichever opinion happened to be weakest — which is arbitrary in a way that fading is not.
   */
  FADES_A_DAY: 0.75,
  /** Under this, an opinion is not an opinion any more and is let go of on the next compaction. */
  FAINTEST: 1,
  /** As strongly as anybody ever feels about anybody, either way: the scale `standing.ts` uses. */
  KEENEST: 100,
  /**
   * How long something stays news.
   *
   * `gossip.ts` reads this to decide what a villager raises before being asked, and compaction
   * reads it to decide what is worth writing to disk: past this the specific memory says nothing
   * anybody will ever hear, and it is worth only what it has already put into an opinion. Two
   * numbers here would drift, and the one that matters is that compaction never forgets something
   * a conversation would still have brought up.
   */
  STILL_NEWS: 4,
} as const;

/**
 * What each kind of thing is worth to the opinion it goes into.
 *
 * Only three of the six move anybody. A rescue is the largest single thing one person can do for
 * another in this game and is priced like it. A gift is small on purpose — `gifts.ts` already dulls
 * the second apple, and warmth earned by walking a village with a full pack belongs on that bond
 * rather than doubled here. A mine that hurt somebody is the only cold entry in the game: it is
 * dread of a place rather than an opinion of a person, which is exactly what `Memory.who` already
 * allows for, and it is the one thing that genuinely happens over and over to the same three people
 * about the same name.
 *
 * The other three are news rather than judgement, and carry nought deliberately. A death is grief
 * and not an opinion of the dead. A robbery on the road names the person it was done *to*, so
 * holding it against them would have the villager cross with the victim. They still make a row —
 * `times` and `keenest` are kept — so the sense of them survives; they simply do not colour
 * anybody. A row of nought is dropped by the next compaction unless it is one of the things below
 * that a person does not get over.
 */
const WEIGHT: Record<Memory['what'], number> = {
  saved: 45,
  /*
   * What somebody left you, which is a larger thing than a gift and a smaller one than your life.
   *
   * Twice a gift, because a bequest is a gift that cannot be repaid and was the last thing that
   * person did; well under a rescue, because being pulled out of a fight is a debt of a different
   * order. It is a memory of the *dead*, which is the unusual part — the opinion it forms is about
   * somebody who is not coming back, and that is the point of holding it: a village where the
   * well-thought-of dead are remembered is a village with a past.
   */
  inherited: 20,
  given: 10,
  born: 6,
  feared: -16,
  died: 0,
  robbed: 0,
};

/**
 * The things a person does not get over, which are exempt from fading and from nothing else.
 *
 * Only a death. He stops bristling about the man who robbed him and he does not stop having lost
 * his neighbour, so a row carrying a death is never dropped for having gone faint. It is still
 * subject to the bound, because a bound with an exception in it is not a bound — and it is safe to
 * be, since the parish already keeps the dead for ever in `Burial`, sixty stones deep. A villager's
 * copy is a second copy of a fact that is bounded somewhere else. What the flag buys is that a
 * death is the last thing to go rather than the first.
 */
const NEVER_GETS_OVER: ReadonlySet<Memory['what']> = new Set(['died']);

/** What one villager has come to think of one name. */
export interface Opinion {
  /** Who or what it is about, by name — a person or a place, exactly as a memory is. */
  who: string;
  /** Warm above nought and cold below, held to `MIND.KEENEST` either way. */
  regard: number;
  /** How many separate things went into it: the ten, so that one opinion can still say ten. */
  times: number;
  /**
   * The day the regard above was last worked out, and where fading runs from. Not ticked, for the
   * reason `grudge.ts` gives: an opinion nobody has been near for a fortnight has been fading all
   * that while, and a village the player never visits should not need a heartbeat to cool off.
   */
  day: number;
  /**
   * The one that struck hardest, kept whole — a person keeps one and he does not keep ten. Ties go
   * to the most recent, because between two things that hurt the same the newer one is the one he
   * would actually bring up.
   */
  keenest: Memory | null;
  /** Whether one of the things in here is a thing he does not get over. See `NEVER_GETS_OVER`. */
  kept: boolean;
}

/**
 * A person's opinions, made if this is the first.
 *
 * The guard is for a villager read back out of a save written before opinions existed. There are no
 * such saves today — a villager has never been written to disk at all, which is half the finding of
 * this work — but `Register.save()` exists and C5 is what turns it on, so the one place that could
 * meet a bare `Person` may as well cost a comparison.
 */
function opinionsOf(person: Person): Opinion[] {
  if (!person.opinions) person.opinions = [];
  return person.opinions;
}

/** Nobody ever feels more strongly than the scale allows, either way. */
function held(regard: number): number {
  return Math.max(-MIND.KEENEST, Math.min(MIND.KEENEST, regard));
}

/** What an opinion has come to by a given day, with the fading already taken off. */
export function regardOn(opinion: Opinion, day: number): number {
  const gone = Math.max(0, day - opinion.day) * MIND.FADES_A_DAY;
  const left = Math.max(0, Math.abs(opinion.regard) - gone);
  return opinion.regard < 0 ? -left : left;
}

/** What a villager thinks of one name today. Nought for anybody he has no view about. */
export function regardFor(person: Person, who: string, day: number): number {
  const view = opinionsOf(person).find((o) => o.who === who);
  return view ? regardOn(view, day) : 0;
}

/** What a villager holds about one name today, faded, or nothing at all. */
export function opinionOf(person: Person, who: string, day: number): Opinion | null {
  const view = opinionsOf(person).find((o) => o.who === who);
  return view ? { ...view, regard: regardOn(view, day), day } : null;
}

/**
 * Fold something that happened into what this villager thinks of whoever it happened to.
 *
 * Called from `remember`, so every memory forms its opinion on the way in whether or not it
 * survives the list it is being put at the front of.
 *
 * The existing regard is faded to the day of the new thing before the new thing is added to it. A
 * slight after a year of silence has to land on a cooled opinion rather than on the hot one it was
 * last left at, or a villager can be wound up once and then topped back to the ceiling for ever by
 * one small thing a year.
 */
export function formAnOpinion(person: Person, memory: Memory): void {
  const opinions = opinionsOf(person);
  const weight = WEIGHT[memory.what] ?? 0;

  let view = opinions.find((o) => o.who === memory.who);
  if (!view) {
    view = { who: memory.who, regard: 0, times: 0, day: memory.day, keenest: null, kept: false };
    opinions.push(view);
  }

  view.regard = held(regardOn(view, memory.day) + weight);
  view.times += 1;
  view.day = Math.max(view.day, memory.day);
  view.kept = view.kept || NEVER_GETS_OVER.has(memory.what);
  if (!view.keenest || Math.abs(weight) >= Math.abs(WEIGHT[view.keenest.what] ?? 0)) view.keenest = memory;

  holdToTheBound(opinions, memory.day);
}

/**
 * Settle a villager's memory down to what is worth writing on disk: the natural moment is a
 * province being written out with nobody in it, but nothing here needs that to be true, and
 * compacting twice on the same day changes nothing.
 *
 * Two things happen. The particular memories that have stopped being news are dropped, because past
 * `MIND.STILL_NEWS` a villager will not raise one unasked — so all that memory can still do is what
 * it has already done, which is sit in an opinion. And the opinions are faded to today, the ones
 * that have come to nothing are let go of, and whatever is left is held to the bound.
 *
 * The faded number is written back with today's date rather than left to be worked out on every
 * read. It is the same arithmetic either way; doing it here means a province that sat on the shelf
 * for a year is read back as a read rather than as a year of subtraction per villager per name.
 */
export function compact(person: Person, day: number): void {
  person.memories = person.memories.filter((memory) => day - memory.day <= MIND.STILL_NEWS);

  const settled: Opinion[] = [];
  for (const view of opinionsOf(person)) {
    const regard = regardOn(view, day);
    if (Math.abs(regard) < MIND.FAINTEST && !view.kept) continue;
    settled.push({ ...view, regard, day });
  }
  holdToTheBound(settled, day);
  person.opinions = settled;
}

/**
 * Everybody in a place, at the moment the place is put away.
 *
 * The hook a province's unload wants, and it is called now: `keepNear` in `server/world.ts` is
 * where a province stops being anybody's business, and the world holds the register it settles.
 * Called with whoever lived in the province being written, on the day it was written, and what goes
 * to disk is opinions rather than a history.
 */
export function compactAll(people: Iterable<Person>, day: number): void {
  for (const person of people) compact(person, day);
}

/**
 * Hold a villager to the number of people he can have a view about.
 *
 * The faintest go first, which is the only ordering that is not arbitrary: what a man has stopped
 * feeling anything about is what he has room to stop holding. A row carrying something he does not
 * get over outranks every row that carries nothing of the kind, however strongly he feels about
 * them — so a death is dropped only when there are more deaths than there are slots, and then the
 * oldest of them goes.
 */
function holdToTheBound(opinions: Opinion[], day: number): void {
  if (opinions.length <= MIND.OPINIONS) return;
  const strength = (view: Opinion): number =>
    Math.abs(regardOn(view, day)) + (view.kept ? MIND.KEENEST : 0);
  opinions.sort((a, b) => strength(b) - strength(a) || b.day - a.day);
  opinions.length = MIND.OPINIONS;
}
