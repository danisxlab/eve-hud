// SPDX-License-Identifier: GPL-3.0-or-later
// "Use the graphics card" (tray menu on Windows, Settings menu on a Mac). On by default. Off, the
// app draws the HUD with the processor instead (Chromium without hardware acceleration), so a game
// on the other screen has the graphics card to itself; that costs some CPU, little with
// Animations: Limited. Needs a restart: Electron decides this before the app starts.
//
// Kept in app-options.json in the app folder (next to location.json), not in config.json: it has
// to be read before the app is ready, before the HUD's folders are known.
// --no-gpu on the command line also turns it off, for one start.

import fs from 'node:fs';
import path from 'node:path';

export const OPTIONS_FILE = 'app-options.json';

function readOptions(userData) {
  try {
    return JSON.parse(fs.readFileSync(path.join(userData, OPTIONS_FILE), 'utf8')) || {};
  } catch {
    return {};
  }
}

export function readUseGpu(userData) {
  return readOptions(userData).useGpu !== false;
}

export function writeUseGpu(userData, on) {
  const next = { ...readOptions(userData), useGpu: Boolean(on) };
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, OPTIONS_FILE);
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}
