// SPDX-License-Identifier: GPL-3.0-or-later
// A stand-in for the `electron` module, so the main process (src/main.js) can run under plain Node
// in tests. It does nothing on screen: it records what the app asks for (windows, URLs, dialogs,
// the tray menu, quitting) in globalThis.fakeElectron, and answers dialogs from queues the test
// fills in beforehand. Loaded through register.js (a module resolve hook).

import { EventEmitter } from 'node:events';
import path from 'node:path';

const f = (globalThis.fakeElectron ||= {});
f.options ||= {};
f.log = [];
f.windows = [];
f.dialogs = [];
f.opened = [];
f.external = [];
f.trayMenus = [];
f.loginItem = { openAtLogin: false };
f.quitCalls = 0;
f.sessions = {};
f.relaunched = false;
f.exited = null;
const opt = f.options;
const record = (what, data) => f.log.push({ what, ...data });

// ---------- app ----------
class App extends EventEmitter {
  get isPackaged() {
    return Boolean(opt.isPackaged);
  }
  getAppPath() {
    return opt.appPath;
  }
  getVersion() {
    return '0.1.0-test';
  }
  getName() {
    return 'EVE HUD';
  }
  getPath(name) {
    const base = opt.paths?.[name];
    if (!base) throw new Error(`fake getPath(${name}) not configured`);
    return base;
  }
  requestSingleInstanceLock() {
    return opt.lock !== false;
  }
  whenReady() {
    return new Promise((r) => setTimeout(r, 5));
  }
  setAppUserModelId() {}
  disableHardwareAcceleration() {
    f.noGpu = true;
    record('disableHardwareAcceleration');
  }
  setLoginItemSettings(s) {
    Object.assign(f.loginItem, s);
    record('loginItem', s);
  }
  getLoginItemSettings() {
    return { ...f.loginItem };
  }
  relaunch() {
    f.relaunched = true;
    f.relaunchEnv = {
      EVE_HUD_HOME: process.env.EVE_HUD_HOME ?? null,
      EVE_HUD_DATA: process.env.EVE_HUD_DATA ?? null,
    };
  }
  quit() {
    f.quitCalls += 1;
    let prevented = false;
    this.emit('before-quit', {
      preventDefault: () => {
        prevented = true;
      },
    });
    if (prevented) return;
    if (f.quit) return;
    f.quit = true;
    // like Electron: windows get 'close' / 'closed' before the app quits
    for (const w of f.windows)
      if (!w.destroyed) {
        w.emit('close', { preventDefault() {} });
        w.destroyed = true;
        w.emit('closed');
      }
    record('quit');
    this.emit('quit');
  }
  exit(code = 0) {
    f.exited = code;
    record('exit', { code });
  }
}
export const app = new App();
app.dock = { setIcon() {}, hide() {} };

// ---------- screen ----------
const displays = () =>
  opt.displays || [
    {
      id: 1,
      label: 'Main',
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      workArea: { x: 0, y: 0, width: 2560, height: 1400 },
      size: { width: 2560, height: 1440 },
      scaleFactor: 1,
    },
    {
      id: 2,
      label: 'Portrait',
      bounds: { x: 2560, y: 0, width: 1200, height: 1920 },
      workArea: { x: 2560, y: 0, width: 1200, height: 1880 },
      size: { width: 1200, height: 1920 },
      scaleFactor: 1,
    },
  ];
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
class Screen extends EventEmitter {
  getAllDisplays() {
    return displays();
  }
  getPrimaryDisplay() {
    return displays()[0];
  }
  getDisplayMatching(r) {
    return displays().reduce(
      (best, d) => (overlap(d.bounds, r) > overlap(best.bounds, r) ? d : best),
      displays()[0],
    );
  }
}
export const screen = new Screen();

// ---------- windows ----------
// ---------- sessions ----------
class Session {
  constructor(name, persistent) {
    this.name = name;
    this.persistent = persistent;
    this.cleared = [];
    this.beforeRequest = null;
    this.beforeSendHeaders = null;
    this.permissionRequest = null;
    this.permissionCheck = null;
    this.webRequest = {
      onBeforeRequest: (_filter, fn) => {
        this.beforeRequest = fn;
      },
      onBeforeSendHeaders: (_filter, fn) => {
        this.beforeSendHeaders = fn;
      },
    };
  }
  setPermissionRequestHandler(fn) {
    this.permissionRequest = fn;
  }
  setPermissionCheckHandler(fn) {
    this.permissionCheck = fn;
  }
  clearStorageData() {
    this.cleared.push('storage');
    return Promise.resolve();
  }
  clearCache() {
    this.cleared.push('cache');
    return Promise.resolve();
  }
}
const sessionFor = (name) =>
  (f.sessions[name] ||= new Session(name, name === 'default' || name.startsWith('persist:')));
export const session = {
  get defaultSession() {
    return sessionFor('default');
  },
  fromPartition: (p) => sessionFor(p),
};

