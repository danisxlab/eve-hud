// SPDX-License-Identifier: GPL-3.0-or-later
// Star map data from CCP/Fenris Creations's official Static Data Export (SDE), cached in data/universe.json.
//   https://developers.eveonline.com/static-data
// The JSON Lines archive is downloaded once, the three map files are extracted
// (mapSolarSystems, mapRegions, mapStargates), and the zip is deleted again.
// On later starts only the tiny latest.jsonl is fetched to see whether CCP/Fenris Creations published a new build.
// Fallback when the SDE can't be downloaded: crawl ESI (slower, and without jump lanes).
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dataPath, readJson, writeJson } from './store.js';
import { listEntries, extractEntry } from './zip.js';
import { netFetch } from './net.js';
import { isKSpace, compactPayload, linkSystems } from './universe-data.js';

const FILE = dataPath('universe.json');
// Item names for recognising items in chat (EVE's chat logs keep only the plain text of links).
const NAMES_FILE = dataPath('typenames.json');
// Categories that aren't things you'd link in chat: system, owners, celestials, stations, NPC entities.
const SKIP_CATEGORIES = new Set([0, 1, 2, 3, 11]);
// Build-pinned archive (so the cached build number always matches the data), with the
// redirecting "latest" link as a fallback when the build number can't be read.
const SDE_BUILD_ZIP = (build) =>
  `https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-${build}-jsonl.zip`;
const SDE_LATEST_ZIP = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';
const SDE_LATEST = 'https://developers.eveonline.com/static-data/tranquility/latest.jsonl';

// Bump when the cached structure changes, so an older data/universe.json is rebuilt once.
// 2: adds position2D, the schematic layout the in-game 2D map uses.
// 3: adds data/typenames.json (item names from types.jsonl), built from the same download.
const CACHE_FORMAT = 3;

function parseJsonl(buf) {
  const out = [];
  for (const line of buf.toString('utf8').split('\n')) {
    const t = line.trim();
    if (t) out.push(JSON.parse(t));
  }
  return out;
}

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

// Published item names, longest first is done in the browser; here just [typeID, English name].
export function itemNames({ typesBuf, groupsBuf }) {
  const groupCategory = new Map();
  eachJsonl(groupsBuf, (g) => {
    if (g.published) groupCategory.set(g._key, g.categoryID);
  });
  const names = [];
  eachJsonl(typesBuf, (t) => {
    if (!t.published) return;
    const cat = groupCategory.get(t.groupID);
    if (cat === undefined || SKIP_CATEGORIES.has(cat)) return;
    const name = en(t.name).trim();
    if (name.length >= 3) names.push([t._key, name]);
  });
  return names;
}

const en = (name) => (name && typeof name === 'object' ? (name.en ?? Object.values(name)[0]) : name) || '';

async function latestBuild(userAgent) {
  const res = await netFetch(SDE_LATEST, { headers: { 'User-Agent': userAgent } });
  if (!res.ok) throw new Error(`latest.jsonl -> HTTP ${res.status}`);
  const rows = parseJsonl(Buffer.from(await res.arrayBuffer()));
  const sde = rows.find((r) => r._key === 'sde') || rows[0];
  return sde?.buildNumber ?? null;
}

