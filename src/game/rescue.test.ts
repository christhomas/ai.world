import { describe, expect, it } from 'vitest';
import {
  RESCUE, Rescues, contractFor, counts, goodwillFor, purseOf, takenTonight, troubleNear,
  type Asking, type Trouble,
} from './rescue';
import { KINDS } from '../entities/animals';
import { BIOME_ANIMALS } from '../entities/spawns';
import { HIRE } from './hire';
import { Standing } from './standing';
import { Biome } from '../world/biomes';
import { FORTUNE } from '../world/fortunes';
import { Register } from '../world/register';
import { TerrainSampler } from '../world/terrain';
import { generateRoadGraph } from '../world/graph';
import { StructureKind, type Poi, type Shop, type Site, type Structures, type Village } from '../world/structures';

const TRADES = ['farmer', 'hunter', 'seller'];

/** A village with only the parts of one a contract reads: where it stands, and what it has. */
const asking = (over: Partial<Asking> = {}): Asking => ({
  name: 'Ashford', x: 0, z: 0, biome: Biome.Forest,
  houses: Array.from({ length: 1 }, () => ({} as Village['houses'][number])),
  stalls: [], pub: null, shops: [],
  ...over,
});

/** A village of a given size, which is the whole of what `meansOf` prices. */
const place = (houses: number, stalls = 0, pub = false, shops: Shop['type'][] = []): Asking => asking({
  houses: Array.from({ length: houses }, () => ({} as Village['houses'][number])),
  stalls: Array.from({ length: stalls }, () => [0, 0] as [number, number]),
  pub: pub ? ({} as Village['pub']) : null,
  shops: shops.map((type) => ({ type } as Shop)),
});

/** A named place on the map. A shrine is never kept, so this is somewhere and nothing more. */
const poi = (name: string, x: number, z: number, kind = StructureKind.Shrine): Poi =>
  ({ name, kind, x, z, structure: {} as Poi['structure'] });

const cave = (id: string, x: number, z: number): Site => ({ id, name: `${id} Cave`, x, z });

/** The world outside a village, holding only what this file ever looks at. */
const around = (pois: Poi[] = [], caves: Site[] = [], wrecks: Site[] = []): Structures =>
  ({ doors: [], villages: [], pois, all: [], piers: [], signposts: [], caves, wrecks });

/** A shrine one good walk away: somewhere to blame, kept by nothing. */
const STONES = around([poi('Standing Stones', 40, 0)]);

/** A world in which the country round Ashford has turned on it, since not every one has. */
const preyedOn = (structures = STONES, village = asking()): { seed: number; trouble: Trouble } => {
  for (let seed = 1; seed < 500; seed++) {
    const trouble = troubleNear(seed, village, structures);
    if (trouble) return { seed, trouble };
  }
  throw new Error('no world in five hundred has anything against Ashford');
};

/** And one where what is kept nearby is the sort of thing a village could be rid of. */
const keptNearby = (): { seed: number; structures: Structures; trouble: Trouble } => {
  const structures = around([], [cave('Blackmouth', 35, 20)]);
  for (let seed = 1; seed < 500; seed++) {
    const trouble = troubleNear(seed, asking(), structures);
    if (trouble?.kind === 'ogre') return { seed, structures, trouble };
  }
  throw new Error('nothing keeps Blackmouth in any of five hundred worlds');
};

