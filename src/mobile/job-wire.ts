import { fromBase64, toBase64 } from './bytes';
import type { WorkerRequest, WorkerResponse } from '../world/messages';
import type { CountryRequest, CountryReply } from '../world/countrymessages';

/** The worker protocols stay intact inside an envelope naming their owned job and request. */
export type JobCommand = { id: number; sequence: number } & (
  | { kind: 'chunks'; type: 'message'; message: WorkerRequest }
  | { kind: 'country'; type: 'message'; message: CountryRequest }
  | { kind: 'chunks' | 'country'; type: 'close' }
);

export interface JobReply {
  id: number;
  sequence: number;
  kind: 'chunks' | 'country';
  messages: (WorkerResponse | CountryReply)[];
  took: number;
  error?: string;
}

const arrays = { Float32Array, Uint32Array, Int32Array, Uint8Array };

/**
 * The native bridge carries UTF-8 JSON, so buffers travel as bytes with their original element
 * type. Numeric JSON would lose NaNs in terrain parcels and turn indices into ordinary arrays.
 * Views send only their own bytes, even when their backing buffer holds something else too.
 */
export function encodeJob(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && (!Number.isFinite(item) || Object.is(item, -0))) {
      return { $jobNumber: String(item), negativeZero: Object.is(item, -0) };
    }
    if (item instanceof ArrayBuffer) return { $jobBuffer: 'ArrayBuffer', bytes: toBase64(new Uint8Array(item)) };
    if (ArrayBuffer.isView(item)) {
      const type = item.constructor.name;
      if (!Object.hasOwn(arrays, type)) throw new Error(`Unsupported job array: ${type}`);
      return { $jobBuffer: type, bytes: toBase64(new Uint8Array(item.buffer, item.byteOffset, item.byteLength)) };
    }
    return item;
  });
}

export function decodeJob<T>(text: string): T {
  return JSON.parse(text, (_key, item: unknown) => {
    if (item && typeof item === 'object' && '$jobNumber' in item) {
      return 'negativeZero' in item && item.negativeZero ? -0 : Number(item.$jobNumber);
    }
    if (!item || typeof item !== 'object' || !('$jobBuffer' in item)) return item;
    const { $jobBuffer: type, bytes } = item as { $jobBuffer: string; bytes: string };
    if (typeof bytes !== 'string' || bytes.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(bytes)) {
      throw new Error('Invalid job buffer');
    }
    const buffer = fromBase64(bytes).buffer as ArrayBuffer;
    if (type === 'ArrayBuffer') return buffer;
    if (!Object.hasOwn(arrays, type)) throw new Error(`Unsupported job array: ${type}`);
    return new arrays[type as keyof typeof arrays](buffer);
  }) as T;
}
