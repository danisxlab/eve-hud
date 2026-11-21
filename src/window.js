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
// The window has no system title bar but a slim one in the HUD's style, above the HUD's top bar
// (frameOptions and markFrame below; #titlebar in hud/public/css/topbar.css). Drag it to move the
// window, double-click it to maximize. Mac: the red, yellow and green buttons sit at its left.
// Windows and Linux: the system's own minimize, maximize and close buttons sit at its right, drawn
// see-through in the HUD's colours (Snap Layouts on Windows 11 keep working). Full screen: no bar.
// The window's edge is a dark green line (FRAME_BORDER): the system's border on Windows 11, drawn
// by the page on Linux. (macOS draws its own faint edge, which apps can't colour.) A maximized
// window (not full screen) gets small accents in its corners, on Windows and Linux.
// When the window's size has settled (a resize with the mouse ended, maximized, full screen, or
// back), the page hears about it ("hud:window-settled"): the star map then centres on your system.
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

// ---------- the title bar ----------
// The window buttons are as tall as the HUD's title bar (--titlebar-h in hud/public/css/base.css)
// and stay so when you zoom (Ctrl + / Ctrl -).
export const TITLEBAR_HEIGHT = 28;
const TRAFFIC_LIGHTS_HEIGHT = 14; // the Mac's red, yellow and green buttons
const OVERLAY_COLOURS = { color: 'rgba(0, 0, 0, 0)', symbolColor: '#d4d9db' }; // see-through; the HUD's text colour
// the window's edge: dark green, close to black (also --frame-border in hud/public/css/base.css)
export const FRAME_BORDER = '#0e231c';

// BrowserWindow options for the title bar, per platform. Mac: a see-through window (the HUD itself
// paints every pixel), because macOS draws a light line along the top edge of an opaque one.
// Windows: accentColor colours the system's 1 px border (Windows 11), also when the window isn't
// the active one, instead of the default grey.
export function frameOptions(platform = process.platform, zoom = 1) {
  const height = Math.round(TITLEBAR_HEIGHT * zoom);
  if (platform === 'darwin')
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: trafficLights(height),
      transparent: true,
      backgroundColor: '#00000000',
    };
  const options = { titleBarStyle: 'hidden', titleBarOverlay: { ...OVERLAY_COLOURS, height } };
  if (platform === 'win32') options.accentColor = FRAME_BORDER;
  return options;
}
// How round the window's corners are, so the corner accents can follow them: Windows 11 rounds
// them by 8 pixels, Windows 10 and Linux not. (The Mac has no corner accents.)
// version: process.getSystemVersion(), e.g. "10.0.22631" (Windows 11).
export function cornerRadius(platform, version = '') {
  const build = Number(String(version).split('.')[2]) || 0;
  return platform === 'win32' && build >= 22000 ? 8 : 0;
}
// The page's part (classes on <html>): titled (the title bar is there: not in full screen),
// corner-accents (maximized, on Windows and Linux), buttons-right (Windows and Linux: the buttons
// fill the top-right corner), frame-line (Linux, a plain window: the page draws the window's edge);
// and --window-radius, the corners' roundness
export const frameScript = ({ titled, accents, buttonsRight, line = false, radius = 0 }) =>
  `(() => { const r = document.documentElement; const c = r.classList; c.toggle('titled', ${Boolean(titled)}); c.toggle('corner-accents', ${Boolean(accents)}); c.toggle('buttons-right', ${Boolean(buttonsRight)}); c.toggle('frame-line', ${Boolean(line)}); r.style.setProperty('--window-radius', '${Number(radius) || 0}px'); })()`;
// tells the page that the window's size has settled (the star map listens)
export const SETTLED_SCRIPT = "window.dispatchEvent(new Event('hud:window-settled'))";
// the Mac's buttons, centred on a title bar of this height
const trafficLights = (height) => ({ x: 13, y: Math.round((height - TRAFFIC_LIGHTS_HEIGHT) / 2) });

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
// apiToken: sent along with the window's requests to the HUD's API (privacy.js).

// The window loads the HUD from 127.0.0.1, the address the server listens on, and not from the name
// "localhost": that name also stands for ::1 (IPv6), where another program could be listening on
// the same port. The EVE login in your browser keeps using localhost (EVE's callback URL).
export function windowUrl(url) {
  const u = new URL(url);
  if (u.hostname === 'localhost') u.hostname = '127.0.0.1';
  return u.href;
}

