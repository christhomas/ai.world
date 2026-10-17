import type { Presence } from '../../server/protocol';

/** What the travellers list is read from: everybody else in this world, and where you are. */
export interface CompanyInput {
  /** Everyone else the server says is in this world. */
  players: Presence[];
  /** Ids of the people travelling with you. */
  party: Set<string>;
  /** Where you are, so distances mean something. */
  x: number;
  z: number;
  /** The world you are standing in, so it can say who is beside you. */
  place: string;
  /** Your own name, for the heading. */
  me: string;
}

/** One of the others, as the list reads them out. */
export interface Traveller {
  id: string;
  name: string;
  /** Travelling with you. */
  party: boolean;
  /** Where they are, said from where you are standing. */
  where: string;
  /** How many tiles off. */
  away: number;
  riding: Presence['riding'];
}

/** The travellers list (#576), as the page's list and an installed app's both draw it. */
export interface CompanyView {
  me: string;
  /** Where you are, said the way a person would. */
  where: string;
  /** Nearest first. */
  travellers: Traveller[];
}

/** Which world somebody is standing in, said the way a person would. */
function whereabouts(place: string): string {
  if (place === 'surface') return 'out in the world';
  if (place.includes(':')) return `underground in ${place.split(':')[0]}`;
  return `inside ${place}`;
}

/** Everybody else in this world, nearest first, and where each of them is from here. */
export function companyView(input: CompanyInput): CompanyView {
  const away = (p: Presence) => Math.hypot(p.x - input.x, p.z - input.z);
  return {
    me: input.me,
    where: whereabouts(input.place),
    travellers: [...input.players].sort((a, b) => away(a) - away(b)).map((p) => ({
      id: p.id, name: p.name, party: input.party.has(p.id),
      // standing beside you counts for more than the name of the place
      where: p.place === input.place ? 'here with you' : whereabouts(p.place),
      away: Math.round(away(p)), riding: p.riding,
    })),
  };
}
