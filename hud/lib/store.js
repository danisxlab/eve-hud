// SPDX-License-Identifier: GPL-3.0-or-later
// Config + local JSON persistence (settings, tokens, caches).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canEncrypt, isSealed, seal, unseal } from './secrets.js';

// ROOT: the HUD code (server.js, lib/, public/, config.example.json). Read-only in the installed
// app, where it lives in app.asar.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// HOME: where config.json and data/ live. The app (src/main.js) sets EVE_HUD_HOME to its folder
// (%APPDATA%\EVE HUD, ~/Library/Application Support/EVE HUD) before loading the server. Read once
// at import time, so it must be set before server.js (or any lib/ module) is imported.
if (!process.env.EVE_HUD_HOME)
  throw new Error('EVE_HUD_HOME is not set: start EVE HUD with npm start (the app sets it)');
export const HOME = path.resolve(process.env.EVE_HUD_HOME);
export const CONFIG_FILE = path.join(HOME, 'config.json');
// DATA_DIR: data/ (login, layout, star map, caches), next to config.json unless the app was told
// to keep it somewhere else (Settings → Storage; EVE_HUD_DATA).
export const DATA_DIR = process.env.EVE_HUD_DATA
  ? path.resolve(process.env.EVE_HUD_DATA)
  : path.join(HOME, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// config.json and data/ are written readable for your user account only (on a Mac and Linux; on
// Windows %APPDATA% is private already), so other accounts on the computer can't read your login,
// even where the system has no encryption (some Linux desktops). Files from older versions or an
// imported folder are made private when they're loaded.
export const PRIVATE = { mode: 0o600 };
export function makePrivate(file) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* not there (yet) */
  }
}
makePrivate(CONFIG_FILE);
makePrivate(path.join(DATA_DIR, 'tokens.json'));

export function dataPath(name) {
  return path.join(DATA_DIR, name);
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Atomic write: write to a temp file, then rename over the original.
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), PRIVATE);
  fs.renameSync(tmp, file);
}

// The app's version (package.json "version"; the app passes it in EVE_HUD_VERSION), for the
// User-Agent that identifies the HUD to CCP/Fenris Creations. Changing the version changes it too.
const APP_VERSION =
  process.env.EVE_HUD_VERSION || readJson(path.join(ROOT, '..', 'package.json'), {})?.version || 'dev';
const DEFAULT_USER_AGENT = `eve-hud/${APP_VERSION} (+https://github.com/danisxlab/eve-hud)`;
// User-Agents earlier versions wrote into config.json: replaced by the current one
const isOldDefaultUserAgent = (ua) =>
  typeof ua === 'string' &&
  /^eve-hud\/[\w.-]+ \((personal second-screen dashboard|\+https:\/\/github\.com\/danisxlab\/eve-hud)\)$/.test(
    ua,
  );

const DEFAULT_CONFIG = {
  clientId: '',
  clientSecret: '',
  port: 4747,
  callbackUrl: 'http://localhost:4747/callback',
  scopes: [],
  compatibilityDate: '2026-08-18',
  userAgent: DEFAULT_USER_AGENT,
  eveLogDir: '', // EVE's logs folder ('' = the usual place); chatLogDir: the older setting (a Chatlogs folder)
  chatLogDir: '',
  chatChannels: [
    { id: 'local', label: 'Local', filePrefix: 'Local' },
    { id: 'corp', label: 'Corp', filePrefix: 'Corp' },
    { id: 'militia', label: 'Militia', filePrefix: 'Militia', fw: true },
  ],
  chatPollMs: 1000,
  // seconds; each feed refreshes when ESI's cache expires, clamped to [min, max]
  refresh: {
    status: { min: 30, max: 120 },
    esihealth: { min: 60, max: 300 },
    presence: { min: 5, max: 60 },
    skills: { min: 60, max: 900 },
    wallet: { min: 60, max: 900 },
    industry: { min: 120, max: 900 },
    objectives: { min: 120, max: 900 },
    orders: { min: 300, max: 1800 },
    character: { min: 120, max: 3600 },
    hazards: { min: 300, max: 1800 },
    warfare: { min: 600, max: 3600 },
    traffic: { min: 600, max: 3600 },
    sovereignty: { min: 1800, max: 3600 },
    clones: { min: 300, max: 3600 },
    mail: { min: 60, max: 600 },
    notifications: { min: 120, max: 1800 },
    activity: { min: 300, max: 1800 },
    mining: { min: 600, max: 3600 },
    assets: { min: 1800, max: 3600 },
    standings: { min: 1800, max: 3600 },
    kills: { min: 600, max: 3600 },
  },
  hazards: { pvpKillThreshold: 3 },
  notifications: { ignoreTypes: [] },
  rateLimit: { reserve: 0.25, maxWaitSeconds: 15 },
  // window mode and which monitor to use
  window: { mode: 'normal', display: 'last' },
};

