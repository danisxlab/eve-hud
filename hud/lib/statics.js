// SPDX-License-Identifier: GPL-3.0-or-later
// Item data from CCP/Fenris Creations's static data (SDE), for the item window, the assets module,
// the home station and the faction names. ESI dropped its static-data routes (/universe/types,
// groups, categories, stations, factions, systems, constellations) at compatibility date
// 2026-11-19, so these come from the same download as the star map (universe.js), kept in data/:
//   items.jsonl   one line per item type, sorted by type ID: name, group, volume (packaged when it
//                 has one), mass, tech and meta level, market group, published, English description
//   statics.json  item groups and categories, factions, NPC stations (system, number of services),
//                 and where each line of items.jsonl starts
// items.jsonl is never read whole: a lookup reads just its own line from disk. statics.json is
// small, read on first use.
import fs from 'node:fs';
import { dataPath, readJson, writeJson } from './store.js';

const ITEMS_FILE = dataPath('items.jsonl');
const STATICS_FILE = dataPath('statics.json');
const FORMAT = 1;

const en = (v) => (v && typeof v === 'object' ? (v.en ?? Object.values(v)[0]) : v) || '';

// Line-by-line JSONL over a Buffer, without turning the whole (large) file into one string.
function eachJsonl(buf, fn) {
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(10, start);
    if (end < 0) end = buf.length;
    const line = buf.toString('utf8', start, end).trim();
    if (line) fn(JSON.parse(line));
    start = end + 1;
  }
}

// From the SDE files (Buffers of types.jsonl, groups.jsonl, …) to { items: Buffer, statics }.
// stations and operations are optional: without them there are just no station details.
export function buildStatics({
  typesBuf,
  groupsBuf,
  categoriesBuf,
  factionsBuf,
  stationsBuf,
  operationsBuf,
}) {
  const groups = {};
  eachJsonl(groupsBuf, (g) => {
    groups[g._key] = [en(g.name), g.categoryID ?? null];
  });
  const categories = {};
  if (categoriesBuf) eachJsonl(categoriesBuf, (c) => (categories[c._key] = en(c.name)));
  const factions = {};
  if (factionsBuf) eachJsonl(factionsBuf, (f) => (factions[f._key] = en(f.name)));
  const services = new Map(); // operationID -> number of services
  if (operationsBuf) eachJsonl(operationsBuf, (o) => services.set(o._key, o.services?.length ?? null));
  const stations = {};
  if (stationsBuf)
    eachJsonl(stationsBuf, (s) => {
      stations[s._key] = [s.solarSystemID, services.get(s.operationID) ?? null];
    });

  const rows = [];
  eachJsonl(typesBuf, (t) => {
    const row = { id: t._key, name: en(t.name).trim(), group: t.groupID };
    const volume = t.packagedVolume ?? t.volume;
    if (volume != null) row.vol = volume;
    if (t.mass) row.mass = t.mass;
    if (t.published) row.pub = 1;
    if (t.marketGroupID) row.mkt = t.marketGroupID;
    if (t.techLevel != null) row.tech = t.techLevel;
    if (t.metaLevel != null) row.meta = t.metaLevel;
    const desc = en(t.description);
    if (desc) row.desc = desc;
    rows.push(row);
  });
  if (rows.length < 1000)
    throw new Error(`Only ${rows.length} item types found; the SDE format may have changed`);
  rows.sort((a, b) => a.id - b.id);

  // items.jsonl, and per line [type ID, byte offset, group ID] (12 bytes) for statics.json
  const chunks = [];
  const index = Buffer.alloc(rows.length * 12);
  let offset = 0;
  rows.forEach((row, i) => {
    const line = Buffer.from(`${JSON.stringify(row)}\n`);
    chunks.push(line);
    index.writeUInt32LE(row.id, i * 12);
    index.writeUInt32LE(offset, i * 12 + 4);
    index.writeUInt32LE(row.group >>> 0, i * 12 + 8);
    offset += line.length;
  });
  const items = Buffer.concat(chunks);
  return {
    items,
    statics: {
      format: FORMAT,
      itemsSize: items.length,
      count: rows.length,
      index: index.toString('base64'),
      groups,
      categories,
      factions,
      stations,
    },
  };
}

// Writes the two files: items.jsonl first, statics.json (which points into it) last.
export function saveStatics(built, { build = null, builtAt = null } = {}) {
  const tmp = `${ITEMS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, built.items, { mode: 0o600 });
  fs.renameSync(tmp, ITEMS_FILE);
  writeJson(STATICS_FILE, { ...built.statics, build, builtAt });
}

export function createStatics({ log = console } = {}) {
  let data; // undefined: not read yet; null: missing or unusable
  let ids = null; // Uint32Array: [id, offset, group] per item type, sorted by id

  function load() {
    if (data !== undefined) return data;
    data = null;
    ids = null;
    const s = readJson(STATICS_FILE, null);
    if (!s || s.format !== FORMAT || !s.index) return data;
    let size = -1;
    try {
      size = fs.statSync(ITEMS_FILE).size;
    } catch {
      /* missing */
    }
    const raw = Buffer.from(s.index, 'base64');
    if (size !== s.itemsSize || raw.length !== s.count * 12) return data; // half-written: rebuild
    ids = new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    delete s.index;
    data = s;
    return data;
  }

  // position of a type ID in the index, or -1
  function find(id) {
    if (!load() || !Number.isInteger(id) || id < 0) return -1;
    let lo = 0;
    let hi = data.count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = ids[mid * 3];
      if (v === id) return mid;
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  function type(id) {
    const i = find(id);
    if (i < 0) return null;
    const start = ids[i * 3 + 1];
    const end = i + 1 < data.count ? ids[(i + 1) * 3 + 1] : data.itemsSize;
    const buf = Buffer.alloc(end - start);
    let fd;
    try {
      fd = fs.openSync(ITEMS_FILE, 'r');
      fs.readSync(fd, buf, 0, buf.length, start);
      const r = JSON.parse(buf.toString('utf8'));
      return {
        id: r.id,
        name: r.name,
        groupId: r.group,
        volume: r.vol ?? null,
        mass: r.mass ?? null,
        published: Boolean(r.pub),
        marketGroupId: r.mkt ?? null,
        techLevel: r.tech ?? null,
        metaLevel: r.meta ?? null,
        description: r.desc || '',
      };
    } catch (err) {
      log.warn?.(`[statics] item ${id}: ${err.message}`);
      return null;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  function group(id) {
    const g = load()?.groups[id];
    return g ? { id, name: g[0], categoryId: g[1] } : null;
  }

  return {
    ready: () => Boolean(load()),
    reload() {
      data = undefined; // read again on next use (after a new download)
      ids = null;
    },
    type,
    group,
    category: (id) => load()?.categories[id] ?? null,
    // type ID -> category ID (6 = ship), without reading items.jsonl
    categoryOfType(id) {
      const i = find(id);
      return i < 0 ? null : (group(ids[i * 3 + 2])?.categoryId ?? null);
    },
    factionNames: () => ({ ...(load()?.factions || {}) }),
    station(id) {
      const s = load()?.stations[id];
      return s ? { id, systemId: s[0], services: s[1] } : null;
    },
  };
}
