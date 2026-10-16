import type { FrameDescription } from '../core/scene';
import { expandForFlutter } from '../render/flutter-frame';

type Node = FrameDescription['nodes'][number];
type Wire = Record<string, unknown>;

/** What one step hands the app's renderer: the frame, and only the geometry it has not been sent. */
export interface ScenePacket {
  frame: Omit<FrameDescription, 'nodes'> & { nodes: Wire[] };
  geometries: Record<string, { attributes: Node['attributes']; indices: Node['indices'] }>;
  /** Nodes left out of this frame because their geometry did not fit; they arrive with it. */
  withheld: number;
  /** Geometry the app was sent that has left the scene: no frame has named it for a while. */
  released: string[];
}

/**
 * The scene as an embedded engine sends it, a step at a time (#563, #566).
 *
 * The Flutter feed names geometry by a digest of its contents, which costs hashing every buffer of
 * every frame. Here the graph's own buffers name it: the scene graph hands out the same typed arrays
 * frame after frame and replaces a geometry rather than editing it, so a buffer seen before is
 * geometry the app already holds. New geometry goes out once, within a budget of numbers per
 * packet so that opening a world is a few steps of arriving ground rather than one enormous reply;
 * a node whose geometry has not gone yet waits for it rather than being drawn without it.
 *
 * What the app holds is bounded by what the scene holds (#566): a geometry no packet has named for
 * `keep` packets in a row has left it — a chunk walked away from, a place left — and the packet says
 * so, for the app to let it go. If it comes back it is sent again, under the same name.
 */
export class ScenePackets {
  private readonly names = new WeakMap<object, string>();
  /** Which geometry the app holds, and the packet that last named each. */
  private readonly sent = new Map<string, number>();
  private next = 0;
  private packets = 0;

  constructor(private readonly budget = 300_000, private readonly keep = 4) {}

  /** Geometry this many numbers large is sent in one packet at most. */
  get numbersPerPacket(): number { return this.budget; }

  packet(recorded: FrameDescription): ScenePacket {
    const packet = ++this.packets;
    const frame = expandForFlutter(recorded);
    const geometries: ScenePacket['geometries'] = {};
    let spent = 0;
    let withheld = 0;
    const nodes: Wire[] = [];
    // a parent left out takes its children with it, because a child's place is its parent's
    const kept: number[] = [];
    for (const [at, node] of frame.nodes.entries()) {
      const parent = node.parent < 0 ? -1 : kept[node.parent];
      if (parent === undefined || (node.parent >= 0 && parent < 0)) { kept[at] = -1; withheld++; continue; }
      const drawn = node.kind === 'mesh' || node.kind === 'instances' || node.kind === 'points';
      const positions = node.attributes?.position?.values;
      if (!drawn || !positions || typeof positions !== 'object') {
        kept[at] = nodes.length;
        nodes.push({ ...node, parent });
        continue;
      }
      let id = this.names.get(positions);
      if (!id) { id = `g${this.next++}`; this.names.set(positions, id); }
      if (!this.sent.has(id)) {
        const size = Object.values(node.attributes ?? {}).reduce((n, a) => n + a.values.length, 0) + (node.indices?.length ?? 0);
        if (spent > 0 && spent + size > this.budget) { kept[at] = -1; withheld++; continue; }
        spent += size;
        geometries[id] = { attributes: node.attributes, indices: node.indices };
      }
      this.sent.set(id, packet);
      const rest: Wire = { ...node, parent, geometryId: id };
      delete rest.attributes;
      delete rest.indices;
      kept[at] = nodes.length;
      nodes.push(rest);
    }
    const released: string[] = [];
    for (const [id, named] of this.sent) {
      if (packet - named >= this.keep) { released.push(id); this.sent.delete(id); }
    }
    return { frame: { ...frame, nodes }, geometries, withheld, released };
  }

  /** How many geometries the app holds now, by this engine's account. */
  get held(): number { return this.sent.size; }

  /** The app has forgotten everything it was sent: a new renderer, or a recovered one. */
  forget(): void { this.sent.clear(); }
}

/** Typed arrays as plain arrays, the only shape JSON has for them. */
export const plainArrays = (_key: string, value: unknown): unknown =>
  ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : value;
