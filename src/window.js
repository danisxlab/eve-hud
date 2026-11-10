// SPDX-License-Identifier: GPL-3.0-or-later
// The HUD window.
//
// Two modes ("window": { "mode": … } in config.json, switched with F11 or the tray menu):
//   normal      a resizable window. Its size, position, monitor and whether it was maximized
//               (Mac: zoomed, e.g. by double-clicking the title bar) are remembered in
//               data/window-state.json, so it comes back the way you left it.
//   fullscreen  borderless and filling one monitor: the one it was on, or the one picked with
//               tray > Move to monitor.
// At start-up "window": { "display": … } picks the monitor: "last" (where it was last time; on the
// very first start the first portrait monitor, if there is one), "portrait" or "primary".
// A remembered position on a monitor that's no longer connected is ignored.
//
// Keys: F11 full-screen on/off · F5 / Ctrl+R reload · Ctrl + / Ctrl - / Ctrl 0 zoom (Cmd on a Mac) ·
//       F12 / Ctrl+Shift+I developer tools, only when run from source (npm start) or with --devtools.
//
// Links that leave the HUD open in your default browser, and so does the EVE login: "Log in with EVE
// Online" opens http://localhost:<port>/login?from=app in the browser, EVE sends you back to the HUD
// server there, and the app picks the login up by itself. The window never shows a login page, and
// keeps no cookies (see privacy.js).

import fs from 'node:fs';
import { BrowserWindow, screen, shell } from 'electron';
import { SESSION_PARTITION, guardSession } from './privacy.js';

// The first window (no remembered position yet):
//   on a portrait monitor  1200×1920, the HUD's own portrait layout, scaled down to fill the screen
//   on any other monitor   1600×900, fits a 1920×1080 screen with room for the taskbar / Dock;
//                          smaller screens get it scaled down to 90% of their free area
const PORTRAIT = { width: 1200, height: 1920 };
const LANDSCAPE = { width: 1600, height: 900 };
const LANDSCAPE_MAX = 0.9;

// ---------- placement (plain functions, so they can be tested without Electron) ----------

const isPortrait = (d) => d.bounds.height > d.bounds.width;

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function pickDisplay(displays, primary, { display = 'last' } = {}, state = {}) {
  if (display === 'primary') return primary;
  if (display === 'portrait') return displays.find(isPortrait) || primary;
  // "last": the remembered monitor, else the one under the remembered position, else a portrait one
  return (
    displays.find((d) => d.id === state.displayId) ||
    (state.bounds && displays.find((d) => overlap(d.workArea, state.bounds) > 0)) ||
    displays.find(isPortrait) ||
    primary
  );
}

