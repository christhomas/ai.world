import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DialoguePair, PhoneDialogue, insideWith, possessions } from './dialogue-parity.test.fixture';
import { contextualFamilies, setting } from './contextual-targets.test.fixture';
import { travelInteractions } from '../game/interact/travel';
import { wildInteractions } from '../game/interact/wild';
import { craftInteractions } from '../game/interact/craft';
import { prayerInteractions } from '../game/interact/prayer';
import { createInteractions } from '../game/interact';
import { Places } from '../game/places';
import { ITEMS as SHOP_ITEMS, SHOP_DEFS } from '../game/shops';
import { SKYWARD } from '../game/eyries';
import { ITEMS } from '../game/items';
import { SHRINE_FEE } from '../world/shrine';
import { StructureKind } from '../world/structures';

let phone: PhoneDialogue;
beforeAll(() => {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('document', undefined);
  phone = new PhoneDialogue();
});
afterAll(() => { phone?.dispose(); vi.unstubAllGlobals(); });

/**
 * Every place in `game/interact/` that opens a conversation, counted by file.
 *
 * A new `dialogue.start(` makes this fail until somebody decides what it is: a fixture in
 * contextual-targets.test.fixture.ts, or a row in the document's "Menus without a fixture" table
 * saying why not. The counts are of call sites, not of menus a player sees, so a refusal said
 * through the same call as its menu is one site. See the document for which is which.
 */
const MENUS: Record<string, number> = {
  'builder.ts': 10, 'buildercoast.ts': 0, 'camp.ts': 4, 'carrier.ts': 1, 'context.ts': 0, 'craft.ts': 0,
  'gifts.ts': 1, 'herbs.ts': 1, 'hire.ts': 3, 'index.ts': 2, 'jail.ts': 2, 'nemesis.ts': 2, 'people.ts': 3,
  'prayer.ts': 0, 'rescue.ts': 3, 'travel.ts': 10, 'village.ts': 12, 'wild.ts': 8, 'wildcamps.ts': 2, 'wright.ts': 0,
};

describe('every menu that can open is classified (#574)', () => {
  it('counts the conversation starts in each interaction file against the recorded table', () => {
    const dir = 'src/game/interact';
    const counted = Object.fromEntries(readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => [file, readFileSync(`${dir}/${file}`, 'utf8').match(/dialogue\.start\(/g)?.length ?? 0]));
    expect(counted).toEqual(MENUS);
  });

  it('knows every kind of person dialogueFor answers for', () => {
    const source = readFileSync('src/game/talk.ts', 'utf8');
    const from = source.indexOf('export function dialogueFor(');
    expect(from, 'talk.ts still has dialogueFor').toBeGreaterThanOrEqual(0);
    const body = source.slice(from, source.indexOf('\n}\n', from));
    const all = (pattern: RegExp) => [...body.matchAll(pattern)].map((match) => match[1]);
    // each of these is a `talk:` family in dialogue-families.test.ts
    expect(all(/e\.role === '(\w+)'/g)).toEqual(['shopkeeper', 'elder', 'congregation', 'keeper']);
    expect(all(/e\.trade === '(\w+)'/g)).toEqual(['doctor']);
    expect(all(/k\.id === '(\w+)'/g)).toEqual(['villager', 'traveller']);
  });
});

/** Read to the end of the greeting with the phone alone, as somebody tapping through it would. */
function readOnPhone(): void {
  for (let tap = 0; tap < 20 && phone.talk && !phone.talk.atChoices; tap++) phone.act('interact');
  expect(phone.talk?.atChoices, 'the greeting ends at its choices').toBe(true);
}

