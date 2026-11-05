// SPDX-License-Identifier: GPL-3.0-or-later
// "Start with Windows" / "Open at login" / "Start at login".
// Windows and macOS: Electron's login items. Linux: Electron has none there, so a .desktop file in
// ~/.config/autostart, the freedesktop.org way GNOME, KDE, Xfce, Cinnamon and others all read.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A value inside a .desktop file's Exec line, quoted the freedesktop.org way.
const execArg = (s) => `"${String(s).replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;

export function autostartDesktopFile(exec) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=EVE HUD',
    'Comment=Live EVE Online HUD',
    `Exec=${execArg(exec)}`,
    'Icon=eve-hud',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

export function createAutostart({
  app,
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
}) {
  if (platform !== 'linux') {
    return {
      isOn: () => app.getLoginItemSettings().openAtLogin,
      set: (on) => app.setLoginItemSettings({ openAtLogin: on }),
    };
  }
  const file = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart', 'eve-hud.desktop');
  return {
    file,
    isOn: () => fs.existsSync(file),
    set: (on) => {
      if (!on) return fs.rmSync(file, { force: true }); // only ever this one file, which this app wrote
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // an AppImage runs from a temporary mount: start the AppImage file itself
      fs.writeFileSync(file, autostartDesktopFile(env.APPIMAGE || app.getPath('exe')));
    },
  };
}
