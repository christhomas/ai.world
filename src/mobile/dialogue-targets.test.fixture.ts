import { expect } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import type { ShopType, Structures, Village } from '../world/structures';
import { Biome } from '../world/biomes';
import { Register } from '../world/register';
import { booksKeptIn } from '../game/enquiry';
import type { GameState } from '../game/state';
import type { TalkCtx } from '../game/talk';
import { generateQuests, type Quest } from '../game/quests';

export const VILLAGE = 'Testford';

/** A counter and a resident with stable names, stood at the same tile on both hosts. */
export function person(trade = '', role: Entity['role'] = 'villager', shop?: ShopType): Entity {
  const herd = new Herd(KINDS.villager, 0, 0, 0, 0, 1);
  herd.tag = VILLAGE;
  const entity = new Entity(KINDS.villager, 0, 0, herd, 'fixture-keeper', mulberry32(5));
  entity.name = 'Mira';
  entity.trade = trade;
  entity.role = role;
  entity.shop = shop ?? null;
  return entity;
}

export function talkContext(state: GameState): TalkCtx {
  return {
    state, rng: mulberry32(5), time: state.time, quests: new Map(),
    onInventoryChange: () => {}, onQuestChange: () => {},
  };
}

export function errand(kind: 'fetch' | 'visit'): Quest {
  // The generator alternates visits and fetches. Only a general store is missing from this
  // village, so a bounded seed search can select an actual two-loaf errand, words and all.
  const home = { name: VILLAGE, x: 0, z: 0, biome: Biome.Forest,
    shops: [{ type: 'smith' }, { type: 'inn' }, { type: 'apothecary' }] } as Village;
  const structures = { villages: kind === 'visit' ? [home] : [{ ...home, name: 'Otherford' }, home],
    pois: [{ name: 'Old Tower', x: 60, z: 0 }] } as Structures;
  for (let seed = 1; seed <= 200; seed++) {
    const quest = generateQuests(structures, seed).find((q) => q.village === VILLAGE && q.kind === kind);
    if (quest && (kind === 'visit' || quest.target === 'bread')) {
      expect(quest.count).toBe(kind === 'fetch' ? 2 : 1);
      return quest;
    }
  }
  throw new Error(`No ${kind} fixture quest in 200 seeds`);
}

/**
 * Real records, rather than an empty book that silently avoids the fee row. Seed 1 settles a
 * parish; one burial gives its church something to read and its living founders have births.
 */
export function records(state: GameState, room: string): NonNullable<TalkCtx['enquiry']> {
  const register = new Register(1, 1);
  const folk = register.settle(VILLAGE, 8, ['farmer', 'seller', 'priest', 'clerk']);
  expect(folk.length, 'a populated parish').toBeGreaterThan(1);
  register.bury(folk[0].id, 1);
  const books = booksKeptIn(room, VILLAGE, register, 2, {
    charges: [{ who: 'Mira', village: VILLAGE, day: 1, hours: 6, fine: 30 }], wanted: false,
  });
  expect(books.length, `${room} actually keeps a book`).toBeGreaterThan(0);
  for (const book of books) {
    expect(book.open().detail.length, `${book.ask} has detail to sell`).toBeGreaterThan(0);
  }
  return {
    books, purse: () => state.inventory.gold, paid: new Set(),
    pay: (fee) => { state.inventory.gold -= fee; },
  };
}