describe('a village that is losing people', () => {
  it('says nothing while it is doing well enough, and asks the moment it is not', () => {
    const { seed } = preyedOn();
    const village = place(6);

    expect(contractFor(seed, village, STONES, 'well')).toBeNull();
    expect(contractFor(seed, village, STONES, 'lost')).toBeNull();
    expect(contractFor(seed, village, STONES, 'struggling')).not.toBeNull();
    expect(contractFor(seed, village, STONES, 'failing')).not.toBeNull();
  });

  it('has nothing to ask where nothing round it hunts, however few of them are left', () => {
    // the plains grow cows and sheep. A village there is short of people for some other reason
    for (let seed = 1; seed < 60; seed++) {
      const meadow = asking({ biome: Biome.Plains });
      expect(troubleNear(seed, meadow, STONES)).toBeNull();
      expect(contractFor(seed, meadow, STONES, 'failing')).toBeNull();
    }
  });

  it('blames something that actually lives round it', () => {
    for (const biome of [Biome.Forest, Biome.Mountain, Biome.Snow]) {
      const village = asking({ biome });
      const { seed, trouble } = preyedOn(STONES, village);
      const lives = BIOME_ANIMALS[biome].map((s) => s.kind);

      expect(lives).toContain(trouble.kind);
      expect(KINDS[trouble.kind].dangerous ?? 0).toBeGreaterThan(0);
      // and the worst of what lives there: a wood with bears in it does not blame the foxes
      const worse = lives.filter((k) => (KINDS[k].dangerous ?? 0) > (KINDS[trouble.kind].dangerous ?? 0));
      expect(worse).toEqual([]);
      expect(contractFor(seed, village, STONES, 'struggling')!.trouble.kind).toBe(trouble.kind);
    }
  });

  it('blames what keeps a place nearby before it blames the wildlife', () => {
    const { structures, trouble } = keptNearby();

    expect(trouble.kind).toBe('ogre');
    expect(trouble.place).toBe('Blackmouth Cave');
    // there is one of it, and a village that has seen it knows there is
    expect(trouble.needed).toBe(1);
    expect(structures.caves).toHaveLength(1);
  });

  it('never blames the one thing nobody could be hired to deal with', () => {
    // a wight keeps to the ground it is buried in and no blade touches it, so a contract naming
    // one would be a contract nobody could ever finish
    const sampler = new TerrainSampler(generateRoadGraph(11));
    const structures = sampler.structures;
    let named = 0;
    for (const village of structures.villages) {
      const trouble = troubleNear(11, village, structures);
      if (!trouble) continue;
      named++;
      expect(trouble.kind).not.toBe('wight');
    }
    expect(named).toBeGreaterThan(0);
  });

  it('names a place on the map, near enough that somebody from here has walked to it', () => {
    const sampler = new TerrainSampler(generateRoadGraph(11));
    const structures = sampler.structures;
    const onTheMap = new Set([...structures.pois, ...structures.caves, ...structures.wrecks].map((p) => p.name));
    let checked = 0;

    for (const village of structures.villages) {
      const contract = contractFor(11, village, structures, 'struggling');
      if (!contract) continue;
      checked++;
      const { trouble } = contract;
      expect(onTheMap.has(trouble.place)).toBe(true);
      expect(Math.hypot(trouble.x - village.x, trouble.z - village.z)).toBeLessThan(RESCUE.REACH);
      expect(trouble.tiles).toBeGreaterThan(RESCUE.NEAREST);
      // and the elder says where it is in words somebody can act on without a marker
      expect(contract.intro.join(' ')).toContain(trouble.place);
      expect(contract.intro.join(' ')).toContain(trouble.dir);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('is the same trouble however often it is asked, and another one in the next world', () => {
    const { seed, trouble } = preyedOn();
    expect(troubleNear(seed, asking(), STONES)).toEqual(trouble);

    const elsewhere = [];
    for (let other = 1; other < 200; other++) elsewhere.push(troubleNear(other, asking(), STONES) !== null);
    // not every world has it in for the same village, which is the point of rolling it at all
    expect(new Set(elsewhere).size).toBe(2);
  });
});

describe('what a village will pay', () => {
  const { seed } = preyedOn();
  const offer = (village: Asking, fortune: 'struggling' | 'failing' = 'struggling') =>
    contractFor(seed, village, STONES, fortune)!;

  it('is coin where it has a market and a pub, and none at all where it has one street', () => {
    const town = offer(place(HIRE.RICHEST, 2, true));
    const hamlet = offer(place(1));

    expect(town.gold).toBeGreaterThan(hamlet.gold);
    expect(town.gold).toBeGreaterThanOrEqual(RESCUE.IN_KIND_BELOW);
    expect(hamlet.gold).toBe(0);
    // and it is the village that is dearer, not this one elder feeling generous
    expect(purseOf(place(6), 'struggling')).toBeGreaterThan(purseOf(place(3), 'struggling'));
  });

  it('finds less once it has stopped replacing its dead', () => {
    const town = place(HIRE.RICHEST, 2, true);
    expect(purseOf(town, 'failing')).toBeLessThan(purseOf(town, 'struggling'));
    expect(offer(town, 'failing').gold).toBeLessThan(offer(town, 'struggling').gold);
  });

  it('offers a standing arrangement instead, out of whatever it does have', () => {
    const inn = offer(place(1, 0, false, ['inn'])).welcome!;
    const physic = offer(place(1, 0, false, ['apothecary'])).welcome!;
    const shelf = offer(place(1, 0, false, ['store'])).welcome!;
    const nothing = offer(place(1)).welcome!;

    expect(inn.kind).toBe('lodging');
    expect(physic.kind).toBe('mend');
    expect(shelf.kind).toBe('goods');
    expect(nothing.kind).toBe('word');
    // an arrangement, not a present: every one of them is how things are between you from now on
    for (const welcome of [inn, physic, shelf, nothing]) expect(welcome.words.length).toBeGreaterThan(0);
    // and a village that can pay coin offers no arrangement, because it does not have to
    expect(offer(place(HIRE.RICHEST, 2, true)).welcome).toBeNull();
  });

  it('has no coin at all once it has stopped replacing its dead, however grand it was', () => {
    // the ceiling on a failing purse is under what anybody would call money, which is the whole
    // design in one line: the villages nearest to going out are the ones with least to hand you
    for (const village of [place(1), place(5), place(HIRE.RICHEST, 2, true, ['inn'])]) {
      const contract = offer(village, 'failing');
      expect(contract.gold).toBe(0);
      expect(contract.welcome).not.toBeNull();
      expect(contract.goodwill).toBe(RESCUE.CONSCIENCE_MOST);
    }
  });

  it('is worth more to the country the less the village could pay', () => {
    const poorest = offer(place(1));
    const richest = offer(place(HIRE.RICHEST, 2, true));

    expect(poorest.goodwill).toBeGreaterThan(richest.goodwill);
    expect(goodwillFor(0)).toBe(RESCUE.CONSCIENCE_MOST);
    expect(goodwillFor(RESCUE.PURSE_MOST)).toBe(RESCUE.CONSCIENCE_LEAST);

    // and it lands on the same scale a murder does, through the door standing.ts already has
    const kind = new Standing(0);
    const paid = new Standing(0);
    kind.gave(poorest.goodwill);
    paid.gave(richest.goodwill);
    expect(kind.value).toBeGreaterThan(paid.value);
    expect(kind.words).not.toBe(new Standing(0).words);
  });
});

describe('what the elder says', () => {
  const { seed } = preyedOn();

  it('promises children where the register can still make them, and does not where it cannot', () => {
    const struggling = contractFor(seed, place(4), STONES, 'struggling')!;
    const failing = contractFor(seed, place(4), STONES, 'failing')!;

    expect(struggling.done.join(' ')).toContain('children in Ashford');
    // past that line the register stops filling gaps, and promising otherwise would be a lie
    expect(failing.done.join(' ')).not.toContain('children');
    expect(failing.done.join(' ')).toContain('still be here');
  });

  it('talks about a pack and about one of a thing differently', () => {
    const pack = contractFor(seed, place(4), STONES, 'struggling')!;
    expect(pack.trouble.needed).toBe(RESCUE.CULL);
    expect(pack.intro.join(' ')).toContain('They come out of');
    expect(pack.reminder).toContain('are still out at');

    const kept = keptNearby();
    const one = contractFor(kept.seed, place(4), kept.structures, 'struggling')!;
    expect(one.trouble.needed).toBe(1);
    expect(one.intro.join(' ')).toContain('It comes out of');
    expect(one.reminder).toContain('is still out at');
  });
});

describe('doing something about it', () => {
  const { seed, trouble } = preyedOn();
  const contract = contractFor(seed, place(1), STONES, 'struggling')!;

  it('counts a kill at the place, and not one across the valley', () => {
    expect(counts(trouble, trouble.kind, trouble.x, trouble.z)).toBe(true);
    expect(counts(trouble, trouble.kind, trouble.x + RESCUE.GROUND - 1, trouble.z)).toBe(true);
    expect(counts(trouble, trouble.kind, trouble.x + RESCUE.GROUND + 5, trouble.z)).toBe(false);
    expect(counts(trouble, 'rabbit', trouble.x, trouble.z)).toBe(false);
  });

  it('counts nothing towards work nobody agreed to do', () => {
    const rescues = new Rescues();
    expect(rescues.strike(trouble)).toBe(trouble.needed);
    expect(rescues.stands(trouble.village)).toBe(true);
    expect(rescues.owed(trouble.village)).toBe(false);
  });

  it('takes the whole pack before a village will believe it is over', () => {
    const rescues = new Rescues();
    expect(rescues.take(contract, 3)).toBe(true);
    expect(rescues.take(contract, 3)).toBe(false);          // it is already somebody's

    for (let n = 1; n < trouble.needed; n++) {
      expect(rescues.strike(trouble)).toBe(trouble.needed - n);
      expect(rescues.stands(trouble.village)).toBe(true);
      expect(rescues.owed(trouble.village)).toBe(false);
    }
    expect(rescues.strike(trouble)).toBe(0);
    expect(rescues.stands(trouble.village)).toBe(false);
    expect(rescues.owed(trouble.village)).toBe(true);
  });

  it('settles once, and leaves the arrangement standing afterwards', () => {
    const rescues = new Rescues();
    rescues.take(contract, 3);
    for (let n = 0; n < trouble.needed; n++) rescues.strike(trouble);

    expect(rescues.welcomeIn(contract.village)).toBeNull();  // not until somebody has been back
    const settled = rescues.settle(contract, 9)!;
    expect(settled.gold).toBe(contract.gold);
    expect(settled.goodwill).toBe(contract.goodwill);
    expect(settled.welcome).toEqual(contract.welcome);
    expect(rescues.settle(contract, 10)).toBeNull();         // and never twice

    expect(rescues.welcomeIn(contract.village)).toEqual(contract.welcome);
    expect(new Rescues(rescues.save()).welcomeIn(contract.village)).toEqual(contract.welcome);
  });
});

/**
 * The whole point of the thing, as a test: a village that nobody helps goes out, and a village
 * that somebody helps fills its houses again by itself, because that is what the register does
 * with a place below the size it was founded at.
 */
describe('what a raid takes', () => {
  const trouble = {
    village: 'Ashford', kind: 'wolf', place: 'Deep Wood', x: 10, z: 10, needed: 3,
    said: 'wolves out of Deep Wood', tiles: 18, dir: 'north',
  };
  const folk = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `Person ${i}`, village: 'Ashford', trade: 'farmer',
    born: -30, lives: 80, mother: '', father: '', knows: [] as string[], memories: [], purse: 0,
  }));

  it('eases off as the village empties, so a place is never quietly finished off', () => {
    // over many nights, because whether it comes down at all is a roll
    const worst = (n: number, fortune: 'well' | 'struggling') => Math.max(
      ...Array.from({ length: 40 }, (_, day) => takenTonight(1, trouble, folk(n), day + 2, fortune).length),
    );
    expect(worst(22, 'well')).toBeGreaterThan(worst(5, 'struggling'));
    expect(worst(22, 'well')).toBeLessThanOrEqual(RESCUE.TAKES_MOST);
    expect(worst(5, 'struggling')).toBeGreaterThanOrEqual(RESCUE.TAKES_LEAST);
  });

  it('leaves a village that is already past saving entirely alone', () => {
    // whatever the night rolls: a place nobody can save any more is not to be finished off by a
    // background number, it is to sit there failing and wait for somebody
    for (let day = 2; day < 60; day++) {
      expect(takenTonight(1, trouble, folk(4), day, 'failing')).toEqual([]);
    }
  });
});

