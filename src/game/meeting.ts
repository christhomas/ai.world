import { turnToFace, type Entity } from '../entities/entity';
import { buy, holds } from '../world/deeds';
import { heroOf } from '../world/health';
import { personTill, villageTill } from './tills';
import type { Player } from '../entities/player';
import type { Person } from '../world/people';
import type { Register } from '../world/register';
import type { Doorway } from '../world/structures';
import type { DialogueBox } from '../ui/dialogue';
import type { Sound } from './audio';
import type { Gifts, Kindness } from './gifts';
import type { Grudges } from './grudge';
import type { Handover } from './handover';
import type { Jail } from './jail';
import type { Standing } from './standing';
import type { Online } from './online';
import type { Quest } from './quests';
import { booksKeptIn } from './enquiry';
import { ITEMS } from './shops';
import type { GameState } from './state';
import { DOCTOR, dialogueFor, type TalkCtx } from './talk';
import type { Biome } from '../world/biomes';

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
  /**
   * The country's cells, which are also where its charge sheets are written.
   *
   * Here rather than anywhere nearer the watch house, because the sheet is the one village book
   * that is not a reading of the register: nothing about a village says who was arrested in it.
   */
  jail: Jail;
  /** And how badly the law wants the person asking to see it. */
  standing: Standing;
  gifts: Gifts;
  online: Online;
  handover: Handover;
  sound: Sound;
  dialogue: DialogueBox;
  /** The lines a person says are seeded, so the same villager says the same things. */
  rng: () => number;
  /**
   * What country the hero is standing in, which is what a fur is worth here.
   *
   * The one price in this game that depends on where it is paid. It was a sentence rather than a
   * rule until the hunting loop was walked end to end: the game told a hunter his pelt was worth
   * twenty-three gold in the desert and fifteen in the snow, and then every shop in the world paid
   * him thirteen, because the local price was worked out in exactly one place — the line that
   * advertises it.
   */
  countryAt: (x: number, z: number) => Biome;
  /** The elder's errand in each village, which a conversation can take on or finish. */
  quests: Map<string, Quest>;
  /** What a village you saved does for you, when you walk back into it. */
  villageWelcome: (village: string) => Kindness | null;
  /** What is said about a person by the people who know them. */
  wordOfHim: (person: Person) => string;
  /** And what a village believes about the mine it works. */
  saidOfMine: (village: string) => string;
  /**
   * The doorway of the room the hero is standing in, or nothing out of doors.
   *
   * Records are kept by buildings rather than by people, so this is what decides whether the
   * person in front of you has a book to read out of. It is a doorway rather than a place because
   * a doorway already carries both halves of the answer: what the room is, and whose village it
   * belongs to.
   */
  indoors: () => Doorway | null;
  flash: (message: string) => void;
  persist: () => void;
}

export function createMeeting(ctx: Meeting) {
  const {
    state, player, register, grudges, jail, standing, gifts, online, handover, sound, dialogue,
    rng, quests, villageWelcome, wordOfHim, saidOfMine, indoors, flash, persist, countryAt,
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
    // where this counter stands, read when a price is asked for rather than when the game is built:
    // the hero walks, and the whole point of a fur is that it is worth more somewhere else
    country: () => countryAt(player.x, player.z),
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
        /*
         * The doctor is paid, and he is the doctor standing in front of you.
         *
         * This was `state.inventory.gold -= price` — one of the last places in the game where the
         * hero's money left the world. It was missed when the other fifteen were converted, because
         * it lives here rather than in `game/interact/`, which is exactly how a site like this
         * survives a sweep. `e.person` is his row on the register, so the fee outlives the body
         * behind the desk being despawned the moment you walk out of the village.
         */
        if (paid) {
          buy(holds(state.inventory), personTill(register, e.person, e.herd.tag), talkCtx.mending!.price);
        }
        heroOf(state).mend(state.maxHpTotal);
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
        // and the innkeeper is paid for the bed, which is his trade rather than a toll
        buy(holds(state.inventory), personTill(register, e.person, e.herd.tag), bed);
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
    // and the books, which belong to the room rather than to whoever is stood in it: a priest
    // reads out his own churchyard, a clerk his own roll, a sergeant his own charge sheet, each of
    // them only for somebody standing where the book is kept. Worked out afresh for every
    // conversation, so a fee paid at one counter buys nothing at the next one and nothing at this
    // one tomorrow — and the sheet is read at the moment it is asked for, because the surest way
    // to get onto one is to be stood in front of the man who writes it.
    const room = indoors();
    const kept = room
      ? booksKeptIn(room.kind, room.village, register, state.day, { charges: jail.charges(), wanted: standing.wanted })
      : [];
    talkCtx.enquiry = kept.length === 0 ? undefined : {
      books: kept,
      purse: () => state.inventory.gold,
      /*
       * A clerk's fee for looking something up, paid to the village whose books they are.
       *
       * The village rather than the clerk: a town hall's books belong to the place, the person
       * behind the desk is whoever is on duty, and `places.ts` names them rather than the register.
       */
      pay: (fee: number) => {
        buy(holds(state.inventory), villageTill(register, room?.village ?? e.herd.tag), fee);
        sound.chime();
        persist();
      },
      paid: new Set(),
    };
    turnToFace(e, player.x, player.z);
    e.state = 'idle';
    e.timer = 1e9;
    dialogue.start(dialogueFor(e, talkCtx), () => { e.timer = 1; });
  };

  return { heroFace, startTalk, talkCtx };
}
