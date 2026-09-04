import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LIMITS } from '../../server/protocol';
import { KINDS } from '../entities/animals';
import { COMBAT, struck } from './combat';
import { HIRE, Hires, type Quote } from './hire';
import { GameState } from './state';
import {
  WARBAND, Warband, cleanSwing, cleanSwords, fighterOf, reckon, sideOf, softened, strangers,
  swordsOf, type Fighter, type Side,
} from './warband';

/** A hero wearing exactly this and nothing else, so every figure below is one the shops sell. */
const hero = (worn: string[]): GameState => {
  const state = new GameState();
  for (const id of worn) { state.give(id, 1); state.equip(id); }
  return state;
};

/** Four heroes, one tier of gear apart, from what a new hero owns up to the best in the game. */
const RAGS = ['stick', 'tunic', 'boots'];
const IRON = ['sword', 'cap', 'jerkin', 'boots', 'shield'];
const STEEL = ['steelsword', 'helm', 'mail', 'greaves', 'ironshield'];
const AXE = ['axe', 'helm', 'mail', 'ironshield', 'greaves', 'charm'];

const fighter = (worn: string[], swords: number): Fighter => fighterOf(hero(worn), swords);

const quote = (who: string, name: string): Quote => ({ who, name, asking: 20, terms: [] });

/** Take a man on for a share, which is the form of bargain that keeps paying. */
const hire = (hires: Hires, who: string, name: string, side: string): void => {
  hires.strike(quote(who, name), { fee: 0, share: 0.3 }, 500, side);
};

const side = (who: string, name: string, worn: string[], swords: Side['swords']): Side => {
  const state = hero(worn);
  return sideOf({ who, name, hearts: state.maxHpTotal, guard: state.defence }, swords);
};

/** The far side as we hold it: a count of men, and armour that is their client's business. */
const farSide = (who: string, name: string, worn: string[], swords: number): Side =>
  sideOf({ who, name, hearts: hero(worn).maxHpTotal, guard: 0 }, strangers(swords));

/** Two players who have each hired, and the fight one of them is holding. */
const fieldOf = (theirSwords = 1) => {
  const hires = new Hires();
  hire(hires, 'greta', 'Greta Vos', 'p1');
  hire(hires, 'rolf', 'Rolf Bos', 'p2');
  const ours = new Warband();
  ours.asked('p2');
  ours.begin(side('p1', 'Rowan', RAGS, swordsOf(hires, 'p1')), farSide('p2', 'Wren', AXE, theirSwords));
  return { hires, ours };
};

describe('whose sword arm is whose', () => {
  it('lets a man fight for the one who paid him, and for nobody else on the road', () => {
    const { hires, ours } = fieldOf();

    expect(ours.mayStrike('greta', 'p2', hires)).toBe(true);      // ours, at the man who agreed
    expect(ours.mayStrike('p1', 'p2', hires)).toBe(true);         // and so may we ourselves
    expect(ours.mayStrike('rolf', 'p2', hires)).toBe(false);      // theirs, and asking does not make him ours
    expect(ours.mayStrike('nobody', 'p2', hires)).toBe(false);    // a villager who was never bought
    expect(hires.fightingFor('greta')).toBe('p1');
    expect(hires.fightingFor('rolf')).toBe('p2');

    // and the same fight held from the other end reads the other way round
    const theirs = new Warband();
    theirs.ask('p1');
    theirs.begin(side('p2', 'Wren', AXE, swordsOf(hires, 'p2')), farSide('p1', 'Rowan', RAGS, 1));
    expect(theirs.mayStrike('rolf', 'p1', hires)).toBe(true);
    expect(theirs.mayStrike('greta', 'p1', hires)).toBe(false);
  });

  it('will not let a man be loosed on somebody who never agreed to fight', () => {
    const { hires, ours } = fieldOf();

    expect(ours.mayStrike('greta', 'p3', hires)).toBe(false);     // a stranger walking past
    expect(ours.mayStrike('greta', 'p1', hires)).toBe(false);     // nor on his own employer
    expect(ours.mayStrike('greta', '', hires)).toBe(false);

    // and outside a fight nobody may be struck at all, which is where a bought ambush would start
    const idle = new Warband();
    expect(idle.mayStrike('greta', 'p2', hires)).toBe(false);
    expect(idle.struck({ damage: 5, sword: false })).toBeNull();
    expect(idle.landed({ damage: 5, sword: false })).toBeNull();
  });

  it('counts and pays each side of the fight on its own side of the ledger', () => {
    const hires = new Hires();
    hire(hires, 'greta', 'Greta Vos', 'p1');
    hire(hires, 'hild', 'Hild Smit', 'p1');
    hire(hires, 'rolf', 'Rolf Bos', 'p2');

    expect(swordsOf(hires, 'p1').map((s) => s.who)).toEqual(['greta', 'hild']);
    expect(swordsOf(hires, 'p2').map((s) => s.who)).toEqual(['rolf']);
    expect(swordsOf(hires, 'p3')).toEqual([]);
    expect(swordsOf(hires, 'p1').every((s) => s.hearts === WARBAND.SWORD_HEARTS)).toBe(true);

    // the takings are divided the same way: one side's cut never reaches the other side's men
    expect(hires.divide(100, 'p1').cuts.map((c) => c.who)).toEqual(['greta', 'hild']);
    expect(hires.divide(100, 'p1').paid).toBe(60);
    expect(hires.divide(100, 'p2').cuts.map((c) => c.who)).toEqual(['rolf']);
    expect(hires.divide(100, 'p2').paid).toBe(30);
  });
});