export function loadConfig() {
  const file = CONFIG_FILE;
  if (!fs.existsSync(file)) {
    const example = path.join(ROOT, 'config.example.json');
    // read + write instead of copyFileSync: the example sits inside app.asar in the installed app
    if (fs.existsSync(example)) fs.writeFileSync(file, fs.readFileSync(example), PRIVATE);
  }
  const raw = readJson(file, null);
  if (raw === null && fs.existsSync(file)) {
    throw new Error(
      `config.json is not valid JSON. Fix it or delete it to regenerate from config.example.json.`,
    );
  }
  const cfg = { ...DEFAULT_CONFIG, ...(raw || {}) };
  if (!cfg.userAgent || isOldDefaultUserAgent(cfg.userAgent)) cfg.userAgent = DEFAULT_USER_AGENT; // follows the version
  cfg.refresh = { ...DEFAULT_CONFIG.refresh };
  for (const [k, v] of Object.entries(raw?.refresh || {}))
    if (v && typeof v === 'object') cfg.refresh[k] = { ...DEFAULT_CONFIG.refresh[k], ...v };
  cfg.rateLimit = { ...DEFAULT_CONFIG.rateLimit, ...(raw?.rateLimit || {}) };
  cfg.hazards = { ...DEFAULT_CONFIG.hazards, ...(raw?.hazards || {}) };
  cfg.notifications = { ...DEFAULT_CONFIG.notifications, ...(raw?.notifications || {}) };
  cfg.window = {
    ...DEFAULT_CONFIG.window,
    ...(raw?.window && typeof raw.window === 'object' ? raw.window : {}),
  };
  if (!Array.isArray(cfg.notifications.ignoreTypes)) cfg.notifications.ignoreTypes = [];
  // The Militia channel is always read (also with an older config.json that lists only Local and
  // Corp); the chat module shows its tab only while you're enlisted in Faction Warfare.
  if (!Array.isArray(cfg.chatChannels)) cfg.chatChannels = DEFAULT_CONFIG.chatChannels;
  if (!cfg.chatChannels.some((c) => c.id === 'militia'))
    cfg.chatChannels = [...cfg.chatChannels, MILITIA_CHANNEL];
  // Client ID and Secret Key are stored encrypted (lib/secrets.js)
  cfg.secretProblem = null;
  for (const k of CREDENTIALS) {
    try {
      cfg[k] = unseal(cfg[k]);
    } catch {
      cfg[k] = '';
      cfg.secretProblem =
        'The saved Client ID and Secret Key of your own EVE application could not be decrypted: they were saved on another computer or user account. Log in with the built-in EVE HUD application, or enter them again.';
    }
  }
  for (const k of CREDENTIALS) if (String(cfg[k] || '').startsWith('PASTE_')) cfg[k] = ''; // config.example.json's placeholders
  cfg.ownApp = hasOwnApp(cfg);
  cfg.configured = isConfigured(cfg);
  // Still plain text in the file (older version or imported): encrypt them now.
  const plain = (k) => raw?.[k] && !String(raw[k]).startsWith('PASTE_') && !isSealed(raw[k]);
  if (cfg.ownApp && canEncrypt() && CREDENTIALS.some(plain)) {
    try {
      setCredentials(cfg);
    } catch {
      /* stays plain until the next start */
    }
  }
  return cfg;
}

const CREDENTIALS = ['clientId', 'clientSecret'];
// EVE's Faction Warfare channel; its log files are named Militia_<date>_<time>[_<character>].txt
export const MILITIA_CHANNEL = { id: 'militia', label: 'Militia', filePrefix: 'Militia', fw: true };

// Saves the Client ID and Secret Key, encrypted. Empty values clear them.
export function setCredentials({ clientId = '', clientSecret = '' }) {
  setConfigValues({ clientId: seal(clientId), clientSecret: seal(clientSecret) });
}

// Changes top-level values (strings, numbers) in config.json (Client ID / Secret from the HUD's setup form,
// or clearing them with "Reset EVE HUD"). config.json is hand-edited and holds the secret, so this
// replaces only those values and keeps your formatting and every other key; only when that isn't
// possible is the file rewritten with standard formatting. Checked with JSON.parse before writing.
export function setConfigValues(values) {
  if (!fs.existsSync(CONFIG_FILE)) loadConfig(); // creates it from config.example.json
  let text = fs.readFileSync(CONFIG_FILE, 'utf8');
  const parsed = JSON.parse(text);
  for (const [key, value] of Object.entries(values)) {
    // the old value: a string, a number, true/false or null
    const re = new RegExp(`("${key}"\\s*:\\s*)(?:"(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?|true|false|null)`);
    if (re.test(text)) text = text.replace(re, (all, head) => head + JSON.stringify(value));
    else {
      const brace = text.indexOf('{');
      const indent = /\n([ \t]+)"/.exec(text)?.[1] || '  ';
      text = `${text.slice(0, brace + 1)}\n${indent}${JSON.stringify(key)}: ${JSON.stringify(value)},${text.slice(brace + 1)}`;
    }
  }
  let ok = false;
  try {
    const check = JSON.parse(text);
    ok = Object.entries(values).every(([k, v]) => check[k] === v);
  } catch {
    /* fall through */
  }
  if (!ok) text = `${JSON.stringify({ ...parsed, ...values }, null, 2)}\n`;
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, PRIVATE);
  fs.renameSync(tmp, CONFIG_FILE);
}

