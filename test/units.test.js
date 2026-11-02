// SPDX-License-Identifier: GPL-3.0-or-later
// Unit tests for the parts that don't need Electron at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setWindowMode } from '../src/config-edit.js';
import { findImportSource, importInto, DATA_FILES } from '../src/importer.js';
import { hudHomeDir } from '../src/paths.js';
import { isAllowedRequest, SESSION_PARTITION } from '../src/privacy.js';
import { readUseGpu, writeUseGpu, OPTIONS_FILE } from '../src/gpu.js';
import { createGameLogs, gamelogDirFor } from '../hud/lib/gamelogs.js';
import { chatDirFor, logsRootFor, configuredLogsDir } from '../hud/lib/chatlogs.js';
import { configFiles, findDamaged, resetConfig, recoveryPage } from '../src/recovery.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUD = path.join(APP, 'hud');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-app-unit-'));

// window.js imports 'electron': npm test loads the stand-in (test/fake-electron/register.js)
const { initialPlacement, centredOn, pickDisplay } = await import('../src/window.js');

const write = (name, text) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, text);
  return f;
};

test('setWindowMode: changes only the mode value in the example config', () => {
  const example = fs.readFileSync(path.join(HUD, 'config.example.json'), 'utf8');
  const f = write('a.json', example);
  assert.equal(setWindowMode(f, 'fullscreen'), true);
  const out = fs.readFileSync(f, 'utf8');
  assert.equal(JSON.parse(out).window.mode, 'fullscreen');
  assert.equal(out.replace('"mode": "fullscreen"', '"mode": "normal"'), example);
  assert.equal(setWindowMode(f, 'fullscreen'), false, 'no write when unchanged');
});

test('setWindowMode: adds the key when missing, keeps other formatting', () => {
  const text = '{\n    "clientId": "x",\n    "refresh": { "status":  { "min": 30, "max": 120 } }\n}\n';
  const f = write('b.json', text);
  setWindowMode(f, 'fullscreen');
  const out = fs.readFileSync(f, 'utf8');
  assert.deepEqual(JSON.parse(out), {
    window: { mode: 'fullscreen' },
    clientId: 'x',
    refresh: { status: { min: 30, max: 120 } },
  });
  assert.ok(out.includes('"status":  { "min": 30'), 'odd spacing kept');
  assert.ok(out.startsWith('{\n    "window": { "mode": "fullscreen" },\n    "clientId"'));
});

test('setWindowMode: "window" without mode, empty object, empty file object', () => {
  const f1 = write('c.json', '{ "window": { "display": "portrait" }, "port": 4747 }');
  setWindowMode(f1, 'normal');
  assert.deepEqual(JSON.parse(fs.readFileSync(f1, 'utf8')), {
    window: { mode: 'normal', display: 'portrait' },
    port: 4747,
  });
  const f2 = write('d.json', '{ "window": {} }');
  setWindowMode(f2, 'fullscreen');
  assert.deepEqual(JSON.parse(fs.readFileSync(f2, 'utf8')), { window: { mode: 'fullscreen' } });
  const f3 = write('e.json', '{}');
  setWindowMode(f3, 'fullscreen');
  assert.deepEqual(JSON.parse(fs.readFileSync(f3, 'utf8')), { window: { mode: 'fullscreen' } });
});

test('setWindowMode: leaves a broken file alone', () => {
  const f = write('f.json', '{ "clientId": ');
  assert.throws(() => setWindowMode(f, 'normal'));
  assert.equal(fs.readFileSync(f, 'utf8'), '{ "clientId": ');
});