async function download(url, file, userAgent, progress) {
  const res = await netFetch(url, { headers: { 'User-Agent': userAgent }, timeoutMs: 30 * 60_000 });
  if (!res.ok || !res.body) throw new Error(`${url} -> HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  let lastPct = -1;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 100) : -1;
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      progress(`Downloading CCP/Fenris Creations static data: ${pct}% of ${(total / 1048576).toFixed(0)} MB`);
    }
  });
  await pipeline(body, fs.createWriteStream(file));
}

// Turns the three SDE map files into the compact structure the HUD caches.
export function fromSde({ systemsRows, regionsRows, stargatesRows, build }) {
  const regions = regionsRows.map((r) => ({ id: r._key, name: en(r.name) }));
  const systems = systemsRows.map((s) => ({
    id: s._key,
    name: en(s.name),
    regionId: s.regionID,
    constellationId: s.constellationID,
    x: s.position.x,
    y: s.position.y,
    z: s.position.z,
    // Schematic 2D position used by the in-game 2D map (x = east, y = north). Optional in the SDE.
    ...(s.position2D && Number.isFinite(s.position2D.x) ? { x2: s.position2D.x, y2: s.position2D.y } : {}),
    sec: s.securityStatus,
  }));
  const seen = new Set();
  const jumps = [];
  for (const g of stargatesRows) {
    const a = g.solarSystemID;
    const b = g.destination?.solarSystemID;
    if (!a || !b) continue;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(k)) continue;
    seen.add(k);
    jumps.push(a < b ? [a, b] : [b, a]);
  }
  if (systems.length < 1000)
    throw new Error(`Only ${systems.length} systems found; the SDE format may have changed`);
  return { source: 'ccp-sde', format: CACHE_FORMAT, build, regions, systems, jumps };
}

async function buildFromSde(userAgent, progress) {
  progress('Checking the latest CCP/Fenris Creations static data build');
  let build = null;
  try {
    build = await latestBuild(userAgent);
  } catch {
    /* not fatal */
  }
  const zip = dataPath('sde-download.zip');
  try {
    if (build) {
      try {
        await download(SDE_BUILD_ZIP(build), zip, userAgent, progress);
      } catch {
        await download(SDE_LATEST_ZIP, zip, userAgent, progress);
      }
    } else {
      await download(SDE_LATEST_ZIP, zip, userAgent, progress);
    }
    progress('Extracting the star map from the static data');
    const entries = listEntries(zip);
    const get = (base) => {
      const e = entries.find((x) => x.name === base || x.name.endsWith(`/${base}`));
      if (!e) throw new Error(`${base} not found in the SDE archive`);
      return parseJsonl(extractEntry(zip, e));
    };
    const map = fromSde({
      systemsRows: get('mapSolarSystems.jsonl'),
      regionsRows: get('mapRegions.jsonl'),
      stargatesRows: get('mapStargates.jsonl'),
      build,
    });
    progress('Extracting item names from the static data');
    const raw = (base) => {
      const e = entries.find((x) => x.name === base || x.name.endsWith(`/${base}`));
      if (!e) throw new Error(`${base} not found in the SDE archive`);
      return extractEntry(zip, e);
    };
    let names = null;
    try {
      names = itemNames({ typesBuf: raw('types.jsonl'), groupsBuf: raw('groups.jsonl') });
    } catch (err) {
      progress(`Item names unavailable (${err.message}); chat items won't be highlighted`);
    }
    return { ...map, names };
  } finally {
    fs.rmSync(zip, { force: true });
  }
}

async function buildFromEsi(esi, progress) {
  const { data: ids } = await esi.request('/universe/systems');
  const systems = [];
  const constellationIds = new Set();
  let done = 0;
  const queue = [...ids];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try {
        const { data: s } = await esi.request(`/universe/systems/${id}`, { waitAsLongAsNeeded: true });
        systems.push({
          id,
          name: s.name,
          constellationId: s.constellation_id,
          x: s.position.x,
          y: s.position.y,
          z: s.position.z,
          sec: s.security_status,
        });
        constellationIds.add(s.constellation_id);
      } catch {
        /* skip */
      }
      if (++done % 200 === 0) progress(`Building star map from ESI: ${done}/${ids.length} systems`);
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));
  const constToRegion = new Map();
  const cq = [...constellationIds];
  async function cworker() {
    while (cq.length) {
      const id = cq.shift();
      try {
        const { data: c } = await esi.request(`/universe/constellations/${id}`, { waitAsLongAsNeeded: true });
        constToRegion.set(id, c.region_id);
      } catch {
        /* skip */
      }
    }
  }
  progress('Building star map from ESI: constellations');
  await Promise.all(Array.from({ length: 16 }, cworker));
  for (const s of systems) s.regionId = constToRegion.get(s.constellationId) || 0;
  const regionIds = [...new Set(systems.map((s) => s.regionId).filter(Boolean))];
  const nameOf = await esi.resolveNames(regionIds);
  return { source: 'esi', regions: regionIds.map((id) => ({ id, name: nameOf(id) })), systems, jumps: [] };
}

