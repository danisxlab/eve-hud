// SPDX-License-Identifier: GPL-3.0-or-later
// Polls ESI for each HUD feed, honouring ESI cache expiry, and publishes changes to the browser.
//
// Only feeds that something on screen needs are polled. Every feed lists in `uses` who shows it:
//   a module id ('skills', 'map', …)   that module is visible
//   'topbar'                           the top bar (always visible while a HUD page is open)
//   'mail'                             the top bar's mail icon (Settings → Appearance can hide it)
//   'alert:skills' / 'alert:industry' / 'alert:orders'   a top-bar alert that's switched on
//   'map:hazards' / 'map:faction'      the star map with its hazard overlay / Faction colouring on
// The pages tell the server what they show (setDemand); a feed that becomes needed runs at once,
// one that is no longer needed stops polling and keeps its last data.
import { dataPath, readJson, writeJson } from './store.js';
import { marketPrices } from './esi.js';
import { dumpDebug } from './feeds/shapes.js';
import { publicFeeds } from './feeds/public-feeds.js';
import { characterFeeds } from './feeds/character-feeds.js';
import { economyFeeds } from './feeds/economy-feeds.js';

// for the tests and the server
export { FEED_ROUTES, feedHealth } from './feeds/health.js';
export { categoryOfRef, summarizeKillmail, REF_LABELS } from './feeds/summaries.js';

class ScopeError extends Error {
  constructor(scope) {
    super(`Missing scope ${scope}. Add it to "scopes" in config.json and log in again.`);
    this.scope = scope;
  }
}

