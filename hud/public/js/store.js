// SPDX-License-Identifier: GPL-3.0-or-later
// Client state: live feeds from the server (SSE) + persisted settings.

const listeners = new Map();

// Identifies this page to the server, which polls only the feeds that open pages show.
export const CLIENT_ID = (
  crypto.randomUUID?.() || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
).replace(/[^\w-]/g, '');

export const store = {
  feeds: {},
  auth: null,
  universe: null,
  chat: { status: null, channels: {} },
  combat: { active: false },
  autopilot: { on: false, next: null },
  config: {},
  settings: null,
  connected: false,

  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  },
  emit(event, payload) {
    for (const fn of listeners.get(event) || []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[store] ${event} listener`, err);
      }
    }
  },
  feed(name) {
    return this.feeds[name] || null;
  },
};

export const DEFAULT_SETTINGS = {
  version: 3,
  grid: { cols: 4, rows: 4, gap: 8 },
  appearance: {
    opacity: 0.72,
    blur: 0,
    scanlines: true,
    boot: true,
    updateBlink: true,
    chatBlink: true,
    showMail: true,
    motion: 'on',
    backdrop: 'stars',
    plexus: true,
    plexusMotion: false,
    trainingLight: false,
    redFlash: true, // Settings → Appearance: the red flash when a fight starts
  },
  locked: false,
  modules: {
    character: { c: 0, r: 0, w: 2, h: 1, visible: true },
    skills: { c: 2, r: 0, w: 2, h: 1, visible: true },
    map: { c: 0, r: 1, w: 3, h: 2, visible: true },
    chat: { c: 3, r: 1, w: 1, h: 3, visible: true },
    industry: { c: 0, r: 3, w: 1, h: 1, visible: true },
    market: { c: 1, r: 3, w: 1, h: 1, visible: true },
    warfare: { c: 2, r: 3, w: 1, h: 1, visible: true }, // took the place of the retired Objectives module
    // optional modules: hidden by default (the 4×4 grid is full); showing one puts it in the first free spot
    activity: { c: 0, r: 0, w: 1, h: 1, visible: false },
    mining: { c: 0, r: 0, w: 1, h: 1, visible: false },
    assets: { c: 0, r: 0, w: 1, h: 1, visible: false },
    standings: { c: 0, r: 0, w: 1, h: 1, visible: false },
    kills: { c: 0, r: 0, w: 1, h: 1, visible: false },
  },
  // top-bar alerts (each one keeps its feed running even while its module is hidden)
  alerts: { skills: true, industry: true, orders: true },
  map: { colorBy: 'security', lanes: true, labels: true, layout: 'schematic', view: null },
  chat: { tab: 'local' },
};

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export function initSettings(saved) {
  store.settings = merge(DEFAULT_SETTINGS, migrate(saved));
  return store.settings;
}

// Version 1 -> 2: the Objectives module is gone (its alerts moved to the top bar, your freelance
// jobs and campaign objectives to Warfare → Campaigns). Warfare takes its place when it was hidden.
// Version 2 -> 3: "Animate background" is off by default (it costs a game on the other screen many
// frames a second), also for settings saved before; switch it on again in Settings → Appearance.
function migrate(saved) {
  if (!saved || typeof saved !== 'object' || (saved.version || 1) >= 3) return saved;
  const out = structuredClone(saved);
  if ((out.version || 1) < 2) {
    const mods = out.modules || {};
    const old = mods.objectives;
    if (old?.visible && !mods.warfare?.visible) mods.warfare = { ...old, visible: true };
    delete mods.objectives;
  }
  if (out.appearance) out.appearance.plexusMotion = false;
  out.version = 3;
  return out;
}

let saveTimer = null;
export function saveSettings() {
  store.emit('settings'); // e.g. a module shown or hidden: tell the server what this page shows now
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store.settings),
    }).catch((err) => console.warn('settings save failed', err));
  }, 400);
}

export function resetLayout() {
  store.settings.modules = structuredClone(DEFAULT_SETTINGS.modules);
  store.settings.grid = structuredClone(DEFAULT_SETTINGS.grid);
  saveSettings();
}

export function connect() {
  const es = new EventSource(`/api/stream?client=${CLIENT_ID}`);
  es.addEventListener('snapshot', (e) => {
    const s = JSON.parse(e.data);
    store.auth = s.auth;
    store.feeds = s.feeds || {};
    store.universe = s.universe;
    store.chat = s.chat || { status: null, channels: {} };
    store.combat = s.combat || { active: false };
    store.autopilot = s.autopilot || { on: false, next: null };
    store.logs = s.logs || null;
    store.config = s.config || {};
    if (!store.settings) initSettings(s.settings);
    store.connected = true;
    store.emit('snapshot', s);
    store.emit('connection', true);
    for (const name of Object.keys(store.feeds)) store.emit(`feed:${name}`, store.feeds[name]);
  });
  es.addEventListener('feed', (e) => {
    const { name, ...payload } = JSON.parse(e.data);
    store.feeds[name] = payload;
    store.emit(`feed:${name}`, payload);
  });
  es.addEventListener('auth', (e) => {
    store.auth = JSON.parse(e.data);
    store.emit('auth', store.auth);
  });
  es.addEventListener('universe', (e) => {
    store.universe = JSON.parse(e.data);
    store.emit('universe', store.universe);
  });
  es.addEventListener('chat', (e) => {
    const { channel, messages, initial } = JSON.parse(e.data);
    const ch = (store.chat.channels[channel] = initial ? [] : store.chat.channels[channel] || []);
    ch.push(...messages);
    if (ch.length > 300) ch.splice(0, ch.length - 300);
    store.emit('chat', { channel, messages, initial });
  });
  // in combat or not (server: lib/gamelogs.js)
  // can the game logs be read? (the "EVE logs" window in app.js)
  es.addEventListener('logs', (e) => {
    store.logs = JSON.parse(e.data);
    store.emit('logs', store.logs);
  });
  // the in-game autopilot: on or off, and the next system (server: lib/gamelogs.js)
  es.addEventListener('autopilot', (e) => {
    store.autopilot = JSON.parse(e.data);
    store.emit('autopilot', store.autopilot);
  });
  es.addEventListener('combat', (e) => {
    store.combat = JSON.parse(e.data);
    store.emit('combat', store.combat);
  });
  es.addEventListener('chatStatus', (e) => {
    store.chat.status = JSON.parse(e.data);
    store.emit('chatStatus', store.chat.status);
  });
  es.addEventListener('localSystem', (e) => store.emit('localSystem', JSON.parse(e.data)));
  es.onerror = () => {
    if (store.connected) {
      store.connected = false;
      store.emit('connection', false);
    }
  };
  return es;
}
