// SPDX-License-Identifier: GPL-3.0-or-later
// EVE HUD: the Electron "main process".
//
// It runs the HUD server (hud/server.js) inside this process, waits until it listens on
// localhost:<port> (4747 by default), and shows the HUD in its own window. Quitting the app (or
// closing the window) stops the server. No Node.js installation is needed: Electron brings its own.
// The Client ID, Secret Key and EVE login are stored encrypted (Keychain / Windows data protection).
//
// Files in this folder:
//   main.js         this file: start-up, first-run import, port problems, quitting
//   paths.js        where the HUD code is (and --data-dir)
//   storage.js      where config.json and data/ are kept, and moving them (Settings → Storage)
//   importer.js     copies config.json + data files from an older HUD folder
//   privacy.js      in-memory session, EVE-only network rule, permissions
//   window.js       the HUD window: normal / full-screen, monitor, remembered position
//   tray.js         the tray icon and its menu (Windows), the Settings menu (Mac)
//   config-edit.js  saves the window mode into config.json without reformatting it
//   port-check.js   tells another EVE HUD apart from some other program on the port
//   log.js          the log file (Open log file in the tray / Settings menu)
//   recovery.js     damaged configuration files: the reset window
//
// Start options (also for the installed app, e.g. in a shortcut):
//   --demo            sample data, no login
//   --port=N          another port (the EVE login only works on the callbackUrl port)
//   --rebuild-map     download the star map again
//   --data-dir=PATH   keep config.json and data/ in PATH instead of the usual folder

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, dialog, shell, Menu, screen, session, safeStorage, BrowserWindow } from 'electron';

import { createLogger } from './log.js';
import { hudSourceDir, hudHomeDir } from './paths.js';
import { findImportSource, importInto } from './importer.js';
import { createHudWindow } from './window.js';
import { createControls, setMacMenu } from './tray.js';
import { createAutostart } from './autostart.js';
import { buildCommit } from './build-info.js';
import { setWindowMode } from './config-edit.js';
import { resolveLocations, checkMove, requestMove, takePendingMove, moveStorage } from './storage.js';
import { probeHud } from './port-check.js';
import { readUseGpu, writeUseGpu } from './gpu.js';
import { configFiles, findDamaged, resetConfig, recoveryPage, RESET_TITLE } from './recovery.js';

const argv = process.argv;
const DEMO = argv.includes('--demo');
const PORT = argv.find((a) => a.startsWith('--port='))?.slice('--port='.length);
// The environment as the app was started. start() sets EVE_HUD_HOME / EVE_HUD_DATA for the HUD code;
// a restart must not pass those on, or the new instance would take them for --data-dir.
const STARTED_ENV = { EVE_HUD_HOME: process.env.EVE_HUD_HOME, EVE_HUD_DATA: process.env.EVE_HUD_DATA };

let log = console;
let hudServer = null; // what startServer() returned; null when using a HUD that was already running
let hud = null; // the window
let tray = null;

// "Use the graphics card" off (or --no-gpu): draw with the processor, so a game on the other screen
// has the graphics card to itself. Has to be decided before the app is ready (gpu.js).
const USE_GPU = !argv.includes('--no-gpu') && readUseGpu(app.getPath('userData'));
if (!USE_GPU) app.disableHardwareAcceleration();

// One EVE HUD at a time: starting it again brings the running one to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => hud?.show());
  app.on('activate', () => hud?.show()); // Mac: clicking the Dock icon
  // Closing the window quits.
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', stopServerThenQuit);
  app.whenReady().then(start).catch(fatal);
}