export function createFeeds({
  esi,
  auth,
  universe,
  publish,
  refresh: refreshLimits = {},
  hazards: hazardCfg = {},
  notifications: notifCfg = {},
  log = console,
}) {
  const state = {};
  const statusLog = {}; // written to data/debug/feeds-status.json
  let statusTimer = null;
  const timers = {};
  let generation = 0;

  const characterId = () => auth.characterId;
  const requireScope = (scope) => {
    if (!auth.hasScope(scope)) throw new ScopeError(scope);
  };

  // Wallet journal of the last 30 days (ESI keeps 30 days), oldest first. Shared by the wallet and
  // activity feeds; the second one is served from the ESI cache. X-Pages: page 1 holds the newest
  // entries, further pages (max 5) only until 30 days are covered. De-duplicated by id, because a
  // page can shift if ESI's cache refreshes between two page requests.
  async function journal30() {
    const since = Date.now() - 30 * 86400_000;
    const j = await esi.request(`/characters/${characterId()}/wallet/journal`, {
      authed: true,
      query: { page: 1 },
    });
    let expires = j.expires;
    const byId = new Map(j.data.map((e) => [e.id, e]));
    const oldest = (list) => Math.min(...list.map((e) => Date.parse(e.date)));
    for (
      let page = 2;
      page <= Math.min(j.pages, 5) && j.data.length && oldest([...byId.values()]) > since;
      page++
    ) {
      const more = await esi.request(`/characters/${characterId()}/wallet/journal`, {
        authed: true,
        query: { page },
      });
      expires = Math.min(expires, more.expires);
      for (const e of more.data) if (!byId.has(e.id)) byId.set(e.id, e);
    }
    return { rows: [...byId.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)), expires };
  }

  // Average market prices for every item (one public request, cached by ESI for about an hour).
  // Estimates only: CCP/Fenris Creations's average over recent trades, as the game's "estimated price".
  // get(typeId): the average price (the adjusted one when there's no average), from the one price
  // map the ESI client keeps (esi.js marketPrices)
  async function prices() {
    const { map } = await marketPrices(esi);
    return {
      get(typeId) {
        const p = map.get(typeId);
        return p ? (p[0] ?? p[1] ?? 0) : undefined;
      },
    };
  }

  // typeId -> categoryId (6 = ship), via /universe/types + /universe/groups, cached for good in
  // data/typecats.json (item categories don't change).
  const TYPECATS_FILE = dataPath('typecats.json');
  const typeCats = new Map(Object.entries(readJson(TYPECATS_FILE, {})).map(([k, v]) => [Number(k), v]));
  const groupCats = new Map();
  async function categoryOf(typeIds) {
    let dirty = false;
    for (const id of [...new Set(typeIds)].filter((t) => !typeCats.has(t)).slice(0, 80)) {
      try {
        const t = (await esi.request(`/universe/types/${id}`)).data;
        if (!groupCats.has(t.group_id))
          groupCats.set(t.group_id, (await esi.request(`/universe/groups/${t.group_id}`)).data.category_id);
        typeCats.set(id, groupCats.get(t.group_id));
        dirty = true;
      } catch {
        /* try again next time */
      }
    }
    if (dirty) writeJson(TYPECATS_FILE, Object.fromEntries(typeCats));
    return (id) => typeCats.get(id) ?? null;
  }

  // every feed, by name (feeds/*.js)
  const ctx = {
    esi,
    auth,
    universe,
    characterId,
    requireScope,
    journal30,
    prices,
    categoryOf,
    hazardCfg,
    notifCfg,
    log,
    state,
  };
  const defs = { ...publicFeeds(ctx), ...characterFeeds(ctx), ...economyFeeds(ctx) };

  // Refresh bounds in seconds, from config.json "refresh" (falls back to the built-in defaults).
  // A feed refreshes when ESI's cache expires, but never sooner than min or later than max.
  function limitsFor(name) {
    const def = defs[name];
    const user = refreshLimits?.[name] || {};
    const min = Math.max(1, Number(user.min) || def.min);
    const max = Math.max(min, Number(user.max) || def.max);
    return { min, max, enabled: user.enabled !== false };
  }

  function schedule(name, gen, delayMs) {
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => runFeed(name, gen), delayMs);
  }

  // ---------- who needs which feed ----------
  // Until a HUD page says what it shows, only the top bar's feeds run.
  let demand = new Set(['topbar', 'mail']);
  const running = new Set();
  const isActive = (name) => (defs[name].uses || []).some((u) => demand.has(u));
  const canRun = (name) => (defs[name].authed === false || auth.characterId) && limitsFor(name).enabled;

  // consumers: everything the open HUD pages show (see the list at the top of this file).
  function setDemand(consumers) {
    const next = new Set(consumers);
    const before = new Set(Object.keys(defs).filter(isActive));
    demand = next;
    const started = [];
    const stopped = [];
    for (const name of Object.keys(defs)) {
      const on = isActive(name);
      if (on && !before.has(name)) {
        started.push(name);
        if (!running.has(name) && canRun(name)) schedule(name, generation, 0); // showing a module fetches at once
      } else if (!on && before.has(name)) {
        stopped.push(name);
        clearTimeout(timers[name]);
      }
      if (statusLog[name]) statusLog[name].active = on;
    }
    if (started.length || stopped.length)
      log.info?.(
        `[feeds] ${started.length ? `started ${started.join(', ')}` : ''}${started.length && stopped.length ? '; ' : ''}${stopped.length ? `paused ${stopped.join(', ')}` : ''}`,
      );
  }

  async function runFeed(name, gen = generation) {
    if (gen !== generation) return;
    const def = defs[name];
    if (def.authed !== false && !auth.characterId) return;
    const { min, max, enabled } = limitsFor(name);
    if (!enabled) return;
    if (!isActive(name)) return; // nothing shows it: stay paused until something does
    if (running.has(name)) return;
    running.add(name);
    try {
      await runFeedNow(name, gen, def, min, max);
    } finally {
      running.delete(name);
    }
  }

  async function runFeedNow(name, gen, def, min, max) {
    const prev = state[name];
    let next;
    let delay;
    try {
      const { data, expires } = await def.run();
      next = { data, error: null, updatedAt: Date.now() };
      delay = Math.min(Math.max((expires || 0) - Date.now() + 1000, min * 1000), max * 1000);
    } catch (err) {
      const scope = err instanceof ScopeError ? err.scope : null;
      next = {
        data: prev?.data ?? null,
        error: { message: err.message, status: err.status ?? null, scope },
        updatedAt: prev?.updatedAt ?? null,
      };
      delay = scope ? 600_000 : err.status === 401 || err.status === 403 ? 300_000 : 60_000;
      if (!scope) log.warn?.(`[feed:${name}] ${err.message}`);
    }
    // Restarted meanwhile (login, logout): this answer may belong to the old character, so it's
    // dropped. But the restart's own run of this feed found it still busy and skipped, so run it
    // again now; otherwise it would never update again (the top bar's "Tranquility checking…").
    if (gen !== generation) {
      if (isActive(name) && canRun(name)) schedule(name, generation, 0);
      return;
    }
    next.nextAt = Date.now() + delay;
    state[name] = next;
    statusLog[name] = {
      active: isActive(name),
      updatedAt: next.updatedAt && new Date(next.updatedAt).toISOString(),
      nextAt: new Date(next.nextAt).toISOString(),
      error: next.error?.message || null,
    };
    // overwritten (never appended), and at most every 30 s: the location feed alone runs every 5 s
    if (!statusTimer)
      statusTimer = setTimeout(() => {
        statusTimer = null;
        dumpDebug('feeds-status', statusLog);
      }, 30_000);
    publish(name, next);
    if (isActive(name)) schedule(name, gen, delay); // hidden meanwhile? then it stays paused
  }

  function start() {
    generation++;
    for (const t of Object.values(timers)) clearTimeout(t);
    let i = 0;
    for (const name of Object.keys(defs)) {
      if (defs[name].authed !== false && !auth.characterId) {
        delete state[name];
        continue;
      }
      if (isActive(name)) schedule(name, generation, 150 * i++); // stagger startup requests
    }
  }

  // "Refresh now" and the chat log's jump hint: only feeds something shows.
  function refresh(name) {
    if (name && Object.hasOwn(defs, name)) return runFeed(name); // only real feed names
    return Promise.all(Object.keys(defs).map((n) => runFeed(n)));
  }

  // Stops all polling (tests; the server itself just exits).
  function stop() {
    generation++;
    for (const t of Object.values(timers)) clearTimeout(t);
  }

  return {
    start,
    stop,
    refresh,
    setDemand,
    activeFeeds: () => Object.keys(defs).filter(isActive),
    feedUses: () => Object.fromEntries(Object.entries(defs).map(([n, d]) => [n, d.uses || []])),
    snapshot: () => ({ ...state }),
  };
}
