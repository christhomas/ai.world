import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dialogueFor, type TalkCtx } from '../game/talk';
import type { GameState } from '../game/state';
import { SHOP_DEFS } from '../game/shops';
import type { DialogueNode } from '../ui/dialogue';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { mulberry32 } from '../core/rng';
import { DialoguePair, PhoneDialogue, possessions } from './dialogue-parity.test.fixture';
import { errand, person, records, talkContext, VILLAGE } from './dialogue-targets.test.fixture';

interface Family {
  id: string;
  build(state: GameState): DialogueNode;
  choices: Array<string | RegExp>;
  visit?: string[];
}

const counter = (shop: 'store' | 'smith' | 'inn' | 'apothecary', extra?: (state: GameState) => Partial<TalkCtx>) =>
  (state: GameState) => dialogueFor(person('', 'shopkeeper', shop), { ...talkContext(state), ...extra?.(state) });

const bookkeeper = (trade: string, room: string) => (state: GameState) =>
  dialogueFor(person(trade, trade === 'priest' ? 'congregation' : 'keeper'), {
    ...talkContext(state), enquiry: records(state, room),
  });

const room = { price: 12, shared: false, take: () => 'Slept.', leave: () => {} };
const mending = { price: 14, hearts: 2, hours: 6, take: () => 'Mended.' };
const doctor = (state: GameState, terms = mending) => {
  state.hp = state.maxHpTotal - terms.hearts;
  return dialogueFor(person('doctor'), { ...talkContext(state), mending: terms });
};

/** The rows here are the web's actual families and conditions, also named in the document. */
const families: Family[] = [
  { id: 'store', build: counter('store'), choices: ['Buy', 'Sell', 'Chat', 'Leave'], visit: ['Buy', 'Sell', 'Chat'] },
  { id: 'smith', build: counter('smith'), choices: ['Buy', 'Sell', 'Chat', 'Leave'], visit: ['Buy', 'Sell', 'Chat'] },
  { id: 'apothecary', build: counter('apothecary', (state) => ({ enquiry: records(state, 'apothecary') })),
    choices: ['Buy', 'Sell', 'Ask about the births', 'Chat', 'Leave'], visit: ['Buy', 'Sell', 'Ask about the births'] },
  { id: 'inn-local', build: counter('inn', () => ({ room })),
    choices: ['Buy', 'Sell', 'Take a room (12g)', 'Chat', 'Leave'], visit: ['Buy', 'Sell', 'Take a room (12g)'] },
  { id: 'inn-shared', build: counter('inn', () => ({ room: { ...room, shared: true },
    post: { folk: ['Rowan'], collect: () => {}, send: () => {} } })),
    choices: ['Buy', 'Sell', 'Take a room (12g)', 'The post shelf', 'Chat', 'Leave'], visit: ['The post shelf'] },
  { id: 'inn-night', build: (state) => {
    state.time = 0.95;
    return counter('inn', () => ({ room }))(state);
  }, choices: ['Take a room (12g)', 'Back out into the dark'], visit: ['Take a room (12g)'] },
  { id: 'priest', build: bookkeeper('priest', 'church'), choices: ['Ask about the dead', 'Leave'], visit: ['Ask about the dead'] },
  { id: 'clerk', build: bookkeeper('clerk', 'townhall'),
    choices: ['Ask about the people here', 'Ask who is descended from whom', 'Leave'],
    visit: ['Ask about the people here', 'Ask who is descended from whom'] },
  { id: 'sergeant', build: bookkeeper('sergeant', 'watchhouse'),
    choices: ['Ask about the charge sheet', 'Leave'], visit: ['Ask about the charge sheet'] },
  { id: 'doctor-paid', build: (state) => doctor(state),
    choices: ['Pay 14 gold', 'Wait your turn (6 hours)', 'Not now'] },
  { id: 'doctor-poor', build: (state) => {
    state.inventory.gold = 0;
    return doctor(state);
  }, choices: ['Wait your turn (6 hours)', 'Not now'] },
  { id: 'doctor-favour', build: (state) => doctor(state, { ...mending, price: 0 }),
    choices: ['Let them see to it', 'Not now'] },
  ...(['fetch', 'visit'] as const).map((kind): Family => ({
    id: `elder-${kind}`, build: (state) => dialogueFor(person('', 'elder'), {
      ...talkContext(state), quests: new Map([[VILLAGE, errand(kind)]]),
    }), choices: ['Accept', 'Not now'],
  })),
  { id: 'elder-ready', build: (state) => {
    const quest = errand('fetch');
    state.give(quest.target, quest.count);
    state.quests.set(quest.id, 'active');
    return dialogueFor(person('', 'elder'), { ...talkContext(state), quests: new Map([[VILLAGE, quest]]) });
  }, choices: ['Take 50 gold'] },
  { id: 'resident', build: (state) => dialogueFor(person('farmer'), talkContext(state)), choices: [] },
  { id: 'congregation', build: (state) => dialogueFor(person('', 'congregation'), talkContext(state)), choices: [] },
  { id: 'keeper-outdoors', build: (state) => dialogueFor(person('clerk', 'keeper'), talkContext(state)), choices: [] },
  ...(['traveller', 'wolf'] as const).map((kind): Family => ({
    id: kind, build: (state) => {
      const herd = new Herd(KINDS[kind], 0, 0, 0, 0, 1);
      return dialogueFor(new Entity(KINDS[kind], 0, 0, herd, kind, mulberry32(5)), talkContext(state));
    }, choices: [],
  })),
];

let phone: PhoneDialogue;
beforeAll(() => {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('document', undefined);
  phone = new PhoneDialogue();
});
afterAll(() => { phone?.dispose(); vi.unstubAllGlobals(); });

describe('the per-family web and native conversation matrix (#574)', () => {
  it('accounts for every shop and keeps the documented family list attached to these fixtures', () => {
    expect(Object.keys(SHOP_DEFS).sort()).toEqual(['apothecary', 'inn', 'smith', 'store']);
    const document = readFileSync('docs/mobile/dialogue-feature-matrix.md', 'utf8');
    const documented = [...document.matchAll(/^\| `talk:([^`]+)` \|/gm)].map((row) => row[1]);
    expect(documented.sort()).toEqual(families.map((family) => family.id).sort());
  });

  it.each(families)('$id offers exactly the web rows through the native ABI', (family) => {
    const pair = new DialoguePair(phone);
    pair.open(family.build);
    const before = possessions(pair.webState);
    pair.read();
    const labels = phone.talk!.choices.map((row) => row.label);
    expect(labels).toEqual(family.choices);
    expect(pair.web.node!.pages.length, 'a real speaker with something to say').toBeGreaterThan(0);
    expect(possessions(pair.webState), 'reading is not a commit').toEqual(before);
    // Buying, selling, books, beds and the post each open a different menu. Check those too;
    // comparing just the greeting would miss a native adapter dropping shelf notes or dials.
    for (const row of family.visit ?? []) {
      pair.open(family.build);
      pair.choose(row);
      pair.read();
      expect(phone.talk!.choices.length, `${family.id}: ${row} offers a way back`).toBeGreaterThan(0);
    }
  });
});