test('importer: project folder or its data folder; never overwrites unless asked', () => {
  const project = path.join(tmp, 'project');
  fs.mkdirSync(path.join(project, 'data'), { recursive: true });
  fs.writeFileSync(path.join(project, 'config.json'), '{"clientSecret":"s"}');
  fs.writeFileSync(path.join(project, 'data', 'tokens.json'), '{}');
  fs.writeFileSync(path.join(project, 'data', 'universe.json'), '{"u":1}');
  fs.writeFileSync(path.join(project, 'data', 'debug.txt'), 'not copied');

  const src = findImportSource(project);
  assert.deepEqual(src.dataFiles, ['tokens.json', 'universe.json']);
  const fromData = findImportSource(path.join(project, 'data'));
  assert.equal(
    fromData.configFile,
    path.join(project, 'config.json'),
    'config.json found next to the data folder',
  );

  const home = path.join(tmp, 'home');
  assert.deepEqual(importInto(src, home), ['config.json', 'data/tokens.json', 'data/universe.json']);
  fs.writeFileSync(path.join(home, 'data', 'universe.json'), '{"u":2}');
  assert.deepEqual(importInto(src, home), [], 'existing files kept');
  assert.equal(fs.readFileSync(path.join(home, 'data', 'universe.json'), 'utf8'), '{"u":2}');
  assert.deepEqual(importInto(src, home, { overwrite: true }), [
    'config.json',
    'data/tokens.json',
    'data/universe.json',
  ]);
  assert.equal(fs.readFileSync(path.join(home, 'data', 'universe.json'), 'utf8'), '{"u":1}');
  assert.ok(!fs.existsSync(path.join(home, 'data', 'debug.txt')));
  assert.ok(DATA_FILES.includes('typenames.json'));
});

test('importer: an empty folder has nothing to import', () => {
  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  assert.equal(findImportSource(empty), null);
});

test('paths: one home folder for npm start and the installed app; --data-dir / EVE_HUD_HOME override it', () => {
  assert.equal(hudHomeDir({ argv: [], env: {}, userData: '/ud' }), '/ud');
  assert.equal(
    hudHomeDir({ argv: ['--data-dir=/x'], env: { EVE_HUD_HOME: '/y' }, userData: '/ud' }),
    path.resolve('/x'),
  );
  assert.equal(hudHomeDir({ argv: [], env: { EVE_HUD_HOME: '/y' }, userData: '/ud' }), path.resolve('/y'));
});

const main = {
  id: 1,
  bounds: { x: 0, y: 0, width: 2560, height: 1440 },
  workArea: { x: 0, y: 0, width: 2560, height: 1400 },
};
const portrait = {
  id: 2,
  bounds: { x: 2560, y: 0, width: 1200, height: 1920 },
  workArea: { x: 2560, y: 0, width: 1200, height: 1920 },
};

test('placement: first start fills a portrait monitor; on a landscape one 1600×900, inside the taskbar / Dock', () => {
  assert.deepEqual(initialPlacement([main, portrait], main, { display: 'last' }, {}).bounds, {
    x: 2560,
    y: 0,
    width: 1200,
    height: 1920,
  });
  const p = initialPlacement([main, portrait], main, { display: 'primary' }, {});
  assert.equal(p.display.id, 1);
  assert.deepEqual(p.bounds, { x: 480, y: 250, width: 1600, height: 900 });
  // 1920×1080 with a 40 px Windows taskbar at the bottom
  const fullHd = {
    id: 3,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  };
  assert.deepEqual(centredOn(fullHd), { x: 160, y: 70, width: 1600, height: 900 });
  // a MacBook: 1440×900 with the menu bar (25 px) and the Dock (60 px)
  const mac = {
    id: 4,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 25, width: 1440, height: 815 },
  };
  const m = centredOn(mac);
  assert.ok(
    m.width <= 1440 * 0.9 && m.height <= 815 * 0.9 && m.y >= 25 && m.y + m.height <= 840,
    JSON.stringify(m),
  );
  assert.equal(Math.round((m.width / m.height) * 100), Math.round((16 / 9) * 100), 'keeps 16:9');
});