describe('the phone reaches a real counter through its own meeting (#574)', () => {
  // No `build` here: `interact` goes through the host's interaction chain and meeting.ts, which
  // makes the keeper's context out of the host's own state. The rows are written out, not read back.
  const counters: Array<['store' | 'inn', string[]]> = [
    ['store', ['Buy', 'Sell', 'Chat', 'Leave']],
    ['inn', ['Buy', 'Sell', `Take a room (${SHOP_ITEMS.room.price}g)`, 'Chat', 'Leave']],
  ];
  it.each(counters)('a %s keeper in seed 3 offers the fixed root rows', (shop, rows) => {
    const pair = new DialoguePair(phone);
    const { structures } = phone.host.handles();
    // an inn that is one of the village's shops, not its pub, where the landlord answers instead
    const door = structures.doors.find((door) => door.kind === shop && structures.villages.some((village) =>
      village.name === door.village && village.shops.some((s) => s.type === shop && s.house.tx === door.bx && s.house.tz === door.bz)));
    expect(door, `seed 3 has a ${shop} counter to walk into`).toBeDefined();
    insideWith(phone, door!, (visit, x, z) => visit.world.nearKeeper(x, z) && !visit.world.atDoor(x, z), (visit) => {
      expect(visit.keeper, `the ${shop} has somebody behind the counter`).not.toBeNull();
      const before = possessions(pair.phoneState);
      phone.act('interact');
      expect(phone.talk, 'interact at the counter starts a conversation').not.toBeNull();
      expect(phone.talk!.speaker).toBe(`${visit.keeper!.name}, ${SHOP_DEFS[shop].title}`);
      readOnPhone();
      expect(phone.talk!.choices.map((row) => row.label)).toEqual(rows);
      // a local world has nobody to send a parcel to, so the shelf is not offered at all
      if (shop === 'inn') expect(phone.talk!.choices.map((row) => row.label)).not.toContain('The post shelf');
      expect(phone.shown.owner).toBe('BOOK');
      expect(possessions(pair.phoneState), 'talking is not a commit').toEqual(before);
    });
  });
});

