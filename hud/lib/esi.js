// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal ESI client: compatibility-date routes, Expires/ETag caching, error-limit back-off,
// and a persistent ID -> name cache.
import { dataPath, readJson, writeJson } from './store.js';
import { netFetch } from './net.js';
import { createRateLimiter } from './ratelimit.js';

const BASE = 'https://esi.evetech.net';
const NAMES_FILE = dataPath('names.json');
// The answer cache is kept small: answers that expired this long ago are dropped, and when there
// are still too many, the ones not used for the longest go (a map built from ESI alone asks for
// thousands of systems once).
const CACHE_KEEP_MS = 30 * 60_000;
const CACHE_MAX = 1500;
const CACHE_SWEEP_MS = 5 * 60_000;
const STRUCTURE_ID_MIN = 1e11; // player structures have very large IDs and are not resolvable via /universe/names

export class EsiError extends Error {
  constructor(status, path, body) {
    super(`ESI ${status} on ${path}: ${String(body).slice(0, 200)}`);
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export function createEsi(config, auth, { log = console } = {}) {
  const limiter = createRateLimiter({ reserve: config.rateLimit?.reserve ?? 0.25, log });
  const cache = new Map(); // key -> { etag, expires, data, pages, used }
  function sweepCache(now = Date.now()) {
    for (const [key, hit] of cache) if (hit.expires < now - CACHE_KEEP_MS) cache.delete(key);
    if (cache.size > CACHE_MAX) {
      const oldest = [...cache].sort((a, b) => a[1].used - b[1].used);
      for (const [key] of oldest.slice(0, cache.size - CACHE_MAX)) cache.delete(key);
    }
    return cache.size;
  }
  setInterval(sweepCache, CACHE_SWEEP_MS).unref();
  let pausedUntil = 0;
  const names = new Map(Object.entries(readJson(NAMES_FILE, {})).map(([k, v]) => [Number(k), v]));
  let namesDirty = false;

  setInterval(() => {
    if (!namesDirty) return;
    namesDirty = false;
    writeJson(NAMES_FILE, Object.fromEntries(names));
  }, 10_000).unref();

  const maxWaitMs = (config.rateLimit?.maxWaitSeconds ?? 15) * 1000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function request(
    path,
    {
      authed = false,
      query = null,
      method = 'GET',
      body = null,
      force = false,
      waitAsLongAsNeeded = false,
      shape = null, // (data) => what to keep and return instead of the raw answer (always the same for a path)
    } = {},
  ) {
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    const key = `${authed ? auth.characterId : 'pub'} ${method} ${path}${qs} ${body ? JSON.stringify(body) : ''}`;
    const hit = cache.get(key);
    if (hit) hit.used = Date.now();
    if (hit && !force && method === 'GET' && Date.now() < hit.expires) {
      return { data: hit.data, expires: hit.expires, pages: hit.pages, cached: true };
    }
    if (Date.now() < pausedUntil) {
      if (hit) return { data: hit.data, expires: pausedUntil, pages: hit.pages, cached: true };
      throw new EsiError(420, path, 'Paused after hitting the ESI error/rate limit');
    }

    // Stay under the route group's rate limit: serve the cached copy a little longer, or wait.
    const release = await limiter.gate(method, path);
    try {
      return await send();
    } finally {
      release();
    }

    async function send() {
      let wait = limiter.waitMs(method, path, authed);
      if (wait > 0) {
        if (hit)
          return {
            data: hit.data,
            expires: Date.now() + wait,
            pages: hit.pages,
            cached: true,
            throttled: true,
          };
        if (wait > maxWaitMs && !waitAsLongAsNeeded) {
          throw new EsiError(
            429,
            path,
            `Held back for ${Math.ceil(wait / 1000)}s to stay under the ESI rate limit`,
          );
        }
        while (wait > 0) {
          await sleep(wait);
          wait = limiter.waitMs(method, path, authed);
        }
      }
      limiter.spend(method, path, authed);

      const headers = {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'X-Compatibility-Date': config.compatibilityDate,
        'X-Tenant': 'tranquility',
        'User-Agent': config.userAgent,
      };
      if (authed) {
        const token = await auth.getAccessToken();
        if (!token) throw new EsiError(401, path, 'Not logged in');
        headers.Authorization = `Bearer ${token}`;
      }
      if (hit?.etag && method === 'GET') headers['If-None-Match'] = hit.etag;
      if (body) headers['Content-Type'] = 'application/json';

      const res = await netFetch(`${BASE}${path}${qs}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      limiter.observe(method, path, authed, res);

      // Legacy error limit (routes without the new rate limiting): max 100 errors per minute
      const remain = Number(res.headers.get('x-esi-error-limit-remain'));
      const reset = Number(res.headers.get('x-esi-error-limit-reset'));
      if (Number.isFinite(remain) && res.headers.has('x-esi-error-limit-remain') && remain < 15) {
        pausedUntil = Date.now() + (reset || 60) * 1000;
        log.warn?.(`[esi] Error limit low (${remain}); pausing ${reset || 60}s`);
      }
      if (res.status === 420) {
        const retry = Number(res.headers.get('retry-after')) || 60;
        pausedUntil = Date.now() + retry * 1000;
        log.warn?.(`[esi] 420 error-limited on ${path}; pausing all requests ${retry}s`);
      }
      if (res.status === 429 && hit) {
        // keep showing the last good data while the limiter holds this route back
        return {
          data: hit.data,
          expires: Date.now() + (Number(res.headers.get('retry-after')) || 60) * 1000,
          pages: hit.pages,
          cached: true,
          throttled: true,
        };
      }

      const expiresHeader = Date.parse(res.headers.get('expires') || '');
      const expires = Number.isFinite(expiresHeader)
        ? Math.max(expiresHeader, Date.now() + 5_000)
        : Date.now() + 60_000;
      const pages = Number(res.headers.get('x-pages')) || 1;

      if (res.status === 304 && hit) {
        hit.expires = expires;
        return { data: hit.data, expires, pages: hit.pages, cached: true };
      }
      const text = await res.text();
      if (!res.ok) throw new EsiError(res.status, path, text);
      const raw = text ? JSON.parse(text) : null;
      const data = shape ? shape(raw) : raw;
      if (method === 'GET') {
        cache.set(key, { etag: res.headers.get('etag'), expires, data, pages, used: Date.now() });
        if (cache.size > CACHE_MAX * 2) sweepCache();
      }
      return { data, expires, pages, cached: false };
    }
  }

  // Cursor-based pagination (https://developers.eveonline.com/docs/services/esi/pagination/cursor-based/).
  // The first request (no before/after) returns the most recent records plus a cursor; we then walk
  // backwards with `before` until an empty list (or maxPages). Records can repeat across pages: the copy
  // we already have is the newer one, so later duplicates are dropped.
  async function requestCursor(
    path,
    opts = {},
    { maxPages = 5, idOf = (r) => r?.id ?? JSON.stringify(r) } = {},
  ) {
    const listOf = (body) => {
      if (Array.isArray(body)) return body;
      for (const v of Object.values(body || {})) if (Array.isArray(v)) return v;
      return [];
    };
    const first = await request(path, opts);
    const seen = new Set();
    const older = [];
    const add = (list, into) => {
      for (const r of list) {
        const id = idOf(r);
        if (!seen.has(id)) {
          seen.add(id);
          into.push(r);
        }
      }
    };
    const newest = [];
    add(listOf(first.data), newest);
    let expires = first.expires;
    let before = first.data?.cursor?.before;
    for (let page = 1; page < maxPages && before; page++) {
      const r = await request(path, { ...opts, query: { ...(opts.query || {}), before } });
      const list = listOf(r.data);
      if (!list.length) break;
      const chunk = [];
      add(list, chunk);
      older.unshift(...chunk); // older pages go in front, keeping oldest-first order overall
      expires = Math.min(expires, r.expires);
      before = r.data?.cursor?.before;
    }
    return { data: [...older, ...newest], raw: first.data, expires };
  }

  // Fetch every page of a paginated (X-Pages) route.
  async function requestAll(path, opts = {}) {
    const first = await request(path, { ...opts, query: { ...(opts.query || {}), page: 1 } });
    let data = Array.isArray(first.data) ? [...first.data] : first.data;
    let expires = first.expires;
    for (let p = 2; p <= Math.min(first.pages, 20); p++) {
      const r = await request(path, { ...opts, query: { ...(opts.query || {}), page: p } });
      if (Array.isArray(r.data)) data = data.concat(r.data);
      expires = Math.min(expires, r.expires);
    }
    return { data, expires };
  }

  async function postNames(ids) {
    try {
      const { data } = await request('/universe/names', { method: 'POST', body: ids });
      for (const row of data) names.set(row.id, { name: row.name, category: row.category });
      namesDirty = true;
    } catch (err) {
      // One bad ID fails the whole batch: split and retry so the good IDs still resolve.
      if (err.status === 404 && ids.length > 1) {
        const mid = Math.floor(ids.length / 2);
        await postNames(ids.slice(0, mid));
        await postNames(ids.slice(mid));
      } else if (err.status === 404) {
        names.set(ids[0], { name: `Unknown #${ids[0]}`, category: 'unknown', transient: true });
      } else {
        throw err;
      }
    }
  }

  const structureMisses = new Map();
  async function resolveStructure(id) {
    if (names.has(id) && !names.get(id).transient) return;
    if (structureMisses.get(id) > Date.now()) return;
    try {
      const { data } = await request(`/universe/structures/${id}`, { authed: true });
      names.set(id, {
        name: data.name,
        category: 'structure',
        solarSystemId: data.solar_system_id,
        typeId: data.type_id,
      });
      namesDirty = true;
    } catch (err) {
      structureMisses.set(id, Date.now() + 3600_000);
      names.set(id, { name: `Structure ${id}`, category: 'structure', transient: true });
    }
  }

  async function resolveNames(ids) {
    const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
    const structures = unique.filter((id) => id >= STRUCTURE_ID_MIN);
    const missing = unique.filter(
      (id) => id < STRUCTURE_ID_MIN && (!names.has(id) || names.get(id).transient),
    );
    for (let i = 0; i < missing.length; i += 1000) await postNames(missing.slice(i, i + 1000));
    for (const id of structures) await resolveStructure(id);
    return (id) => names.get(id)?.name || `#${id}`;
  }

  function nameOf(id) {
    return names.get(id)?.name || `#${id}`;
  }

  return {
    request,
    requestAll,
    requestCursor,
    resolveNames,
    nameOf,
    rateStatus: () => limiter.status(),
    sweepCache, // (tests)
  };
}

// Average market prices for every item (one public request, cached by ESI for about an hour), kept
// once: the ESI cache holds this map instead of the raw answer, and everything that needs a price
// (asset and kill values, the chat's item window) reads the same one.
//   typeId -> [average_price, adjusted_price]  (null when ESI gives none)
const priceMap = (rows) =>
  new Map((rows || []).map((p) => [p.type_id, [p.average_price ?? null, p.adjusted_price ?? null]]));
export async function marketPrices(esi) {
  const r = await esi.request('/markets/prices', { shape: priceMap });
  return { map: r.data instanceof Map ? r.data : priceMap(r.data), expires: r.expires };
}
