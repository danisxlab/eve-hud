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
import {
  chatDirFor,
  logsRootFor,
  configuredLogsDir,
  newestCandidates,
  createChatLogs,
} from '../hud/lib/chatlogs.js';
import { createLinker } from '../hud/lib/itemlinks.js';
import { configFiles, findDamaged, resetConfig, recoveryPage } from '../src/recovery.js';
import { buildSite } from '../scripts/build-site.js';
import { createAutostart, autostartDesktopFile } from '../src/autostart.js';
import { readGitCommit, buildCommit } from '../src/build-info.js';
import { frameOptions, frameScript, cornerRadius, TITLEBAR_HEIGHT, FRAME_BORDER } from '../src/window.js';

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
  assert.ok(DATA_FILES.includes('items.jsonl') && DATA_FILES.includes('statics.json'), 'item data');
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

test('storage: only EVE HUD’s own files move or get deleted; your other files stay where they are', async () => {
  const { resolveLocations, checkMove, moveStorage, programFolder } = await import('../src/storage.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-own-'));
  const ud = path.join(root, 'ud');
  const write = (f, text) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  // a data folder that you also put your own files in
  const old = path.join(root, 'old');
  write(path.join(ud, 'config.json'), '{}');
  write(path.join(old, 'tokens.json'), '{"sealed":"enc:x"}');
  write(path.join(old, 'debug', 'industry.json'), '{}');
  write(path.join(old, 'holiday.jpg'), 'photo');
  write(path.join(old, 'debug', 'notes.txt'), 'mine');
  write(path.join(old, 'Documents', 'letter.txt'), 'mine too');
  fs.writeFileSync(path.join(ud, 'location.json'), JSON.stringify({ configDir: ud, dataDir: old }));
  const from = resolveLocations({ userData: ud });
  const to = { configDir: ud, dataDir: path.join(root, 'new') };
  moveStorage({ userData: ud, from, to });
  assert.ok(
    fs.existsSync(path.join(to.dataDir, 'tokens.json')) &&
      fs.existsSync(path.join(to.dataDir, 'debug', 'industry.json')),
  );
  assert.ok(!fs.existsSync(path.join(to.dataDir, 'holiday.jpg')), 'your files are not copied along');
  assert.ok(
    !fs.existsSync(path.join(old, 'tokens.json')) && !fs.existsSync(path.join(old, 'debug', 'industry.json')),
  );
  assert.equal(fs.readFileSync(path.join(old, 'holiday.jpg'), 'utf8'), 'photo', 'your files stay');
  assert.equal(fs.readFileSync(path.join(old, 'debug', 'notes.txt'), 'utf8'), 'mine');
  assert.equal(fs.readFileSync(path.join(old, 'Documents', 'letter.txt'), 'utf8'), 'mine too');

  // a failed copy removes only what the move made: hidden files already in the chosen folder stay
  const back = resolveLocations({ userData: ud });
  const target = path.join(root, 'hidden-only');
  write(path.join(target, '.secret'), 'keep');
  fs.chmodSync(path.join(back.dataDir, 'tokens.json'), 0o000); // can't be read: the copy fails
  const unreadable = (() => {
    try {
      fs.readFileSync(path.join(back.dataDir, 'tokens.json'));
      return false;
    } catch {
      return true;
    }
  })();
  if (unreadable) {
    assert.throws(() => moveStorage({ userData: ud, from: back, to: { configDir: ud, dataDir: target } }));
    assert.equal(fs.readFileSync(path.join(target, '.secret'), 'utf8'), 'keep');
    assert.deepEqual(fs.readdirSync(target), ['.secret'], 'the copies are gone again');
    assert.ok(
      fs.existsSync(path.join(back.dataDir, 'debug', 'industry.json')),
      'nothing removed at the old place',
    );
  }
  fs.chmodSync(path.join(back.dataDir, 'tokens.json'), 0o600);

  // never into the program folder (updated with every new version)
  const exe = path.join(root, 'Programs', 'EVE HUD', 'EVE HUD.exe');
  const installDir = programFolder('win32', exe);
  assert.equal(installDir, path.join(root, 'Programs', 'EVE HUD'));
  assert.equal(
    programFolder('darwin', '/Applications/EVE HUD.app/Contents/MacOS/EVE HUD'),
    '/Applications/EVE HUD.app',
  );
  assert.throws(
    () => checkMove({ from: back, to: { configDir: installDir, dataDir: back.dataDir }, installDir }),
    /program folder/,
  );
  assert.throws(
    () =>
      checkMove({ from: back, to: { configDir: ud, dataDir: path.join(installDir, 'data') }, installDir }),
    /program folder/,
  );
  fs.rmSync(root, { recursive: true, force: true });
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

  // a folder in a file's place: removed only when empty, never emptied
  fs.mkdirSync(path.join(ud, 'config.json'));
  assert.deepEqual(resetConfig(files), [path.join(ud, 'config.json')]);
  fs.mkdirSync(path.join(ud, 'config.json'));
  fs.writeFileSync(path.join(ud, 'config.json', 'mine.txt'), 'mine');
  fs.writeFileSync(path.join(where.dataDir, 'settings.json'), '{}');
  assert.throws(() => resetConfig(files), /doesn't delete/);
  assert.equal(fs.readFileSync(path.join(ud, 'config.json', 'mine.txt'), 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(where.dataDir, 'settings.json')), 'then nothing is deleted');
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

test('game logs: the autopilot, from its log lines (on / off and the next jump)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-'));
  fs.mkdirSync(path.join(root, 'Chatlogs'));
  fs.mkdirSync(path.join(root, 'Gamelogs'));
  const file = path.join(root, 'Gamelogs', '20261102_190000.txt');
  const clock = Date.UTC(2026, 10, 2, 19, 0, 0);
  const at = '[ 2026.11.02 19:00:00 ]';
  fs.writeFileSync(file, '------\n  Gamelog\n');
  const seen = [];
  const g = createGameLogs(
    {},
    {
      chatDir: path.join(root, 'Chatlogs'),
      onAutopilot: (a) => seen.push(`${a.on}:${a.next}`),
      log: {},
      now: () => clock,
    },
  );
  g.scan();
  const add = (line) => {
    fs.appendFileSync(file, `${at} ${line}\n`);
    g.poll();
  };
  add('(notify) Autopilot engaged');
  add('(notify) Autopilot warping to Tiberis');
  add('(notify) Autopilot jumping to Tiberis');
  add('(None) Jumping from Fortitude to Tiberis');
  add('(notify) Autopilot warping to Ligare');
  add('(None) Jumping from Tiberis to Ligare');
  add('(notify) Autopilot warping to Ligare V - University of Caille');
  add('(notify) Autopilot disabled');
  assert.deepEqual(seen, [
    'true:null',
    'true:Tiberis',
    'true:null',
    'true:Ligare',
    'true:null',
    'true:Ligare V - University of Caille',
    'false:null',
  ]);
  assert.deepEqual(g.autopilot(), { on: false, next: null });
  fs.rmSync(root, { recursive: true, force: true });
});

