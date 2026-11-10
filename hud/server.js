// SPDX-License-Identifier: GPL-3.0-or-later
// EVE HUD's local server. No dependencies beyond Node's built-ins.
//
// The app (src/main.js) imports this file and calls startServer() in its own process; the HUD window
// shows http://localhost:<port>/. The server listens on 127.0.0.1 only. It exists because the EVE
// login has to return somewhere: EVE sends your browser to http://localhost:<port>/callback.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  HOME,
  CONFIG_FILE,
  DATA_DIR,
  loadConfig,
  loadSettings,
  saveSettings,
  useSettingsFile,
  setConfigValues,
  setCredentials,
  isConfigured,
  hasOwnApp,
  loginApp,
  knownScopes,
  addConfigScopes,
  builtinPortProblem,
  GITHUB_USER_AGENT,
  BUILTIN_CLIENT_ID,
  CLIENT_ID_RE,
  BUILTIN_PORT,
} from './lib/store.js';
import { createAuth } from './lib/auth.js';
import { createEsi } from './lib/esi.js';
import { createUniverse } from './lib/universe.js';
import { createFeeds } from './lib/feeds.js';
import {
  createChatLogs,
  autoDir as chatAutoDir,
  chatDirFor,
  logsRootFor,
  configuredLogsDir,
} from './lib/chatlogs.js';
import { createGameLogs, idleSecondsOf } from './lib/gamelogs.js';
import { createDemo, demoUniverse, demoShowInfo, DEMO_ITEM_NAMES } from './lib/demo.js';
import { createShowInfo } from './lib/showinfo.js';
import { createRouter } from './lib/route.js';
import { createUpdateCheck } from './lib/updates.js';

const defaultLog = {
  info: (...a) => console.log(new Date().toISOString().slice(11, 19), ...a),
  warn: (...a) => console.warn(new Date().toISOString().slice(11, 19), ...a),
};
const PUBLIC = path.join(ROOT, 'public');

// ---------------- http ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 300 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Text in the small HTML pages the server writes itself (login done, login failed): never markup.
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// Sent with every page and file: no other website may show the HUD in a frame, files are only
// read as what they are, and no address leaks to the sites the HUD links to.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
};

// The HUD only answers to this computer's own names. A website that points its own name at
// 127.0.0.1 ("DNS rebinding") arrives with that name in Host, and gets nothing.
export function isLocalHost(host) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i.test(String(host || ''));
}

// From another website (or another localhost port) in a browser? Requests without these headers
// (the app's own server-side code, tests) aren't from a web page.
export function isCrossSite(req) {
  const site = String(req.headers['sec-fetch-site'] || '');
  if (site === 'cross-site' || site === 'same-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true; // "null" (sandboxed frames, files) or malformed
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(buf);
  });
}

// Shown in your browser after a login started from the app: logged in, back to the app.
function donePage(res, name) {
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(`<!doctype html><meta charset="utf-8"><title>Logged in to EVE HUD</title>
<body style="background:#000;color:#c9d3d6;font:16px system-ui;padding:40px">
<h1 style="color:#8fe6c4;font-weight:500">Logged in${name ? ` as ${esc(name)}` : ''}</h1>
<p>EVE HUD has logged you in successfully. You can close this tab and go back to the app.</p>`);
}

