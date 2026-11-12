// SPDX-License-Identifier: GPL-3.0-or-later
// The demo website (GitHub Pages): the HUD page in demo mode, without a server.
// This file stands in for hud/server.js inside the browser. It answers the page's /api/… requests
// and its live connection (/api/stream) from the same sample data as `npm run demo`
// (hud/lib/demo.js), with an invented star map. Nothing is sent anywhere; layout and settings
// are kept in this browser only.
// demo/index.html loads it before the HUD's own scripts; scripts/build-site.js makes that page
// from hud/public/index.html.
import { createDemo, demoUniverse, demoShowInfo, DEMO_ITEM_NAMES } from '../hud/lib/demo.js';
import { createRouter } from '../hud/lib/route.js';
import { createLinker } from '../hud/lib/itemlinks.js';
import { compactPayload, isKSpace, linkSystems } from '../hud/lib/universe-data.js';

const SETTINGS_KEY = 'eve-hud-demo-settings';
const HUD_ROOT = new URL('../hud/public/', import.meta.url); // the HUD page's own files
const CHAT_CHANNELS = [
  { id: 'local', label: 'Local', filePrefix: 'Local' },
  { id: 'corp', label: 'Corp', filePrefix: 'Corp' },
  { id: 'militia', label: 'Militia', filePrefix: 'Militia', fw: true },
];

// ---------------- the star map (like lib/universe.js, from the invented demo map) ----------------
function demoMap(data) {
  const regionName = new Map(data.regions.map((r) => [r.id, r.name]));
  for (const s of data.systems) s.regionName = regionName.get(s.regionId) || '';
  const byId = new Map(data.systems.map((s) => [s.id, s]));
  let compact = null;
  return {
    state: {
      ready: true,
      message: `Star map: ${data.systems.length} systems`,
      source: data.source,
      build: null,
      builtAt: null,
    },
    payload: () => (compact ||= compactPayload(data)),
    linkNames: () => ({ version: 'demo', items: DEMO_ITEM_NAMES, systems: linkSystems(data) }),
    system: (id) => byId.get(id) || null,
    findByName: (name) =>
      data.systems.find((s) => s.name.toLowerCase() === String(name).toLowerCase()) || null,
    isKSpace,
    allSystems: () => data.systems,
    jumps: () => data.jumps,
  };
}

// ---------------- settings: in this browser (localStorage), like data/settings.json ----------------
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}
function saveSettings(obj) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj));
  } catch {
    /* private window or storage off: the settings last until the page is closed */
  }
}

// ---------------- live state and the page's live connection ----------------
const clients = new Set();
const latest = {}; // feed name -> payload
const chatBuffers = {};
function broadcast(event, data) {
  for (const es of clients) es.deliver(event, data);
}
function publish(name, payload) {
  latest[name] = payload;
  broadcast('feed', { name, ...payload });
}
const linker = createLinker(); // item and system names in chat become links, as in the app's server
function publishChat(channel, messages) {
  messages.forEach(linker.link);
  (chatBuffers[channel] ||= []).push(...messages);
  if (chatBuffers[channel].length > 300) chatBuffers[channel].splice(0, chatBuffers[channel].length - 300);
  broadcast('chat', { channel, messages, initial: false });
}

const universe = demoMap(demoUniverse());
const showInfo = demoShowInfo(universe);
const router = createRouter({ esi: null, auth: null, universe, demo: true });
const chatStatus = {
  dir: '(demo)',
  found: true,
  channels: CHAT_CHANNELS.map((c) => ({ id: c.id, label: c.label, file: 'demo' })),
};