describe('what comes of it', () => {
  const HOUSES = 4;
  const { seed, trouble } = preyedOn();

  /** Live a village forward, with whatever is out there taking people until it is dealt with. */
  const liveOn = (register: Register, rescues: Rescues, from: number, to: number): string[] => {
    const born: string[] = [];
    for (let day = from; day <= to; day++) {
      for (const change of register.advance(day)) if (change.kind === 'born') born.push(change.name);
      if (!rescues.stands(trouble.village)) continue;
      for (const id of takenTonight(seed, trouble, register.living(trouble.village), day)) register.bury(id, day);
    }
    return born;
  };

  /** The day a village first admits it is in trouble, or -1 for one that never does. */
  const runTo = (register: Register, rescues: Rescues, until: (day: number) => boolean, last: number): number => {
    for (let day = 2; day <= last; day++) {
      liveOn(register, rescues, day, day);
      if (until(day)) return day;
    }
    return -1;
  };

  it('takes more than the village can replace, so waiting is never the answer', () => {
    const register = new Register(seed);
    register.settle(trouble.village, HOUSES, TRADES);
    const founded = register.living(trouble.village).length;
    const struggled = runTo(register, new Rescues(), () => register.fortune(trouble.village) === 'struggling', 60);

    expect(struggled).toBeGreaterThan(1);
    expect(register.living(trouble.village).length).toBeLessThan(founded * FORTUNE.STRUGGLING);
  });

  it('empties the place if nobody comes, and the map keeps the name', () => {
    const register = new Register(seed);
    register.settle(trouble.village, HOUSES, TRADES);
    const lost = runTo(register, new Rescues(), () => register.fortune(trouble.village) === 'lost', 120);

    expect(lost).toBeGreaterThan(1);
    expect(register.living(trouble.village)).toHaveLength(0);
    // the register notices an empty place the following morning, so give it the morning
    liveOn(register, new Rescues(), lost + 1, lost + 1);
    expect(register.emptiedOn(trouble.village)).toBe(lost + 1);
    expect(register.settled()).toContain(trouble.village);
  });

  it('fills its houses again once somebody has dealt with the cause, and not before', () => {
    const rescued = new Register(seed);
    const abandoned = new Register(seed);
    rescued.settle(trouble.village, HOUSES, TRADES);
    abandoned.settle(trouble.village, HOUSES, TRADES);
    const founded = rescued.living(trouble.village).length;

    const rescues = new Rescues();
    const nobody = new Rescues();
    const struggling = (register: Register) => () => register.fortune(trouble.village) === 'struggling';
    const helped = runTo(rescued, rescues, struggling(rescued), 60);
    runTo(abandoned, nobody, struggling(abandoned), 60);
    const thin = rescued.living(trouble.village).length;

    // somebody goes out and finishes it, which is the only thing that changes between the two
    const contract = contractFor(seed, place(HOUSES), STONES, 'struggling')!;
    rescues.take(contract, helped);
    for (let n = 0; n < trouble.needed; n++) rescues.strike(trouble);
    expect(rescues.stands(trouble.village)).toBe(false);

    const RECOVER = 8;
    const born = liveOn(rescued, rescues, helped + 1, helped + RECOVER);
    liveOn(abandoned, nobody, helped + 1, helped + RECOVER);

    expect(born.length).toBeGreaterThan(0);                  // children, within the week
    expect(rescued.living(trouble.village).length).toBeGreaterThan(thin);
    expect(rescued.living(trouble.village).length).toBeGreaterThan(abandoned.living(trouble.village).length);
    expect(rescued.living(trouble.village).length).toBeLessThanOrEqual(founded);
    // and the one nobody came to is still going the other way
    expect(abandoned.living(trouble.village).length).toBeLessThan(thin);
  });

  it('takes the same neighbours from the same village on the same night, for everybody', () => {
    const register = new Register(seed);
    const people = register.settle(trouble.village, HOUSES, TRADES);
    const nights = [];
    for (let day = 2; day < 30; day++) nights.push(takenTonight(seed, trouble, people, day).join(','));

    for (let day = 2; day < 30; day++) {
      expect(takenTonight(seed, trouble, people, day).join(',')).toBe(nights[day - 2]);
    }
    // quiet nights and bad ones, and never more than a village could lose in one
    expect(new Set(nights).size).toBeGreaterThan(2);
    expect(Math.max(...nights.map((n) => (n === '' ? 0 : n.split(',').length)))).toBeLessThanOrEqual(RESCUE.TAKES_MOST);
    expect(nights.filter((n) => n === '').length).toBeGreaterThan(0);
  });
});
