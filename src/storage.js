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

import fs from 'node:fs';
import path from 'node:path';

export const POINTER = 'location.json';
export const PENDING = 'location.pending.json';

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
export function checkMove({ from, to }) {
  for (const k of ['configDir', 'dataDir']) {
    if (!to[k] || !path.isAbsolute(to[k]))
      throw new Error(`Choose a full folder path for ${k === 'configDir' ? 'the settings' : 'the data'}.`);
  }
  const moveConfig = !same(from.configDir, to.configDir);
  const moveData = !same(from.dataDir, to.dataDir);
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
export function moveStorage({ userData, from, to }) {
  const { moveConfig, moveData } = checkMove({ from, to });
  const oldConfig = path.join(from.configDir, 'config.json');
  const newConfig = path.join(to.configDir, 'config.json');
  const moved = [];
  // 1. copy and check; on any problem, remove the copies again and leave everything as it was
  try {
    if (moveConfig) {
      fs.mkdirSync(to.configDir, { recursive: true });
      fs.copyFileSync(oldConfig, newConfig, fs.constants.COPYFILE_EXCL);
      moved.push('config.json');
      if (!fs.readFileSync(newConfig).equals(fs.readFileSync(oldConfig)))
        throw new Error('Copying config.json failed: the copy differs.');
    }
    if (moveData) {
      fs.mkdirSync(to.dataDir, { recursive: true });
      moved.push('data');
      if (fs.existsSync(from.dataDir))
        fs.cpSync(from.dataDir, to.dataDir, { recursive: true, errorOnExist: true, force: false });
      const count = (d) => {
        try {
          return fs.readdirSync(d, { recursive: true }).length;
        } catch {
          return 0;
        }
      };
      if (count(to.dataDir) < count(from.dataDir))
        throw new Error('Copying the data folder failed: files are missing in the copy.');
    }
  } catch (err) {
    if (moved.includes('config.json')) fs.rmSync(newConfig, { force: true });
    if (moved.includes('data')) fs.rmSync(to.dataDir, { recursive: true, force: true });
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
  // 3. remove the old copies
  if (moveConfig) fs.rmSync(oldConfig, { force: true });
  if (moveData) fs.rmSync(from.dataDir, { recursive: true, force: true });
  return moved;
}
