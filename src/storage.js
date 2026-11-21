// SPDX-License-Identifier: GPL-3.0-or-later
// Where config.json and data/ are kept, and moving them (Settings → Storage in the HUD).
//
// Default: both in the app's own folder (Windows %APPDATA%\EVE HUD, macOS ~/Library/Application
// Support/EVE HUD): config.json there, data/ next to it. Other folders chosen in the HUD are kept in
// location.json in that same app folder, so the app finds them at the next start:
//   { "configDir": "D:\\EVE HUD", "dataDir": "D:\\EVE HUD\\data" }
// --data-dir=PATH or EVE_HUD_HOME still win (config.json in PATH, data/ in PATH/data); the HUD then
// shows the folders but can't change them.
//
// Moving happens at the next start, before the HUD server runs (so nothing writes to the old folder
// meanwhile): the HUD asks, checkMove() checks the folders, the request goes into
// location.pending.json, the app restarts, and main.js calls moveStorage(). Moving copies the files
// first, checks them, and only then removes the old ones. It refuses a folder that already holds a
// config.json or HUD data, so nothing gets overwritten.
//
// Only EVE HUD's own files move: config.json and the files in DATA_FILES, by name. Anything else
// in those folders (your own files) is never copied, moved or deleted, and a folder is only removed
// when it is empty.

import fs from 'node:fs';
import path from 'node:path';

export const POINTER = 'location.json';
export const PENDING = 'location.pending.json';

// Every file EVE HUD keeps in its data folder (test/hud.test.js checks this against the HUD code).
// debug/: only with "debugDumps" in config.json (lib/feeds/shapes.js).
export const DEBUG_DUMPS = [
  'feeds-status',
  'hazards',
  'industry',
  'meta-status',
  'notifications',
  'objectives',
  'sovereignty',
];
export const DATA_FILES = [
  'settings.json',
  'settings-demo.json',
  'tokens.json',
  'window-state.json',
  'universe.json',
  'typenames.json',
  'items.jsonl',
  'statics.json',
  'names.json',
  'killmails.json',
  ...DEBUG_DUMPS.map((n) => `debug/${n}.json`),
];

// EVE HUD's own files in a data folder (relative paths), as far as they're there
export function ownDataFiles(dataDir) {
  return DATA_FILES.filter((f) => {
    try {
      return fs.lstatSync(path.join(dataDir, f)).isFile();
    } catch {
      return false;
    }
  });
}

// The folder the app is installed in (updated with every new version): no place for config.json or data/
export function programFolder(platform, exe) {
  const i = platform === 'darwin' ? exe.indexOf('.app/') : -1;
  return i > 0 ? exe.slice(0, i + 4) : path.dirname(exe);
}

export function readPointer(userData) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(userData, POINTER), 'utf8'));
    return {
      configDir: typeof p.configDir === 'string' && path.isAbsolute(p.configDir) ? p.configDir : null,
      dataDir: typeof p.dataDir === 'string' && path.isAbsolute(p.dataDir) ? p.dataDir : null,
    };
  } catch {
    return { configDir: null, dataDir: null };
  }
}

// Where things are now. home: from --data-dir / EVE_HUD_HOME (paths.js), or null.
export function resolveLocations({ userData, home = null }) {
  const defaults = { configDir: userData, dataDir: path.join(userData, 'data') };
  if (home) return { configDir: home, dataDir: path.join(home, 'data'), defaults, fixed: true };
  const p = readPointer(userData);
  const configDir = p.configDir || defaults.configDir;
  return { configDir, dataDir: p.dataDir || path.join(configDir, 'data'), defaults, fixed: false };
}

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
const nonEmpty = (dir) => {
  try {
    return fs.readdirSync(dir).some((f) => !f.startsWith('.'));
  } catch {
    return false;
  }
};