// Every scope the HUD can use (the list in config.example.json), for "Grant access".
export function knownScopes() {
  return readJson(path.join(ROOT, 'config.example.json'), {})?.scopes || [];
}

// Adds scopes to the "scopes" list in config.json, in place (one new line per scope, same
// indentation, nothing else touched). Returns the full list afterwards.
export function addConfigScopes(add) {
  if (!fs.existsSync(CONFIG_FILE)) loadConfig();
  const text = fs.readFileSync(CONFIG_FILE, 'utf8');
  const parsed = JSON.parse(text);
  const have = Array.isArray(parsed.scopes) ? parsed.scopes : [];
  const missing = [...new Set(add)].filter((x) => !have.includes(x));
  if (!missing.length) return have;
  const want = [...have, ...missing];
  let next = null;
  const m = /("scopes"\s*:\s*\[)([\s\S]*?)(\s*)\]/.exec(text);
  if (m) {
    const indent = /\n([ \t]+)"/.exec(m[2])?.[1] || '    ';
    const body = m[2].trim() ? `${m[2]},` : '';
    const added = missing.map((x) => `\n${indent}${JSON.stringify(x)}`).join(',');
    next =
      text.slice(0, m.index) +
      m[1] +
      body +
      added +
      (m[3] || '\n  ') +
      ']' +
      text.slice(m.index + m[0].length);
    try {
      if (JSON.stringify(JSON.parse(next).scopes) !== JSON.stringify(want)) next = null;
    } catch {
      next = null;
    }
  }
  if (!next) next = `${JSON.stringify({ ...parsed, scopes: want }, null, 2)}\n`;
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next, PRIVATE);
  fs.renameSync(tmp, CONFIG_FILE);
  return want;
}

// The EVE HUD application on developers.eveonline.com, registered by the author for everyone: a
// public Client ID without a Secret Key (EVE SSO's PKCE flow for desktop apps), so players don't
// need an application of their own. Its Callback URL is fixed, so the built-in login needs port 4747.
// Your own application (Client ID, and optionally its Secret Key, in config.json) replaces it.
export const BUILTIN_CLIENT_ID = 'a4168fa5545f4bc290966721eb4574b7';
export const BUILTIN_PORT = 4747;
export const BUILTIN_CALLBACK_URL = `http://localhost:${BUILTIN_PORT}/callback`;

// "port" in config.json was changed, but the login goes through the EVE HUD application, whose
// Callback URL only comes back to port 4747: the page shows a red window asking to change it back.
export const builtinPortProblem = (cfg) => !hasOwnApp(cfg) && Number(cfg.port) !== BUILTIN_PORT;

// Your own EVE application is set (Client ID in config.json; the Secret Key is optional). The EVE HUD
// application's own Client ID, copied into config.json by hand, still counts as the built-in one: it
// only works on port 4747 and without a Secret Key.
export const hasOwnApp = (cfg) =>
  Boolean(cfg.clientId && !String(cfg.clientId).startsWith('PASTE_') && cfg.clientId !== BUILTIN_CLIENT_ID);

// Ready to log in: always, with your own application or the built-in one.
export const isConfigured = () => true;

// The application the login uses: { clientId, clientSecret ('' = PKCE), callbackUrl, builtin }.
export function loginApp(cfg) {
  if (hasOwnApp(cfg))
    return {
      clientId: cfg.clientId,
      clientSecret: String(cfg.clientSecret || '').startsWith('PASTE_') ? '' : cfg.clientSecret || '',
      callbackUrl: cfg.callbackUrl,
      builtin: false,
    };
  return { clientId: BUILTIN_CLIENT_ID, clientSecret: '', callbackUrl: BUILTIN_CALLBACK_URL, builtin: true };
}

// Settings are owned by the browser UI; the server only validates size and shape.
let SETTINGS_FILE = dataPath('settings.json');

// Demo mode keeps its own layout so it never rearranges your live HUD.
export function useSettingsFile(name) {
  SETTINGS_FILE = dataPath(name);
}

export function loadSettings() {
  return readJson(SETTINGS_FILE, {});
}

export function saveSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    throw new Error('Settings must be a JSON object');
  const text = JSON.stringify(obj);
  if (text.length > 256 * 1024) throw new Error('Settings too large');
  writeJson(SETTINGS_FILE, obj);
}
