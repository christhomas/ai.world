import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DialoguePair, PhoneDialogue, possessions } from './dialogue-parity.test.fixture';
import { contextualFamilies, setting } from './contextual-targets.test.fixture';
import { travelInteractions } from '../game/interact/travel';
import { wildInteractions } from '../game/interact/wild';
import { craftInteractions } from '../game/interact/craft';
import { prayerInteractions } from '../game/interact/prayer';
import { createInteractions } from '../game/interact';
import { Places } from '../game/places';
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

describe('contextual menus use the same rows on web and phone (#574)', () => {
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
      pair.choose(family.visit);
      pair.read();
    }
  });
});

describe('contextual refusals keep the web words and possessions', () => {
  it.each(['absent', 'out of reach'] as const)('an indoor keeper who is %s cannot start a transaction', (why) => {
    const pair = new DialoguePair(phone);
    const { places, player, structures } = phone.host.handles();
    const door = structures.doors.find((door) => door.kind === 'store');
    expect(door, 'seed 3 has a store to enter').toBeDefined();
    places.enterBuilding(door!);
    try {
      const visit = places.indoors!;
      expect(visit.keeper, 'the store started with a keeper').not.toBeNull();
      // Find actual clear floor away from the counter and threshold, rather than assuming a
      // generated room has either at a fixed coordinate. Missing suitable floor fails the case.
      let spot: [number, number] | null = null;
      for (let z = 1; z < visit.world.map.h - 1; z++) {
        for (let x = 1; x < visit.world.map.w - 1; x++) {
          const at: [number, number] = [x + 0.5, z + 0.5];
          if (!visit.world.blocked(...at) && !visit.world.atDoor(...at) && !visit.world.nearKeeper(...at)) spot = at;
        }
      }
      expect(spot, 'clear floor beyond talking reach').not.toBeNull();
      player.teleport(...spot!);
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
    } finally { places.leaveBuilding(); }
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
    expect(pair.read()[0]).toMatch(/^It spreads its wings, thinks better of it, and folds them\. That pack weighs \d+ to a bird that can lift \d+, and the cart is most of it\.$/);
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

  it('an empty village shrine refuses an unpaid raising without changing the register', () => {
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

  it('rain refuses a fire without consuming wood or raw food', () => {
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
