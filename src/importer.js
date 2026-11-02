// SPDX-License-Identifier: GPL-3.0-or-later
// Importing an existing EVE HUD folder into the app's own folder, so you keep your EVE login,
// layout and star map instead of logging in and downloading the map again.
//
// Copied (when present): config.json, and from data/: tokens.json (the EVE login), universe.json
// + typenames.json (star map and item names; without typenames.json the map is downloaded again),
// settings.json + settings-demo.json (layout and appearance) and names.json (name cache).
// Files are copied byte for byte and never read or logged: config.json and tokens.json are secret.

import fs from 'node:fs';
import path from 'node:path';

export const DATA_FILES = [
  'tokens.json',
  'universe.json',
  'typenames.json',
  'settings.json',
  'settings-demo.json',
  'names.json',
];

// Works out what a chosen folder contains. Accepts the HUD project folder (config.json and/or
// data/) or its data/ folder itself. Returns null when there is nothing to import.
export function findImportSource(dir) {
  const has = (...p) => fs.existsSync(path.join(dir, ...p));
  let configFile = null;
  let dataDir = null;
  if (has('config.json')) configFile = path.join(dir, 'config.json');
  if (has('data') && fs.statSync(path.join(dir, 'data')).isDirectory()) dataDir = path.join(dir, 'data');
  else if (DATA_FILES.some((f) => has(f))) {
    dataDir = dir; // the data folder itself was picked
    if (!configFile && fs.existsSync(path.join(dir, '..', 'config.json')))
      configFile = path.join(dir, '..', 'config.json');
  }
  const dataFiles = dataDir ? DATA_FILES.filter((f) => fs.existsSync(path.join(dataDir, f))) : [];
  if (!configFile && !dataFiles.length) return null;
  return { dir, configFile, dataDir, dataFiles };
}

// Copies what findImportSource found into home (config.json) and home/data. Existing files are
// only replaced with overwrite: true. Returns the copied paths, relative to home.
export function importInto(source, home, { overwrite = false, dataDir = null } = {}) {
  const dataHome = dataDir || path.join(home, 'data');
  fs.mkdirSync(dataHome, { recursive: true });
  const flags = overwrite ? 0 : fs.constants.COPYFILE_EXCL;
  const copied = [];
  const copy = (from, to, rel) => {
    if (path.resolve(from) === path.resolve(to)) return; // picked the app's own folder
    try {
      fs.copyFileSync(from, to, flags);
      copied.push(rel);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  };
  if (source.configFile) copy(source.configFile, path.join(home, 'config.json'), 'config.json');
  for (const f of source.dataFiles) copy(path.join(source.dataDir, f), path.join(dataHome, f), `data/${f}`);
  return copied;
}
