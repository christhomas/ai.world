import type { Rng } from '../core/rng';
import type { Sex } from '../world/people';
import type { Post } from './entity';

/**
 * What a villager does for a living.
 *
 * A trade is a name and the places it needs. The day itself is in `behaviours/villagers.json` —
 * this only decides who ends up with which job, and refuses to make somebody a sailor in a
 * village with no water in sight.
 */
export interface Trade {
  id: string;
  label: string;
  /** How often this trade turns up, against the others available. */
  weight: number;
  /** Places the village must actually have before anybody can hold this job. */
  needs?: Post[];
  /** What they say when you talk to them, over and above the usual village chatter. */
  lines: string[];
}

export const TRADES: Trade[] = [
  {
    id: 'seller', label: 'Market Seller', weight: 3, needs: ['market'],
    lines: ['Fresh in this morning, if you are quick.', 'Buying as well as selling, if you have anything.'],
  },
  {
    id: 'farmer', label: 'Farmer', weight: 3, needs: ['field'],
    lines: ['The field will not turn itself over.', 'Rain would be welcome. Not that much rain.'],
  },
  {
    id: 'hunter', label: 'Hunter', weight: 3, needs: ['woods', 'market'],
    lines: ['Wolves have been bold this week.', 'I take it to the market before it turns.'],
  },
  /*
   * The builder, and why he was the last trade to go on the register rather than the first.
   *
   * A village has been raising its own roofs with whatever hands it had, which is what a village
   * without a builder does and is honest as far as it goes — but it meant the money a hall paid for
   * a house was shared among everybody who held any trade at all, including the men who were down
   * the mine that morning. The hall's own comment has said for weeks that this is the line that
   * would name him instead.
   *
   * He was left off deliberately once, and the objection was a good one: *"a builder who can be
   * carried off by a wolf half way through the job is a house that dangles."* What answers it is
   * that a commission is a contract at the hall rather than an arrangement with a man — the money
   * is the village's, the job is on its books, and if the builder dies the next pair of hands takes
   * it on. The same reasoning the watchman's wage runs on.
   *
   * `square` and nothing else: a builder needs somewhere to be commissioned, not a wood or a field.
   * A hamlet with no square raises what it can with its own hands, exactly as it always has.
   */
  {
    id: 'builder', label: 'Builder', weight: 2, needs: ['square'],
    lines: [
      'Timber first, then a frame. You cannot hurry a frame.',
      'Everything anybody builds here goes through me, one way or another.',
    ],
  },
  /*
   * The logger, and the first trade in this world that another trade cannot do without.
   *
   * Everything else here earns by selling to somebody outside the valley or to the player. A logger
   * fells the wood behind the village and stacks it in the yard, and the builder cannot raise a
   * roof without it — so a village with a wood and no logger is a village that has stopped
   * building, and a logger in a village with nothing to build is a man cutting for the next valley.
   * `game/timber.ts` is the yard between them.
   *
   * `woods` and nothing else: he needs trees, and the market a hunter needs is not his business —
   * what he cuts is used where it is stacked as often as it is sold.
   */
  {
    id: 'logger', label: 'Logger', weight: 2, needs: ['woods'],
    lines: [
      'Six good lengths today, and the saw wants setting again.',
      'Anything they put up here came off my stack.',
      'The stand up the hill is the last of the old timber.',
      'Cut it green and it will twist on you. Everybody learns that once.',
    ],
  },
  {
    id: 'soldier', label: 'Soldier', weight: 2, needs: ['gate'],
    lines: ['The road is quiet. Long may it stay so.', 'Coin buys a sword arm, if you were asking.'],
  },
  {
    id: 'sailor', label: 'Sailor', weight: 2, needs: ['shore'],
    lines: ['Tide is on the turn.', 'I have been further out than anybody here, whatever they tell you.'],
  },
  /*
   * The fisherman, and what a coast eats.
   *
   * A sailor goes away and a fisherman comes back before dark, which is the whole difference
   * between the two and the reason both exist. What he brings in is the paid half of a coastal
   * larder — `aDaysFishing` in `livelihoods.ts`, beside the herd — and the unpaid half is the
   * shellfish everybody on a shore gathers whether or not there is a boat.
   *
   * `shore` and nothing else, so he can exist in a hamlet on a rock that has never had a harbour.
   * That is deliberate and it is the ordering the work list asks for: a village may have fishermen
   * and no boats, in which case they gather with everybody else and the place survives without
   * prospering — and then somebody builds a jetty, `holdings.ts` finds `can_fish` with a place to
   * put it, and the same men start landing fish. The trade is the seat; the harbour is what fills
   * it.
   */
  {
    id: 'fisherman', label: 'Fisherman', weight: 2, needs: ['shore'],
    lines: [
      'Out before light and in before dark. That is the whole of it.',
      'Mussels off the rocks at low water, and nobody goes hungry here.',
      'A boat pays for itself in a season, if the season is kind.',
      'We have fed this place through worse than you have seen.',
    ],
  },
  {
    id: 'miner', label: 'Miner', weight: 2, needs: ['heights'],
    lines: ['Down at the face all week. The seam is still giving.', 'It is dark work, but it pays.', 'You hear things down there. Rock settling, mostly.'],
  },
  {
    id: 'climber', label: 'Mountain Climber', weight: 1, needs: ['heights'],
    lines: ['There is a way up the north face. Nobody believes me.', 'The view is worth the knees.'],
  },
  {
    id: 'explorer', label: 'Explorer', weight: 1,
    lines: ['I am only back for supplies.', 'There is a shrine four days east that nobody has opened.'],
  },
  {
    id: 'constable', label: 'Constable', weight: 2, needs: ['square'],
    lines: ['Keep it peaceful and we shall get along.', 'Wolves at the field again. I earn my keep.'],
  },
  {
    id: 'doctor', label: 'Doctor', weight: 1, needs: ['doctor'],
    lines: ['Sit down and let me see it.', 'I will take what you can spare. If you can spare nothing, sit longer.'],
  },
  {
    id: 'innkeeper', label: 'Innkeeper', weight: 1, needs: ['inn'],
    lines: ['Beds are made, whatever the hour.', 'You look like a person who has walked a long way.'],
  },
];