test('website: the documentation and the demo, with only browser code in the demo', () => {
  const out = buildSite(path.join(tmp, 'site'));
  for (const f of [
    'index.html',
    'documentation/index.html',
    'demo/index.html',
    'demo/fake-server.js',
    'hud/public/js/app.js',
    'hud/public/fonts/OFL.txt',
    'LICENSE',
  ])
    assert.ok(fs.existsSync(path.join(out, f)), f);
  const page = fs.readFileSync(path.join(out, 'demo/index.html'), 'utf8');
  // the demo server first, then the HUD; nothing from the server's root
  assert.ok(page.indexOf('src="fake-server.js"') < page.indexOf('src="../hud/public/js/app.js"'));
  assert.doesNotMatch(page, /(?:src|href)="\/(?!\/)/);
  // hud/lib: only what the demo imports, and none of it may need Node.js
  const lib = fs.readdirSync(path.join(out, 'hud/lib')).sort();
  assert.deepEqual(lib, ['demo.js', 'evehtml.js', 'itemlinks.js', 'route.js', 'universe-data.js']);
  for (const f of lib)
    assert.doesNotMatch(fs.readFileSync(path.join(out, 'hud/lib', f), 'utf8'), /from ['"]node:/, f);
  assert.doesNotMatch(
    fs.readFileSync(path.join(HUD, 'public/css/base.css'), 'utf8'),
    /url\('\//,
    'fonts relative to the stylesheet',
  );
  // building again replaces its own folder, but never a folder it didn't make
  buildSite(out);
  const other = fs.mkdtempSync(path.join(tmp, 'other-'));
  fs.writeFileSync(path.join(other, 'keep.txt'), 'x');
  assert.throws(() => buildSite(other), /wasn't made by this script/);
  assert.ok(fs.existsSync(path.join(other, 'keep.txt')));
});

test('start at login on Linux: an autostart .desktop file for the AppImage, removed again', () => {
  const config = fs.mkdtempSync(path.join(tmp, 'xdg-'));
  const a = createAutostart({
    app: { getPath: () => '/opt/EVE HUD/eve-hud' },
    platform: 'linux',
    env: { XDG_CONFIG_HOME: config, APPIMAGE: '/home/me/Apps/EVE HUD-1.0.3-x86_64.AppImage' },
  });
  assert.equal(a.file, path.join(config, 'autostart', 'eve-hud.desktop'));
  assert.equal(a.isOn(), false);
  a.set(true);
  assert.equal(a.isOn(), true);
  assert.match(
    fs.readFileSync(a.file, 'utf8'),
    /^Exec="\/home\/me\/Apps\/EVE HUD-1\.0\.3-x86_64\.AppImage"$/m,
  );
  a.set(false);
  assert.equal(a.isOn(), false);
  // the .deb: the installed program; quotes and $ escaped the freedesktop.org way
  assert.match(autostartDesktopFile('/opt/a "b" $c'), /^Exec="\/opt\/a \\"b\\" \\\$c"$/m);
  // Windows and macOS: Electron's login items
  const calls = [];
  const w = createAutostart({
    app: { getLoginItemSettings: () => ({ openAtLogin: true }), setLoginItemSettings: (x) => calls.push(x) },
    platform: 'win32',
  });
  assert.equal(w.isOn(), true);
  w.set(false);
  assert.deepEqual(calls, [{ openAtLogin: false }]);
});

test('About: the commit the app was built from, from its package.json or the .git folder', () => {
  const sha = '7f18d078b7102cd4612c7ba2ebf4ae170199637a';
  const repo = fs.mkdtempSync(path.join(tmp, 'git-'));
  fs.mkdirSync(path.join(repo, '.git', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(repo, '.git', 'packed-refs'), `# pack-refs\n${sha} refs/heads/main\n`);
  assert.equal(readGitCommit(repo), '7f18d07', 'packed refs');
  fs.writeFileSync(
    path.join(repo, '.git', 'refs', 'heads', 'main'),
    '83fa76bc55ef78bf36848dab7b6c3ffc4f51c75d\n',
  );
  assert.equal(readGitCommit(repo), '83fa76b', 'a loose ref');
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), `${sha}\n`);
  assert.equal(readGitCommit(repo), '7f18d07', 'a detached HEAD');
  assert.equal(readGitCommit(path.join(tmp, 'nowhere')), null);
  // the installed app: package.json's gitCommit (electron-builder.config.cjs) wins
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ gitCommit: 'abcdef1' }));
  assert.equal(buildCommit(repo), 'abcdef1');
});

test('chat links: item and system names become links where the chat is read', () => {
  const linker = createLinker();
  const plain = { text: 'WTS  Damage Control II  and  Tritanium  , convo me' };
  assert.equal(linker.link(plain).parts, undefined, 'no names yet: plain text');
  assert.equal(
    linker.setNames({
      version: 'a',
      items: [
        [2048, 'Damage Control II'],
        [34, 'Tritanium'],
        [1, 'Damage Control'],
      ],
      systems: [[30000142, 'Jita']],
    }),
    true,
  );
  assert.equal(linker.setNames({ version: 'a', items: [], systems: [] }), false, 'the same version: kept');
  // the names came later: the same message gets its links (the longest name wins)
  assert.deepEqual(
    linker.link(plain).parts.filter((p) => p.href),
    [
      { text: 'Damage Control II', href: 'showinfo:2048' },
      { text: 'Tritanium', href: 'showinfo:34' },
    ],
  );
  assert.equal(
    linker
      .link(plain)
      .parts.map((p) => p.text)
      .join(''),
    plain.text,
    'linking again changes nothing',
  );
  // a one-word name only when it stands on its own; a system links to its info
  assert.equal(linker.link({ text: 'going to Jita now' }).parts, undefined);
  assert.deepEqual(linker.link({ text: 'Jita' }).parts, [{ text: 'Jita', href: 'showinfo:5//30000142' }]);
  // a link EVE wrote itself stays, the text around it is still looked at
  const mixed = { text: 'x Tritanium', parts: [{ text: 'x', href: 'showinfo:9' }, { text: '  Tritanium' }] };
  assert.deepEqual(
    linker
      .link(mixed)
      .parts.filter((p) => p.href)
      .map((p) => p.href),
    ['showinfo:9', 'showinfo:34'],
  );
});

test('EVE logs: only the few newest files by name are looked at, and the folder scan can run async', async () => {
  const names = [];
  for (let d = 1; d <= 28; d++) names.push(`Local_202610${String(d).padStart(2, '0')}_180000_42.txt`);
  names.push('Local_20261101_090000_7.txt', 'Local_20261102_090000_7.txt');
  assert.deepEqual(newestCandidates(names, 42), [
    'Local_20261028_180000_42.txt',
    'Local_20261027_180000_42.txt',
    'Local_20261026_180000_42.txt',
    'Local_20261025_180000_42.txt',
  ]);
  assert.deepEqual(newestCandidates(names, 7), [
    'Local_20261102_090000_7.txt',
    'Local_20261101_090000_7.txt',
  ]);
  assert.equal(newestCandidates(names, null).length, 4, 'no character: the newest of all');
  assert.equal(newestCandidates(['a.txt', 'Local_20261028_180000.txt'], null).length, 2, 'no date: all');

  // the periodic (async) scan finds a new session's file, as the scan at the start does
  const root = fs.mkdtempSync(path.join(tmp, 'chatlogs-'));
  const dir = path.join(root, 'Chatlogs');
  fs.mkdirSync(dir);
  const log = (name, line) =>
    fs.writeFileSync(
      path.join(dir, name),
      Buffer.from(`\uFEFF[ 2026.11.12 18:00:00 ] Demo Pilot > ${line}\r\n`, 'utf16le'),
    );
  log('Local_20261112_170000_42.txt', 'first');
  const got = [];
  const chat = createChatLogs(
    { eveLogDir: root, chatChannels: [{ id: 'local', label: 'Local', filePrefix: 'Local' }] },
    { getCharacterId: () => 42, onMessages: (ch, msgs) => got.push(...msgs.map((m) => m.text)), log: {} },
  );
  chat.rescan();
  assert.deepEqual(got, ['first']);
  assert.equal(chat.status().channels[0].file, 'Local_20261112_170000_42.txt');
  log('Local_20261112_180000_42.txt', 'second');
  await chat.scanAsync();
  assert.equal(chat.status().channels[0].file, 'Local_20261112_180000_42.txt');
  assert.deepEqual(got, ['first', 'second']);
  // the look every second (async) reads what EVE wrote since
  fs.appendFileSync(
    path.join(dir, 'Local_20261112_180000_42.txt'),
    Buffer.from('[ 2026.11.12 18:00:05 ] Demo Pilot > third\r\n', 'utf16le'),
  );
  await Promise.all([chat.pollAsync(), chat.pollAsync()]); // two at once: read only once
  assert.deepEqual(got, ['first', 'second', 'third']);
  await chat.pollAsync();
  assert.deepEqual(got, ['first', 'second', 'third'], 'nothing new: nothing read');
});

test('game logs: the look every second (async) reads combat like the direct one', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamelogs-async-'));
  const games = path.join(root, 'Gamelogs');
  fs.mkdirSync(path.join(root, 'Chatlogs'));
  fs.mkdirSync(games);
  const file = path.join(games, '20261102_190000_123.txt');
  let clock = Date.UTC(2026, 10, 2, 19, 0, 0);
  fs.writeFileSync(file, '------\n');
  const events = [];
  const g = createGameLogs(
    { combatIdleSeconds: 15 },
    {
      chatDir: path.join(root, 'Chatlogs'),
      onCombat: (c) => events.push(c.active),
      log: {},
      now: () => clock,
    },
  );
  await g.scanAsync();
  assert.equal(g.status().file, '20261102_190000_123.txt');
  await g.pollAsync();
  assert.deepEqual(events, []);
  fs.appendFileSync(file, '[ 2026.11.02 19:00:00 ] (combat) <b>32</b> to Guristas Arrogator - Hits\n');
  await Promise.all([g.pollAsync(), g.pollAsync()]); // two at once: read only once
  assert.deepEqual(events, [true]);
  clock += 16_000;
  await g.pollAsync();
  assert.deepEqual(events, [true, false]);
  fs.rmSync(path.join(games, '20261102_190000_123.txt'));
  await g.pollAsync(); // the file is gone: no error
  fs.rmSync(root, { recursive: true, force: true });
});