test('placement: remembered position is used, unless its monitor is gone', () => {
  const state = { bounds: { x: 2600, y: 100, width: 1000, height: 1500 }, displayId: 2 };
  assert.deepEqual(initialPlacement([main, portrait], main, { display: 'last' }, state).bounds, state.bounds);
  const gone = initialPlacement([main], main, { display: 'last' }, state);
  assert.equal(gone.display.id, 1);
  assert.deepEqual(
    gone.bounds,
    { x: 780, y: 0, width: 1000, height: 1400 },
    'same width, clamped and centred on the remaining monitor',
  );
  assert.equal(pickDisplay([main, portrait], main, { display: 'portrait' }, state).id, 2);
});

test('privacy: the window only loads the HUD and EVE servers, over https', () => {
  const hud = 'http://localhost:4747';
  const ok = (u) => isAllowedRequest(u, hud);
  assert.ok(!SESSION_PARTITION.startsWith('persist:'), 'in-memory session');
  for (const u of [
    `${hud}/`,
    `${hud}/api/state`,
    'https://images.evetech.net/types/587/icon',
    'https://esi.evetech.net/latest/',
    'https://login.eveonline.com/',
    'https://www.eveonline.com/',
    'data:image/png;base64,AA',
    'blob:http://localhost:4747/x',
  ])
    assert.ok(ok(u), u);
  for (const u of [
    'https://fonts.googleapis.com/',
    'https://zkillboard.com/',
    'https://evetech.net.evil.com/',
    'https://evil-evetech.net/',
    'http://images.evetech.net/x',
    'http://localhost:4748/',
    'http://127.0.0.1:4747/',
    'file:///etc/passwd',
    'ftp://esi.evetech.net/',
    'not a url',
  ])
    assert.ok(!ok(u), u);
});

test('storage: default folders, a chosen place via location.json, --data-dir wins', async () => {
  const { resolveLocations } = await import('../src/storage.js');
  const ud = path.join(tmp, 'st-ud');
  fs.mkdirSync(ud, { recursive: true });
  assert.deepEqual(resolveLocations({ userData: ud }), {
    configDir: ud,
    dataDir: path.join(ud, 'data'),
    defaults: { configDir: ud, dataDir: path.join(ud, 'data') },
    fixed: false,
  });
  fs.writeFileSync(
    path.join(ud, 'location.json'),
    JSON.stringify({ configDir: '/x/cfg', dataDir: '/y/data' }),
  );
  const w = resolveLocations({ userData: ud });
  assert.equal(w.configDir, '/x/cfg');
  assert.equal(w.dataDir, '/y/data');
  assert.equal(resolveLocations({ userData: ud, home: '/z' }).fixed, true);
  fs.writeFileSync(path.join(ud, 'location.json'), '{ broken');
  assert.equal(
    resolveLocations({ userData: ud }).configDir,
    ud,
    'a broken location.json falls back to the default',
  );
});

