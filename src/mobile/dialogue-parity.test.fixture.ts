import { expect, vi } from 'vitest';
import { HOST_CONTRACT_VERSION, type HostResult, type Presentation, type Request } from '../../shared/mobile/host-contract';
import * as headless from '../platform/headless-game';
import { Conversation } from '../ui/conversation';
import type { DialogueNode } from '../ui/dialogue';
import { GameState } from '../game/state';
import { packView } from '../game/pack';
import { SLOTS } from '../game/items';
import { create } from './game-engine';

interface TalkModel {
  speaker: string;
  emoji: string;
  shown: string;
  done: boolean;
  page: number;
  pages: number;
  choice: number;
  atChoices: boolean;
  choices: Array<{ label: string; note: string | null; adjusts: boolean }>;
}

/**
 * The real app ABI, with its host kept only so a fixture can put the same state on both sides.
 * No frame is needed to read a counter. The world is assembled normally, and disposed afterwards;
 * the spy observes headlessGame rather than replacing the game or its request handlers.
 */
export class PhoneDialogue {
  readonly host: headless.HeadlessGame;
  private readonly engine: ReturnType<typeof create>;
  private sequence = 0;
  private readonly session = 'dialogue-parity';
  shown!: Presentation;

  constructor() {
    let host: headless.HeadlessGame | undefined;
    const original = headless.headlessGame;
    const spy = vi.spyOn(headless, 'headlessGame').mockImplementation((options) => {
      host = original(options);
      return host;
    });
    try {
      this.engine = create(this.session, JSON.stringify({
        seed: 3, kind: 'road', slot: 'dialogue-parity', viewport: { width: 1200, height: 540 },
      }));
      this.send({ type: 'start', payload: { mode: 'local', world: 'dialogue-parity' } });
      expect(host, 'the app assembled a real headless host').toBeDefined();
      this.host = host!;
    } finally { spy.mockRestore(); }
  }

  send(request: Request): void {
    const sequence = this.sequence++;
    const reply = JSON.parse(this.engine.request(JSON.stringify({
      ...request, version: HOST_CONTRACT_VERSION, session: this.session, sequence, id: `dialogue-${sequence}`,
    }))) as HostResult;
    expect(reply.type, JSON.stringify(reply.payload)).toBe('result');
    if (reply.payload.state) this.shown = reply.payload.state;
  }

  act(action: string, target: string | null = null): void {
    this.send({ type: 'action', payload: { action, target, args: null } });
  }

  refresh(): void { this.send({ type: 'resync', payload: { reason: 'dialogue-fixture' } }); }
  dispose(): void { this.send({ type: 'dispose', payload: {} }); }
  get talk(): TalkModel | null { return this.shown.models.conversation as unknown as TalkModel | null; }
}

/** Only the fixture's purse, pack and errands; neither path inherits a previous case's hero. */
function reset(state: GameState): void {
  state.inventory.gold = 100;
  state.inventory.items.clear();
  for (const slot of SLOTS) delete state.equipped[slot];
  state.quests.clear();
  state.discovered.clear();
  state.charted.clear();
  state.explored.clear();
  state.prayers.length = 0;
  state.shouldering = null;
  state.practice = 0;
  state.hp = state.maxHp;
  state.day = 1;
  state.time = 0.5;
  state.version = 0;
}

export const possessions = (state: GameState) => ({
  gold: state.inventory.gold, pack: [...state.inventory.items], quests: [...state.quests],
  charted: [...state.charted], discovered: [...state.discovered], version: state.version,
});

/**
 * Web keys drive the Conversation used by DialogueBox; phone taps cross create().request, just as
 * Flutter's ConversationBand does. At each page and choice we compare the serialized native model
 * with the web controller, as well as the gold, carried items and quest statuses underneath it.
 * This is about rules and offered rows, not a substitute for the touch/layout playtest in #584.
 */
export class DialoguePair {
  readonly web = new Conversation();
  readonly webState = new GameState();
  readonly phoneState: GameState;

  constructor(readonly phone: PhoneDialogue) {
    phone.host.conversation.close();
    phone.host.presentation.toasts.length = 0;
    this.phoneState = phone.host.handles().state;
    reset(this.webState);
    reset(this.phoneState);
  }

  open(build: (state: GameState) => DialogueNode): void {
    this.web.start(build(this.webState));
    this.phone.host.conversation.start(build(this.phoneState));
    this.phone.refresh();
    this.same();
  }

  same(): void {
    const node = this.web.node;
    const model = this.phone.talk;
    if (!node) expect(model).toBeNull();
    else {
      expect(model).toMatchObject({
        speaker: node.speaker, emoji: node.emoji, shown: this.web.shown, done: this.web.done,
        page: this.web.page, pages: node.pages.length, choice: this.web.choice, atChoices: this.web.atChoices,
      });
      expect(model!.choices).toEqual((node.choices ?? []).map((row) => ({
        label: row.label, note: row.note ?? null, adjusts: !!row.adjust,
      })));
    }
    expect(possessions(this.phoneState)).toEqual(possessions(this.webState));
    expect(this.phone.shown.models.pack).toEqual(packView(this.webState));
    expect(this.phone.shown.models.hero).toMatchObject({ gold: this.webState.inventory.gold });
    expect(this.phone.shown.owner).toBe(node ? 'BOOK' : 'WORLD');
    expect(this.phone.shown.busy).toBe(node ? 'talking' : null);
  }

  /** Read the remaining pages, stopping before any choice or dismissal can commit anything. */
  read(): string[] {
    const node = this.web.node;
    expect(node, 'there is somebody speaking').not.toBeNull();
    const pages: string[] = [];
    const from = this.web.page;
    for (let page = from; page < node!.pages.length; page++) {
      expect(this.web.page).toBe(page);
      if (!this.web.done) this.advance();
      pages.push(this.phone.talk!.shown);
      if (page < node!.pages.length - 1) this.advance();
    }
    expect(pages).toEqual(node!.pages.slice(from));
    return pages;
  }

  advance(): void {
    this.web.advance();
    this.phone.act('interact');
    this.same();
  }

  choose(label: string | RegExp): void {
    this.read();
    const rows = this.web.node?.choices ?? [];
    const index = rows.findIndex((row) => typeof label === 'string' ? row.label === label : label.test(row.label));
    expect(index, `the web offers ${String(label)}`).toBeGreaterThanOrEqual(0);
    expect(this.phone.talk!.choices[index].label).toBe(rows[index].label);
    this.web.move(index - this.web.choice);
    this.web.advance();
    this.phone.act('choose', String(index));
    this.same();
  }

  nudge(label: RegExp, dir: 1 | -1): void {
    this.read();
    const index = this.web.node!.choices!.findIndex((row) => label.test(row.label));
    expect(index, `a quantity row for ${label}`).toBeGreaterThanOrEqual(0);
    expect(this.web.node!.choices![index].adjust).toBeTypeOf('function');
    this.web.move(index - this.web.choice);
    this.web.nudge(dir);
    this.phone.act('nudge', `${index}:${dir}`);
    this.same();
  }
}