test("title bar: the HUD's own title bar, the window buttons as tall as it, gone in full screen", () => {
  const css = fs.readFileSync(path.join(HUD, 'public/css/base.css'), 'utf8');
  assert.equal(
    `${TITLEBAR_HEIGHT}px`,
    css.match(/html\.titled \{\s*--titlebar-h:\s*([^;]+);/)[1],
    "the same height as the HUD's title bar",
  );
  assert.deepEqual(frameOptions('darwin'), {
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 13, y: 7 }, // the 14 px buttons centred on the 28 px bar
    transparent: true, // no light line along the top edge
    backgroundColor: '#00000000',
  });
  for (const platform of ['win32', 'linux'])
    assert.deepEqual(frameOptions(platform), {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: 'rgba(0, 0, 0, 0)', symbolColor: '#d4d9db', height: 28 },
      // Windows: the system's border in dark green (Linux: the page draws it, frame-line)
      ...(platform === 'win32' ? { accentColor: FRAME_BORDER } : {}),
    });
  assert.equal(
    FRAME_BORDER,
    css.match(/--frame-border:\s*([^;]+);/)[1],
    "the page's window edge (Linux) has the same colour",
  );
  assert.equal(frameOptions('win32', 1.2).titleBarOverlay.height, 34, 'zoomed');
  assert.deepEqual(frameOptions('darwin', 1.2).trafficLightPosition, { x: 13, y: 10 });
  // the classes the page gets (run on a fake page here)
  const classes = new Set();
  const documentElement = {
    classList: { add: (c) => classes.add(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    style: { setProperty() {} },
  };
  new Function('document', frameScript({ titled: true, accents: true, buttonsRight: true }))({
    documentElement,
  });
  assert.deepEqual([...classes].sort(), ['buttons-right', 'corner-accents', 'titled']);
  new Function('document', frameScript({ titled: false, accents: true, buttonsRight: true }))({
    documentElement,
  });
  assert.deepEqual([...classes].sort(), ['buttons-right', 'corner-accents'], 'full screen: no title bar');
  new Function('document', frameScript({ titled: true, accents: false, buttonsRight: false }))({
    documentElement,
  });
  assert.deepEqual([...classes].sort(), ['titled'], 'Mac: no corner accents');
  new Function('document', frameScript({ titled: true, accents: false, buttonsRight: true, line: true }))({
    documentElement,
  });
  assert.deepEqual([...classes].sort(), ['buttons-right', 'frame-line', 'titled'], 'Linux: the edge line');
  // how round the window's corners are, for the corner accents
  assert.equal(cornerRadius('win32', '10.0.22631'), 8, 'Windows 11');
  assert.equal(cornerRadius('win32', '10.0.19045'), 0, 'Windows 10');
  assert.equal(cornerRadius('linux', '6.8.0'), 0);
});

test('Windows uninstaller: removes only EVE HUD’s own program files, then folders only when empty', async () => {
  const { nsisRemoveList, writeUninstallList } = (await import('../scripts/uninstall-files.cjs')).default;
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'win-unpacked-'));
  for (const f of [
    'EVE HUD.exe',
    'ffmpeg.dll',
    'locales/en-US.pak',
    'resources/app.asar',
    'resources/app.asar.unpacked/x/y.node',
    'odd $name "q".txt',
  ]) {
    fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
    fs.writeFileSync(path.join(app, f), '');
  }
  const lines = nsisRemoveList(app).split('\r\n');
  const body = lines.filter((l) => l.startsWith('  '));
  assert.ok(lines.includes('!macro eveHudRemoveProgramFiles') && lines.includes('!macroend'));
  assert.ok(body.includes('  Delete "$INSTDIR\\EVE HUD.exe"'));
  assert.ok(body.includes('  Delete "$INSTDIR\\resources\\app.asar.unpacked\\x\\y.node"'));
  assert.ok(body.includes('  Delete "$INSTDIR\\resources\\elevate.exe"'), 'added by the installer');
  assert.ok(body.includes('  Delete "$INSTDIR\\odd $$name $\\"q$\\".txt"'), '$ and " written the NSIS way');
  // only Delete (files) and RMDir without /r (empty folders), always inside the program folder
  for (const l of body) assert.match(l, /^ {2}(Delete|RMDir) "\$INSTDIR\\[^"]/);
  assert.ok(!body.some((l) => /RMDir \/r|\*/.test(l)), 'no /r and no wildcards');
  const rmdirs = body
    .filter((l) => l.startsWith('  RMDir'))
    .map((l) => l.slice('  RMDir "$INSTDIR\\'.length, -1));
  assert.deepEqual(rmdirs, [
    'resources\\app.asar.unpacked\\x',
    'resources\\app.asar.unpacked',
    'locales',
    'resources',
  ]);
  assert.ok(
    body.indexOf('  RMDir "$INSTDIR\\locales"') > body.findLastIndex((l) => l.startsWith('  Delete')),
  );
  // the program folder itself only when empty (build/installer.nsh), and the list is read from
  // where electron-builder.config.cjs writes it
  const nsh = fs.readFileSync(path.join(APP, 'build', 'installer.nsh'), 'utf8');
  assert.match(nsh, /!include "\$\{PROJECT_DIR\}\/dist\/uninstall-files\.nsh"/);
  assert.match(
    nsh,
    /!macro customRemoveFiles[\s\S]*eveHudRemoveProgramFiles[\s\S]*RMDir "\$INSTDIR" ;[\s\S]*!macroend/,
  );
  assert.ok(!/RMDir \/r "\$INSTDIR/.test(nsh), 'never the whole program folder');
  const config = (await import('../electron-builder.config.cjs')).default;
  assert.equal(config.directories.output, 'dist');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
  config.afterPack({ electronPlatformName: 'win32', appOutDir: app, outDir: out });
  assert.equal(fs.readFileSync(path.join(out, 'uninstall-files.nsh'), 'utf8'), nsisRemoveList(app));
  config.afterPack({ electronPlatformName: 'darwin', appOutDir: app, outDir: path.join(out, 'mac') });
  assert.ok(!fs.existsSync(path.join(out, 'mac')), 'only for Windows builds');
  assert.throws(() => nsisRemoveList(out), /not a built Windows app/);
  writeUninstallList(app, path.join(out, 'again.nsh'));
  fs.rmSync(app, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});