async function start() {
  if (process.platform === 'win32') app.setAppUserModelId('com.evehud.app');
  log = createLogger({ dir: app.getPath('logs') });
  log.info(
    `EVE HUD ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform} ${process.arch}${app.isPackaged ? '' : ', development'})`,
  );
  process.on('uncaughtException', (err) => log.error('Unexpected error:', err));
  process.on('unhandledRejection', (err) => log.error('Unexpected error:', err));
  setAppMenu();
  forgetOldSiteData();

  const appDir = app.getAppPath();
  const assetsDir = path.join(appDir, 'assets');
  const icoFile = path.join(assetsDir, 'icon.ico');
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(assetsDir, 'icon.png'));

  // ---------- where things are ----------
  const hudDir = hudSourceDir({ appPath: appDir });
  const userData = app.getPath('userData');
  const override = hudHomeDir({ argv, userData: null }); // --data-dir / EVE_HUD_HOME, or null
  let where = resolveLocations({ userData, home: override });
  // A move asked for in Settings → Storage happens now, before anything reads or writes the files.
  const pending = where.fixed ? null : takePendingMove(userData);
  if (pending) {
    try {
      const moved = moveStorage({ userData, from: where, to: pending });
      log.info(
        `Storage: moved ${moved.join(' and ') || 'nothing'} (config.json now in ${pending.configDir}, data in ${pending.dataDir})`,
      );
      where = resolveLocations({ userData });
    } catch (err) {
      log.warn(`Storage: could not move the files: ${err.message}`);
      await dialog.showMessageBox({
        type: 'warning',
        title: 'EVE HUD',
        message: 'The EVE HUD files could not be moved',
        detail: `${err.message}\n\nThey stay where they were:\n${where.configDir}\n${where.dataDir}`,
        buttons: ['OK'],
        noLink: true,
      });
    }
  }
  // A damaged configuration file (config.json, settings, login…): reset to a fresh start (recovery.js)
  const cfgFiles = configFiles({ userData, where });
  const damaged = findDamaged(cfgFiles);
  if (damaged.length) {
    await resetForDamage(damaged, cfgFiles, appDir);
    return;
  }
  const home = where.configDir;
  fs.mkdirSync(home, { recursive: true });
  if (!DEMO && !fs.existsSync(path.join(home, 'config.json'))) {
    if (!(await firstRun(home, where.dataDir))) return app.quit();
  }
  // Must be set before the HUD code is loaded: lib/store.js reads them once.
  process.env.EVE_HUD_HOME = home;
  process.env.EVE_HUD_DATA = where.dataDir;
  process.env.EVE_HUD_VERSION = app.getVersion();
  process.env.EVE_HUD_COMMIT = buildCommit(app.getAppPath()) || '';
  log.info(`HUD code: ${hudDir}`);
  log.info(`HUD folders: config.json in ${home}, data in ${where.dataDir}`);

  // Secrets on disk are encrypted with the operating system's key for this user (lib/secrets.js).
  const secrets = await import(pathToFileURL(path.join(hudDir, 'lib', 'secrets.js')).href);
  secrets.useSecretBox(secretBox());

  const server = await import(pathToFileURL(path.join(hudDir, 'server.js')).href);
  const store = await import(pathToFileURL(path.join(hudDir, 'lib', 'store.js')).href);
  const { paths } = server;

  let config;
  try {
    config = store.loadConfig();
  } catch (err) {
    // checked above already; this catches a file that went bad in between
    log.error(`config.json: ${err.message}`);
    await resetForDamage(
      [{ file: paths.configFile, problem: 'not valid JSON' }],
      configFiles({ userData, where }),
      appDir,
    );
    return;
  }
  const callbackPort = Number(new URL(config.callbackUrl).port || 80);
  if (!PORT && callbackPort !== Number(config.port)) {
    log.warn(
      `config.json: "port" is ${config.port} but "callbackUrl" uses port ${callbackPort}. The EVE login will fail until they match.`,
    );
  }

  // ---------- start the server ----------
  let url = null;
  for (;;) {
    try {
      hudServer = await server.startServer({
        demo: DEMO,
        port: PORT,
        log,
        rebuildMap: argv.includes('--rebuild-map'),
        // the setup form (or Reset) moved the HUD to another port: the window and tray follow
        onPortChange: (next) => {
          url = next;
          hud?.setUrl(next);
          tray?.update();
        },
        // logged in through the browser: bring the app back to the front
        onLogin: () => hud?.show(),
        storage: {
          get: () => ({
            configDir: where.configDir,
            dataDir: where.dataDir,
            defaults: where.defaults,
            fixed: where.fixed,
          }),
          browse: async (which, current) => {
            const titles = {
              data: 'Folder for the data (login, layout, star map)',
              config: 'Folder for config.json (settings)',
              logs: "EVE's logs folder (…/EVE/logs, with Chatlogs and Gamelogs; also on a network share)",
            };
            const r = await dialog.showOpenDialog(hud?.win, {
              title: titles[which] || titles.config,
              defaultPath:
                current ||
                (which === 'data'
                  ? where.dataDir
                  : which === 'logs'
                    ? app.getPath('documents')
                    : where.configDir),
              properties: which === 'logs' ? ['openDirectory'] : ['openDirectory', 'createDirectory'],
            });
            return r.canceled ? null : r.filePaths[0] || null;
          },
          move: async (to) => {
            if (where.fixed)
              throw new Error(
                'The app was started with --data-dir (or EVE_HUD_HOME), which sets these folders.',
              );
            checkMove({ from: where, to }); // a readable error now, instead of after the restart
            requestMove(userData, to);
            log.info(`Storage: moving to ${to.configDir} / ${to.dataDir} at the restart`);
            setTimeout(restart, 400); // after the reply has gone out
            return { ok: true };
          },
        },
      });
      url = hudServer.url;
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
      log.warn(err.message);
      const choice = await portProblem(err, paths.configFile);
      if (choice === 'retry') continue;
      if (choice === 'use') {
        url = `http://localhost:${err.port}/`;
        log.info(`Using the EVE HUD that is already running at ${url}`);
        break;
      }
      return app.quit();
    }
  }

  // ---------- window + tray ----------
  const openFile = async (file) => {
    // Opens a file in its default app; when there is none (often the case for .json), shows it
    // in Explorer / Finder instead, so the menu item never silently does nothing.
    const error = await shell.openPath(file);
    if (error) {
      log.warn(`Could not open ${file} (${error}); showing it in its folder instead`);
      shell.showItemInFolder(file);
    }
  };

  hud = createHudWindow({
    url,
    mode: config.window.mode === 'fullscreen' ? 'fullscreen' : 'normal',
    windowConfig: config.window,
    statePath: path.join(paths.dataDir, 'window-state.json'),
    icon: process.platform === 'win32' ? icoFile : path.join(assetsDir, 'icon.png'),
    devTools: !app.isPackaged || argv.includes('--devtools'), // F12 only when run from source (or with --devtools)
    log,
    onModeChange: (mode) => {
      try {
        if (setWindowMode(paths.configFile, mode)) log.info(`Window mode: ${mode} (saved in config.json)`);
      } catch (err) {
        log.warn(`Could not save the window mode in config.json: ${err.message}`);
      }
      tray?.update();
    },
    onClosed: () => app.quit(),
    onAppAction: (action) => {
      log.info(`From the HUD page: ${action}`);
      if (action === 'log') openFile(log.file);
      else if (action === 'config') openFile(paths.configFile);
      else if (action === 'restart') restart();
      else if (action === 'quit') app.quit();
    },
    onLoadFailed: (desc) => serverGone(desc, openFile),
  });

  const autostart = createAutostart({ app });
  tray = createControls({
    icoFile,
    pngFile: path.join(assetsDir, 'icon.png'),
    status: () => ({
      demo: DEMO,
      port: new URL(url).port,
      url,
      external: !hudServer,
      mode: hud.mode,
      displayId: hud.currentDisplayId(),
      canImport: Boolean(home), // in development the HUD folder *is* the source
      useGpu: readUseGpu(app.getPath('userData')), // as saved: applies from the next start
    }),
    actions: {
      show: () => hud.show(),
      reload: () => hud.reload(),
      about: showAbout,
      setMode: (m) => hud.setMode(m),
      moveToDisplay: async (id) => {
        await hud.moveToDisplay(id);
        tray.update();
      },
      openConfig: () => openFile(paths.configFile),
      openDataFolder: () => shell.openPath(paths.dataDir),
      openLog: () => openFile(log.file),
      importFolder: () => importLater(home, where.dataDir),
      setUseGpu,
      startsAtLogin: () => autostart.isOn(),
      setStartAtLogin: (on) => {
        try {
          autostart.set(on);
          log.info(`Start at login: ${on ? 'on' : 'off'}`);
        } catch (err) {
          log.warn(`Start at login: ${err.message}`);
        }
        tray.update();
      },
      restart,
      quit: () => app.quit(),
    },
  });
  hud.win.on('moved', () => tray.update());
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed'])
    screen.on(ev, () => tray.update());
}