describe('agreeing to a fight', () => {
  const both = (): [Side, Side] => [side('p1', 'Rowan', RAGS, []), farSide('p2', 'Wren', AXE, 0)];

  it('cannot begin because somebody says it has', () => {
    const warband = new Warband();
    expect(warband.begin(...both())).toBe(false);       // told out of nowhere, by anybody at all
    expect(warband.active).toBe(false);

    warband.ask('p9');                                  // an asking, but with somebody else entirely
    expect(warband.begin(...both())).toBe(false);
    expect(warband.asking('p2')).toBe(false);

    warband.asked('p2');
    expect(warband.asking('p2')).toBe(true);
    expect(warband.begin(...both())).toBe(true);
    expect(warband.active).toBe(true);
    expect(warband.opponent).toBe('p2');
    expect(warband.opponentName).toBe('Wren');

    expect(warband.begin(...both())).toBe(false);       // and nobody is dragged into a second one
    expect(warband.asking('p9')).toBe(false);           // every other asking lapsed when this began
  });

  it('forgets an asking that came to nothing', () => {
    const warband = new Warband();
    warband.ask('p2');
    warband.forget('p2');
    expect(warband.asking('p2')).toBe(false);
    expect(warband.begin(...both())).toBe(false);
  });
});

describe('a man in front of the man who paid him', () => {
  it('takes the blows until he is down, and then they reach his employer', () => {
    const { ours } = fieldOf();
    const axe = hero(AXE).attack;                       // 5, which is the hardest swing in the game

    expect(ours.muster).toBe(1);
    expect(ours.struck({ damage: axe, sword: false })).toMatchObject({ at: 'greta', sword: true, felled: false });
    // six hearts, so the second swing has him, and a hired man wears no armour to turn any of it
    expect(ours.struck({ damage: axe, sword: false })).toMatchObject({ at: 'greta', sword: true, felled: true, over: false });
    expect(ours.muster).toBe(0);

    const onward = ours.struck({ damage: axe, sword: false });
    expect(onward).toMatchObject({ at: 'p1', sword: false, felled: false, over: false });
    expect(ours.readout()).toContain('you 6/10 and 0 swords');
    expect(ours.readout()).toContain('them 18/18 and 1 sword');
  });

  it('stops fighting the moment his employer is out of it, however that happened', () => {
    const cutDown = fieldOf();
    expect(cutDown.ours.fallen('greta')).toBe(true);
    expect(cutDown.ours.mayStrike('greta', 'p2', cutDown.hires)).toBe(false);
    expect(cutDown.ours.fallen('greta')).toBe(false);   // burying him twice changes nothing

    const paidOff = fieldOf();
    paidOff.hires.part('greta');                        // the bargain ended in the middle of it
    expect(paidOff.ours.mayStrike('greta', 'p2', paidOff.hires)).toBe(false);

    const called = fieldOf();
    called.ours.end();                                  // his employer yielded, or walked away
    expect(called.ours.active).toBe(false);
    expect(called.ours.mayStrike('greta', 'p2', called.hires)).toBe(false);
    expect(called.ours.readout()).toBe('');
  });

  it('takes the far side at their word for how many of theirs are left', () => {
    const { ours } = fieldOf(2);
    expect(ours.theirMuster).toBe(2);
    ours.theirs(1);
    expect(ours.theirMuster).toBe(1);
    ours.theirs(99);                                    // and no client may claim more than may be hired
    expect(ours.theirMuster).toBe(HIRE.MOST);
  });
});

