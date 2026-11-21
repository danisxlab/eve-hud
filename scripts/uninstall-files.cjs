// SPDX-License-Identifier: GPL-3.0-or-later
// The Windows uninstaller's list of EVE HUD's own program files (build/installer.nsh).
//
// electron-builder's own uninstaller deletes the whole program folder, also files that aren't EVE
// HUD's (for instance when it was installed into a folder that already had files in it). Instead,
// EVE HUD's uninstaller deletes only the files the installer put there, by name, and then the
// folders, each only when it is empty. The names come from the app itself: when the Windows app is
// built, electron-builder.config.cjs (afterPack) calls writeUninstallList(), which writes
// dist/uninstall-files.nsh with one Delete line per file. The installer then can't drift from the
// list: whatever a new Electron version adds is in it automatically.
//
// Besides the app's files: resources\elevate.exe, which electron-builder adds to the installer's
// copy of the app (for installing for all users). The uninstaller itself ("Uninstall EVE HUD.exe")
// is in build/installer.nsh, as it's named there.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ADDED_BY_INSTALLER = ['resources/elevate.exe'];

// In an NSIS "…" string: $ is written $$, and " is written $\"
const nsisString = (s) => s.replace(/\$/g, '$$$$').replace(/"/g, '$\\"');

// Every file and folder under appDir, relative, with / (folders: deepest first)
function listApp(appDir) {
  const files = [];
  const dirs = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(appDir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        dirs.push(r);
        walk(r);
      } else files.push(r);
    }
  };
  walk('');
  for (const f of ADDED_BY_INSTALLER) {
    if (!files.includes(f)) files.push(f);
    const dir = path.posix.dirname(f);
    if (dir !== '.' && !dirs.includes(dir)) dirs.push(dir);
  }
  files.sort();
  dirs.sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b));
  return { files, dirs };
}

// The NSIS macro: Delete for every file, then RMDir (without /r: only an empty folder) for every
// folder, deepest first. The program folder itself is removed in build/installer.nsh.
function nsisRemoveList(appDir) {
  const { files, dirs } = listApp(appDir);
  if (!files.some((f) => /\.exe$/i.test(f) && !f.includes('/')))
    throw new Error(`${appDir} has no program file: not a built Windows app`);
  const win = (r) => `$INSTDIR\\${nsisString(r.replace(/\//g, '\\'))}`;
  return [
    '; Made by scripts/uninstall-files.cjs when the Windows app is built: every file the installer',
    "; puts in the program folder. Don't edit; it's made again at every build.",
    '!macro eveHudRemoveProgramFiles',
    ...files.map((f) => `  Delete "${win(f)}"`),
    ...dirs.map((d) => `  RMDir "${win(d)}"`),
    '!macroend',
    '',
  ].join('\r\n');
}

function writeUninstallList(appDir, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, nsisRemoveList(appDir));
}

module.exports = { listApp, nsisRemoveList, writeUninstallList, ADDED_BY_INSTALLER };
