/**
 * What the game will tell you if you ask it.
 *
 * This used to be a box of keys pinned to the bottom-left corner of the screen, always there,
 * taking a fifth of the picture and unhideable — which is a poor trade for a list you read twice
 * and then never again. It is asked for instead: `? keys` in the console prints it, and the rest
 * of the time the screen is the game.
 *
 * The text is written as it is spoken to the player, so the topics read as answers rather than as
 * documentation: what a thing is for comes before which key does it, because somebody typing `?`
 * has a question and not a lookup.
 */

export interface Topic {
  name: string;
  /** One line for the list of topics, so `?` on its own is useful. */
  about: string;
  lines: string[];
}

export const TOPICS: Topic[] = [
  {
    name: 'keys',
    about: 'every key, in one place',
    lines: [
      'WASD or the arrows run · Shift walks · Q and E turn the camera · Scroll zooms',
      'Enter or Space talks, opens and boards · X strikes with whatever is to hand',
      'C guards, held: raise it as they swing to parry, early and you only block',
      'Z looses an arrow · B wards · H blights · U witchlight · V drinks a draught',
      'M map · I rucksack · J journal · F free camera · P photo · O options · N save and leave',
      'T chat · G offer a trade · K party · L who is here · R rally point',
      '` drops this console down and puts it away · ? asks it something',
    ],
  },
  {
    name: 'fighting',
    about: 'strikes, guards, breath',
    lines: [
      'X strikes. C holds a guard up.',
      'A guard raised as the blow lands parries it and staggers them; raised early it only blocks.',
      'Swinging and guarding both cost breath, and breath only comes back while you do neither —',
      'so backing off a step is a move rather than a retreat.',
      'Z looses an arrow if you have a bow to loose it from.',
    ],
  },
  {
    name: 'living',
    about: 'work, money, sleep',
    lines: [
      'Talk to villagers. Most have work, and every one of them says what it pays.',
      'Sell what you gather at a market stall; rent a pitch of your own if you have goods to shift.',
      'Sleep at an inn, or make camp, to heal.',
    ],
  },
  {
    name: 'magic',
    about: 'the things that need kit',
    lines: [
      'B wards, and turns blows aside · H blights, and strikes at a distance',
      'U lights a witchlight · V drinks a warding draught',
      'None of it works without the kit for it, which is bought, found or earned.',
    ],
  },
  {
    name: 'travelling',
    about: 'the map, mounts, boats, the sky',
    lines: [
      'M opens the map; F takes the camera off your shoulder so you can look about.',
      'A horse is ridden by walking into it; a boat is boarded from a pier with Enter.',
      'The eagles at a crag will carry you to a village in the sky, for a price.',
      'Mountains are walked round rather than over: a road through a range is a pass, and the pass',
      'is the way through.',
    ],
  },
  {
    name: 'online',
    about: 'other people in your world',
    lines: [
      'T chats · G offers a trade · K is your party · L is who else is here · R drops a rally point',
      'A world is shared by its seed, so anybody joining the same number is standing in your world.',
      '/wave, /bow, /cheer, /laugh, /thanks and /help are gestures everyone can see.',
    ],
  },
  {
    name: 'console',
    about: 'what this box does',
    lines: [
      '` drops this down and puts it away again; Escape closes it too.',
      'Anything typed is said out loud to the world, unless it starts with one of these:',
      '  ? topic     asks the game something, and only you see the answer',
      '  /wave       a gesture, which everybody sees',
      '  /teleport silverholm     a command, run on the spot',
      'Type `/help` for the list of commands.',
    ],
  },
];

/** Every topic name, for the line printed when somebody asks for nothing in particular. */
export function topicNames(): string[] {
  return TOPICS.map((t) => t.name);
}

/**
 * The topic somebody meant.
 *
 * Exact name first, then the one that starts with what they typed, then the one that contains it,
 * so `? key` and `? keys` both find the key list and neither has to be guessed at twice.
 */
export function topicFor(asked: string): Topic | null {
  const wanted = asked.trim().toLowerCase();
  if (!wanted) return null;
  return TOPICS.find((t) => t.name === wanted)
    ?? TOPICS.find((t) => t.name.startsWith(wanted))
    ?? TOPICS.find((t) => t.name.includes(wanted))
    ?? null;
}

/** What to print when the topic is not one we have. Names what we do have, which is the answer. */
export function noSuchTopic(asked: string): string[] {
  return [
    `Nothing here about "${asked.trim()}".`,
    `Ask about: ${topicNames().join(', ')}`,
  ];
}

/** What `?` on its own prints: what can be asked about, and how. */
export function topicIndex(): string[] {
  return [
    'Ask with ? and a topic — "? keys", "? fighting":',
    ...TOPICS.map((t) => `  ${t.name.padEnd(11)}${t.about}`),
  ];
}