function errorPage(res, title, detail) {
  res.writeHead(400, { 'Content-Type': MIME['.html'], ...SECURITY_HEADERS });
  res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<body style="background:#000;color:#c9d3d6;font:16px system-ui;padding:40px">
<h1 style="color:#d9493a;font-weight:500">${esc(title)}</h1><p>${esc(detail)}</p><p><a style="color:#6fe0c4" href="/">Back to the HUD</a></p>`);
}

// ---------------- start ----------------
// Starts the HUD server and resolves once it is listening.
//   demo        sample data, no login (uses data/settings-demo.json)
//   port        overrides config.port (the login callback only works on the callbackUrl port)
//   rebuildMap  force a fresh star map download
//   host        listen address, 127.0.0.1 by default: the HUD is never reachable from the network
//   log         { info, warn } for log lines; the app passes its log file writer
//   onPortChange(url)  called when the setup form (or Reset) moved the HUD to another port (the app window follows)
//   onLogin(name)      called after a successful EVE login (the app comes to the front)
// Rejects with err.code 'EADDRINUSE' (port taken) or 'EACCES' (port not allowed) and a readable
// message when the port can't be used; calling it again after such a failure is fine (the desktop
// app's "Try again"). Run one HUD per process: the settings file and lib/ caches are shared.
//   storage     from the app: where config.json and data/ are, and how to change that
//               { get() -> { configDir, dataDir, defaults: { configDir, dataDir }, fixed },
//                 browse(which, current) -> folder | null, move({ configDir, dataDir }) -> { ok } }
export async function startServer({
  demo = false,
  port,
  rebuildMap = false,
  host = '127.0.0.1',
  log = defaultLog,
  onPortChange = () => {},
  onLogin = () => {},
  storage = null,
} = {}) {
  const config = loadConfig();
  const DEMO = Boolean(demo);
  if (DEMO) useSettingsFile('settings-demo.json');
  // port: e.g. 4748 for a demo next to your live HUD.
  // (Live login only works on the port in callbackUrl, so use this mainly with demo mode.)
  if (port) config.port = Number(port) || config.port;
  const portFromOption = Boolean(port); // --port=N: chosen for this start, so Reset leaves it alone
  // where EVE sends the login back: your own application's callback URL, or the built-in one's
  const isCallbackPath = (p) => p === new URL(loginApp(config).callbackUrl).pathname;

  const appLogins = new Set(); // login states started from the app (they end on a "done" page)

  // ---------------- live state + server-sent events ----------------
  const clients = new Set();
  const latest = {}; // feed name -> payload

  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function broadcast(event, data) {
    for (const res of clients) send(res, event, data);
  }
  function publish(name, payload) {
    latest[name] = payload;
    broadcast('feed', { name, ...payload });
  }

  // New versions on GitHub (lib/updates.js): "Update Ready" in the top bar. Only with a version to
  // compare (the app passes it); Settings → Updates turns it off. EVE_HUD_UPDATE_CHECK=off: never.
  const updatesOn = () => loadSettings()?.updates?.check !== false;
  const updates = createUpdateCheck({
    version: process.env.EVE_HUD_UPDATE_CHECK === 'off' ? null : process.env.EVE_HUD_VERSION || null,
    userAgent: GITHUB_USER_AGENT, // without the contact address: that's for EVE's servers
    enabled: updatesOn,
    onChange: (u) => broadcast('update', u),
    log,
  });

  // the character and permissions the feeds were started for
  const feedsKey = (s) => (s?.loggedIn ? `${s.characterId}|${[...(s.scopes || [])].sort().join(' ')}` : '');
  let feedsCharacter = null;
  const auth = createAuth(config, {
    log,
    onChange: (s) => {
      latest.auth = s;
      broadcast('auth', s);
      // restart the feeds for another character or other permissions (login, logout, Grant access),
      // not for a refreshed token: that restart dropped answers in flight (see feeds.js)
      const who = feedsKey(s);
      if (!DEMO && who !== feedsCharacter) {
        feedsCharacter = who;
        feeds.start();
      }
    },
  });
  const esi = createEsi(config, auth, { log });
  const universe = createUniverse({
    esi,
    userAgent: config.userAgent,
    log,
    onProgress: (s) => broadcast('universe', s),
  });
  const showInfo = DEMO ? demoShowInfo(universe) : createShowInfo({ esi, universe, log });
  const feeds = createFeeds({
    esi,
    auth,
    universe,
    publish,
    refresh: config.refresh,
    hazards: config.hazards,
    notifications: config.notifications,
    log,
  });
  const router = createRouter({ esi, auth, universe, demo: DEMO, log });

  // ---------------- what the open pages show ----------------
  // The HUD page reports which modules and top-bar parts it shows;
  // the feeds poll for the union. A page that goes away is forgotten after 30 s (so a reload
  // doesn't pause and restart everything); with no page open only the top bar's feeds run.
  const demandByClient = new Map(); // client id -> Set of consumers
  const forgetTimers = new Map();
  function updateDemand() {
    const all = new Set(['topbar']);
    if (!demandByClient.size) all.add('mail');
    for (const set of demandByClient.values()) for (const c of set) all.add(c);
    if (!DEMO) feeds.setDemand(all); // demo mode publishes its own sample feeds
  }
  const cleanClientId = (v) => (typeof v === 'string' && /^[\w-]{6,64}$/.test(v) ? v : null);

  const chatBuffers = {};
  let chatStatus = null;
  let chatLogs = null; // the chat log reader (not in demo mode)
  let gameLogs = null; // combat from the game logs (not in demo mode)
  let logsHealth = null; // { ok, dir, error }: the "EVE logs can't be read" window in the HUD
  let combat = { active: false, t: 0 };
  let autopilot = { on: false, next: null }; // the in-game autopilot, from the game log
  const chatLogInfo = () => ({
    dir: configuredLogsDir(config), // EVE's logs folder as set; '' = the usual place
    auto: logsRootFor(chatAutoDir()), // the usual place on this computer, if it exists
    reading: logsRootFor(chatStatus?.dir || ''), // the logs folder being read (its Chatlogs, Gamelogs…)
    found: Boolean(chatStatus?.found),
    demo: DEMO,
    game: logsHealth, // can the game logs (combat) be read? null in demo mode
  });
  function publishChat(channel, messages, initial = false) {
    if (initial) chatBuffers[channel] = [];
    (chatBuffers[channel] ||= []).push(...messages);
    if (chatBuffers[channel].length > 300) chatBuffers[channel].splice(0, chatBuffers[channel].length - 300);
    broadcast('chat', { channel, messages, initial });
  }

  function authStatus() {
    if (DEMO)
      return {
        loggedIn: true,
        demo: true,
        configured: true,
        ownApp: false,
        characterName: 'Demo Capsuleer',
        characterId: 2112625428,
        scopes: [],
      };
    const st = auth.status();
    return config.secretProblem && !st.loggedIn ? { ...st, secretProblem: config.secretProblem } : st;
  }

  function snapshot() {
    return {
      auth: authStatus(),
      feeds: latest,
      universe: universe.state,
      chat: { status: chatStatus, channels: chatBuffers },
      combat,
      autopilot,
      logs: logsHealth,
      update: updates.state(),
      settings: loadSettings(),
      // files + app: for the help texts in the page, which say where config.json and data/ are
      config: {
        port: config.port,
        callbackUrl: config.callbackUrl,
        chatChannels: config.chatChannels,
        demo: DEMO,
        files: { configFile: CONFIG_FILE, dataDir: DATA_DIR },
        app: true,
        version: process.env.EVE_HUD_VERSION || null,
        commit: process.env.EVE_HUD_COMMIT || null, // the commit it was built from (About: v1.0.3_8f2c1d0)
        scopes: config.scopes, // for the setup form: what to enable on the EVE application
        knownScopes: knownScopes(), // everything the HUD can use (Settings → Account: "16 of 22 permissions")
      },
    };
  }

  // One request handler, so the HUD can move to another port (setup form) without a restart.
  const onRequest = async (req, res) => {
    if (!isLocalHost(req.headers.host)) {
      res.writeHead(421, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      return res.end('EVE HUD only answers on localhost.');
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    // The API is only for the HUD page itself, not for another website open in the same browser:
    // not for changes (settings, logout, autopilot…), and not for reads or work either (ESI lookups,
    // routes, the live stream). Browsers say where a request comes from (Origin, Sec-Fetch-Site).
    if (p.startsWith('/api/') && isCrossSite(req))
      return json(res, 403, { error: 'Cross-site request refused' });
    try {
      // /login?from=app: the app opens this in your default browser, so the EVE login (and its
      // cookies) stay in the browser you trust; the app itself never shows EVE's login page.
      if (p === '/login') {
        // The built-in application's Callback URL is http://localhost:4747/callback: EVE sends the
        // login back to that port only.
        const app = loginApp(config);
        const cbPort = Number(new URL(app.callbackUrl).port || 80);
        if (cbPort !== config.port)
          return errorPage(
            res,
            `The login needs port ${cbPort}`,
            app.builtin
              ? `The built-in EVE HUD login only comes back to port ${cbPort}, and this HUD runs on port ${config.port}. Set "port" in config.json back to ${cbPort} and restart, or use your own EVE application (the login screen has a link for it).`
              : `Your application's callback URL (${app.callbackUrl}) uses port ${cbPort}, and this HUD runs on port ${config.port}. Make "port" and "callbackUrl" in config.json match.`,
          );
        const target = auth.loginUrl();
        if (url.searchParams.get('from') === 'app') {
          appLogins.add(new URL(target).searchParams.get('state'));
          if (appLogins.size > 20) appLogins.delete(appLogins.values().next().value);
        }
        res.writeHead(302, { Location: target });
        return res.end();
      }
      if (isCallbackPath(p)) {
        if (url.searchParams.get('error') === 'invalid_scope') {
          return errorPage(
            res,
            'EVE refused a permission',
            loginApp(config).builtin
              ? 'The built-in EVE HUD application does not have every scope the HUD asked for. Please report this on GitHub (danisxlab/eve-hud); meanwhile you can use your own EVE application.'
              : 'Your EVE application does not have every scope the HUD asked for. Open your application on developers.eveonline.com, tick all scopes listed under "scopes" in config.json (the HUD\'s setup form and the documentation list them), save, and log in again.',
          );
        }
        if (url.searchParams.get('error'))
          return errorPage(
            res,
            'EVE SSO login failed',
            // from the address, so anyone can write it: plain text (esc), and kept short
            String(url.searchParams.get('error_description') || url.searchParams.get('error')).slice(0, 200),
          );
        const state = url.searchParams.get('state');
        const fromApp = appLogins.delete(state);
        let who;
        try {
          who = await auth.handleCallback({ code: url.searchParams.get('code'), state });
        } catch (err) {
          return errorPage(res, 'EVE SSO login failed', err.message);
        }
        try {
          onLogin(who?.characterName || null);
        } catch {
          /* the login itself worked */
        }
        if (fromApp) return donePage(res, who?.characterName);
        res.writeHead(302, { Location: '/' });
        return res.end();
      }
      // Settings → Storage: where config.json and data/ are kept (the app moves them and restarts)
      if (p === '/api/storage' && req.method === 'GET') {
        if (!storage) return json(res, 404, { error: 'Not available' });
        return json(res, 200, storage.get());
      }
      if (p === '/api/storage/browse' && req.method === 'POST') {
        if (!storage) return json(res, 404, { error: 'Not available' });
        const body = await readBody(req)
          .then((t) => JSON.parse(t || '{}'))
          .catch(() => ({}));
        const folder = await storage.browse(
          ['data', 'logs'].includes(body.which) ? body.which : 'config',
          String(body.current || ''),
        );
        return json(res, 200, { folder: folder || null });
      }
      if (p === '/api/storage' && req.method === 'POST') {
        if (!storage) return json(res, 404, { error: 'Not available' });
        const body = await readBody(req)
          .then((t) => JSON.parse(t || '{}'))
          .catch(() => ({}));
        try {
          return json(
            res,
            200,
            await storage.move({
              configDir: String(body.configDir || ''),
              dataDir: String(body.dataDir || ''),
            }),
          );
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      // Settings → Storage → EVE logs: EVE's logs folder (chat from its Chatlogs, combat from Gamelogs)
      if (p === '/api/chatlogs' && req.method === 'GET') return json(res, 200, chatLogInfo());
      if (p === '/api/chatlogs' && req.method === 'POST') {
        const body = await readBody(req)
          .then((t) => JSON.parse(t || '{}'))
          .catch(() => ({}));
        const dir = String(body.dir || '').trim();
        if (dir) {
          let st = null;
          try {
            st = fs.statSync(dir);
          } catch {
            /* below */
          }
          if (!st?.isDirectory())
            return json(res, 400, {
              error: `Can't reach that folder: ${dir}. Check the path, and that the network share is connected.`,
            });
        }
        // saved as the logs folder (also when Chatlogs or Gamelogs was chosen); chat reads its
        // Chatlogs, combat its Gamelogs. An older "chatLogDir" is emptied: eveLogDir replaces it.
        const root = logsRootFor(dir);
        const values = { eveLogDir: root };
        try {
          if (/"chatLogDir"/.test(fs.readFileSync(CONFIG_FILE, 'utf8'))) values.chatLogDir = '';
        } catch {
          /* a new file */
        }
        setConfigValues(values);
        config.eveLogDir = root;
        config.chatLogDir = '';
        chatLogs?.setDir(root ? chatDirFor(root) : '');
        logsHealth = gameLogs?.setChatDir(chatLogs?.status().dir || '') || logsHealth;
        log.info(`EVE logs: ${root || 'the usual place on this computer'}`);
        return json(res, 200, chatLogInfo());
      }
      // Settings → Combat: seconds without combat before ATTACK goes off (and a new attack can alert)
      if (p === '/api/combat' && req.method === 'GET')
        return json(res, 200, { idleSeconds: idleSecondsOf(config.combatIdleSeconds) });
      if (p === '/api/combat' && req.method === 'POST') {
        const body = await readBody(req)
          .then((t) => JSON.parse(t || '{}'))
          .catch(() => ({}));
        const idleSeconds = idleSecondsOf(body.idleSeconds);
        setConfigValues({ combatIdleSeconds: idleSeconds });
        config.combatIdleSeconds = idleSeconds;
        gameLogs?.setIdleSeconds(idleSeconds);
        return json(res, 200, { idleSeconds });
      }
      if (p === '/api/logout' && req.method === 'POST') {
        auth.logout();
        return json(res, 200, { ok: true });
      }
      if (p === '/api/state') return json(res, 200, snapshot());
      if (p === '/api/ratelimits')
        return json(res, 200, { reserve: config.rateLimit.reserve, groups: esi.rateStatus() });
      if (p === '/api/universe') {
        const data = universe.payload();
        return data ? json(res, 200, data) : json(res, 503, universe.state);
      }
      if (p === '/api/linknames') {
        const ln = universe.linkNames();
        if (DEMO && !ln.items.length) {
          ln.items = DEMO_ITEM_NAMES;
          ln.version += '|demo';
        }
        const etag = `"${Buffer.from(ln.version).toString('base64url')}"`;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag });
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', ETag: etag });
        return res.end(JSON.stringify({ version: ln.version, items: ln.items, systems: ln.systems }));
      }
      if (p === '/api/showinfo') {
        try {
          return json(
            res,
            200,
            await showInfo.lookup(url.searchParams.get('type'), url.searchParams.get('item')),
          );
        } catch (err) {
          return json(res, err.status === 400 || err.status === 404 ? err.status : 502, {
            error: err.message,
          });
        }
      }
      if (p === '/api/settings') {
        if (req.method === 'GET') return json(res, 200, loadSettings());
        if (req.method === 'PUT' || req.method === 'POST') {
          const wasOn = updatesOn();
          saveSettings(JSON.parse(await readBody(req)));
          if (updatesOn() !== wasOn) updates.check(); // Settings → Updates switched: ask now, or hide it
          return json(res, 200, { ok: true });
        }
      }
      if (p === '/api/refresh' && req.method === 'POST') {
        if (!DEMO) feeds.refresh(url.searchParams.get('feed') || undefined);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        res.write('retry: 3000\n\n');
        send(res, 'snapshot', snapshot());
        clients.add(res);
        const clientId = cleanClientId(url.searchParams.get('client'));
        if (clientId) {
          clearTimeout(forgetTimers.get(clientId));
          forgetTimers.delete(clientId);
        }
        const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
          if (clientId) {
            forgetTimers.set(
              clientId,
              setTimeout(() => {
                forgetTimers.delete(clientId);
                if (demandByClient.delete(clientId)) updateDemand();
              }, 30_000),
            );
          }
        });
        return;
      }
      // Your own EVE application, from the HUD page: { clientId, clientSecret } -> config.json, used
      // at once (no restart) instead of the built-in one. Only while none is set; "Reset EVE HUD"
      // clears it first. The Secret Key is optional (without one the login uses PKCE).
      // The secret is never sent back to the page and never logged.
      if (p === '/api/credentials' && req.method === 'POST') {
        if (DEMO) return json(res, 400, { error: 'Not available in demo mode' });
        if (hasOwnApp(config))
          return json(res, 409, { error: 'Already set up. Use "Reset EVE HUD" in Settings first.' });
        const body = JSON.parse((await readBody(req, 4096)) || '{}');
        const clientId = String(body.clientId || '').trim();
        const clientSecret = String(body.clientSecret || '').trim();
        if (!CLIENT_ID_RE.test(clientId))
          return json(res, 400, {
            error:
              "That doesn't look like a Client ID (usually 32 letters and digits). Copy it from your application on developers.eveonline.com.",
            field: 'clientId',
          });
        if (clientId === BUILTIN_CLIENT_ID)
          return json(res, 400, {
            error:
              "That's the EVE HUD application's own Client ID: it's already built in. Enter the Client ID of your own application, or go back to the EVE HUD login.",
            field: 'clientId',
          });
        if (
          clientSecret &&
          (clientSecret.length < 20 || clientSecret.length > 200 || /\s/.test(clientSecret))
        )
          return json(res, 400, {
            error:
              "That doesn't look like a Secret Key. Copy it from your application on developers.eveonline.com.",
            field: 'clientSecret',
          });
        // Another port for the HUD (and so for the callback URL)? Only with your own application (this
        // form): the EVE HUD application only works on 4747. Opened first: if that fails, nothing is saved.
        const newPort = body.port === undefined || body.port === '' ? config.port : Number(body.port);
        if (!Number.isInteger(newPort) || newPort < 1024 || newPort > 65535)
          return json(res, 400, { error: 'The port must be a number from 1024 to 65535.', field: 'port' });
        let moved = null;
        if (newPort !== config.port) {
          try {
            moved = await openPort(newPort);
          } catch (err) {
            return json(res, 409, {
              error:
                err.code === 'EADDRINUSE'
                  ? `Port ${newPort} is already in use on this computer. Pick another one.`
                  : err.message,
              field: 'port',
            });
          }
        }
        setCredentials({ clientId, clientSecret });
        config.scopes = addConfigScopes(knownScopes()); // the setup form listed all of them to enable
        Object.assign(config, { clientId, clientSecret });
        config.ownApp = hasOwnApp(config);
        config.configured = isConfigured(config);
        auth.logout(); // a login of the built-in application can't be refreshed by this one
        log.info(`EVE application set up (Client ID ${clientId.slice(0, 6)}…) in ${CONFIG_FILE}`);
        if (moved) {
          movePort(moved, newPort); // the reply below still goes out on the old port
          return json(res, 200, { ok: true, url: handle.url });
        }
        broadcast('auth', authStatus());
        return json(res, 200, { ok: true });
      }
      // "Grant access": { scopes: [...] } are added to "scopes" in config.json (only scopes the HUD
      // knows), so the next login asks EVE for them and EVE shows its consent screen.
      if (p === '/api/scopes' && req.method === 'POST') {
        if (DEMO) return json(res, 400, { error: 'Not available in demo mode' });
        const body = JSON.parse((await readBody(req, 8192)) || '{}');
        const known = new Set(knownScopes());
        const add = (Array.isArray(body.scopes) ? body.scopes : []).filter((x) => known.has(x));
        if (!add.length) return json(res, 400, { error: 'No known scopes given' });
        config.scopes = addConfigScopes(add);
        log.info(`Scopes added to config.json: ${add.filter((x) => config.scopes.includes(x)).join(', ')}`);
        return json(res, 200, { ok: true, scopes: config.scopes, login: '/login' });
      }
      // "Reset EVE HUD": log out and remove your own Client ID + Secret (the login then uses the
      // built-in EVE HUD application). Layout, settings and the map stay.
      if (p === '/api/reset' && req.method === 'POST') {
        if (DEMO) return json(res, 400, { error: 'Not available in demo mode' });
        auth.logout();
        setCredentials({ clientId: '', clientSecret: '' });
        Object.assign(config, { clientId: '', clientSecret: '', ownApp: false, secretProblem: null });
        config.configured = isConfigured(config);
        log.info('EVE HUD reset: logged out, Client ID and Secret removed from config.json');
        // the EVE HUD application only works on 4747: go back there (if it's free; otherwise the
        // page's red window says what to do)
        if (config.port !== BUILTIN_PORT && !portFromOption) {
          try {
            movePort(await openPort(BUILTIN_PORT), BUILTIN_PORT);
            return json(res, 200, { ok: true, url: handle.url });
          } catch (err) {
            log.warn(`Could not go back to port ${BUILTIN_PORT}: ${err.message}`);
          }
        }
        broadcast('auth', authStatus());
        return json(res, 200, { ok: true });
      }
      // Own-application form: is this port free? /api/portcheck?port=4750 -> { port, free, current }
      if (p === '/api/portcheck') {
        const want = Number(url.searchParams.get('port'));
        if (!Number.isInteger(want) || want < 1024 || want > 65535)
          return json(res, 200, { port: want, free: false, invalid: true });
        if (want === config.port) return json(res, 200, { port: want, free: true, current: true });
        try {
          const s2 = await openPort(want);
          s2.close();
          return json(res, 200, { port: want, free: true });
        } catch {
          return json(res, 200, { port: want, free: false });
        }
      }
      // { client, consumers: ['topbar', 'mail', 'skills', 'map', 'map:hazards', 'alert:skills', …] }
      if (p === '/api/demand' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
        const id = cleanClientId(body.client);
        if (!id || !Array.isArray(body.consumers))
          return json(res, 400, { error: 'client and consumers expected' });
        demandByClient.set(
          id,
          new Set(body.consumers.filter((c) => typeof c === 'string' && c.length < 40).slice(0, 60)),
        );
        updateDemand();
        return json(res, 200, { ok: true, active: DEMO ? null : feeds.activeFeeds() });
      }
      // Route from one system to another: /api/route?from=30000142&to=30002187&pref=shorter|safer|insecure
      if (p === '/api/route') {
        try {
          return json(
            res,
            200,
            await router.route(
              url.searchParams.get('from'),
              url.searchParams.get('to'),
              url.searchParams.get('pref') || 'shorter',
            ),
          );
        } catch (err) {
          return json(res, err.status && err.status < 500 ? err.status : 502, { error: err.message });
        }
      }
      // Set destination (in-game autopilot): POST { to: systemId }
      if (p === '/api/waypoint' && req.method === 'POST') {
        try {
          const body = JSON.parse((await readBody(req, 1024)) || '{}');
          return json(res, 200, await router.setDestination(body.to));
        } catch (err) {
          return json(res, err.status && err.status < 500 ? err.status : 502, {
            error: err.message,
            scope: err.scope || null,
          });
        }
      }
      if (req.method === 'GET') return serveStatic(req, res, p);
      res.writeHead(405);
      res.end();
    } catch (err) {
      log.warn(`[http] ${p}: ${err.message}`);
      json(res, 500, { error: err.message });
    }
  };
  let server = http.createServer(onRequest);

  // ---------------- boot ----------------
  // Listen first, so a port that is already taken fails fast (before any ESI traffic starts).
  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(listenError(err, config.port));
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, host);
  });
  server.on('error', (err) => log.warn(`[http] ${err.message}`));
  log.info(`EVE HUD running at http://localhost:${config.port}${DEMO ? '  (demo mode)' : ''}`);
  if (!DEMO && config.secretProblem) log.warn(config.secretProblem);
  if (!DEMO && builtinPortProblem(config))
    log.warn(
      `"port" is ${config.port} in config.json, but the EVE HUD application only works on port ${BUILTIN_PORT}: change it back to ${BUILTIN_PORT}, or use your own EVE developer application.`,
    );
  else if (!DEMO && !auth.status().loggedIn)
    log.info(`Open http://localhost:${config.port} and click "Log in with EVE Online".`);

  // Opens the HUD on another port (resolves with the listening server, or rejects like listen()).
  function openPort(newPort) {
    return new Promise((resolve, reject) => {
      const next = http.createServer(onRequest);
      next.once('error', (err) => reject(listenError(err, newPort)));
      next.listen(newPort, host, () => resolve(next));
    });
  }
  // Switches to the already open `next` server: saves port + callbackUrl in config.json, tells the
  // app (its window follows), and closes the old port a moment later.
  function movePort(next, newPort) {
    const old = server;
    server = next;
    server.on('error', (err) => log.warn(`[http] ${err.message}`));
    config.port = newPort;
    config.callbackUrl = `http://localhost:${newPort}/callback`;
    setConfigValues({ port: newPort, callbackUrl: config.callbackUrl });
    handle.port = newPort;
    handle.url = `http://localhost:${newPort}/`;
    log.info(`EVE HUD moved to ${handle.url} (port and callbackUrl saved in config.json)`);
    try {
      onPortChange(handle.url);
    } catch (err) {
      log.warn(`[http] onPortChange: ${err.message}`);
    }
    setTimeout(() => {
      for (const res of clients) res.end(); // pages still on the old port reconnect to nothing: they move with the reply
      clients.clear();
      old.close();
      old.closeAllConnections?.();
    }, 1500);
  }

  // What the caller gets back. stop() closes the HTTP server and the live connections; the feed
  // and chat timers keep running until the process exits, which is what quitting does anyway.
  const handle = {
    port: config.port,
    url: `http://localhost:${config.port}/`,
    demo: DEMO,
    configured: config.configured,
    stop: () =>
      new Promise((resolve) => {
        for (const res of clients) res.end();
        clients.clear();
        server.close(() => resolve());
        server.closeAllConnections?.(); // Node 18.2+: don't wait for keep-alive sockets
      }),
  };

  updates.start(); // also in demo mode: it's about the app, not the character

  if (DEMO) {
    // Not awaited: loading (or downloading) the star map must not hold up the caller. The page
    // gets the demo feeds over the live connection as soon as they exist.
    (async () => {
      await universe.ensure().catch(() => {});
      if (!universe.state.ready) universe.loadExternal(demoUniverse());
      const demo = createDemo(universe, publish);
      for (const [ch, msgs] of Object.entries(demo.chat)) chatBuffers[ch] = msgs;
      chatStatus = {
        dir: '(demo)',
        found: true,
        channels: config.chatChannels.map((c) => ({ id: c.id, label: c.label, file: 'demo' })),
      };
      demo.start(publishChat);
    })().catch((err) => log.warn(`[demo] ${err.message}`));
    return handle;
  }

  const chat = (chatLogs = createChatLogs(config, {
    log,
    getCharacterId: () => auth.characterId,
    onMessages: (channel, msgs, initial) => publishChat(channel, msgs, initial),
    onStatus: (s) => {
      chatStatus = s;
      broadcast('chatStatus', s);
    },
    // Local channel announces jumps instantly; ESI location can lag a few seconds behind.
    onSystemChange: (name) => {
      broadcast('localSystem', { name, t: Date.now() });
      setTimeout(() => feeds.refresh('presence'), 6000);
    },
  }));
  chat.start();
  // in combat (the top bar's ATTACK and the red flash): from the game logs next to the chat logs
  gameLogs = createGameLogs(config, {
    log,
    chatDir: chat.status().dir,
    getCharacterId: () => auth.characterId,
    onCombat: (c) => {
      combat = c;
      broadcast('combat', c);
    },
    onAutopilot: (a) => {
      autopilot = a;
      broadcast('autopilot', a);
    },
    onHealth: (health) => {
      logsHealth = health;
      broadcast('logs', health);
    },
  });
  gameLogs.start();
  logsHealth = gameLogs.health();
  feedsCharacter = feedsKey(auth.status());
  feeds.start();
  const loadMap = (rebuild) =>
    universe.ensure({ rebuild }).then(() => {
      broadcast('universe', universe.state);
      if (universe.state.ready) feeds.refresh('presence');
      else setTimeout(() => loadMap(false), 5 * 60_000); // offline? try again later
    });
  loadMap(Boolean(rebuildMap));
  return handle;
}

// Turns a listen() error into a message that says what to do about it.
function listenError(err, port) {
  if (err.code === 'EADDRINUSE') {
    err.message =
      `Port ${port} is already in use, probably by another EVE HUD. ` +
      'Stop that one first, or set another "port" in config.json (and change "callbackUrl" and your EVE developer application to match).';
  } else if (err.code === 'EACCES') {
    err.message =
      `Port ${port} may not be used on this computer. On Windows, Hyper-V/WSL can reserve port ranges: check with ` +
      '"netsh interface ipv4 show excludedportrange protocol=tcp", or pick another "port" in config.json (and change "callbackUrl" to match).';
  }
  err.port = port;
  return err;
}

// Where config.json and data/ are, for the app's menu and the HUD's help texts.
export const paths = { root: ROOT, home: HOME, configFile: CONFIG_FILE, dataDir: DATA_DIR };