/** Which trades a village can actually support, given what is around it. */
export function tradesFor(posts: Partial<Record<Post, [number, number]>>): Trade[] {
  return TRADES.filter((trade) => (trade.needs ?? []).every((post) => posts[post] !== undefined));
}

/** Somebody's job, weighted, from what this village can support. */
export function pickTrade(posts: Partial<Record<Post, [number, number]>>, rng: Rng): string {
  const available = tradesFor(posts);
  if (available.length === 0) return '';
  const total = available.reduce((sum, trade) => sum + trade.weight, 0);
  let roll = rng() * total;
  for (const trade of available) {
    roll -= trade.weight;
    if (roll <= 0) return trade.id;
  }
  return available[available.length - 1].id;
}

/** The trade with this name, for anything that wants its label or its lines. */
export function tradeNamed(id: string): Trade | undefined {
  return TRADES.find((trade) => trade.id === id);
}

/**
 * Which body a trade is drawn with.
 *
 * A village was eleven trades and one body, so the whole working day of the place — a farmer out to
 * his field at dawn, a constable called when somebody is robbed, a miner up to the high ground —
 * was invisible from three paces. Seven of them have a shape of their own now, and the rule
 * throughout is that the silhouette carries it rather than the colour: at the distance this camera
 * watches a street from, a hat is legible and a shirt is not.
 *
 * The four that are not here are not oversights. A seller, a hunter, a soldier and an explorer look
 * like villagers because that is what they are — a hat apiece would be seven hats in a village of
 * five people, and a crowd where everybody is marked is a crowd where nobody is.
 */
const BODIES: Record<string, string> = {
  miner: 'miner', farmer: 'farmer', doctor: 'doctor',
  constable: 'constable', priest: 'priest', mayor: 'mayor',
  /*
   * And the two the register never hands out, because they are jobs a *building* has rather than
   * trades a person is born to.
   *
   * A clerk is whoever is behind the desk of a town hall and a sergeant is whoever is behind the
   * desk of a watch house — `places.ts` names them when it stands somebody up inside one, and
   * neither name appears anywhere in `trades.json`. They are here because this is the one table
   * that answers "what does somebody doing this job look like", and a sergeant drawn as a
   * shopkeeper is a sergeant nobody can tell from a grocer.
   *
   * The clerk gets the mayor's body, which is the body that was made for a town hall: a hat like
   * Henry the Eighth's, on the one person in the building.
   */
  clerk: 'mayor', sergeant: 'constable',
};

/**
 * Which body a woman is drawn with, and which a man.
 *
 * The same table one step earlier, and written for the same reason. A village was eleven trades
 * and one body; it was also, for as long as there has been a register, two sexes and one body —
 * so half of every street was drawn in a man's trousers and a player could not tell a village
 * from a garrison. Long hair and a dress against a belted tunic is what a medieval village looked
 * like from a distance, and it is a silhouette rather than a colour, which is the rule `BODIES`
 * follows and the only rule that survives being seen from up here.
 *
 * The plain `villager` stays, and is not a leftover. It is the body for anybody nobody has a
 * register entry for — a congregation at a church door, whoever is behind a counter, a stranger
 * stood up by a page that has not been told who lives here yet — and drawing those as men would
 * be a guess the register never made.
 */
const SEXED: Record<Sex, string> = { woman: 'woman', man: 'man' };

/**
 * The body somebody is drawn with: their trade's if it has one, otherwise their own.
 *
 * The trade wins, which is what a woman with a trade would have worn: a farmer's hat goes over a
 * dress the way it goes over anything else, and a doctor is known by her coat and her bag. Only
 * six trades have a body at all, so most of a village — the sellers, the hunters, the soldiers,
 * the children with no trade yet — falls through to the second question and is drawn as a woman
 * or a man.
 *
 * The trade is tested rather than handed to `BODIES` raw, and it matters: an empty trade is what
 * a child carries, and `(trade && BODIES[trade]) ?? 'villager'` — what this used to be — hands
 * back the empty string for one, because `''` is falsy and is not nullish. Nothing ever noticed
 * because `manager.place` falls back to the herd's own kind when a body it is given does not
 * exist, and the herd was villagers. It would notice now: a girl would be drawn as her mother's
 * herd rather than as a girl.
 */
export function bodyForTrade(trade: string | undefined, sex?: Sex): string {
  const wears = trade ? BODIES[trade] : undefined;
  return wears ?? (sex ? SEXED[sex] : 'villager');
}
