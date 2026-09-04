import { PARTY_LIMIT, type PartyMember, type Presence } from '../../server/protocol';

export { PARTY_LIMIT };
export type { PartyMember };

/**
 * The handful of people you are travelling with. A party is nothing but a list of names the
 * server keeps for as long as everyone stays connected: it grants no powers of its own, but your
 * companions are drawn on the map wherever they are, and an errand one of you finishes counts for
 * all of you.
 */
export class Party {
  private members: PartyMember[] = [];
  private ids = new Set<string>();

  /** Take the roster the server sends whenever the party changes. */
  receive(members: PartyMember[]): void {
    this.members = members;
    this.ids = new Set(members.map((m) => m.id));
  }

  get size(): number { return this.members.length; }
  get roster(): PartyMember[] { return this.members; }
  has(id: string): boolean { return this.ids.has(id); }

  /** Everyone in the party who is somewhere we can point at, ourselves left out. */
  companions(players: Iterable<Presence>, myId: string): Presence[] {
    const out: Presence[] = [];
    for (const p of players) if (p.id !== myId && this.ids.has(p.id)) out.push(p);
    return out;
  }

  /** How the party reads in a line: "with Wren and Rowan". */
  describe(myId: string): string {
    const names = this.members.filter((m) => m.id !== myId).map((m) => m.name);
    if (names.length === 0) return 'travelling alone';
    if (names.length === 1) return `with ${names[0]}`;
    return `with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
}
