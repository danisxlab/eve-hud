// SPDX-License-Identifier: GPL-3.0-or-later
// Runs the real main process (src/main.js) with a stand-in Electron and the real HUD server
// (hud/), one scenario per child process. No Electron or network needed.
//   npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUD = path.join(APP, 'hud');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-app-test-'));
const dir = (name) => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const MAIN = {
  id: 1,
  label: 'Main',
  bounds: { x: 0, y: 0, width: 2560, height: 1440 },
  workArea: { x: 0, y: 25, width: 2560, height: 1375 },
  size: { width: 2560, height: 1440 },
  scaleFactor: 1,
};

// Every run gets its own app folder (userData), so your real one is never touched.
function run({ options = {}, args = [], steps = [], env = {} }) {
  const id = Math.random().toString(36).slice(2);
  const fakeOptions = {
    appPath: APP,
    paths: { logs: dir(`logs-${id}`), userData: dir(`userdata-${id}`), documents: tmp },
    ...options,
  };
  const logs = fakeOptions.paths.logs;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        path.join(APP, 'test/fake-electron/register.js'),
        path.join(APP, 'test/fake-electron/run-main.js'),
      ],
      {
        env: {
          ...process.env,
          ...env,
          FAKE_OPTIONS: JSON.stringify(fakeOptions),
          FAKE_ARGS: JSON.stringify(args),
          FAKE_STEPS: JSON.stringify(steps),
          EVE_HUD_HOME: env.EVE_HUD_HOME || '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout\n${out}`));
    }, 30_000);
    child.on('exit', () => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      if (!line) return reject(new Error(`no result\n${out}`));
      const result = JSON.parse(line.slice(7));
      result.output = out;
      result.userData = fakeOptions.paths.userData;
      result.logFile = fs.existsSync(path.join(logs, 'eve-hud.log'))
        ? fs.readFileSync(path.join(logs, 'eve-hud.log'), 'utf8')
        : '';
      resolve(result);
    });
  });
}

// A packaged-app layout: <appPath>/hud (the HUD code) + <appPath>/assets, like electron-builder makes.
function packagedAppDir() {
  const d = dir('packaged-app');
  if (!fs.existsSync(path.join(d, 'hud'))) {
    fs.symlinkSync(HUD, path.join(d, 'hud'), 'junction');
    fs.symlinkSync(path.join(APP, 'assets'), path.join(d, 'assets'), 'junction');
    fs.writeFileSync(path.join(d, 'package.json'), '{ "type": "module" }');
  }
  return d;
}

// An "old" HUD folder (the eve project before the merge), with made-up credentials and login, in plain text.
function oldHudFolder() {
  const d = dir('old-hud');
  const example = JSON.parse(fs.readFileSync(path.join(HUD, 'config.example.json'), 'utf8'));
  fs.writeFileSync(
    path.join(d, 'config.json'),
    JSON.stringify({ ...example, clientId: 'test-id', clientSecret: 'test-secret' }, null, 2),
  );
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(d, 'data', 'tokens.json'),
    JSON.stringify({ characterId: 1, characterName: 'Test', refreshToken: 'x' }),
  );
  fs.writeFileSync(path.join(d, 'data', 'settings.json'), JSON.stringify({ marker: 'imported-layout' }));
  for (const f of ['universe.json', 'typenames.json']) {
    const src = path.join(HUD, 'data', f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(d, 'data', f));
  }
  return d;
}

