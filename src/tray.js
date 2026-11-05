// SPDX-License-Identifier: GPL-3.0-or-later
// The app's controls outside the HUD page.
//
// Windows: an icon in the notification area. Left click shows the HUD, right click opens the menu:
//   Show HUD · Reload
//   Normal window / Full-screen (F11)
//   Move to monitor ▸ (every connected monitor; the current one is ticked)
//   Open config file · Open data folder · Open log file · Import from an existing HUD folder…
//   Use the graphics card (restart needed)
//   Start with Windows (only in the installed app)
//   Restart · Quit EVE HUD
//
// Linux: the same tray menu, as a status icon (KDE, Cinnamon, Xfce…; on GNOME with the AppIndicator
//   extension, which Ubuntu has built in). The window also has it as a menu bar, hidden until you
//   press Alt, for desktops without status icons. "Start at login" instead of "Start with Windows".
//
// macOS: no menu bar icon. The menu bar has a "Settings" menu with the same options instead, next
// to the usual EVE HUD, Edit, View and Window menus. Show HUD, Reload, full-screen and Quit are
// where a Mac has them already: the Dock icon, View → Reload, View → Enter Full Screen (or F11, or
// the green button; the mode is saved either way) and EVE HUD → Quit (Cmd+Q).

import { Tray, Menu, nativeImage, app, screen } from 'electron';
import { displayLabel } from './window.js';

const isMac = () => process.platform === 'darwin';
const isLinux = () => process.platform === 'linux';

// The Mac menu bar. settings: the items of the Settings menu, or null before the HUD has started
// (during the first-start questions and port messages).
export function setMacMenu({ reload, about = null, settings = null }) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      // the app menu, with our own About: the HUD's About window (version, CCP/Fenris Creations notice, licenses)
      // instead of Electron's standard panel, which shows Electron's name and icon when run from source
      {
        label: 'EVE HUD',
        submenu: [
          about ? { label: 'About EVE HUD', click: about } : { role: 'about', label: 'About EVE HUD' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide', label: 'Hide EVE HUD' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: 'Quit EVE HUD' },
        ],
      },
      { role: 'editMenu' },
      // our own short View: Electron's standard one adds "Toggle Developer Tools" and its own
      // "Toggle Full Screen" next to the "Enter Full Screen" item macOS puts there by itself
      {
        label: 'View',
        submenu: [
          { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: reload },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
        ],
      },
      ...(settings ? [{ label: 'Settings', submenu: settings }] : []),
      { role: 'windowMenu' },
    ]),
  );
}

export function createControls({ icoFile, pngFile, status, actions }) {
  const mac = isMac();
  const linux = isLinux();
  let tray = null;
  if (!mac) {
    tray = new Tray(
      linux
        ? nativeImage.createFromPath(pngFile).resize({ width: 32, height: 32 }) // Linux can't read .ico
        : nativeImage.createFromPath(icoFile), // the .ico has the small sizes Windows needs
    );
    tray.on('click', () => actions.show()); // Windows; on Linux a click opens the menu
  }

  function update() {
    const s = status();
    const primaryId = screen.getPrimaryDisplay().id;
    const displays = screen.getAllDisplays().map((d, i) => ({
      label: displayLabel(d, i, primaryId),
      type: 'radio',
      checked: d.id === s.displayId,
      click: () => actions.moveToDisplay(d.id),
    }));
    const where = `${s.demo ? 'demo mode · ' : ''}${s.external ? 'using the HUD already running on ' : ''}localhost:${s.port}`;
    const files = [
      { label: 'Open config file', click: actions.openConfig },
      { label: 'Open data folder', click: actions.openDataFolder },
      { label: 'Open log file', click: actions.openLog },
      { label: 'Import from an existing HUD folder…', click: actions.importFolder, enabled: s.canImport },
    ];
    const useGpu = {
      label: 'Use the graphics card (restart needed)',
      type: 'checkbox',
      checked: s.useGpu !== false,
      click: (item) => actions.setUseGpu(item.checked),
    };
    const startAtLogin = {
      label: mac ? 'Open at login' : linux ? 'Start at login' : 'Start with Windows',
      type: 'checkbox',
      checked: actions.startsAtLogin(),
      enabled: app.isPackaged, // in development it would register the Electron binary instead
      click: (item) => actions.setStartAtLogin(item.checked),
    };

    if (mac) {
      setMacMenu({
        reload: actions.reload,
        about: actions.about,
        settings: [
          { label: `EVE HUD · ${where}`, enabled: false },
          { type: 'separator' },
          { label: 'Move to monitor', submenu: displays },
          { type: 'separator' },
          ...files,
          { type: 'separator' },
          useGpu,
          startAtLogin,
          { type: 'separator' },
          { label: 'Restart EVE HUD', click: actions.restart },
        ],
      });
      return;
    }

    tray.setToolTip(`EVE HUD${s.demo ? ' (demo)' : ''} · ${s.url}`);
    const items = [
      { label: `EVE HUD · ${where}`, enabled: false },
      { type: 'separator' },
      { label: 'Show HUD', click: actions.show },
      { label: 'Reload', click: actions.reload },
      { type: 'separator' },
      {
        label: 'Normal window',
        type: 'radio',
        checked: s.mode !== 'fullscreen',
        click: () => actions.setMode('normal'),
      },
      {
        label: 'Full-screen (F11)',
        type: 'radio',
        checked: s.mode === 'fullscreen',
        click: () => actions.setMode('fullscreen'),
      },
      { label: 'Move to monitor', submenu: displays },
      { type: 'separator' },
      ...files,
      { type: 'separator' },
      useGpu,
      startAtLogin,
      { type: 'separator' },
      { label: 'Restart', click: actions.restart },
      { label: 'Quit EVE HUD', click: actions.quit },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(items));
    // Linux: also in the window, behind Alt (autoHideMenuBar), for desktops without status icons
    if (linux) Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'EVE HUD', submenu: items }]));
  }

  update();
  return { update, destroy: () => tray?.destroy() };
}