// ---------- first start: import or start fresh ----------
// Returns false when the user chose Quit.
async function firstRun(home, dataDir) {
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'EVE HUD',
      message: 'Welcome to EVE HUD',
      detail:
        `The app keeps its config.json and data in:\n${home}\n\n` +
        'Used the HUD before (the old eve folder with config.json and data/)? Import that folder to keep your EVE login, layout and star map.\n\n' +
        "Or start fresh: the HUD window then asks for your EVE application's Client ID and Secret Key.",
      buttons: ['Import from folder…', 'Start fresh', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 2) return false;
    if (response === 1) {
      log.info('First start: starting fresh (config.json is created from config.example.json)');
      return true;
    }
    const source = await chooseImportFolder();
    if (!source) continue;
    const copied = importInto(source, home, { dataDir });
    log.info(`First start: imported ${copied.join(', ') || 'nothing'} from ${source.dir}`);
    await dialog.showMessageBox({
      type: 'info',
      title: 'EVE HUD',
      message: `Imported ${copied.length} file${copied.length === 1 ? '' : 's'}`,
      detail: `${copied.join('\n')}${copied.includes('config.json') ? '' : '\n\nThere was no config.json, so a new one is created from the example.'}`,
      buttons: ['Start EVE HUD'],
      noLink: true,
    });
    return true;
  }
}

