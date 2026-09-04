import type { GameState } from './state';

/**
 * Spells, and the breath they are paid for with.
 *
 * The point of the whole module is the ward: a few seconds in which most of what is coming at you
 * glances off, which is exactly long enough to turn round and go. A fight you cannot win should
 * end in a walk home rather than in a death, and that is a thing the rules have to offer, because
 * a player with nothing but a sword has only ever been offered the fight.
 *
 * What a spell costs had to be something that runs out and comes back, or fleeing is free and
 * therefore not a decision. Hearts were the obvious candidate and are wrong: paying for your
 * escape in health means the spell that saves you is also the spell that kills you. Gold is
 * worse, because gold does not come back on its own and a full purse would make casting free. So
 * the cost is breath: it empties in one or two castings, it fills again in the time it takes to
 * walk away, and it is never worth saving up. Nothing here is written to the save for the same
 * reason, since a save that remembered breath would be remembering the last ten seconds.
 *
 * Nobody has to learn any of this. There is no spellbook and no teacher, because a way out of a
 * fight that must first be unlocked is not a way out of the fight you are in now.
 */

export const SPELL = {
  /** Breath a hero has when they are not out of it. Ten, like a new hero's hearts, so the two read at one scale. */
  BREATH: 10,
  /** Breath that comes back each second: a full chest in ten, from empty, which is about how long getting away takes. */
  RECOVERS: 1,
  /** Seconds after a casting before any breath returns at all, so two spells at once cost more than two apart. */
  WINDED: 1.5,
  /** Share of a blow the spoken ward turns aside. Half, never all: a ward buys distance, it does not make you safe. */
  WARD_SHARE: 0.5,
  /** Seconds it holds: about twenty tiles at a hero's pace, which is enough to break away from anything on legs. */
  WARD_SECONDS: 4,
  /**
   * What the ward costs. Seven of ten, chosen so that getting back to a second ward takes longer
   * than the first one lasts: there is always a moment out in the open, and so there is always a
   * decision about whether to spend it running or standing.
   */
  WARD_BREATH: 7,
  /** The bottled ward turns aside more, having been paid for in herbs and silver rather than in breath. */
  DRAUGHT_SHARE: 0.75,
  /** And holds far longer, which is what makes carrying one worth the gathering. */
  DRAUGHT_SECONDS: 10,
  /** A conjured light. Cheap, because being able to see in a cave is not a fight. */
  LIGHT_BREATH: 2,
  /** How long before it gutters out. A lantern you did not buy, and did not get to keep. */
  LIGHT_SECONDS: 45,
  /** The one spell that hits back. */
  BLIGHT_BREATH: 4,
  /** Hearts it takes off: less than the plainest sword, on purpose. It reaches, it does not win. */
  BLIGHT_DAMAGE: 2,
  /** Tiles it carries, against a swing's two. The reach is the whole of what it is for. */
  BLIGHT_RANGE: 6,
} as const;

/** The spells there are. Four, so the choice in a bad moment is a choice and not a menu. */
export type SpellId = 'ward' | 'draught' | 'light' | 'blight';

/** What a spell actually does, in the terms the rest of the game already speaks. */
export type SpellEffect =
  | { kind: 'ward'; share: number; seconds: number }
  | { kind: 'light'; seconds: number }
  | { kind: 'blight'; damage: number; range: number };

/** One spell: what it costs, what it does, and what the hero is told when it comes. */
export interface Spell {
  id: SpellId;
  name: string;
  emoji: string;
  /** Breath it takes. Nought for a spell that is drunk rather than spoken. */
  breath: number;
  /** The item a bottled spell empties. Absent for anything spoken. */
  drinks?: string;
  effect: SpellEffect;
  /** The line for the screen when it works. */
  words: string;
}

/**
 * Every spell, as rows rather than as branches, for the same reason the recipes are: adding one
 * is adding a line, and nothing that offers or casts them has to be opened again.
 */
export const SPELLS: Record<SpellId, Spell> = {
  ward: {
    id: 'ward', name: 'Warding', emoji: '✋', breath: SPELL.WARD_BREATH,
    effect: { kind: 'ward', share: SPELL.WARD_SHARE, seconds: SPELL.WARD_SECONDS },
    words: 'The air thickens. Go now.',
  },
  draught: {
    id: 'draught', name: 'Warding Draught', emoji: '🔮', breath: 0, drinks: 'ward',
    effect: { kind: 'ward', share: SPELL.DRAUGHT_SHARE, seconds: SPELL.DRAUGHT_SECONDS },
    words: 'You drink it down. Blows come at you as though through water.',
  },
  light: {
    id: 'light', name: 'Witchlight', emoji: '✨', breath: SPELL.LIGHT_BREATH,
    effect: { kind: 'light', seconds: SPELL.LIGHT_SECONDS },
    words: 'A cold light gathers over your shoulder.',
  },
  blight: {
    id: 'blight', name: 'Blight', emoji: '🌫️', breath: SPELL.BLIGHT_BREATH,
    effect: { kind: 'blight', damage: SPELL.BLIGHT_DAMAGE, range: SPELL.BLIGHT_RANGE },
    words: 'Something withers where you pointed.',
  },
};

