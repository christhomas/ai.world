import { deflateSync } from 'node:zlib';

/**
 * Writing a PNG, in about as little as it can be done.
 *
 * The art tools deliberately do not open a browser. Faces are drawn by a pure function that takes
 * a "put a rectangle here" callback, so the only thing standing between that and a picture on the
 * terminal is a file format — and PNG's simplest form is a zlib stream of rows, each with a zero
 * byte in front of it saying "no filter". Node has zlib, so that is the whole job.
 *
 * Keeping it here rather than taking a dependency means `chore art` runs in a fraction of a
 * second with nothing installed, which is what makes it worth reaching for while you work.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @param rgba four bytes per pixel, row by row from the top */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1);
    raw[at] = 0;                                  // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, at + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;                                  // bits per channel
  header[9] = 6;                                  // colour type: RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(kind: string, body: Buffer): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(kind, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