test('storage: moving copies, checks, records the place and removes the old files; refuses occupied folders', async () => {
  const { resolveLocations, checkMove, requestMove, takePendingMove, moveStorage } =
    await import('../src/storage.js');
  const ud = path.join(tmp, 'mv-ud');
  fs.mkdirSync(path.join(ud, 'data', 'debug'), { recursive: true });
  fs.writeFileSync(path.join(ud, 'config.json'), '{"clientId":"enc:abc"}');
  fs.writeFileSync(path.join(ud, 'data', 'tokens.json'), '{"sealed":"enc:x"}');
  fs.writeFileSync(path.join(ud, 'data', 'debug', 'feeds-status.json'), '{}');
  const from = resolveLocations({ userData: ud });
  const to = { configDir: path.join(tmp, 'mv-new'), dataDir: path.join(tmp, 'mv-new', 'data') };

  // occupied targets are refused before anything happens
  fs.mkdirSync(path.join(tmp, 'busy'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'busy', 'config.json'), '{}');
  assert.throws(
    () => checkMove({ from, to: { ...to, configDir: path.join(tmp, 'busy') } }),
    /already has a config\.json/,
  );
  assert.throws(() => checkMove({ from, to: { ...to, dataDir: path.join(tmp, 'busy') } }), /isn't empty/);
  assert.throws(
    () => checkMove({ from, to: { ...to, dataDir: path.join(ud, 'data', 'sub') } }),
    /inside the old one/,
  );
  assert.throws(() => checkMove({ from, to: { ...to, configDir: 'relative/path' } }), /full folder path/);

  // asked for in the HUD, done at the next start
  requestMove(ud, to);
  const pending = takePendingMove(ud);
  assert.deepEqual(pending, to);
  assert.equal(takePendingMove(ud), null, 'one try only');
  assert.deepEqual(moveStorage({ userData: ud, from, to: pending }), ['config.json', 'data']);
  assert.equal(fs.readFileSync(path.join(to.configDir, 'config.json'), 'utf8'), '{"clientId":"enc:abc"}');
  assert.ok(
    fs.existsSync(path.join(to.dataDir, 'tokens.json')) &&
      fs.existsSync(path.join(to.dataDir, 'debug', 'feeds-status.json')),
  );
  assert.ok(
    !fs.existsSync(path.join(ud, 'config.json')) && !fs.existsSync(path.join(ud, 'data')),
    'old copies removed',
  );
  assert.deepEqual(resolveLocations({ userData: ud }).configDir, to.configDir, 'remembered in location.json');

  // and back to the default folders: location.json goes away again
  const now = resolveLocations({ userData: ud });
  moveStorage({ userData: ud, from: now, to: now.defaults });
  assert.ok(fs.existsSync(path.join(ud, 'config.json')) && !fs.existsSync(path.join(ud, 'location.json')));
});

test('Use the graphics card: on by default, saved in app-options.json, keeps other keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evehud-gpu-'));
  assert.equal(readUseGpu(dir), true, 'no file: on');
  fs.writeFileSync(path.join(dir, OPTIONS_FILE), '{ "other": 1 }');
  writeUseGpu(dir, false);
  assert.equal(readUseGpu(dir), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, OPTIONS_FILE), 'utf8')), {
    other: 1,
    useGpu: false,
  });
  writeUseGpu(dir, true);
  assert.equal(readUseGpu(dir), true);
  fs.writeFileSync(path.join(dir, OPTIONS_FILE), 'not json');
  assert.equal(readUseGpu(dir), true, 'a broken file counts as on');
});