async function chooseImportFolder() {
  for (;;) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choose your EVE HUD folder (with config.json and data)',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths.length) return null;
    const source = findImportSource(filePaths[0]);
    if (source) return source;
    await dialog.showMessageBox({
      type: 'warning',
      title: 'EVE HUD',
      message: 'Nothing to import there',
      detail: `${filePaths[0]} has no config.json and no data folder with HUD files. Pick your old HUD folder (the one with config.json and data/).`,
      buttons: ['Choose another folder'],
      noLink: true,
    });
  }
}

// Tray > Import from an existing HUD folder…: replaces the app's files, then restarts.
async function importLater(home, dataDir) {
  if (!home) return;
  const source = await chooseImportFolder();
  if (!source) return;
  const files = [source.configFile && 'config.json', ...source.dataFiles.map((f) => `data/${f}`)].filter(
    Boolean,
  );
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'EVE HUD',
    message: "Replace the app's files with these?",
    detail: `${files.join('\n')}\n\nfrom ${source.dir}\n\nThe app restarts afterwards.`,
    buttons: ['Import and restart', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return;
  const copied = importInto(source, home, { overwrite: true, dataDir });
  log.info(`Imported ${copied.join(', ')} from ${source.dir}`);
  restart();
}

// ---------- problems ----------
async function portProblem(err, configFile) {
  const { port } = err;
  const portHelp =
    'Another port only works with your own EVE developer application: the EVE HUD application only logs in on port 4747. ' +
    'With your own application, change "port" and "callbackUrl" in config.json and the Callback URL on developers.eveonline.com to the same port. ' +
    'The app never moves to another port by itself, because the EVE login only comes back to the callbackUrl port.';
  let options;
  const probe = err.code === 'EADDRINUSE' ? await probeHud(port) : { isHud: false };
  if (probe.isHud) {
    options = {
      message: `Another EVE HUD is already running on port ${port}`,
      detail:
        `It's probably another copy of the app, or an old node server.js${probe.demo ? ' (in demo mode)' : ''}. Stop it (quit it, or Ctrl+C in its terminal) and choose Try again.\n\n` +
        'Or show that HUD in this window. Quitting the app then leaves it running.',
      buttons: ['Try again', 'Show the running HUD', 'Quit'],
      actions: ['retry', 'use', 'quit'],
    };
  } else {
    options = {
      message:
        err.code === 'EACCES'
          ? `Port ${port} may not be used on this computer`
          : `Port ${port} is used by another program`,
      detail: `${err.code === 'EACCES' ? err.message : 'Close that program and choose Try again.'}\n\n${portHelp}`,
      buttons: ['Try again', 'Open config file', 'Quit'],
      actions: ['retry', 'config', 'quit'],
    };
  }
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'EVE HUD',
      message: options.message,
      detail: options.detail,
      buttons: options.buttons,
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    const action = options.actions[response];
    if (action !== 'config') return action;
    const error = await shell.openPath(configFile); // then ask again: Try again re-reads config.json
    if (error) shell.showItemInFolder(configFile);
  }
}

