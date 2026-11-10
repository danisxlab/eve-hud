// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal ZIP reader (central directory + deflate/store, ZIP64 aware) using only node:zlib.
// Enough to pull a few files out of CCP/Fenris Creations's static data export without extra dependencies.
import fs from 'node:fs';
import zlib from 'node:zlib';

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function read(fd, length, position) {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, buf, done, length - done, position + done);
    if (!n) break;
    done += n;
  }
  return buf;
}

export function listEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = read(fd, tailLen, size - tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === EOCD) {
        e = i;
        break;
      }
    if (e < 0) throw new Error('Not a zip file (no end-of-central-directory record)');
    let count = tail.readUInt16LE(e + 10);
    let cdSize = tail.readUInt32LE(e + 12);
    let cdOffset = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = e - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== ZIP64_LOCATOR) throw new Error('ZIP64 locator missing');
      const z = read(fd, 56, Number(tail.readBigUInt64LE(loc + 8)));
      count = Number(z.readBigUInt64LE(32));
      cdSize = Number(z.readBigUInt64LE(40));
      cdOffset = Number(z.readBigUInt64LE(48));
    }
    const cd = read(fd, cdSize, cdOffset);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== CENTRAL) throw new Error('Corrupt central directory');
      const method = cd.readUInt16LE(p + 10);
      let compSize = cd.readUInt32LE(p + 20);
      let size2 = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      // ZIP64 extended information extra field (0x0001): fields present only when the 32-bit value is maxed
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x);
        const len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (size2 === 0xffffffff) {
            size2 = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
          if (compSize === 0xffffffff) {
            compSize = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
          if (offset === 0xffffffff) {
            offset = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
        }
        x += 4 + len;
      }
      entries.push({ name, method, compSize, size: size2, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

export function extractEntry(file, entry) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = read(fd, 30, entry.offset);
    if (head.readUInt32LE(0) !== LOCAL) throw new Error(`Bad local header for ${entry.name}`);
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const data = read(fd, entry.compSize, start);
    if (entry.method === 0) return data;
    // at most 1 GB unpacked (the map files are far smaller): a broken archive can't fill the memory
    if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 1024 * 1024 * 1024 });
    throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
  } finally {
    fs.closeSync(fd);
  }
}
