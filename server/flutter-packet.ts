/**
 * What the Flutter feed actually sends for one recorded frame, as a function rather than a loop body.
 *
 * It lived inside `flutter-scene-feed.ts`, which is the one place that could say what the phone is
 * fed and the one place nothing could call: a script that opens a browser and a socket at import.
 * So a frame the phone had really been handed could only be seen by running the feed and a phone,
 * and the Dart tests fed a frame written by hand instead. The record-only playtest writes one of
 * these to disk, and the Dart side parses that, so the transform they share has to be this one.
 *
 * Geometry goes by digest: the first packet a client sees carries every buffer, and later ones name
 * the buffers it already holds and carry only what it has not been sent.
 */
import { createHash } from 'node:crypto';
import type { FrameDescription } from '../src/core/scene';
import { expandForFlutter } from '../src/render/flutter-frame';

/** Typed arrays as plain arrays, which is the only shape JSON has for them. */
export const plainArrays = (_key: string, value: unknown): unknown =>
  ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : value;

export interface FlutterPacket {
  frame: Omit<FrameDescription, 'nodes'> & { nodes: Array<Record<string, unknown>> };
  geometries: Record<string, { attributes: unknown; indices: unknown }>;
}

/** One recorded frame, expanded for Flutter, with every geometry it names — a new client's packet. */
export function flutterPacket(recorded: FrameDescription): FlutterPacket {
  const frame = expandForFlutter(recorded);
  const geometries: FlutterPacket['geometries'] = {};
  const nodes = frame.nodes.map((node) => {
    if (node.kind !== 'mesh' && node.kind !== 'instances' && node.kind !== 'points') return node;
    const geometry = { attributes: node.attributes, indices: node.indices };
    const id = createHash('sha256').update(JSON.stringify(geometry, plainArrays)).digest('hex');
    geometries[id] = geometry;
    const rest: Record<string, unknown> = { ...node };
    delete rest.attributes;
    delete rest.indices;
    return { ...rest, geometryId: id };
  });
  return { frame: { ...frame, nodes }, geometries };
}

/** The same packet for a client already holding `known`, which learns whatever this one sends. */
export function unsentTo(packet: FlutterPacket, known: Set<string>): FlutterPacket {
  const geometries: FlutterPacket['geometries'] = {};
  for (const [id, geometry] of Object.entries(packet.geometries)) {
    if (known.has(id)) continue;
    geometries[id] = geometry;
    known.add(id);
  }
  return { frame: packet.frame, geometries };
}
