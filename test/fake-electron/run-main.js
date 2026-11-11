// SPDX-License-Identifier: GPL-3.0-or-later
// Runs src/main.js once with the fake Electron, for one test scenario.
//   FAKE_OPTIONS  JSON: isPackaged, appPath, paths, lock, displays, messageResponses, openDialogResults
//   FAKE_ARGS     JSON array of app arguments (e.g. ["--demo", "--port=4791"])
//   FAKE_STEPS    JSON array of things to do once the window has loaded (see below)
// Prints one line "RESULT <json>" with what happened, then exits.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const options = JSON.parse(process.env.FAKE_OPTIONS || '{}');
// the tests describe Windows unless they say otherwise ('darwin' for the Mac menu, 'linux'), on
// whatever computer runs them
Object.defineProperty(process, 'platform', { value: options.platform || 'win32' });
globalThis.fakeElectron = { options };
process.argv = [process.argv[0], '.', ...JSON.parse(process.env.FAKE_ARGS || '[]')];
const steps = JSON.parse(process.env.FAKE_STEPS || '[]');
const f = globalThis.fakeElectron;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(test, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(20);
  }
  return false;
}

const result = { steps: {} };
await import('../../src/main.js');

// Wait for a window that has loaded a page, or for the app to quit/exit without one.
// (the controls: the tray on Windows, the Settings menu on a Mac)
const controlsReady = () => f.tray || f.appMenu?.template.some((m) => m.label === 'Settings');
await until(() => (f.windows[0]?.webContents.url && controlsReady()) || f.quit || f.exited !== null);
await sleep(150);
const win = f.windows[0];
result.url = win?.webContents.url || null;

// A request as the HUD window makes it: with the headers the app's network filter adds (the API token).
const windowHeaders = (url, headers = {}) =>
  new Promise((resolve) => {
    const fn = win.webContents.session.beforeSendHeaders;
    if (!fn) return resolve(headers);
    fn({ url: String(url), requestHeaders: headers }, (r) => resolve(r.requestHeaders));
  });
const hudFetch = async (url, init = {}) =>
  fetch(url, { ...init, headers: await windowHeaders(url, init.headers) });