/**
 * A spell that strikes, said in the only terms combat cares about: how hard, and how far. Passing
 * this rather than the spell itself is what keeps combat from ever having heard of magic.
 */
export interface Blow {
  damage: number;
  /** Tiles it carries, which is the whole reason to cast it rather than swing. */
  range: number;
}

/** What came of a casting. `spell` is null when nothing happened, and `words` says why either way. */
export interface Cast {
  spell: Spell | null;
  /** Hand this to the swing when it is there: the spell has struck at something. */
  blow: Blow | null;
  words: string;
}

/** As much of a rucksack as a bottled spell needs to see. */
export type Bottles = Pick<GameState, 'count' | 'take'>;

/**
 * What is left of a blow once a ward has turned its share aside.
 *
 * A plain function of two numbers, so whatever is doing the hitting never has to know that a
 * spell exists: it is handed a share, and a share of nought is the answer for everybody who is
 * not warded, which is nearly everybody, nearly always.
 */
export function turnedAside(damage: number, ward: number): number {
  const share = Math.max(0, Math.min(1, ward));
  return Math.max(0, Math.round(damage * (1 - share)));
}

/**
 * The hero's breath, and whatever is currently up because they spent some of it. One of these is
 * made per game and ticked with the frame; combat reads `ward` off it and nothing else.
 */
export class Magic {
  /** Breath in hand. Read it for a bar; it is only ever spent by casting and refilled by time. */
  breath: number = SPELL.BREATH;
  private share = 0;
  private wardFor = 0;
  private lightFor = 0;
  private winded = 0;

  /** Share of a blow being turned aside right now, 0 when nothing is up: the one number combat wants. */
  get ward(): number { return this.wardFor > 0 ? this.share : 0; }

  /** Seconds of warding left, for whatever counts it down on the screen. */
  get warded(): number { return this.wardFor; }

  /** Is a conjured light burning? The lantern's answer to the same question is the hero's kit. */
  get lit(): boolean { return this.lightFor > 0; }

  /** Breath as a share of full, which is the form a bar wants it in. */
  get wind(): number { return this.breath / SPELL.BREATH; }

  /** Ticked with the frame: everything up runs down, and breath comes back once you have a moment. */
  tick(dt: number): void {
    this.wardFor = Math.max(0, this.wardFor - dt);
    this.lightFor = Math.max(0, this.lightFor - dt);
    if (this.winded > 0) { this.winded = Math.max(0, this.winded - dt); return; }
    this.breath = Math.min(SPELL.BREATH, this.breath + SPELL.RECOVERS * dt);
  }

  /** Everything goes out at once: knocked down, carried off, or back at the title screen. */
  dispel(): void {
    this.share = 0;
    this.wardFor = 0;
    this.lightFor = 0;
  }

  /** Why this spell will not come, in words the player can act on, or null when it will. */
  reason(id: SpellId, held: Bottles): string | null {
    const spell = SPELLS[id];
    if (spell.drinks && held.count(spell.drinks) <= 0) return `You have no ${spell.name} to drink.`;
    if (this.breath < spell.breath) return `No breath left for ${spell.name}. Get some back first.`;
    return null;
  }

  /**
   * Cast it. Always answers with a line for the screen, because a spell that refuses in silence
   * reads as a broken key rather than as an empty chest.
   */
  cast(id: SpellId, held: Bottles): Cast {
    const spell = SPELLS[id];
    const no = this.reason(id, held);
    if (no) return { spell: null, blow: null, words: no };
    if (spell.drinks) held.take(spell.drinks, 1);
    this.breath -= spell.breath;
    this.winded = SPELL.WINDED;
    const effect = spell.effect;
    if (effect.kind === 'ward') {
      // the better of the two rather than the sum: a draught drunk on top of a spoken ward should
      // make the next few seconds safer, not make you unkillable for the rest of the minute
      this.share = Math.max(this.ward, effect.share);
      this.wardFor = Math.max(this.wardFor, effect.seconds);
    }
    if (effect.kind === 'light') this.lightFor = Math.max(this.lightFor, effect.seconds);
    return {
      spell,
      blow: effect.kind === 'blight' ? { damage: effect.damage, range: effect.range } : null,
      words: spell.words,
    };
  }
}
