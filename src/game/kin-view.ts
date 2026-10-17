import type { Kin, Lineage, Placed } from './lineage';

/**
 * A village's descent as any screen draws it (#575): who is on the table and where, the lines
 * between them, and what the clerk has on each of them.
 *
 * The page's lineage panel and the phone's kin page both draw from this, so the headline and a
 * person's record read the same on both. The layout is `layOut`'s: across the row in units of one
 * person, down the tree a generation at a time.
 */
export interface KinView {
  village: string;
  headline: string;
  people: Array<{ id: string; name: string; standing: Kin['standing']; x: number; y: number; record: string[] }>;
  /** Child to parent, by id, between people who are both on the table. */
  ties: Array<{ child: string; parent: string }>;
}

/**
 * What the clerk has, and what of it is on the table.
 *
 * The two are not the same and saying so is not pedantry: most of a churchyard is people whose
 * children are also gone, and they are drawn nowhere because a lineage is the lines between
 * people. A player who paid for this should be told that the missing ones exist rather than left
 * to wonder why a village of ninety-one names came out as a tree of thirty.
 */
export function kinHeadline(tree: Lineage, placed: readonly Placed[]): string {
  if (tree.people.length === 0) return `Nobody has kept a record at ${tree.village}`;
  const alone = tree.people.length - placed.length;
  const drawn = `${tree.village}: ${placed.length} of them over ${tree.generations} generations`;
  return alone > 0 ? `${drawn} · ${alone} more the clerk has, related to nobody left` : drawn;
}

/** What the register knows about one person, which is what the fee actually bought: their name first. */
export function kinRecord(tree: Lineage, kin: Kin): string[] {
  const stood = kin.standing === 'living' ? 'living'
    : kin.standing === 'buried' ? `died on day ${kin.died}`
    : 'remembered only as a parent';
  const lines = [kin.name, `${kin.trade || 'no trade'} · ${stood}`];
  // "1 years old" is the kind of thing that makes a record read as generated rather than kept
  if (kin.age !== null) lines.push(`${kin.age} ${kin.age === 1 ? 'year' : 'years'} old${kin.died !== null ? ' when they died' : ''}`);
  if (kin.born !== null) lines.push(`born on day ${kin.born}`);
  if (kin.purse !== null) lines.push(`holds ${Math.round(kin.purse)} gold`);
  const folk = [kin.mother, kin.father].filter(Boolean);
  if (folk.length > 0) lines.push(`child of ${folk.join(' and ')}`);
  const children = tree.people.filter((k) => k.mother === kin.name || k.father === kin.name).map((k) => k.name);
  if (children.length > 0) lines.push(`parent of ${children.join(', ')}`);
  return lines;
}

export function kinView(tree: Lineage, placed: readonly Placed[]): KinView {
  const on = new Set(placed.map((p) => p.kin.id));
  return {
    village: tree.village,
    headline: kinHeadline(tree, placed),
    people: placed.map((p) => ({ id: p.kin.id, name: p.kin.name, standing: p.kin.standing, x: p.x, y: p.y,
      record: kinRecord(tree, p.kin) })),
    ties: tree.ties.filter((tie) => on.has(tie.child) && on.has(tie.parent)),
  };
}