// Throws with a readable message when `to` can't be used. Returns what would move.
// installDir: programFolder() in the installed app (null when started with npm start).
export function checkMove({ from, to, installDir = null }) {
  for (const k of ['configDir', 'dataDir']) {
    if (!to[k] || !path.isAbsolute(to[k]))
      throw new Error(`Choose a full folder path for ${k === 'configDir' ? 'the settings' : 'the data'}.`);
  }
  const moveConfig = !same(from.configDir, to.configDir);
  const moveData = !same(from.dataDir, to.dataDir);
  for (const [k, moving] of [
    ['configDir', moveConfig],
    ['dataDir', moveData],
  ]) {
    if (moving && installDir && (same(to[k], installDir) || inside(to[k], installDir)))
      throw new Error(
        `${to[k]} is inside EVE HUD's program folder, which is updated with every new version of EVE HUD. Choose another folder.`,
      );
  }
  if (moveData && (inside(to.dataDir, from.dataDir) || inside(from.dataDir, to.dataDir))) {
    throw new Error("The new data folder can't be inside the old one (or the other way round).");
  }
  const newConfig = path.join(to.configDir, 'config.json');
  if (moveConfig && fs.existsSync(newConfig))
    throw new Error(
      `${to.configDir} already has a config.json. Choose another folder, or remove that file first.`,
    );
  if (moveData && nonEmpty(to.dataDir))
    throw new Error(`${to.dataDir} isn't empty. Choose an empty or new folder for the data.`);
  return { moveConfig, moveData };
}

export function requestMove(userData, to) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, PENDING),
    `${JSON.stringify({ configDir: to.configDir, dataDir: to.dataDir }, null, 2)}\n`,
  );
}
export function takePendingMove(userData) {
  const file = path.join(userData, PENDING);
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { configDir: String(p.configDir || ''), dataDir: String(p.dataDir || '') };
  } catch {
    return null;
  } finally {
    fs.rmSync(file, { force: true }); // one try only
  }
}

// Moves config.json and/or data/ from `from` to `to` ({ configDir, dataDir } each) and records the
// new place in location.json. Returns the list of what moved. Throws with a readable message when
// a folder can't be used (then nothing changed).
export function moveStorage({ userData, from, to, installDir = null }) {
  const { moveConfig, moveData } = checkMove({ from, to, installDir });
  const oldConfig = path.join(from.configDir, 'config.json');
  const newConfig = path.join(to.configDir, 'config.json');
  const files = moveData ? ownDataFiles(from.dataDir) : [];
  const moved = [moveConfig && 'config.json', moveData && 'data'].filter(Boolean);
  // 1. copy and check; on any problem, remove the copies (only those) and the folders this move
  // made (only when empty), and leave everything as it was
  const copies = [];
  const madeDirs = [];
  const makeDir = (dir) => {
    const missing = [];
    for (let d = path.resolve(dir); !fs.existsSync(d) && d !== path.dirname(d); d = path.dirname(d))
      missing.unshift(d);
    fs.mkdirSync(dir, { recursive: true });
    madeDirs.push(...missing);
  };
  const copy = (src, dst, name) => {
    makeDir(path.dirname(dst));
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL); // never over an existing file
    copies.push(dst);
    if (!fs.readFileSync(dst).equals(fs.readFileSync(src)))
      throw new Error(`Copying ${name} failed: the copy differs.`);
  };
  try {
    if (moveConfig) copy(oldConfig, newConfig, 'config.json');
    if (moveData) {
      makeDir(to.dataDir);
      for (const f of files) copy(path.join(from.dataDir, f), path.join(to.dataDir, f), f);
    }
  } catch (err) {
    for (const f of copies.reverse()) fs.rmSync(f, { force: true });
    for (const d of madeDirs.reverse()) removeIfEmpty(d);
    throw err;
  }
  // 2. remember the new place (location.json lives in the app folder, which never moves)
  const pointer = path.join(userData, POINTER);
  const isDefault = same(to.configDir, userData) && same(to.dataDir, path.join(userData, 'data'));
  fs.mkdirSync(userData, { recursive: true });
  if (isDefault) fs.rmSync(pointer, { force: true });
  else
    fs.writeFileSync(
      pointer,
      `${JSON.stringify({ configDir: to.configDir, dataDir: to.dataDir }, null, 2)}\n`,
    );
  // 3. remove the old copies: only the files that were copied, then the folders if nothing else is
  // left in them
  if (moveConfig) fs.rmSync(oldConfig, { force: true });
  if (moveData) {
    for (const f of files) fs.rmSync(path.join(from.dataDir, f), { force: true });
    removeIfEmpty(path.join(from.dataDir, 'debug'));
    removeIfEmpty(from.dataDir);
  }
  return moved;
}

// fs.rmdirSync only removes an empty folder; anything still in it keeps the folder where it is
function removeIfEmpty(dir) {
  try {
    fs.rmdirSync(dir);
  } catch {
    /* not empty, or not there */
  }
}