export function createUniverse({ esi, userAgent, log = console, onProgress = () => {} }) {
  let data = null;
  let byId = new Map();
  let state = { ready: false, message: 'Star map not loaded' };
  let compact = null;
  let itemNameData = null;

  function setState(s) {
    state = s;
    onProgress(s);
  }

  function index(d) {
    data = d;
    byId = new Map(d.systems.map((s) => [s.id, s]));
    const regionName = new Map(d.regions.map((r) => [r.id, r.name]));
    for (const s of d.systems) s.regionName = regionName.get(s.regionId) || '';
    compact = null;
    setState({
      ready: true,
      message: `Star map: ${d.systems.length} systems`,
      source: d.source,
      build: d.build ?? null,
      builtAt: d.builtAt ?? null,
    });
  }

  async function build() {
    const progress = (message) => {
      setState({ ready: false, message });
      log.info?.(`[map] ${message}`);
    };
    let built;
    try {
      built = await buildFromSde(userAgent, progress);
    } catch (err) {
      log.warn?.(
        `[map] CCP/Fenris Creations static data download failed (${err.message}); falling back to ESI (takes a few minutes, no jump lanes)`,
      );
      try {
        built = await buildFromEsi(esi, progress);
      } catch (err2) {
        setState({ ready: false, message: `Star map unavailable: ${err2.message}`, error: true });
        return false;
      }
    }
    built.builtAt = new Date().toISOString();
    const { names, ...mapData } = built;
    if (built.source === 'ccp-sde') {
      // written even when empty, so a missing types.jsonl doesn't trigger a rebuild on every start
      writeJson(NAMES_FILE, { build: built.build ?? null, builtAt: built.builtAt, names: names || [] });
      itemNameData = null;
      log.info?.(`[map] ${names?.length || 0} item names saved for chat links`);
    }
    built = mapData;
    writeJson(FILE, built);
    index(built);
    log.info?.(
      `[map] Star map ready: ${built.systems.length} systems, ${built.jumps.length} jump lanes (${built.source}${built.build ? ` build ${built.build}` : ''})`,
    );
    return true;
  }

  // Use the cache; then, in the background, rebuild if CCP/Fenris Creations has published a newer SDE build.
  async function checkForUpdate() {
    try {
      const latest = await latestBuild(userAgent);
      if (latest && data?.build && String(latest) !== String(data.build)) {
        log.info?.(`[map] New static data build ${latest} (have ${data.build}); updating the star map`);
        const keep = data;
        if (!(await build())) index(keep);
      } else if (
        data?.source === 'ccp-sde' &&
        ((data.format ?? 1) < CACHE_FORMAT || !fs.existsSync(NAMES_FILE))
      ) {
        log.info?.(
          '[map] Updating the cached static data: in-game 2D map layout and item names for chat (one download)',
        );
        const keep = data;
        if (!(await build())) index(keep);
      } else if (latest && data && data.source !== 'ccp-sde') {
        log.info?.('[map] Replacing the fallback star map with CCP/Fenris Creations static data');
        const keep = data;
        if (!(await build())) index(keep);
      }
    } catch {
      /* offline: keep the cache */
    }
  }

  async function ensure({ rebuild = false } = {}) {
    if (!rebuild && fs.existsSync(FILE)) {
      const d = readJson(FILE, null);
      if (d?.systems?.length) {
        index(d);
        checkForUpdate();
        return;
      }
    }
    await build();
  }

  // Compact payload for the browser (universe-data.js)
  function payload() {
    if (!data) return null;
    return (compact ||= compactPayload(data));
  }

  // Names the chat module recognises: items (from the SDE) and k-space systems.
  function linkNames() {
    if (!itemNameData) {
      const n = readJson(NAMES_FILE, null);
      itemNameData = n?.names?.length ? n : { names: [], build: null, builtAt: null };
    }
    const systems = linkSystems(data);
    return {
      version: `${itemNameData.builtAt || 'none'}|${data?.builtAt || 'none'}`,
      items: itemNameData.names,
      systems,
    };
  }

  return {
    ensure,
    payload,
    linkNames,
    get state() {
      return state;
    },
    system: (id) => byId.get(id) || null,
    findByName: (name) =>
      data?.systems.find((s) => s.name.toLowerCase() === String(name).toLowerCase()) || null,
    isKSpace,
    allSystems: () => data?.systems || [],
    jumps: () => data?.jumps || [], // [[systemId, systemId], …] stargate connections (for local routes)
    loadExternal: index, // used by demo mode
  };
}