describe('what a blow comes to', () => {
  it('is softened by armour exactly as the hero own hide softens it', () => {
    for (const worn of [RAGS, IRON, STEEL, AXE]) {
      for (let damage = 1; damage <= 10; damage++) {
        const state = hero(worn);
        const before = state.hp;
        struck(state, damage);
        expect(before - state.hp).toBe(softened(damage, state.defence));
      }
    }
    expect(softened(3, 12)).toBe(WARBAND.LEAST);        // chain mail turns nearly all of it aside
    expect(softened(3, 0)).toBe(3);
  });

  it('is read straight off what the fighter is wearing', () => {
    expect(fighter(RAGS, 0)).toEqual({ attack: 2, guard: 2, hearts: 10, swords: 0 });
    expect(fighter(IRON, 0)).toEqual({ attack: 3, guard: 6, hearts: 12, swords: 0 });
    expect(fighter(STEEL, 0)).toEqual({ attack: 4, guard: 12, hearts: 16, swords: 0 });
    expect(fighter(AXE, 2)).toEqual({ attack: 5, guard: 12, hearts: 18, swords: 2 });
  });

  it('keeps a hired man worth what the behaviour tree and the creature list say he is', () => {
    const trees = JSON.parse(readFileSync('behaviours/villagers.json', 'utf8')) as Record<string, unknown>;
    const findBite = (node: unknown): Record<string, number> | null => {
      if (!node || typeof node !== 'object') return null;
      const spec = node as Record<string, unknown>;
      if (spec.do === 'bite' && spec.with) return spec.with as Record<string, number>;
      for (const value of Object.values(spec)) {
        const list = Array.isArray(value) ? value : [value];
        for (const each of list) { const found = findBite(each); if (found) return found; }
      }
      return null;
    };

    const bite = findBite(trees[HIRE.TREE]);
    expect(bite?.damage).toBe(WARBAND.SWORD_BLOW);
    expect(bite?.cooldown).toBe(WARBAND.SWORD_EVERY);
    expect(KINDS.villager.hp).toBe(WARBAND.SWORD_HEARTS);
  });
});

