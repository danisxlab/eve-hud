// SPDX-License-Identifier: GPL-3.0-or-later
// EVE SSO (OAuth 2.0 authorization code flow, v2 endpoints) with refresh-token persistence.
// Without a Secret Key (the built-in EVE HUD application, or your own without one) it uses PKCE,
// EVE's flow for desktop apps: a one-time code_verifier per login instead of the secret.
import crypto from 'node:crypto';
import { BUILTIN_CLIENT_ID, builtinPortProblem, dataPath, loginApp, readJson, writeJson } from './store.js';
import { canEncrypt, seal, unseal } from './secrets.js';
import { netFetch } from './net.js';

const AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize';
const TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
const TOKENS_FILE = dataPath('tokens.json');

function decodeJwt(token) {
  const part = token.split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// tokens.json holds { "sealed": "enc:…" }: the login, encrypted (lib/secrets.js). A plain file
// (older version, imported folder) is read once and saved encrypted.
function readTokens(log) {
  const raw = readJson(TOKENS_FILE, null);
  if (!raw) return null;
  if (typeof raw.sealed === 'string') {
    try {
      return JSON.parse(unseal(raw.sealed));
    } catch {
      log.warn?.(
        '[auth] The saved EVE login could not be decrypted (saved on another computer or user account?). Log in again.',
      );
      return null;
    }
  }
  if (canEncrypt()) saveTokens(raw);
  return raw;
}
function saveTokens(t) {
  writeJson(TOKENS_FILE, t && canEncrypt() ? { sealed: seal(JSON.stringify(t)) } : t);
}

export function createAuth(config, { onChange = () => {}, log = console } = {}) {
  let tokens = readTokens(log);
  const pendingStates = new Map(); // state -> { at, verifier, app }
  let refreshing = null;

  function status() {
    const app = loginApp(config);
    const base = { configured: config.configured, ownApp: !app.builtin, callbackUrl: app.callbackUrl };
    // "port" changed without your own application: the login can't come back (the page says so)
    if (builtinPortProblem(config)) base.portProblem = Number(config.port);
    if (!tokens) return { loggedIn: false, ...base };
    return {
      loggedIn: true,
      ...base,
      // the application this login was made with (older logins: your own, the only kind there was)
      loginOwnApp: tokens.clientId ? tokens.clientId !== BUILTIN_CLIENT_ID : true,
      characterId: tokens.characterId,
      characterName: tokens.characterName,
      scopes: tokens.scopes,
    };
  }

  function loginUrl() {
    const app = loginApp(config);
    const state = crypto.randomBytes(16).toString('hex');
    // PKCE (no Secret Key): a random code_verifier, and its SHA-256 as the code_challenge
    const verifier = app.clientSecret ? null : crypto.randomBytes(32).toString('base64url');
    pendingStates.set(state, { at: Date.now(), verifier, app });
    for (const [s, p] of pendingStates) if (Date.now() - p.at > 10 * 60_000) pendingStates.delete(s);
    // at most 20 logins waiting (a page that opens /login over and over can't fill the memory)
    while (pendingStates.size > 20) pendingStates.delete(pendingStates.keys().next().value);
    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: app.callbackUrl,
      client_id: app.clientId,
      scope: config.scopes.join(' '),
      state,
    });
    if (verifier) {
      params.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
      params.set('code_challenge_method', 'S256');
    }
    return `${AUTHORIZE_URL}?${params.toString().replace(/\+/g, '%20')}`;
  }

  // app: { clientId, clientSecret }. With a secret: Basic auth (web apps); without one: the
  // Client ID in the body and no Authorization header (EVE's native apps).
  async function tokenRequest(body, app) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': config.userAgent };
    if (app.clientSecret)
      headers.Authorization = `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`;
    else body = { ...body, client_id: app.clientId };
    const res = await netFetch(TOKEN_URL, {
      method: 'POST',
      headers,
      body: new URLSearchParams(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    if (!res.ok) {
      const err = new Error(
        `SSO token request failed (${res.status}): ${json?.error_description || json?.error || text.slice(0, 200)}`,
      );
      err.code = json?.error;
      err.status = res.status;
      throw err;
    }
    return json;
  }

  function storeTokenResponse(json, app) {
    const claims = decodeJwt(json.access_token);
    const characterId = Number(String(claims.sub).split(':').pop());
    const scopes = Array.isArray(claims.scp) ? claims.scp : claims.scp ? [claims.scp] : [];
    tokens = {
      characterId,
      characterName: claims.name,
      accessToken: json.access_token,
      refreshToken: json.refresh_token || tokens?.refreshToken,
      expiresAt: claims.exp ? claims.exp * 1000 : Date.now() + json.expires_in * 1000,
      scopes,
      clientId: app.clientId, // refreshes go to the application that made the login
    };
    saveTokens(tokens);
    onChange(status());
  }

  async function handleCallback({ code, state }) {
    const pending = state && pendingStates.get(state);
    if (!pending) throw new Error('Login state did not match. Start the login again from the HUD.');
    pendingStates.delete(state);
    if (!code) throw new Error('No authorization code returned by EVE SSO.');
    const body = { grant_type: 'authorization_code', code };
    if (pending.verifier) body.code_verifier = pending.verifier;
    const json = await tokenRequest(body, pending.app);
    storeTokenResponse(json, pending.app);
    log.info?.(`[auth] Logged in as ${tokens.characterName} (${tokens.characterId})`);
    return status();
  }

  async function refresh() {
    if (!tokens?.refreshToken) throw new Error('Not logged in');
    if (!refreshing) {
      // The application that made this login (older logins: your own, the only kind there was).
      // Another application than the current one (e.g. the built-in one after you added your own)
      // refreshes without a Secret Key, as it logged in.
      const now = loginApp(config);
      const app =
        !tokens.clientId || tokens.clientId === now.clientId
          ? now
          : { clientId: tokens.clientId, clientSecret: '' };
      refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, app)
        .then((json) => storeTokenResponse(json, app))
        .catch((err) => {
          if (err.code === 'invalid_grant' || err.status === 400) {
            log.warn?.('[auth] Refresh token rejected; you need to log in again.');
            logout();
          }
          throw err;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  }

  async function getAccessToken() {
    if (!tokens) return null;
    if (Date.now() > tokens.expiresAt - 60_000) await refresh();
    return tokens?.accessToken || null;
  }

  function hasScope(scope) {
    return Boolean(tokens?.scopes?.includes(scope));
  }

  function logout() {
    tokens = null;
    saveTokens(null);
    onChange(status());
  }

  return {
    status,
    loginUrl,
    handleCallback,
    getAccessToken,
    hasScope,
    logout,
    get characterId() {
      return tokens?.characterId;
    },
  };
}
