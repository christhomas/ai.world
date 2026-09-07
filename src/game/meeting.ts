import { yawFor, type Entity } from '../entities/entity';
import type { Player } from '../entities/player';
import type { Person } from '../world/people';
import type { Register } from '../world/register';
import type { DialogueBox } from '../ui/dialogue';
import type { Sound } from './audio';
import type { Gifts, Kindness } from './gifts';
import type { Grudges } from './grudge';
import type { Handover } from './handover';
import type { Online } from './online';
import type { Quest } from './quests';
import { ITEMS } from './shops';
import type { GameState } from './state';
import { DOCTOR, dialogueFor, type TalkCtx } from './talk';

/**
 * Stopping in front of somebody.
 *
 * Everything a person will offer you is decided here, at the moment you speak to them, rather
 * than being held anywhere: what the room costs tonight, whether the doctor will take your money,
 * what this shopkeeper has heard about you. All of it turns on things that change between one
 * conversation and the next, so working it out fresh each time is the only version that can be
 * right — and it is why generosity is worth more than the gold it costs, because the innkeeper
 * you were good to is asked again and gives the same answer.
 */
export interface Meeting {
  state: GameState;
  player: Player;
  register: Register;
  grudges: Grudges;
  gifts: Gifts;
  online: Online;
  handover: Handover;
  sound: Sound;
  dialogue: DialogueBox;
  /** The lines a person says are seeded, so the same villager says the same things. */
  rng: () => number;
  /** The elder's errand in each village, which a conversation can take on or finish. */
  quests: Map<string, Quest>;
  /** What a village you saved does for you, when you walk back into it. */
  villageWelcome: (village: string) => Kindness | null;
  /** What is said about a person by the people who know them. */
  wordOfHim: (person: Person) => string;
  /** And what a village believes about the mine it works. */
  saidOfMine: (village: string) => string;
  flash: (message: string) => void;
  persist: () => void;
}

export function createMeeting(ctx: Meeting) {
  const {
    state, player, register, grudges, gifts, online, handover, sound, dialogue, rng, quests,
    villageWelcome, wordOfHim, saidOfMine, flash, persist,
  } = ctx;

  /**
   * The hero's own face, on the right of every conversation. It is seeded by the name they gave
   * themselves, so it is theirs and stays theirs, and their helmet decides what is on its head.
   */
  const heroFace = (): void => dialogue.setHero({
    id: `hero:${localStorage.getItem('ai.world/name') ?? 'Traveller'}`,
    trade: state.equipped.head ? 'soldier' : '',
    stage: 'adult',
  });

  const talkCtx: TalkCtx = {
    state, rng, quests, time: state.time, register, day: state.day,
    wordOfHim,
    saidOfMine,
    onInventoryChange: () => { sound.chime(); persist(); },
    onQuestChange: (q: { village: string; id?: string }, status: 'active' | 'done') => {
      if (status === 'done') {
        sound.fanfare();
        flash(`Quest complete for ${q.village}!`);
        if (q.id) online.shareDeed(q.id);
      } else sound.select();
      persist();
    },
  };

  const startTalk = (e: Entity) => {
    talkCtx.time = state.time;
    talkCtx.day = state.day;
    heroFace();                                 // in case they have put a helmet on since last time
    // a shopkeeper who has heard what you did to somebody's animals takes their opinion out of
    // your purse, whether or not they were the one who owned them
    talkCtx.markup = grudges.markup(e.herd.tag, state.day);
    // an innkeeper you have been good to stops charging you, and does not go back to charging:
    // that is the difference between a favour and a discount, and it is why generosity is worth
    // more than the gold it costs
    const host = e.person !== '' ? register.find(e.person) : undefined;
    const welcome = (host ? gifts.favourFrom(host) : null) ?? villageWelcome(e.herd.tag);
    const bed = welcome?.kind === 'lodging' ? 0 : ITEMS.room.price;
    // a doctor will see to you either way: coin buys the quick way, and everybody else waits.
    // Somebody who has been good to them is not charged at all, and is told so.
    const hurt = state.maxHpTotal - state.hp;
    talkCtx.mending = hurt <= 0 ? undefined : {
      price: welcome?.kind === 'mend' ? 0 : Math.max(4, Math.round(hurt * DOCTOR.A_HEART)),
      hearts: hurt,
      hours: DOCTOR.WAITING,
      take: (paid: boolean) => {
        if (paid) state.inventory.gold -= talkCtx.mending!.price;
        state.hp = state.maxHpTotal;
        state.version++;
        if (!paid) {
          // the hours are real: the world moves on while you sit in the corridor
          state.time += DOCTOR.WAITING / 24;
          while (state.time >= 1) { state.time -= 1; state.day++; }
          register.advance(state.day);
        }
        persist();
        sound.chime();
        return paid
          ? 'Stitched, bound and sent on your way inside the hour.'
          : `You sit in the corner until somebody has time for you. It is ${state.clock().split('·')[1].trim()} by the time you are out, and you are whole again.`;
      },
    };
    // a bed for the night, and in a shared world the night that cannot be skipped
    talkCtx.room = {
      price: bed,
      shared: online.connected,
      take: () => {
        state.inventory.gold -= bed;
        if (online.connected) {
          // the clock belongs to the world here, so the night passes for everybody or nobody
          state.hp = state.maxHpTotal;
          state.version++;
          persist();
          sound.chime();
          return 'You sleep a few hours behind a locked door and wake with your strength back. Outside, the night is still going.';
        }
        state.rest();
        persist();
        sound.chime();
        return 'You sleep soundly and wake at dawn, fully rested.';
      },
    };
    // the post shelf only exists in a shared world, and only knows the names that world has seen
    talkCtx.post = online.connected ? {
      folk: online.folk,
      collect: () => online.fetchMail(),
      send: (to: string, itemId: string, gold: number) => {
        handover.offer(state, itemId, gold);
        online.postMail(to, gold, [[itemId, 1]]);
        persist();
      },
    } : undefined;
    e.yaw = yawFor(player.x - e.x, player.z - e.z);
    e.state = 'idle';
    e.timer = 1e9;
    dialogue.start(dialogueFor(e, talkCtx), () => { e.timer = 1; });
  };

  return { heroFace, startTalk, talkCtx };
}
