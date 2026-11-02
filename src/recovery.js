// SPDX-License-Identifier: GPL-3.0-or-later
// Damaged configuration files: found at start-up, before the HUD server reads them. The app then
// shows one window (recoveryWindow in main.js) that resets EVE HUD: every configuration file is
// deleted and the app restarts as on its very first start (Welcome: import or start fresh).
//
// Configuration files: config.json (Client ID, Secret Key, options), data/settings.json (layout and
// settings), data/settings-demo.json, data/tokens.json (the EVE login), data/window-state.json,
// and in the app folder location.json / location.pending.json (Settings → Storage) and
// app-options.json (Use the graphics card). Caches (star map, names, killmails) are not
// configuration: they stay, and rebuild themselves when needed.
//
// Damaged: the file is there but isn't a JSON object (cut off, empty, garbage, a list…). A plain
// null is fine: tokens.json holds that after logging out.

import fs from 'node:fs';
import path from 'node:path';

// Every configuration file for these folders. where: resolveLocations() (storage.js).
export function configFiles({ userData, where }) {
  const list = [
    path.join(where.configDir, 'config.json'),
    ...['settings.json', 'settings-demo.json', 'tokens.json', 'window-state.json'].map((f) =>
      path.join(where.dataDir, f),
    ),
    path.join(userData, 'app-options.json'),
  ];
  // with --data-dir the app folder's location files don't apply, so they're left alone
  if (!where.fixed)
    list.push(path.join(userData, 'location.json'), path.join(userData, 'location.pending.json'));
  return [...new Set(list)];
}

// The damaged ones, with what's wrong, e.g. [{ file, problem: 'not valid JSON' }]
export function findDamaged(files) {
  const out = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') continue; // not there: fine, it's created when needed
      if (err.code === 'EISDIR') {
        out.push({ file, problem: 'a folder instead of a file' });
        continue;
      }
      continue; // can't be read (permissions): not something a reset can fix
    }
    let value;
    try {
      value = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
      out.push({ file, problem: text.trim() ? 'not valid JSON' : 'empty' });
      continue;
    }
    if (value === null) continue; // "nothing saved" (tokens.json after logging out)
    if (typeof value !== 'object' || Array.isArray(value)) out.push({ file, problem: 'not a JSON object' });
  }
  return out;
}

// Deletes every configuration file (the damaged ones and the rest), so the next start is a fresh
// one. Returns the files it deleted.
export function resetConfig(files) {
  const removed = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file, { recursive: true, force: true });
    removed.push(file);
  }
  return removed;
}

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// The window's page (a data: URL, no server needed), in the HUD's style. The button sets the
// page title to RESET_TITLE; main.js waits for that.
export const RESET_TITLE = 'eve-hud:reset';
export function recoveryPage(damaged, { fonts = {} } = {}) {
  const face = (w, b64) =>
    b64
      ? `@font-face { font-family: 'Saira Semi Condensed'; font-weight: ${w}; src: url(data:font/woff2;base64,${b64}) format('woff2'); }`
      : '';
  const items = damaged
    .map((d) => `<li><code>${esc(d.file)}</code><span>${esc(d.problem)}</span></li>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>EVE HUD</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'">
<style>
${face(400, fonts[400])}
${face(500, fonts[500])}
html, body { margin: 0; height: 100%; background: #000; color: #d4d9db; font-family: 'Saira Semi Condensed', system-ui, sans-serif; -webkit-user-select: none; user-select: none; }
body { display: grid; place-items: center; -webkit-app-region: drag; }
.modal { position: relative; box-sizing: border-box; width: calc(100vw - 40px); padding: 22px 24px 18px; background: rgba(28, 8, 6, 0.96); border: 1px solid rgba(230, 80, 64, 0.9); box-shadow: 0 0 40px rgba(210, 74, 60, 0.35); }
.tick { position: absolute; width: 9px; height: 9px; border: 0 solid #ff7a6c; }
.tl { left: -1px; top: -1px; border-left-width: 1px; border-top-width: 1px; } .tr { right: -1px; top: -1px; border-right-width: 1px; border-top-width: 1px; }
.bl { left: -1px; bottom: -1px; border-left-width: 1px; border-bottom-width: 1px; } .br { right: -1px; bottom: -1px; border-right-width: 1px; border-bottom-width: 1px; }
h2 { margin: 0 0 10px; font-size: 20px; font-weight: 400; color: #ff8a7c; }
p { margin: 6px 0; font-size: 13px; color: #e3c3bf; }
ul { margin: 10px 0; padding: 0; list-style: none; max-height: 120px; overflow: auto; }
li { display: flex; gap: 10px; align-items: baseline; font-size: 12px; padding: 3px 0; border-top: 1px solid rgba(210, 74, 60, 0.2); }
li code { font-family: inherit; color: #fff; word-break: break-all; flex: 1; }
li span { color: #ffb3aa; white-space: nowrap; }
.faint { color: #a07f7b; font-size: 12px; }
.actions { display: flex; justify-content: flex-end; margin-top: 18px; }
button { -webkit-app-region: no-drag; font: inherit; font-size: 13px; letter-spacing: 0.04em; padding: 6px 14px; cursor: pointer; border: 1px solid rgba(210, 74, 60, 0.75); background: rgba(210, 74, 60, 0.16); color: #ffb3aa; }
button:hover { background: rgba(210, 74, 60, 0.3); color: #fff; }
button:focus-visible { outline: 1px solid #ff8a7c; outline-offset: 2px; }
button:disabled { opacity: 0.5; cursor: default; }
</style></head><body>
<div class="modal" role="alertdialog" aria-modal="true" aria-label="Damaged configuration">
<i class="tick tl"></i><i class="tick tr"></i><i class="tick bl"></i><i class="tick br"></i>
<h2>EVE HUD's configuration is damaged</h2>
<p>${damaged.length === 1 ? "This file can't be read:" : "These files can't be read:"}</p>
<ul>${items}</ul>
<p>EVE HUD has to be reset: it deletes its configuration files and starts again as on its first start. You then enter the Client ID and Secret Key again (or import an older HUD folder) and log in with EVE once more. The layout goes back to the default.</p>
<p class="faint">The star map and other downloaded data stay. Nothing in EVE itself changes.</p>
<div class="actions"><button id="reset" autofocus>Reset EVE HUD and restart</button></div>
</div>
<script>
document.getElementById('reset').onclick = (e) => { e.target.disabled = true; e.target.textContent = 'Resetting…'; document.title = ${JSON.stringify(RESET_TITLE)}; };
</script>
</body></html>`;
}