export function createHudWindow({
  url,
  apiToken = null,
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

  url = windowUrl(url);
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
    ...frameOptions(),
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
  const RADIUS = cornerRadius(process.platform, process.getSystemVersion?.() || '');

  // The HUD's title bar (gone in full screen), the corner accents (a maximized window, on Windows
  // and Linux) and Linux's window edge (a plain window): the page draws them
  function markFrame() {
    if (win.isDestroyed()) return;
    const full = win.isFullScreen();
    const maxed = win.isMaximized() && !full;
    const script = frameScript({
      titled: !full,
      accents: process.platform !== 'darwin' && maxed,
      buttonsRight: process.platform !== 'darwin',
      line: process.platform === 'linux' && !full && !maxed,
      radius: full || maxed ? 0 : RADIUS,
    });
    win.webContents.executeJavaScript(script).catch(() => {}); // e.g. while a page is loading
  }
  win.webContents.on('dom-ready', markFrame);
  win.on('maximize', markFrame); // a maximized window has square corners on Windows
  win.on('unmaximize', markFrame);

  // Full-screen can also change outside our menu (the green button on a Mac): keep the mode in step.
  win.on('enter-full-screen', () => {
    setModeState('fullscreen');
    markFrame();
  });
  win.on('leave-full-screen', () => {
    if (!moving) setModeState('normal');
    markFrame();
  });
  function setModeState(m) {
    if (m === currentMode) return;
    currentMode = m;
    onModeChange(m);
  }

  // ---------- the size has settled: tell the page ----------
  // Dragging an edge (Mac and Windows: will-resize while you drag, resized when you let go) counts
  // once you let go; maximize, full screen, back, and other resizes (Windows Snap; everything on
  // Linux, which has no resized) once the size has stopped changing for a moment.
  let dragging = false;
  let dragTimer = null;
  let settledTimer = null;
  const settled = (delay = 250) => {
    clearTimeout(settledTimer);
    settledTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.executeJavaScript(SETTLED_SCRIPT).catch(() => {});
    }, delay);
  };
  win.on('will-resize', () => {
    dragging = true;
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => (dragging = false), 2000); // in case "resized" never comes
  });
  win.on('resized', () => {
    dragging = false;
    clearTimeout(dragTimer);
    settled(50);
  });
  win.on('resize', () => {
    if (!dragging) settled(process.platform === 'linux' ? 500 : 250);
  });
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'])
    win.on(ev, () => settled());

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
  const mac = process.platform === 'darwin';
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = input.key;
    const wc = win.webContents;
    if (key === 'F11') toggleMode();
    else if (key === 'F5' || (mod && !input.shift && key.toLowerCase() === 'r')) reload();
    else if (devTools && (key === 'F12' || (mod && input.shift && key.toLowerCase() === 'i')))
      wc.toggleDevTools();
    // zoom keys (on a Mac they're the View menu's: tray.js setMacMenu)
    else if (mac) return;
    else if (mod && (key === '+' || key === '=')) zoomStep(1);
    else if (mod && key === '-') zoomStep(-1);
    else if (mod && key === '0') zoomStep(0);
    else return;
    event.preventDefault();
  });
  // Zooming makes the title bar taller or shorter: the window buttons follow it. (Chromium's zoom
  // factor is 1.2 to the power of the zoom level.)
  // step: 1 bigger, -1 smaller, 0 back to 100%
  function zoomStep(step) {
    const now = win.webContents.getZoomLevel();
    zoom(step === 0 ? 0 : Math.max(-5, Math.min(5, now + 0.5 * Math.sign(step))));
  }
  function zoom(level) {
    win.webContents.setZoomLevel(level);
    const height = Math.round(TITLEBAR_HEIGHT * 1.2 ** level);
    if (process.platform === 'darwin') win.setWindowButtonPosition?.(trafficLights(height));
    else win.setTitleBarOverlay?.({ ...OVERLAY_COLOURS, height });
  }

  // ---------- links, login, network ----------
  guardSession(win.webContents.session, {
    getHudOrigin: () => hudOrigin,
    getApiToken: () => apiToken,
    log,
  });
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
      if (t.hostname === '127.0.0.1') t.hostname = 'localhost'; // as in EVE's callback URL
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
    zoom: zoomStep,
    setMode,
    toggleMode,
    moveToDisplay,
    get mode() {
      return currentMode;
    },
    currentDisplayId: () => (win.isDestroyed() ? null : screen.getDisplayMatching(win.getBounds()).id),
    // The HUD moved to another port (setup form): load it there; links to it stay inside the window.
    setUrl(next) {
      next = windowUrl(next);
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