describe('what two swords are actually worth', () => {
  it('is one tier of gear, and only to somebody already in armour', () => {
    // a man one tier below, in armour of his own, is handed the fight by the two he may hire
    expect(reckon(fighter(IRON, 0), fighter(STEEL, 0)).win).toBe(false);
    expect(reckon(fighter(IRON, HIRE.MOST), fighter(STEEL, 0)).win).toBe(true);
    expect(reckon(fighter(STEEL, 0), fighter(AXE, 0)).win).toBe(false);
    expect(reckon(fighter(STEEL, HIRE.MOST), fighter(AXE, 0)).win).toBe(true);

    // a hero still in his starting tunic is not, at any price the game will sell him
    expect(reckon(fighter(RAGS, HIRE.MOST), fighter(IRON, 0)).win).toBe(false);
    expect(reckon(fighter(RAGS, HIRE.MOST), fighter(AXE, 0)).win).toBe(false);
    expect(reckon(fighter(RAGS, 3), fighter(IRON, 0)).win).toBe(true);
    expect(reckon(fighter(RAGS, 4), fighter(AXE, 0)).win).toBe(false);
    expect(reckon(fighter(RAGS, 5), fighter(AXE, 0)).win).toBe(true);
    expect(HIRE.MOST).toBeLessThan(5);
  });

  it('is twice as long on your feet, when it is not the fight', () => {
    const alone = reckon(fighter(RAGS, 0), fighter(AXE, 0));
    const bought = reckon(fighter(RAGS, HIRE.MOST), fighter(AXE, 0));

    expect(alone.ours).toBeCloseTo(1.35, 2);            // a second and a third of a second, and it is over
    expect(bought.ours).toBeCloseTo(3.15, 2);
    expect(alone.bought).toBe(1);
    expect(bought.bought).toBeGreaterThan(2.3);
    expect(bought.win).toBe(false);
    expect(bought.words).toContain('2.3 times as long');
  });

  it('says which of those it is, in a line, before anybody has agreed to anything', () => {
    const decided = reckon(fighter(STEEL, HIRE.MOST), fighter(AXE, 0));
    expect(decided.alone).toBe(false);
    expect(decided.words).toContain('Your swords are the difference');

    const walkover = reckon(fighter(AXE, HIRE.MOST), fighter(RAGS, 0));
    expect(walkover.alone).toBe(true);
    expect(walkover.words).toContain('swords or no swords');
  });

  it('is what a fight actually played out comes to, blow by blow', () => {
    const hires = new Hires();
    hire(hires, 'greta', 'Greta Vos', 'p1');
    hire(hires, 'hild', 'Hild Smit', 'p1');
    const ours = new Warband();
    ours.asked('p2');
    ours.begin(side('p1', 'Rowan', RAGS, swordsOf(hires, 'p1')), farSide('p2', 'Wren', AXE, 0));

    const axe = hero(AXE).attack;
    let swings = 0;
    while (swings < 50 && !ours.struck({ damage: axe, sword: false })?.over) swings++;
    swings++;

    // two men at six hearts fall to two swings each, and a tunic turns one off the three that follow
    expect(swings).toBe(2 + 2 + 3);
    expect(swings * COMBAT.COOLDOWN).toBeCloseTo(reckon(fighter(RAGS, HIRE.MOST), fighter(AXE, 0)).ours, 2);
  });
});

describe('what crosses the wire', () => {
  /** Everything arrives as somebody else JSON, so that is how it is handed to the guards. */
  const sent = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it('takes a blow on no trust at all', () => {
    expect(cleanSwing(sent({ damage: 4, sword: true }))).toEqual({ damage: 4, sword: true });
    expect(cleanSwing(sent({ damage: 4.9, sword: 'yes' }))).toEqual({ damage: 4, sword: false });
    expect(cleanSwing(sent({ damage: 9999, sword: false }))).toEqual({ damage: LIMITS.DAMAGE, sword: false });

    for (const wrong of [{ damage: 0 }, { damage: -5 }, { damage: 'lots' }, { damage: Number.NaN }, {}, null, 7, 'hit']) {
      expect(cleanSwing(sent(wrong))).toBeNull();
    }
    expect(cleanSwing(undefined)).toBeNull();
    expect(cleanSwing({ damage: Number.POSITIVE_INFINITY, sword: true })).toBeNull();
  });

  it('takes a muster on no trust either', () => {
    expect(cleanSwords(sent(HIRE.MOST))).toBe(HIRE.MOST);
    expect(cleanSwords(sent(1.9))).toBe(1);
    expect(cleanSwords(sent(99))).toBe(HIRE.MOST);
    expect(cleanSwords(sent(-3))).toBe(0);
    for (const wrong of ['two', null, {}, Number.NaN]) expect(cleanSwords(sent(wrong))).toBe(0);
    expect(cleanSwords(undefined)).toBe(0);

    expect(strangers(99).length).toBe(HIRE.MOST);
    expect(strangers(-1)).toEqual([]);
    expect(strangers(1)[0].hearts).toBe(WARBAND.SWORD_HEARTS);
  });

  it('lets a whole fight round-trip, with neither side holding the pool that decides it', () => {
    const { ours } = fieldOf(1);
    const blow = cleanSwing(sent({ damage: hero(AXE).attack, sword: false }));
    expect(blow).not.toBeNull();

    const landing = ours.struck(blow!);
    expect(landing?.at).toBe('greta');
    // what we report back is a blow and a muster, and nothing about anybody's hearts
    expect(cleanSwing(sent({ damage: hero(RAGS).attack, sword: true }))).toEqual({ damage: 2, sword: true });
    expect(cleanSwords(sent(ours.muster))).toBe(1);
  });
});