test('development: demo server starts in-process, window shows it, tray works, closing the window stops the server', async () => {
  const r = await run({
    args: ['--demo', '--port=4791'],
    steps: [
      'fetchState',
      'trayLabels',
      'externalLink',
      'privacy',
      'appActions',
      'secondInstance',
      'startAtLogin',
      'closeWindow',
    ],
  });
  assert.equal(r.url, 'http://localhost:4791/', r.output);
  assert.equal(r.steps.fetchState.status, 200);
  assert.equal(r.steps.fetchState.demo, true);
  assert.equal(
    path.dirname(r.steps.fetchState.files.configFile),
    r.userData,
    'npm start uses the app folder too',
  );
  assert.equal(r.dialogs.length, 0, 'demo mode starts without the welcome questions');
  assert.ok(r.steps.trayLabels.includes('Quit EVE HUD'));
  assert.match(r.steps.tooltip, /demo/);
  assert.deepEqual(r.steps.externalLink, {
    prevented: true,
    popup: 'deny',
    external: ['https://zkillboard.com/', 'https://images.evetech.net/x'],
  });
  const p = r.steps.privacy;
  assert.equal(p.login, true, 'Log in does not open the login page in the window');
  assert.equal(p.grant, true);
  assert.equal(p.inside, false, 'pages of the HUD itself load normally');
  assert.equal(p.redirect, true, 'the window never follows a redirect to another site');
  assert.deepEqual(
    p.opened,
    ['http://localhost:4791/login?from=app', 'http://localhost:4791/login?scopes=extra&from=app'],
    'the login opens in the default browser',
  );
  assert.equal(p.partition, 'eve-hud');
  assert.equal(p.persistent, false, 'no cookies or storage on disk');
  assert.deepEqual(p.loads, {
    hud: true,
    portrait: true,
    google: false,
    lookalike: false,
    plainHttp: false,
    otherPort: false,
  });
  assert.deepEqual(p.permissions, { clipboard: true, camera: false, notify: false });
  assert.deepEqual(p.defaultCleared, ['storage', 'cache'], 'old cookies from earlier versions are removed');
  assert.match(r.logFile, /Blocked a request to fonts\.googleapis\.com/);
  assert.equal(r.steps.appActions.log, true, '/__app/log is handled by the app');
  assert.equal(r.steps.appActions.opened.length, 1);
  assert.match(r.steps.appActions.opened[0], /eve-hud\.log$/, 'opens the log file');
  assert.equal(r.steps.secondInstance.visible, true);
  assert.equal(r.steps.startAtLogin.enabled, false, 'start at login is only offered in the installed app');
  assert.deepEqual(r.steps.closeWindow, { quit: true, portClosed: true });
  assert.match(r.logFile, /EVE HUD running at http:\/\/localhost:4791/);
});

test('window: first start opens on the portrait monitor; F11 / tray switch modes and save them in config.json; move to monitor', async () => {
  const home = dir('mode-home');
  fs.writeFileSync(path.join(home, 'config.json'), fs.readFileSync(path.join(HUD, 'config.example.json')));
  const before = fs.readFileSync(path.join(home, 'config.json'), 'utf8');
  const r = await run({
    args: ['--demo', '--port=4795', `--data-dir=${home}`],
    steps: ['f11', 'normal', 'fullscreen', 'moveToPortrait', 'quit'],
  });
  assert.deepEqual(
    r.firstWindowBounds,
    { x: 2573, y: 0, width: 1175, height: 1880 },
    'fits 1200×1920 into the portrait work area',
  );
  assert.deepEqual(r.steps.f11, { isFull: true, prevented: true });
  assert.equal(r.steps.normal.isFull, false);
  assert.equal(r.steps.fullscreen.isFull, true);
  const after = fs.readFileSync(path.join(home, 'config.json'), 'utf8');
  assert.equal(JSON.parse(after).window.mode, 'fullscreen');
  assert.equal(
    after.replace('"mode": "fullscreen"', '"mode": "normal"'),
    before,
    'only the mode value changed',
  );
  assert.ok(r.steps.moveToPortrait.bounds.x >= 2560);
  const state = JSON.parse(fs.readFileSync(path.join(home, 'data', 'window-state.json'), 'utf8'));
  assert.equal(state.displayId, 2);

  // next start: full-screen again, on the remembered monitor
  const r2 = await run({ args: ['--demo', '--port=4795', `--data-dir=${home}`], steps: ['quit'] });
  assert.ok(r2.firstWindowBounds.x >= 2560, JSON.stringify(r2.firstWindowBounds));
  assert.match(r2.logFile, /Window: fullscreen on display 2/);
});

