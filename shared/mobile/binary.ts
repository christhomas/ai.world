/** Canonical scalar parcel: little endian, no typed-array alignment or native-endian assumptions. */
const MAGIC = 0x4149574d;
export function encodeScalars(values: readonly number[]): ArrayBuffer {
  if (values.length > 1048576 || values.some(v => !Number.isFinite(v))) throw new Error('invalid');
  const bytes = new ArrayBuffer(16 + values.length * 8);
  const view = new DataView(bytes);
  view.setUint32(0, MAGIC, true); view.setUint16(4, 1, true);
  view.setUint16(6, 8, true); view.setUint32(8, values.length, true); view.setUint32(12, 0, true);
  values.forEach((v, i) => view.setFloat64(16 + i * 8, v, true));
  return bytes;
}
export function decodeScalars(bytes: ArrayBuffer): number[] {
  if (bytes.byteLength < 16) throw new Error('invalid');
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== MAGIC || view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 8 || view.getUint32(12, true) !== 0) throw new Error('invalid');
  const count = view.getUint32(8, true);
  if (count > 1048576 || bytes.byteLength !== 16 + count * 8) throw new Error('invalid');
  return Array.from({ length: count }, (_, i) => {
    const n = view.getFloat64(16 + i * 8, true); if (!Number.isFinite(n)) throw new Error('invalid'); return n;
  });
}