// Damaged configuration: one window, one way on: reset (delete the configuration files) and restart.
// Closing the window (or quitting) leaves everything as it is; the next start asks again.
async function resetForDamage(damaged, files, appDir) {
  for (const d of damaged) log.error(`Damaged configuration file: ${d.file} (${d.problem})`);
  const ok = await recoveryWindow(damaged, appDir);
  if (!ok) {
    log.info('Reset not done: quitting');
    app.quit();
    return;
  }
  try {
    const removed = resetConfig(files);
    log.info(`Reset: deleted ${removed.join(', ') || 'nothing'}; restarting as on the first start`);
  } catch (err) {
    log.error('Reset failed:', err);
    dialog.showErrorBox(
      'EVE HUD could not be reset',
      `${err.message}\n\nDelete these files yourself, then start EVE HUD again:\n${damaged.map((d) => d.file).join('\n')}`,
    );
    app.quit();
    return;
  }
  restart();
}

// The reset window: the HUD's style, shown before the HUD itself (which can't start like this).
// Resolves true when Reset is clicked, false when the window is closed.
function recoveryWindow(damaged, appDir) {
  const fonts = {};
  for (const w of [400, 500]) {
    try {
      fonts[w] = fs
        .readFileSync(
          path.join(
            hudSourceDir({ appPath: appDir }),
            'public',
            'fonts',
            `saira-semi-condensed-latin-${w}-normal.woff2`,
          ),
        )
        .toString('base64');
    } catch {
      /* system font */
    }
  }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 600,
      height: 420,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      alwaysOnTop: true,
      center: true,
      show: false,
      backgroundColor: '#000000',
      title: 'EVE HUD',
      webPreferences: {
        partition: 'eve-hud-recovery',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: false,
      },
    });
    // nothing to load from anywhere: the page is a data: URL
    win.webContents.session?.webRequest?.onBeforeRequest?.({ urls: ['<all_urls>'] }, (d, cb) =>
      cb({ cancel: !d.url.startsWith('data:') }),
    );
    win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    let done = false;
    // Reset: the window stays ("Resetting…") until the restart closes it
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    win.on('page-title-updated', (e, title) => {
      e?.preventDefault?.();
      if (title === RESET_TITLE) finish(true);
    });
    win.on('closed', () => finish(false));
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(recoveryPage(damaged, { fonts }))}`);
  });
}

function fatal(err) {
  try {
    log.error('Could not start:', err);
  } catch {
    /* ignore */
  }
  dialog.showErrorBox(
    'EVE HUD could not start',
    `${err?.message || err}\n\nDetails are in the log file:\n${log.file || app.getPath('logs')}`,
  );
  app.exit(1);
}

// Encryption with Electron's safeStorage: DPAPI on Windows, the Keychain on a Mac ("EVE HUD Safe
// Storage"). null when the system offers none (some Linux desktops): secrets then stay plain text.
function secretBox() {
  const weak = process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text';
  if (!safeStorage.isEncryptionAvailable() || weak) {
    log.warn('No system encryption available: config.json and tokens.json stay readable on disk');
    return null;
  }
  return {
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
  };
}

// Earlier versions logged in inside the window, which kept EVE's login cookies in the app's own
// (persistent) default session. The window now uses an in-memory session, so clear that old one.
function forgetOldSiteData() {
  session.defaultSession
    .clearStorageData()
    .then(() => session.defaultSession.clearCache())
    .catch((err) => log.warn(`Could not clear old site data: ${err.message}`));
}

// ---------- quitting ----------
// Stops the HUD server (closes the port and the live connections) before the app exits, so a
// restart can take the port straight away. Gives up after 2 seconds.
let serverState = 'running'; // -> 'stopping' -> 'stopped'
function stopServerThenQuit(event) {
  if (!hudServer || serverState === 'stopped') return; // let the quit go ahead
  event.preventDefault();
  if (serverState === 'stopping') return; // a second quit request while stopping: just wait
  serverState = 'stopping';
  const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
  Promise.race([hudServer.stop(), timeout])
    .catch((err) => log.warn(`Stopping the server: ${err.message}`))
    .finally(() => {
      serverState = 'stopped';
      log.info('Stopped');
      app.quit();
    });
}

// The HUD page couldn't be loaded from the built-in server (e.g. Reload after it stopped): say so.
let serverGoneShown = false;
async function serverGone(desc, openFile) {
  if (serverGoneShown) return;
  serverGoneShown = true;
  log.error(`EVE HUD stopped working: the built-in server does not answer (${desc})`);
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'EVE HUD',
      message: 'EVE HUD stopped working',
      detail: `An internal error occurred: the HUD's built-in server doesn't answer (${desc}).\n\nThe log file has the details:\n${log.file}`,
      buttons: ['Open log file', 'Restart', 'Close EVE HUD'],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) {
      await openFile(log.file);
      continue;
    }
    if (response === 1) return restart();
    return app.quit();
  }
}

// Tray / Settings menu → "Use the graphics card": saved, then asks to restart (it only applies to
// a new start) in the HUD's own window style (like About). Restart now goes to /__app/restart.
async function setUseGpu(on) {
  writeUseGpu(app.getPath('userData'), on);
  log.info(`Use the graphics card: ${on ? 'on' : 'off'} (after a restart)`);
  tray?.update();
  if (hud) {
    hud.show();
    const shown = await hud.win.webContents
      .executeJavaScript(
        `window.eveHudGpuModal ? (window.eveHudGpuModal(${on ? 'true' : 'false'}), true) : false`,
      )
      .catch(() => false);
    if (shown) return;
  }
  // no HUD page to show it in (e.g. it failed to load): the system's own dialog
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: on ? 'Use the graphics card again?' : 'Draw the HUD without the graphics card?',
    detail: 'This takes effect after a restart.',
  });
  if (response === 0) restart();
}

function restart() {
  log.info('Restarting');
  for (const [k, v] of Object.entries(STARTED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  app.relaunch(); // same arguments and environment; starts once this instance has exited
  app.quit();
}

// About EVE HUD (Mac app menu): the HUD's own About window, shown in the HUD window.
function showAbout() {
  if (!hud) return;
  hud.show();
  hud.win.webContents.executeJavaScript('window.eveHudAbout && window.eveHudAbout()').catch(() => {});
}

// The menu bar: on a Mac the app, Edit, View and Window menus (so Cmd+Q, copy and paste work), plus
// Settings once the HUD runs (tray.js); on Windows none: the tray menu and the keys in window.js
// cover everything. On Linux the tray menu also becomes the window's menu bar once the HUD runs,
// hidden until Alt (tray.js), for desktops without status icons.
function setAppMenu() {
  if (process.platform === 'darwin') setMacMenu({ reload: () => hud?.reload(), about: showAbout });
  else Menu.setApplicationMenu(null);
}