class WebContents extends EventEmitter {
  constructor(partition) {
    super();
    this.url = '';
    this.zoom = 0;
    this.openHandler = null;
    this.session = sessionFor(partition || 'default');
  }
  getURL() {
    return this.url;
  }
  setWindowOpenHandler(fn) {
    this.openHandler = fn;
  }
  reloadIgnoringCache() {
    record('reload');
  }
  toggleDevTools() {
    record('devtools');
  }
  getZoomLevel() {
    return this.zoom;
  }
  setZoomLevel(z) {
    this.zoom = z;
  }
}
export class BrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.normal = { ...this.bounds };
    this.full = false;
    this.visible = false;
    this.destroyed = false;
    this.webContents = new WebContents(options.webPreferences?.partition);
    f.windows.push(this);
    record('window', { bounds: this.bounds });
    setTimeout(() => this.emit('ready-to-show'), 5);
  }
  loadURL(u) {
    this.webContents.url = u;
    record('loadURL', { url: u });
    // the reset window (src/recovery.js): click its button, or close it
    if (u.startsWith('data:text/html')) {
      f.recoveryPages = (f.recoveryPages || 0) + 1;
      if (opt.recovery === 'reset')
        setTimeout(() => this.emit('page-title-updated', { preventDefault() {} }, 'eve-hud:reset'), 20);
      if (opt.recovery === 'close') setTimeout(() => this.close(), 20);
    }
    return Promise.resolve();
  }
  show() {
    this.visible = true;
  }
  focus() {}
  restore() {}
  isMinimized() {
    return false;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isFullScreen() {
    return this.full;
  }
  isMaximized() {
    return Boolean(this.maxed);
  }
  maximize() {
    if (this.maxed) return;
    this.maxed = true;
    this.normal = { ...this.bounds };
    this.bounds = { x: 0, y: 25, width: 2560, height: 1375 };
    record('maximize');
    this.emit('maximize');
    this.emit('resize');
  }
  unmaximize() {
    if (!this.maxed) return;
    this.maxed = false;
    this.bounds = { ...this.normal };
    this.emit('unmaximize');
    this.emit('resize');
  }
  setFullScreen(on) {
    if (on === this.full) return;
    this.full = on;
    if (on) this.normal = { ...this.bounds };
    record('fullscreen', { on });
    setTimeout(() => this.emit(on ? 'enter-full-screen' : 'leave-full-screen'), 1);
  }
  getBounds() {
    return { ...this.bounds };
  }
  getNormalBounds() {
    return this.full ? { ...this.normal } : { ...this.bounds };
  }
  setBounds(b) {
    this.bounds = { ...this.bounds, ...b };
    record('setBounds', { bounds: this.bounds });
    this.emit('move');
  }
  close() {
    this.emit('close', { preventDefault() {} });
    this.destroyed = true;
    this.emit('closed');
    if (f.windows.every((w) => w.destroyed)) app.emit('window-all-closed');
  }
}

// ---------- tray + menus ----------
export const Menu = {
  buildFromTemplate: (template) => ({ template }),
  setApplicationMenu: (m) => {
    f.appMenu = m;
  },
};
export class Tray extends EventEmitter {
  constructor(image) {
    super();
    f.tray = this;
    this.image = image;
  }
  setToolTip(t) {
    this.tip = t;
  }
  setContextMenu(m) {
    this.menu = m;
    f.trayMenus.push(m.template);
  }
  destroy() {}
}
export const nativeImage = {
  createFromPath: (p) => ({
    path: p,
    setTemplateImage() {},
    resize(size) {
      return { ...this, size };
    },
  }),
};

// ---------- dialogs + shell ----------
export const dialog = {
  async showMessageBox(o) {
    if (opt.dialogDelayMs) await new Promise((r) => setTimeout(r, opt.dialogDelayMs)); // "the user reads it"
    const response = (opt.messageResponses || []).shift() ?? 0;
    f.dialogs.push({ message: o.message, detail: o.detail, buttons: o.buttons, response });
    return { response };
  },
  async showOpenDialog(o) {
    const next = (opt.openDialogResults || []).shift();
    f.dialogs.push({ open: o.title, result: next ?? null });
    return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
  },
  showErrorBox(title, content) {
    f.dialogs.push({ error: title, detail: content });
  },
};
export const shell = {
  async openPath(p) {
    f.opened.push(p);
    return '';
  },
  showItemInFolder(p) {
    f.opened.push(`show:${p}`);
  },
  openExternal(u) {
    f.external.push(u);
  },
};

// ---------- safeStorage ----------
// Stand-in for the Keychain / DPAPI: "encrypts" with a per-computer key (options.osKey), so a value
// from another "computer" can't be decrypted. options.encryption: false = none available.
const osKey = () => String(opt.osKey || 'this-computer');
export const safeStorage = {
  isEncryptionAvailable: () => opt.encryption !== false,
  encryptString: (s) => Buffer.from(`${osKey()}|${s}`, 'utf8').reverse(),
  decryptString: (buf) => {
    const text = Buffer.from(buf).reverse().toString('utf8');
    if (!text.startsWith(`${osKey()}|`))
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
    return text.slice(osKey().length + 1);
  },
};

export default {
  app,
  screen,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  dialog,
  shell,
  session,
  safeStorage,
  path,
};