if (win && result.url) {
  for (const step of steps) {
    if (step === 'fetchState') {
      const r = await hudFetch(new URL('/api/state', result.url));
      const body = await r.json();
      result.steps.fetchState = {
        status: r.status,
        demo: body.config.demo,
        files: body.config.files,
        universeReady: body.universe?.ready ?? null,
        settings: body.settings,
        auth: body.auth,
      };
    } else if (step === 'fullscreen') {
      const item = f.tray.menu.template.find((i) => i.label === 'Full-screen (F11)');
      item.click();
      await sleep(100);
      result.steps.fullscreen = { isFull: win.full };
    } else if (step === 'normal') {
      f.tray.menu.template.find((i) => i.label === 'Normal window').click();
      await sleep(100);
      result.steps.normal = { isFull: win.full };
    } else if (step === 'f11') {
      let prevented = false;
      win.webContents.emit(
        'before-input-event',
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        { type: 'keyDown', key: 'F11' },
      );
      await sleep(100);
      result.steps.f11 = { isFull: win.full, prevented };
    } else if (step === 'moveToPortrait') {
      const move = f.tray.menu.template.find((i) => i.label === 'Move to monitor');
      move.submenu.find((d) => d.label.startsWith('Portrait')).click();
      await sleep(100);
      result.steps.moveToPortrait = { bounds: win.getBounds() };
    } else if (step === 'externalLink') {
      let prevented = false;
      win.webContents.emit(
        'will-navigate',
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        'https://zkillboard.com/',
      );
      const popup = win.webContents.openHandler({ url: 'https://images.evetech.net/x' });
      result.steps.externalLink = { prevented, popup: popup.action, external: [...f.external] };
    } else if (step === 'privacy') {
      // the EVE login opens in the default browser; the window never leaves the HUD; only EVE hosts load
      const nav = (target, ev = 'will-navigate') => {
        let prevented = false;
        win.webContents.emit(
          ev,
          {
            preventDefault: () => {
              prevented = true;
            },
          },
          target,
        );
        return prevented;
      };
      const before = f.external.length;
      const login = nav(`${result.url}login`);
      const grant = nav(`${result.url}login?scopes=extra`);
      const inside = nav(`${result.url}?x=1`);
      const redirect = nav('https://login.eveonline.com/v2/oauth/authorize?x', 'will-redirect');
      const ses = win.webContents.session;
      const ask = (url) => new Promise((resolve) => ses.beforeRequest({ url }, (r) => resolve(!r.cancel)));
      const perm = (p) => new Promise((resolve) => ses.permissionRequest(null, p, resolve));
      await new Promise((r) => setTimeout(r, 50)); // the old default session is cleared at start
      result.steps.privacy = {
        login,
        grant,
        inside,
        redirect,
        opened: f.external.slice(before),
        partition: win.options.webPreferences.partition,
        persistent: ses.persistent,
        loads: {
          hud: await ask(`${result.url}api/state`),
          portrait: await ask('https://images.evetech.net/characters/1/portrait?size=64'),
          google: await ask('https://fonts.googleapis.com/css2?family=x'),
          lookalike: await ask('https://evetech.net.evil.com/x'),
          plainHttp: await ask('http://images.evetech.net/x'),
          otherPort: await ask('http://localhost:9999/'),
        },
        permissions: {
          clipboard: await perm('clipboard-sanitized-write'),
          camera: await perm('media'),
          notify: await perm('notifications'),
        },
        defaultCleared: f.sessions.default?.cleared || [],
      };
    } else if (step === 'resizeThenMaximize') {
      // drag the window to another size, then maximize it (Mac: zoom); its plain size must be kept
      win.setBounds({ x: 300, y: 120, width: 1500, height: 1000 });
      win.emit('resize');
      await sleep(400); // settled
      win.maximize();
      await sleep(900); // saved
      result.steps.resizeThenMaximize = { maximized: win.isMaximized() };
    } else if (step === 'appActions') {
      // the "stopped working" window's buttons go to /__app/…: handled by the app, never loaded
      const nav = (target) => {
        let prevented = false;
        win.webContents.emit(
          'will-navigate',
          {
            preventDefault: () => {
              prevented = true;
            },
          },
          target,
        );
        return prevented;
      };
      const before = f.opened.length;
      const log = nav(new URL('/__app/log', result.url).href);
      await sleep(50);
      result.steps.appActions = { log, opened: f.opened.slice(before) };
    } else if (step === 'apiToken') {
      // /api/* only answers the app's own window; the EVE login pages and the page's files stay open
      const u = (p) => new URL(p, result.url);
      const sent = await windowHeaders(u('/api/state'));
      const token = sent['X-EVE-HUD-Token'];
      const status = async (p, init) => (await fetch(u(p), { redirect: 'manual', ...init })).status;
      result.steps.apiToken = {
        tokenLength: (token || '').length,
        inLog:
          Boolean(token) &&
          fs.readFileSync(path.join(options.paths.logs, 'eve-hud.log'), 'utf8').includes(token),
        withToken: (await hudFetch(u('/api/state'))).status,
        without: await status('/api/state'),
        wrong: await status('/api/state', { headers: { 'X-EVE-HUD-Token': 'x'.repeat(43) } }),
        stream: await status('/api/stream'),
        post: await status('/api/logout', { method: 'POST' }),
        page: await status('/'),
        script: await status('/js/app.js'),
        login: await status('/login'),
        badUrl: await new Promise((resolve) => {
          // "GET //" isn't an address: a plain answer, and the server keeps running
          const s = net.connect(Number(u('/').port), '127.0.0.1', () =>
            s.write(`GET // HTTP/1.1\r\nHost: 127.0.0.1:${u('/').port}\r\nConnection: close\r\n\r\n`),
          );
          let got = '';
          s.on('data', (d) => (got += d));
          s.on('close', () => resolve(Number(got.split(' ')[1]) || 0));
          s.on('error', () => resolve(0));
        }),
        after: (await hudFetch(u('/api/state'))).status,
        // the token only goes to the HUD's own API, from the HUD's own address
        toStatic: Object.keys(await windowHeaders(u('/js/app.js'))),
        toEve: Object.keys(await windowHeaders('https://images.evetech.net/types/34/icon')),
        toOtherPort: Object.keys(await windowHeaders('http://127.0.0.1:9999/api/state')),
        toLocalhostName: Object.keys(await windowHeaders(`http://localhost:${u('/').port}/api/state`)),
        // a token the page tries to set itself is dropped
        forged: await windowHeaders('https://images.evetech.net/x', { 'x-eve-hud-token': 'mine' }),
      };
    } else if (step === 'storage') {
      // Settings → Storage: read the folders, choose new ones with Browse…, ask for a move; the app
      // restarts to do it
      const post = (p, body) =>
        hudFetch(new URL(p, result.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const st = await hudFetch(new URL('/api/storage', result.url)).then((r) => r.json());
      const to = JSON.parse(process.env.FAKE_MOVE_TO);
      const bad = await post('/api/storage', { configDir: 'not/absolute', dataDir: to.dataDir });
      // a folder that wasn't chosen in the folder window is refused, also a network share
      const typed = await post('/api/storage', to);
      const share = await post('/api/chatlogs', { dir: '\\\\server\\share\\logs' });
      const picked = [];
      for (const which of ['config', 'data'])
        picked.push((await post('/api/storage/browse', { which }).then((r) => r.json())).folder);
      const r = await post('/api/storage', to);
      await until(() => f.relaunched, 3000);
      result.steps.storage = {
        st,
        badStatus: bad.status,
        typedStatus: typed.status,
        shareStatus: share.status,
        picked,
        status: r.status,
        relaunched: f.relaunched,
        relaunchEnv: f.relaunchEnv,
      };
    } else if (step === 'startAtLogin') {
      const item = f.tray.menu.template.find(
        (i) => i.type === 'checkbox' && /Start with Windows|Open at login/.test(i.label),
      );
      result.steps.startAtLogin = { label: item.label, enabled: item.enabled, checked: item.checked };
      if (item.enabled) {
        item.checked = true;
        item.click(item);
      }
      result.steps.startAtLogin.after = f.loginItem.openAtLogin;
    } else if (step === 'secondInstance') {
      win.visible = false;
      (await import('../fake-electron/electron.js')).app.emit('second-instance');
      result.steps.secondInstance = { visible: win.visible };
    } else if (step === 'menu') {
      const items = (f.appMenu?.template || []).flatMap((m) => [
        m.label || m.role,
        ...(m.submenu || []).map((x) => x.label || x.role || x.type),
      ]);
      result.steps.menu = items;
      result.steps.trayIcon = Boolean(f.tray);
      result.steps.trayImage = f.tray?.image || null;
      const settings = f.appMenu?.template.find((m) => m.label === 'Settings');
      if (settings) result.steps.settings = settings.submenu.map((x) => x.label || x.type);
    } else if (step === 'f12') {
      const before = f.log.filter((x) => x.what === 'devtools').length;
      win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'F12' });
      result.steps.f12 = {
        opened: f.log.filter((x) => x.what === 'devtools').length > before,
        webPrefDevTools: win.options.webPreferences.devTools,
      };
    } else if (step === 'trayLabels') {
      result.steps.trayLabels = f.tray.menu.template.map((i) => i.label || i.type);
      result.steps.tooltip = f.tray.tip;
    } else if (step === 'closeWindow') {
      win.close();
      await until(() => f.quit);
      await sleep(50);
      let portClosed = false;
      try {
        await fetch(new URL('/api/state', result.url), { signal: AbortSignal.timeout(800) });
      } catch {
        portClosed = true;
      }
      result.steps.closeWindow = { quit: Boolean(f.quit), portClosed };
    } else if (step === 'quit') {
      if (f.tray) f.tray.menu.template.find((i) => i.label === 'Quit EVE HUD').click();
      else (await import('../fake-electron/electron.js')).app.quit(); // Mac: EVE HUD → Quit (role)
      await until(() => f.quit);
      result.steps.quit = { quit: Boolean(f.quit) };
    }
  }
}

result.quit = Boolean(f.quit);
result.exited = f.exited;
result.relaunched = f.relaunched;
result.recoveryPages = f.recoveryPages || 0;
result.windows = f.windows.length;
result.dialogs = f.dialogs;
result.opened = f.opened;
result.firstWindowBounds = win?.options && {
  x: win.options.x,
  y: win.options.y,
  width: win.options.width,
  height: win.options.height,
};
process.stdout.write(`\nRESULT ${JSON.stringify(result)}\n`, () => process.exit(0));
