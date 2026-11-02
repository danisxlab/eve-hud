// SPDX-License-Identifier: GPL-3.0-or-later
// Where the HUD code is, and where its config.json and data/ folder live.
//
// HUD code (server.js, lib/, public/): the hud/ folder of this project (in the installed app:
// <app>/resources/app.asar/hud).
//
// HUD home (config.json + data/), the same folder for npm start and the installed app:
//   Windows  %APPDATA%\EVE HUD
//   macOS    ~/Library/Application Support/EVE HUD
// Another folder: --data-dir=PATH or the EVE_HUD_HOME variable (handy for testing a fresh start).

import fs from 'node:fs';
import path from 'node:path';

export function hudSourceDir({ appPath }) {
  // Normally inside app.asar. If a build unpacks it (asarUnpack: ["hud/**"]), use that copy.
  const unpacked = path.join(appPath.replace(/app\.asar$/, 'app.asar.unpacked'), 'hud');
  return fs.existsSync(path.join(unpacked, 'server.js')) ? unpacked : path.join(appPath, 'hud');
}

export function hudHomeDir({ argv, env = process.env, userData }) {
  const arg = argv.find((a) => a.startsWith('--data-dir='));
  if (arg) return path.resolve(arg.slice('--data-dir='.length));
  if (env.EVE_HUD_HOME) return path.resolve(env.EVE_HUD_HOME);
  return userData;
}
