// SPDX-License-Identifier: GPL-3.0-or-later
// The HUD page: starts everything once the first snapshot from the server arrives. The parts
// live in their own files: topbar.js, settings-drawer.js, dialogs.js, logs-dialog.js,
// login-gate.js, appearance.js, backdrop.js, grid.js (the module windows) and modules/ (one file
// per module).

import { $, onFrame } from './util.js';
import { store, connect, initSettings, saveSettings, CLIENT_ID } from './store.js';
import { createGrid } from './grid.js';
import { startPlexus } from './plexus.js';
import { hud } from './hud-context.js';
import { REGISTRY } from './modules/index.js';
import { toast } from './toast.js';
import { applyAppearance, setPlexusRepaint } from './appearance.js';
import { startBackdrop } from './backdrop.js';
import { renderTopbar } from './topbar.js';
import { toggleDrawer } from './settings-drawer.js';
import { watchServer } from './dialogs.js';
import { checkLogs } from './logs-dialog.js';
import { renderGate } from './login-gate.js';
import { watchUpdate } from './update-dialog.js';

// ---------------- update blink ----------------
// Which modules show which feed. A module blinks when one of its feeds brings changed data.
const FEED_MODULES = {
  route: ['map'], // the star map's routes and Set destination (no feed, but an ESI route; see lib/feeds.js FEED_ROUTES)
  character: ['character'],
  wallet: ['character'],
  presence: ['character', 'map'],
  clones: [],
  skills: ['skills', 'character'],
  industry: ['industry'],
  orders: ['market'],
  objectives: ['warfare'],
  hazards: ['map'],
  traffic: ['map'],
  sovereignty: ['map'],
  warfare: ['warfare'],
  activity: ['activity'],
  mining: ['mining'],
  assets: ['assets'],
  standings: ['standings'],
  kills: ['kills'],
};

// ---------------- module lights: ESI health ----------------
// Each module's light turns amber when an ESI route it uses is slow or recovering, red when one is
// down (GET /meta/status, the esihealth feed). Otherwise it shows the module's own state.
const HEALTH_RANK = { ok: 0, recovering: 1, degraded: 2, down: 3 };
function watchHealth() {
  const paint = () => {
    const esiHealth = store.feed('esihealth')?.data;
    hud.grid.setHealth((id) => {
      if (!esiHealth) return null;
      let level = null;
      const problems = [];
      for (const [feed, mods] of Object.entries(FEED_MODULES)) {
        if (!mods.includes(id) || !esiHealth.feeds?.[feed]) continue;
        const l = esiHealth.feeds[feed];
        if (level === null || HEALTH_RANK[l] > HEALTH_RANK[level]) level = l;
        for (const x of esiHealth.problems?.[feed] || [])
          if (!problems.some((y) => y.route === x.route)) problems.push(x);
      }
      return level ? { level, problems } : null;
    });
  };
  store.on('feed:esihealth', paint);
  paint();
}

// ---------------- what this page shows ----------------
// Sent to the server, which polls only the feeds something on screen needs: the top bar, the visible
// modules (plus extras a module asks for, like the map's hazard overlay) and the alerts that are on.
function currentDemand() {
  const s = store.settings;
  const out = new Set(['topbar']);
  if (s.appearance.showMail !== false) out.add('mail');
  for (const [k, on] of Object.entries(s.alerts || {})) if (on !== false) out.add(`alert:${k}`);
  for (const [id, p] of Object.entries(s.modules)) {
    if (!p.visible || !REGISTRY[id]) continue;
    out.add(id);
    for (const extra of REGISTRY[id].demand?.(s) || []) out.add(extra);
  }
  return [...out].sort();
}
let sentDemand = '';
let demandTimer = null;
function sendDemand(force = false) {
  clearTimeout(demandTimer);
  demandTimer = setTimeout(() => {
    const consumers = currentDemand();
    const key = consumers.join(',');
    if (!force && key === sentDemand) return;
    sentDemand = key;
    fetch('/api/demand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: CLIENT_ID, consumers }),
    }).catch(() => {
      sentDemand = '';
    }); // try again with the next change or reconnect
  }, 120);
}
function watchUpdates() {
  const seen = {};
  const sig = (p) => JSON.stringify(p?.data ?? null) + JSON.stringify(p?.error?.message ?? null);
  for (const name of Object.keys(store.feeds)) seen[name] = sig(store.feeds[name]); // data present at startup doesn't blink
  for (const [name, modules] of Object.entries(FEED_MODULES)) {
    store.on(`feed:${name}`, (payload) => {
      const s = sig(payload);
      const changed = name in seen && seen[name] !== s;
      seen[name] = s;
      if (changed) for (const id of modules) hud.grid.pulse(id);
    });
  }
  store.on('chat', ({ initial }) => {
    if (!initial && store.settings.appearance.chatBlink !== false) hud.grid.pulse('chat');
  });
}

// ---------------- boot ----------------
async function main() {
  const saved = await fetch('/api/settings')
    .then((r) => r.json())
    .catch(() => ({}));
  initSettings(saved);
  if ((saved?.version || 1) < store.settings.version && saved?.modules) saveSettings(); // keep the migrated layout
  setPlexusRepaint(
    startPlexus($('#plexus'), {
      on: () => store.settings.appearance.plexus !== false,
      animate: () => store.settings.appearance.plexusMotion === true, // off unless switched on
    }),
  );
  applyAppearance();
  startBackdrop();
  $('#overlay').onclick = () => toggleDrawer(false);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleDrawer(false);
  });

  let started = false;
  store.on('snapshot', () => {
    if (!started) {
      started = true;
      renderTopbar();
      hud.grid = createGrid($('#grid'), REGISTRY, { toast });
      watchHealth();
      watchServer();
      watchUpdates();
      watchUpdate(); // a newer EVE HUD on GitHub: its release notes open once by themselves
      hud.grid.sync();
      onFrame((t) => hud.grid.tick(t)); // the modules' own animations, on the shared clock
    }
    renderGate();
    sendDemand(true); // on every (re)connect: the server may have restarted and forgotten this page
  });
  store.on('settings', () => sendDemand()); // every saveSettings(): module shown/hidden, map overlay, alerts…
  store.on('auth', renderGate);
  store.on('snapshot', checkLogs);
  store.on('logs', checkLogs);
  store.on('auth', checkLogs);
  connect();
}

main();