function snapshot() {
  return {
    auth: {
      loggedIn: true,
      demo: true,
      configured: true,
      characterName: 'Demo Capsuleer',
      characterId: 2112625428,
      scopes: [],
    },
    feeds: latest,
    universe: universe.state,
    chat: { status: chatStatus, channels: chatBuffers },
    combat: { active: false, t: 0 },
    autopilot: { on: false, next: null },
    logs: null,
    update: { available: false }, // nothing to update on the website
    settings: loadSettings(),
    config: {
      port: 4747,
      callbackUrl: 'http://localhost:4747/callback',
      chatChannels: CHAT_CHANNELS,
      demo: true,
      web: true, // the demo website: no app, no files, no login
      files: null,
      app: false,
      version: document.documentElement.dataset.version || null,
      commit: null,
      scopes: [],
      knownScopes: [],
    },
  };
}

// EventSource('/api/stream'): a snapshot first, then the same events as the server sends.
class DemoEventSource extends EventTarget {
  constructor(url) {
    super();
    this.url = String(url);
    this.readyState = 0;
    this.onopen = this.onmessage = this.onerror = null;
    setTimeout(() => {
      if (this.readyState === 2) return;
      this.readyState = 1;
      clients.add(this);
      this.deliver('snapshot', snapshot());
    });
  }
  deliver(event, data) {
    this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data) }));
  }
  close() {
    this.readyState = 2;
    clients.delete(this);
  }
}
DemoEventSource.CONNECTING = 0;
DemoEventSource.OPEN = 1;
DemoEventSource.CLOSED = 2;

// ---------------- the page's requests ----------------
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const notHere = () => json(400, { error: 'Not available on the demo website: download the app for this.' });
const bodyOf = (init) => {
  try {
    return JSON.parse(init?.body || '{}');
  } catch {
    return {};
  }
};

async function api(p, q, method, init) {
  const post = method !== 'GET' && method !== 'HEAD';
  switch (p) {
    case '/api/state':
      return json(200, snapshot());
    case '/api/settings':
      if (!post) return json(200, loadSettings());
      saveSettings(bodyOf(init));
      return json(200, { ok: true });
    case '/api/universe':
      return json(200, universe.payload());
    case '/api/demand':
      return json(200, { ok: true, active: null });
    case '/api/refresh':
      return json(200, { ok: true });
    case '/api/ratelimits':
      return json(200, { reserve: 0.25, groups: [] });
    case '/api/chatlogs':
      if (post) return notHere();
      return json(200, { dir: '', auto: '', reading: '(demo)', found: true, demo: true, game: null });
    case '/api/combat':
      return json(200, { idleSeconds: post ? Number(bodyOf(init).idleSeconds) || 15 : 15 });
    case '/api/storage':
      return json(404, { error: 'Not available' }); // like a HUD opened in a browser, without the app
    case '/api/showinfo':
      try {
        return json(200, await showInfo.lookup(q.get('type'), q.get('item')));
      } catch (err) {
        return json(err.status || 500, { error: err.message });
      }
    case '/api/route':
      try {
        return json(200, await router.route(q.get('from'), q.get('to'), q.get('pref') || 'shorter'));
      } catch (err) {
        return json(err.status || 500, { error: err.message });
      }
    case '/api/waypoint':
      try {
        return json(200, await router.setDestination(bodyOf(init).to));
      } catch (err) {
        return json(err.status || 500, { error: err.message });
      }
    default:
      return notHere(); // login, logout, credentials, scopes, reset, port check, storage
  }
}

const realFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/'))
      return api(url.pathname, url.searchParams, (init.method || input.method || 'GET').toUpperCase(), init);
    // the HUD asks for its own files from the server's root, e.g. /fonts/OFL.txt
    if (url.pathname.startsWith('/fonts/')) return realFetch(new URL(url.pathname.slice(1), HUD_ROOT), init);
  }
  return realFetch(input, init);
};
window.EventSource = DemoEventSource;

// ---------------- the sample data: the same as `npm run demo` ----------------
const demo = createDemo(universe, publish);
linker.setNames(universe.linkNames());
for (const [ch, msgs] of Object.entries(demo.chat)) chatBuffers[ch] = msgs.map(linker.link);
demo.start(publishChat);