test('window: a resized and then maximized window comes back maximized, with its own size to restore to', async () => {
  const home = dir('max-home');
  fs.writeFileSync(path.join(home, 'config.json'), fs.readFileSync(path.join(HUD, 'config.example.json')));
  const r = await run({
    args: ['--demo', '--port=4790', `--data-dir=${home}`],
    options: { displays: [MAIN] },
    steps: ['resizeThenMaximize', 'quit'],
  });
  assert.equal(r.steps.resizeThenMaximize.maximized, true, r.output);
  const state = JSON.parse(fs.readFileSync(path.join(home, 'data', 'window-state.json'), 'utf8'));
  assert.deepEqual(state, {
    bounds: { x: 300, y: 120, width: 1500, height: 1000 },
    displayId: 1,
    maximized: true,
  });
  const r2 = await run({
    args: ['--demo', '--port=4790', `--data-dir=${home}`],
    options: { displays: [MAIN] },
    steps: ['quit'],
  });
  assert.deepEqual(r2.firstWindowBounds, { x: 300, y: 120, width: 1500, height: 1000 });
  assert.match(r2.logFile, /Window: normal on display 1 at 300,120 1500×1000, maximized/);
});

test('Settings → Storage: shows the folders, moves config.json and data at the restart', async () => {
  const userData = dir('ud-storage');
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    fs.readFileSync(path.join(HUD, 'config.example.json')),
  );
  fs.mkdirSync(path.join(userData, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'data', 'settings-demo.json'),
    JSON.stringify({ marker: 'moved-layout' }),
  );
  const to = { configDir: path.join(tmp, 'moved-cfg'), dataDir: path.join(tmp, 'moved-data') };
  const options = { paths: { userData, logs: dir('l-st'), documents: tmp } };
  const r = await run({
    options,
    args: ['--demo', '--port=4789'],
    steps: ['storage', 'quit'],
    env: { FAKE_MOVE_TO: JSON.stringify(to) },
  });
  assert.deepEqual(
    r.steps.storage.st,
    {
      configDir: userData,
      dataDir: path.join(userData, 'data'),
      defaults: { configDir: userData, dataDir: path.join(userData, 'data') },
      fixed: false,
    },
    r.output,
  );
  assert.equal(r.steps.storage.badStatus, 400, 'a relative path is refused');
  assert.equal(r.steps.storage.status, 200);
  assert.equal(r.steps.storage.relaunched, true, 'restarts to move');
  assert.ok(
    !r.steps.storage.relaunchEnv.EVE_HUD_HOME && !r.steps.storage.relaunchEnv.EVE_HUD_DATA,
    'the restarted app is not told the folders as if they came from --data-dir',
  );
  assert.ok(fs.existsSync(path.join(userData, 'config.json')), 'nothing moved yet while running');
  // the next start moves them before the server reads anything
  const r2 = await run({ options, args: ['--demo', '--port=4789'], steps: ['fetchState', 'quit'] });
  assert.equal(r2.steps.fetchState.files.configFile, path.join(to.configDir, 'config.json'), r2.output);
  assert.equal(r2.steps.fetchState.files.dataDir, to.dataDir);
  assert.deepEqual(r2.steps.fetchState.settings, { marker: 'moved-layout' }, 'the layout came along');
  assert.ok(
    !fs.existsSync(path.join(userData, 'config.json')) && !fs.existsSync(path.join(userData, 'data')),
    'old copies removed',
  );
  assert.match(r2.logFile, /Storage: moved config\.json and data/);
});

test('installed app, first start: import the old HUD folder; Client ID, Secret Key and login get encrypted', async () => {
  const userData = dir('ud-import');
  const old = oldHudFolder();
  const r = await run({
    options: {
      isPackaged: true,
      appPath: packagedAppDir(),
      paths: { userData, logs: dir('l1'), documents: tmp },
      messageResponses: [0, 0],
      openDialogResults: [old],
    },
    args: ['--port=4792'],
    steps: ['fetchState', 'startAtLogin', 'quit'],
  });
  assert.equal(r.dialogs[0].message, 'Welcome to EVE HUD', r.output);
  assert.match(r.dialogs[2].message, /^Imported \d+ files$/);
  for (const f of ['config.json', 'data/tokens.json', 'data/settings.json'])
    assert.ok(fs.existsSync(path.join(userData, f)), f);
  // encrypted in place: only the two values changed, the rest of config.json is as imported
  const cfgText = fs.readFileSync(path.join(userData, 'config.json'), 'utf8');
  const cfg = JSON.parse(cfgText);
  assert.match(cfg.clientId, /^enc:/);
  assert.match(cfg.clientSecret, /^enc:/);
  assert.doesNotMatch(cfgText, /test-secret|test-id/);
  const oldCfg = JSON.parse(fs.readFileSync(path.join(old, 'config.json'), 'utf8'));
  assert.deepEqual({ ...cfg, clientId: 0, clientSecret: 0 }, { ...oldCfg, clientId: 0, clientSecret: 0 });
  const tokens = JSON.parse(fs.readFileSync(path.join(userData, 'data', 'tokens.json'), 'utf8'));
  assert.deepEqual(Object.keys(tokens), ['sealed']);
  assert.match(tokens.sealed, /^enc:/);
  assert.equal(r.steps.fetchState.auth.characterName, 'Test', 'the encrypted login still works');
  assert.equal(r.steps.fetchState.auth.configured, true);
  assert.equal(r.steps.fetchState.files.configFile, path.join(userData, 'config.json'));
  assert.deepEqual(
    r.steps.fetchState.settings,
    { marker: 'imported-layout' },
    'the server reads the imported layout',
  );
  if (fs.existsSync(path.join(old, 'data', 'universe.json')))
    assert.equal(r.steps.fetchState.universeReady, true, 'imported star map used');
  assert.equal(r.steps.startAtLogin.enabled, true);
  assert.equal(r.steps.startAtLogin.after, true);
  assert.doesNotMatch(r.logFile, /test-secret/, 'the secret is never logged');
  assert.equal(r.steps.quit.quit, true);
});