// Paired: both sides open from the family's own build, so the written-out rows and refusal words are
// the independent check, and the comparison proves the phone shows and commits what the web does.
describe('contextual menus show their written-out rows, the same on web and phone (#574)', () => {
  it('keeps the documented contextual family list attached to executable cases', () => {
    const document = readFileSync('docs/mobile/dialogue-feature-matrix.md', 'utf8');
    const documented = [...document.matchAll(/^\| `context:([^`]+)` \|/gm)].map((row) => row[1]);
    expect(documented.sort()).toEqual(contextualFamilies.map((family) => family.id).sort());
  });

  it.each(contextualFamilies)('$id offers the web choices through the phone ABI', (family) => {
    const pair = new DialoguePair(phone);
    pair.open(family.build);
    pair.read();
    const labels = phone.talk!.choices.map((row) => row.label);
    const expected = family.choices.map((row) => typeof row === 'string' ? row : expect.stringMatching(row));
    expect(labels).toEqual(family.extraChoices ? expect.arrayContaining(expected) : expected);
    if (family.visit) {
      const before = possessions(pair.webState);
      pair.choose(family.visit);
      const said = pair.read();
      if (family.refusal) expect(said[0]).toBe(family.refusal(pair.webState));
      expect(possessions(pair.webState), `${family.id}: the visit changes nothing`).toEqual(before);
      expect(possessions(pair.phoneState)).toEqual(before);
    }
  });
});

describe('contextual refusals keep the web words and possessions', () => {
  it.each(['absent', 'out of reach'] as const)('an indoor keeper who is %s cannot start a transaction', (why) => {
    const pair = new DialoguePair(phone);
    const { places, player, structures } = phone.host.handles();
    const door = structures.doors.find((door) => door.kind === 'store');
    expect(door, 'seed 3 has a store to enter').toBeDefined();
    // clear floor away from both the counter and the threshold
    insideWith(phone, door!, (visit, x, z) => !visit.world.atDoor(x, z) && !visit.world.nearKeeper(x, z), (visit) => {
      expect(visit.keeper, 'the store started with a keeper').not.toBeNull();
      if (why === 'absent') visit.keeper = null;
      expect(places.interactIndoors(true)).toBeNull();
      const f = setting(pair.webState);
      f.hero.x = player.x; f.hero.z = player.z;
      const webPlace = { indoors: visit, ctx: { player: f.hero } };
      f.ctx.places = { indoors: visit, interactIndoors: () => Places.prototype.interactIndoors.call(webPlace as never) } as never;
      const before = possessions(pair.webState);
      createInteractions(f.ctx).atHand();
      phone.act('interact');
      expect(f.flashes).toEqual(['Stand at the door to leave, or at the counter to talk.']);
      const hud = phone.shown.models.hud as { toasts: string[] };
      expect(hud.toasts.at(-1)).toBe(f.flashes[0]);
      pair.same();
      expect(possessions(pair.webState)).toEqual(before);
    });
  });

  it('an eagle refuses a pack too heavy to lift before charging the fare', () => {
    const pair = new DialoguePair(phone);
    pair.open((state) => {
      state.give('cart', 1);
      const f = setting(state);
      f.ctx.skies = { calledFrom: () => ({ name: 'Cloud Village' }) } as never;
      expect(travelInteractions(f.ctx).trySkyward()).toBe(true);
      return f.take();
    });
    const before = possessions(pair.webState);
    pair.choose(/^Fly up/);
    expect(pair.read()[0]).toMatch(/^It spreads its wings, thinks better of it, and folds them\. That pack weighs \d+ to a bird that can lift \d+, and the [a-z ]+ is most of it\.$/);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it('an eagle refuses the fare without charging or flying', () => {
    const pair = new DialoguePair(phone);
    pair.open((state) => {
      state.inventory.gold = 0;
      const f = setting(state);
      f.ctx.skies = { calledFrom: () => ({ name: 'Cloud Village' }) } as never;
      expect(travelInteractions(f.ctx).trySkyward()).toBe(true);
      return f.take();
    });
    const before = possessions(pair.webState);
    pair.choose(/^Fly up/);
    expect(pair.read()).toEqual([`${SKYWARD.FARE} gold to go up, and you have 0.`]);
    expect(possessions(pair.webState)).toEqual(before);
  });

  it('a shared-world prayer refuses without recording a request', () => {
    const pair = new DialoguePair(phone);
    pair.open((state) => {
      state.prayers.length = 0;
      const f = setting(state);
      f.ctx.online = { connected: true, away: true } as never;
      return prayerInteractions(f.ctx).choicesAt({ name: 'Echoes', x: 0, z: 0 })[0].next()!;
    });
    const before = possessions(pair.webState);
    expect(pair.read()).toEqual(['A prayer that moves the ground can harm another person’s home. The stones answer this prayer only in a world of your own.']);
    expect(pair.webState.prayers).toEqual([]);
    expect(pair.phoneState.prayers).toEqual([]);
    expect(possessions(pair.webState)).toEqual(before);
  });

  // A rule test. The rows are chosen through the phone ABI, but the refusal is said into each
  // side's own fake HUD and the register is the fixture's, so the host's HUD is never consulted.
  it('rule: an empty village shrine refuses an unpaid raising without changing the register', () => {
    const pair = new DialoguePair(phone);
    const settings: ReturnType<typeof setting>[] = [];
    pair.open((state) => {
      state.inventory.gold = 0;
      const f = setting(state);
      for (const resident of [...f.ctx.register.living('Testford')]) f.ctx.register.bury(resident.id, state.day);
      expect(f.ctx.register.living('Testford')).toHaveLength(0);
      f.ctx.structures.pois.push({ name: 'Echoes', kind: StructureKind.Shrine, x: 0.5, z: 0.5 } as never);
      expect(wildInteractions(f.ctx).tryShrine()).toBe(true);
      settings.push(f);
      return f.take();
    });
    const before = possessions(pair.webState);
    pair.choose(`Lay ${SHRINE_FEE} gold in the bowl`);
    expect(settings.map((f) => f.flashes)).toEqual([
      [`The stones want ${SHRINE_FEE} gold, and you have 0.`],
      [`The stones want ${SHRINE_FEE} gold, and you have 0.`],
    ]);
    expect(settings.map((f) => f.ctx.register.living('Testford').length)).toEqual([0, 0]);
    expect(possessions(pair.webState)).toEqual(before);
  });

  // A rule test, not a phone one: both sides call the same kindling rule with a fake HUD and a
  // `raining` that says yes. The host's weather is never asked; only its unchanged state is compared.
  it('rule: rain refuses a fire without consuming wood or raw food', () => {
    const pair = new DialoguePair(phone);
    const refused = [pair.webState, pair.phoneState].map((state) => {
      state.give('firerocks', 1); state.give('wood', 3); state.give('meat', 1);
      const f = setting(state);
      f.ctx.raining = () => true;
      const before = possessions(state);
      expect(ITEMS.meat).toBeDefined();
      expect(state.can('kindle')).toBe(true);
      expect(craftInteractions(f.ctx).tryKindle()).toBe(true);
      expect(possessions(state)).toEqual(before);
      return f.flashes;
    });
    expect(refused).toEqual([
      ['Everything is too wet to catch. Wait the rain out.'],
      ['Everything is too wet to catch. Wait the rain out.'],
    ]);
    phone.refresh();
    pair.same();
  });
});