// A window of the given size (default: see PORTRAIT / LANDSCAPE above), centred on the display's
// usable area (without the taskbar or Dock) and never bigger than it.
export function centredOn(display, size = null) {
  const wa = display.workArea;
  const portrait = isPortrait(display);
  let { width, height } = size || (portrait ? PORTRAIT : LANDSCAPE);
  if (!size) {
    const room = portrait ? 1 : LANDSCAPE_MAX;
    const scale = Math.min(1, (wa.width * room) / width, (wa.height * room) / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  width = Math.min(width, wa.width);
  height = Math.min(height, wa.height);
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width,
    height,
  };
}

// Where the window opens: the remembered bounds when they are still (mostly) on the chosen
// display, otherwise centred on it (keeping the remembered size where possible).
export function initialPlacement(displays, primary, windowConfig, state = {}) {
  const display = pickDisplay(displays, primary, windowConfig, state);
  const b = state.bounds;
  if (b && b.width >= 200 && b.height >= 200) {
    const visible = overlap(display.workArea, b);
    if (visible >= 0.5 * b.width * b.height) return { display, bounds: b };
    return { display, bounds: centredOn(display, { width: b.width, height: b.height }) };
  }
  return { display, bounds: centredOn(display) };
}

export function displayLabel(d, i, primaryId) {
  const w = Math.round(d.size.width * (d.scaleFactor || 1));
  const h = Math.round(d.size.height * (d.scaleFactor || 1));
  const name = d.label || `Monitor ${i + 1}`;
  return `${name} · ${w}×${h}${isPortrait(d) ? ' portrait' : ''}${d.id === primaryId ? ' (main)' : ''}`;
}

// ---------- the window ----------

// onAppAction(name): the page asked the app for something it can't do itself, by going to
// /__app/<name> ("log", "config", "restart", "quit"; the red windows of the page use them).
// onLoadFailed(description): the HUD page itself could not be loaded (its server isn't answering).
export function createHudWindow({
  url,
  devTools = false,
  mode = 'normal',
  windowConfig = {},
  statePath,
  icon,
  log,
  onModeChange = () => {},
  onClosed = () => {},
  onAppAction = () => {},
  onLoadFailed = () => {},
}) {
  const readState = () => {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      return {};
    }
  };
  const saved = readState();
  const { display, bounds } = initialPlacement(
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
    windowConfig,
    saved,
  );
  const maximize = Boolean(saved.maximized) && saved.displayId === display.id;
  log.info(
    `Window: ${mode} on display ${display.id} at ${bounds.x},${bounds.y} ${bounds.width}×${bounds.height}${maximize ? ', maximized' : ''}`,
  );

  let hudOrigin = new URL(url).origin;
  let currentMode = mode;
  let moving = false; // true while moving a full-screen window to another monitor

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 400,
    minHeight: 400,
    show: false,
    title: 'EVE HUD',
    backgroundColor: '#000000', // no white flash before the HUD paints
    icon,
    autoHideMenuBar: true,
    // partition without "persist:": cookies, storage and cache stay in memory and are gone on quit
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools,
      partition: SESSION_PARTITION,
    },
  });

  win.once('ready-to-show', () => {
    if (maximize && currentMode !== 'fullscreen') win.maximize();
    win.show();
    if (currentMode === 'fullscreen') win.setFullScreen(true);
  });
  win.on('page-title-updated', (e) => e.preventDefault()); // keep "EVE HUD" as the title

  // Full-screen can also change outside our menu (the green button on a Mac): keep the mode in step.
  win.on('enter-full-screen', () => setModeState('fullscreen'));
  win.on('leave-full-screen', () => {
    if (!moving) setModeState('normal');
  });
  function setModeState(m) {
    if (m === currentMode) return;
    currentMode = m;
    onModeChange(m);
  }

  // ---------- remember size, position, monitor and maximized ----------
  // The size of the window when it's neither maximized nor full-screen, kept up to date here:
  // getNormalBounds() isn't reliable for a zoomed window on a Mac. Taken once a move or resize has
  // settled, so the in-between sizes of a maximize or full-screen animation don't count.
  let normalBounds = { ...bounds };
  const isPlain = () => !win.isMaximized() && !win.isFullScreen() && !win.isMinimized();
  const trackNormal = () => {
    if (!win.isDestroyed() && isPlain()) normalBounds = win.getBounds();
  };
  let settleTimer = null;
  const trackSoon = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(trackNormal, 300);
  };
  const stopTracking = () => clearTimeout(settleTimer);
  let saveTimer = null;
  function saveState() {
    clearTimeout(saveTimer);
    if (win.isDestroyed()) return;
    try {
      trackNormal();
      const state = {
        bounds: normalBounds,
        displayId: screen.getDisplayMatching(win.getBounds()).id,
        maximized: win.isMaximized() && !win.isFullScreen(),
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (err) {
      log.warn(`Could not save the window position: ${err.message}`);
    }
  }
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 800);
  };
  for (const ev of ['move', 'resize'])
    win.on(ev, () => {
      trackSoon();
      saveSoon();
    });
  for (const ev of ['maximize', 'enter-full-screen', 'minimize'])
    win.on(ev, () => {
      stopTracking();
      saveSoon();
    });
  win.on('unmaximize', saveSoon);
  win.on('close', saveState);
  win.on('closed', onClosed);

  // ---------- keys ----------
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = input.key;
    const wc = win.webContents;
    if (key === 'F11') toggleMode();
    else if (key === 'F5' || (mod && !input.shift && key.toLowerCase() === 'r')) reload();
    else if (devTools && (key === 'F12' || (mod && input.shift && key.toLowerCase() === 'i')))
      wc.toggleDevTools();
    else if (mod && (key === '+' || key === '=')) wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
    else if (mod && key === '-') wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -5));
    else if (mod && key === '0') wc.setZoomLevel(0);
    else return;
    event.preventDefault();
  });

  // ---------- links, login, network ----------
  guardSession(win.webContents.session, { getHudOrigin: () => hudOrigin, log });
  const external = (target) => {
    if (/^https?:\/\//i.test(target)) shell.openExternal(target);
  };
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    external(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    let t = null;
    try {
      t = new URL(target);
    } catch {
      /* not a URL: let Electron handle it */
    }
    if (t && t.origin === hudOrigin && t.pathname.startsWith('/__app/')) {
      event.preventDefault(); // handled by the app, works even when the server is gone
      onAppAction(t.pathname.slice('/__app/'.length));
    } else if (t && t.origin === hudOrigin && t.pathname === '/login') {
      // the EVE login goes to your default browser; the app updates when it's done
      event.preventDefault();
      t.searchParams.set('from', 'app'); // keeps any other options of the login (extra permissions)
      external(t.href);
    } else if (t && t.origin !== hudOrigin) {
      event.preventDefault(); // a link to another site: open it in the browser, not in the app
      external(target);
    }
  });
  win.webContents.on('will-redirect', (event, target) => {
    if (safeOrigin(target) !== hudOrigin) event.preventDefault(); // the window never leaves the HUD
  });
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted, normal on redirects
    log.warn(`Page failed to load (${desc}): ${failedUrl}`);
    if (safeOrigin(failedUrl) === hudOrigin) onLoadFailed(desc);
  });

  win.loadURL(url);

  // ---------- actions for the tray ----------
  function show() {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  function reload() {
    // Back to the HUD, also from a login page that went wrong
    if (safeOrigin(win.webContents.getURL()) === hudOrigin) win.webContents.reloadIgnoringCache();
    else win.loadURL(url);
  }
  function setMode(m) {
    win.setFullScreen(m === 'fullscreen');
    setModeState(m); // the event follows too; this covers platforms where it comes late
  }
  function toggleMode() {
    setMode(currentMode === 'fullscreen' ? 'normal' : 'fullscreen');
  }
  async function moveToDisplay(id) {
    const target = screen.getAllDisplays().find((d) => d.id === id);
    if (!target) return;
    const size = normalBounds;
    const wasMaximized = win.isMaximized();
    if (wasMaximized) win.unmaximize();
    if (currentMode === 'fullscreen' && win.isFullScreen()) {
      moving = true;
      await leaveFullScreen();
      win.setBounds(centredOn(target, { width: size.width, height: size.height }));
      win.setFullScreen(true);
      moving = false;
    } else {
      win.setBounds(centredOn(target, { width: size.width, height: size.height }));
      if (wasMaximized) win.maximize(); // maximized on the new monitor too
    }
    show();
    saveSoon();
  }
  function leaveFullScreen() {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(() => {
        win.off('leave-full-screen', done);
        resolve();
      }, 1500);
      win.once('leave-full-screen', done);
      win.setFullScreen(false);
    });
  }

  return {
    win,
    show,
    reload,
    setMode,
    toggleMode,
    moveToDisplay,
    get mode() {
      return currentMode;
    },
    currentDisplayId: () => (win.isDestroyed() ? null : screen.getDisplayMatching(win.getBounds()).id),
    // The HUD moved to another port (setup form): load it there; links to it stay inside the window.
    setUrl(next) {
      url = next;
      hudOrigin = new URL(next).origin;
      if (!win.isDestroyed()) win.loadURL(next);
    },
  };
}

function safeOrigin(u) {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}