test('installed app, first start: start fresh creates config.json from the example', async () => {
  const userData = dir('ud-fresh');
  const r = await run({
    options: {
      isPackaged: true,
      appPath: packagedAppDir(),
      paths: { userData, logs: dir('l2'), documents: tmp },
      messageResponses: [1],
    },
    args: ['--port=4796'],
    steps: ['fetchState', 'quit'],
  });
  assert.equal(r.url, 'http://localhost:4796/', r.output);
  assert.equal(
    fs.readFileSync(path.join(userData, 'config.json'), 'utf8'),
    fs.readFileSync(path.join(HUD, 'config.example.json'), 'utf8'),
  );
  assert.equal(r.steps.fetchState.files.dataDir, path.join(userData, 'data'));
});

test('installed app, first start: Quit leaves without starting anything', async () => {
  const r = await run({
    options: {
      isPackaged: true,
      appPath: packagedAppDir(),
      paths: { userData: dir('ud-quit'), logs: dir('l3'), documents: tmp },
      messageResponses: [2],
    },
  });
  assert.equal(r.windows, 0);
  assert.equal(r.quit, true);
});

test('port taken by another EVE HUD: clear message, then Quit or Show the running HUD', async () => {
  const other = spawn(process.execPath, [path.join(APP, 'test', 'run-server.js'), '--demo', '--port=4793'], {
    stdio: 'ignore',
  });
  try {
    await waitForPort(4793);
    const quit = await run({ args: ['--demo', '--port=4793'], options: { messageResponses: [2] } });
    assert.equal(quit.dialogs[0].message, 'Another EVE HUD is already running on port 4793', quit.output);
    assert.match(quit.dialogs[0].detail, /demo mode/);
    assert.equal(quit.windows, 0);
    assert.equal(quit.quit, true);

    const use = await run({
      args: ['--demo', '--port=4793'],
      options: { messageResponses: [1] },
      steps: ['trayLabels', 'quit'],
    });
    assert.equal(use.url, 'http://localhost:4793/');
    assert.match(use.steps.trayLabels[0], /already running/);
  } finally {
    other.kill();
  }
});

