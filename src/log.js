// SPDX-License-Identifier: GPL-3.0-or-later
// Simple file logger for the app.
//
// The app and the HUD server (which runs inside the app) both write here (tray > Open log file).
//   Windows: %APPDATA%\EVE HUD\logs\eve-hud.log
//   macOS:   ~/Library/Logs/EVE HUD/eve-hud.log
//
// Rotated at 1 MB (the previous file is kept as eve-hud.old.log). Never pass secrets to it: the
// server only logs status lines, and the app never logs config.json or token contents.

import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;

export function createLogger({ dir, alsoConsole = true }) {
  const file = path.join(dir, 'eve-hud.log');
  const oldFile = path.join(dir, 'eve-hud.old.log');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* logging must never crash the app */
  }

  function rotateIfNeeded() {
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, oldFile);
    } catch {
      /* no file yet */
    }
  }

  function write(level, args) {
    const text = args
      .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${text}\n`;
    if (alsoConsole) process.stdout.write(line);
    try {
      rotateIfNeeded();
      fs.appendFileSync(file, line);
    } catch {
      /* disk full or read-only: keep running */
    }
  }

  return {
    file,
    dir,
    info: (...a) => write('INFO', a),
    warn: (...a) => write('WARN', a),
    error: (...a) => write('ERROR', a),
  };
}