test('game logs: combat starts on a new (combat) line and ends after the idle time', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamelogs-'));
  const chat = path.join(root, 'Chatlogs');
  const games = path.join(root, 'Gamelogs');
  fs.mkdirSync(chat);
  fs.mkdirSync(games);
  assert.equal(gamelogDirFor(chat), games);
  assert.equal(gamelogDirFor(root), games);
  const file = path.join(games, '20261102_190000_123.txt');
  const stamp = (t) => {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `[ ${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ]`;
  };
  let clock = Date.UTC(2026, 10, 2, 19, 0, 0);
  // an old combat line already in the file doesn't count
  fs.writeFileSync(file, `------\n${stamp(clock - 5000)} (combat) <b>12</b> from Guristas - Hits\n`);
  const events = [];
  const g = createGameLogs(
    { combatIdleSeconds: 15 },
    {
      chatDir: chat,
      getCharacterId: () => 123,
      onCombat: (c) => events.push(c.active),
      log: {},
      now: () => clock,
    },
  );
  g.scan();
  g.poll();
  assert.deepEqual(events, []);
  fs.appendFileSync(file, `${stamp(clock)} (notify) Nothing here\n`);
  fs.appendFileSync(
    file,
    `${stamp(clock)} (combat) <color=0xffccff66><b>125</b><color=0x77ffffff><font size=10> remote shield boosted by </font><b>Ana Fleetmate</b>\n`,
  );
  g.poll();
  assert.deepEqual(events, []);
  fs.appendFileSync(file, `${stamp(clock)} (combat) <b>32</b> to Guristas Arrogator - Hobgoblin I - Hits\n`);
  g.poll();
  assert.deepEqual(events, [true]);
  clock += 10_000;
  g.poll();
  assert.deepEqual(events, [true]);
  clock += 6_000;
  g.poll();
  assert.deepEqual(events, [true, false]);
  assert.equal(g.status().active, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('damaged configuration files are found; a reset deletes them all, caches stay', () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-'));
  const where = { configDir: ud, dataDir: path.join(ud, 'data'), fixed: false };
  fs.mkdirSync(where.dataDir);
  const files = configFiles({ userData: ud, where });
  assert.ok(files.includes(path.join(ud, 'config.json')) && files.includes(path.join(ud, 'location.json')));
  assert.ok(
    !configFiles({ userData: ud, where: { ...where, fixed: true } }).includes(path.join(ud, 'location.json')),
  );
  fs.writeFileSync(path.join(ud, 'config.json'), '\uFEFF{ "port": 4747 }');
  fs.writeFileSync(path.join(where.dataDir, 'settings.json'), '{"grid": ');
  fs.writeFileSync(path.join(where.dataDir, 'tokens.json'), '   ');
  fs.writeFileSync(path.join(ud, 'app-options.json'), '[1, 2]');
  fs.writeFileSync(path.join(where.dataDir, 'universe.json'), 'not json, but a cache');
  fs.writeFileSync(path.join(where.dataDir, 'window-state.json'), 'null');
  assert.deepEqual(
    findDamaged(files).map((d) => [path.basename(d.file), d.problem]),
    [
      ['settings.json', 'not valid JSON'],
      ['tokens.json', 'empty'],
      ['app-options.json', 'not a JSON object'],
    ],
  );
  assert.match(recoveryPage(findDamaged(files)), /settings\.json<\/code><span>not valid JSON/);
  assert.equal(resetConfig(files).length, 5);
  assert.deepEqual(findDamaged(files), []);
  assert.ok(fs.existsSync(path.join(where.dataDir, 'universe.json')));
  fs.rmSync(ud, { recursive: true, force: true });
});

test('EVE logs folder: the logs folder, Chatlogs or Gamelogs all read the chat from Chatlogs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evelogs-'));
  fs.mkdirSync(path.join(root, 'Chatlogs'));
  fs.mkdirSync(path.join(root, 'Gamelogs'));
  assert.equal(chatDirFor(root), path.join(root, 'Chatlogs'));
  assert.equal(chatDirFor(path.join(root, 'Chatlogs')), path.join(root, 'Chatlogs'));
  assert.equal(chatDirFor(path.join(root, 'Gamelogs')), path.join(root, 'Chatlogs'));
  assert.equal(chatDirFor(''), '');
  assert.equal(logsRootFor('/Volumes/evelogs/Marketlogs/'), '/Volumes/evelogs');
  assert.equal(logsRootFor('/Volumes/evelogs'), '/Volumes/evelogs');
  assert.equal(
    configuredLogsDir({ eveLogDir: '', chatLogDir: '/Volumes/evelogs/Chatlogs' }),
    '/Volumes/evelogs',
    'an older chatLogDir still works',
  );
  assert.equal(gamelogDirFor(path.join(root, 'Chatlogs')), path.join(root, 'Gamelogs'));
  // game logs that can't be read: reported, and fine again once the folder is there
  const missing = path.join(root, 'elsewhere', 'Chatlogs');
  const health = [];
  const g = createGameLogs({}, { chatDir: missing, onHealth: (x) => health.push(x.ok), log: {} });
  g.scan();
  assert.equal(g.health().ok, false);
  assert.match(g.health().error, /doesn't exist/);
  assert.equal(g.setChatDir(path.join(root, 'Chatlogs')).ok, true);
  assert.deepEqual(health, [false, true]);
  fs.rmSync(root, { recursive: true, force: true });
});