test('port taken by some other program: says so, Try again works once it is free', async () => {
  const blocker = net.createServer((s) => s.end('not http')).listen(4794, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  // first answer "Try again" while blocked, then the blocker goes away, second "Try again" succeeds
  setTimeout(() => blocker.close(), 1500);
  const r = await run({
    args: ['--demo', '--port=4794'],
    options: { messageResponses: [0, 0, 0, 0, 0, 0], dialogDelayMs: 400 },
    steps: ['quit'],
  });
  assert.equal(r.dialogs[0].message, 'Port 4794 is used by another program', r.output);
  assert.match(r.dialogs[0].detail, /callbackUrl/);
  assert.equal(r.url, 'http://localhost:4794/');
});

test('damaged config.json: the reset window; closing it changes nothing', async () => {
  const home = dir('broken');
  fs.writeFileSync(path.join(home, 'config.json'), '{ "clientId": ');
  const r = await run({ args: [`--data-dir=${home}`], options: { recovery: 'close' } });
  assert.equal(r.recoveryPages, 1, r.output);
  assert.equal(r.relaunched, false);
  assert.equal(r.quit, true);
  assert.ok(fs.existsSync(path.join(home, 'config.json')), 'nothing deleted without the button');
  assert.match(r.logFile, /Damaged configuration file: .*config\.json \(not valid JSON\)/);
});

test('damaged settings: Reset deletes every configuration file (caches stay) and restarts like a first start', async () => {
  const home = dir('broken-reset');
  fs.mkdirSync(path.join(home, 'data'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), '{ "clientId": "x" }');
  fs.writeFileSync(path.join(home, 'data', 'settings.json'), '');
  fs.writeFileSync(path.join(home, 'data', 'tokens.json'), '{ "a": 1 }');
  fs.writeFileSync(path.join(home, 'data', 'universe.json'), '{ "systems": [] }');
  const r = await run({ args: [`--data-dir=${home}`], options: { recovery: 'reset' } });
  assert.equal(r.recoveryPages, 1, r.output);
  assert.equal(r.relaunched, true);
  assert.ok(!fs.existsSync(path.join(home, 'config.json')), 'config.json deleted');
  assert.ok(!fs.existsSync(path.join(home, 'data', 'settings.json')));
  assert.ok(!fs.existsSync(path.join(home, 'data', 'tokens.json')), 'logged out');
  assert.ok(fs.existsSync(path.join(home, 'data', 'universe.json')), 'the star map stays');
});

test('only one instance: a second start quits at once', async () => {
  const r = await run({ options: { lock: false } });
  assert.equal(r.windows, 0);
  assert.equal(r.quit, true);
});

function waitForPort(port, ms = 8000) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1', () => {
        s.end();
        resolve();
      });
      s.on('error', () =>
        Date.now() > end ? reject(new Error('port never opened')) : setTimeout(tryOnce, 100),
      );
    };
    tryOnce();
  });
}

test('Mac: no menu bar icon but a Settings menu; no developer tools, no second full-screen item; F12 only from source', async () => {
  const mac = await run({
    options: { platform: 'darwin' },
    args: ['--demo', '--port=4797'],
    steps: ['menu', 'f12', 'quit'],
  });
  const menu = mac.steps.menu;
  assert.ok(
    menu.includes('EVE HUD') &&
      menu.includes('About EVE HUD') &&
      menu.includes('editMenu') &&
      menu.includes('windowMenu'),
    JSON.stringify(menu),
  );
  assert.ok(!menu.includes('about'), "our own About (the HUD window), not Electron's standard panel");
  assert.ok(menu.includes('Reload') && menu.includes('zoomIn'));
  assert.ok(
    !menu.includes('viewMenu') && !menu.includes('toggleDevTools') && !menu.includes('togglefullscreen'),
    JSON.stringify(menu),
  );
  assert.equal(mac.steps.trayIcon, false, 'no icon in the Mac menu bar');
  assert.deepEqual(mac.steps.settings.filter((x) => x !== 'separator').slice(1), [
    'Move to monitor',
    'Open config file',
    'Open data folder',
    'Open log file',
    'Import from an existing HUD folder…',
    'Use the graphics card (restart needed)',
    'Open at login',
    'Restart EVE HUD',
  ]);
  assert.ok(
    !mac.steps.settings.some((x) => /full-screen|Normal window|Quit|Show HUD/i.test(x)),
    'those are in View, Window, the Dock and the app menu already',
  );
  assert.ok(
    menu.indexOf('Settings') > menu.indexOf('View') && menu.indexOf('Settings') < menu.indexOf('windowMenu'),
  );
  assert.deepEqual(mac.steps.f12, { opened: true, webPrefDevTools: true }, 'run from source: F12 works');

  const installed = await run({
    options: {
      isPackaged: true,
      appPath: packagedAppDir(),
      paths: { userData: dir('ud-devtools'), logs: dir('l-devtools'), documents: tmp },
      messageResponses: [1],
    },
    args: ['--demo', '--port=4797'],
    steps: ['f12', 'quit'],
  });
  assert.deepEqual(
    installed.steps.f12,
    { opened: false, webPrefDevTools: false },
    'installed app: no developer tools',
  );
});
