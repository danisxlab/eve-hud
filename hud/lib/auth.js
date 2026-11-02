// SPDX-License-Identifier: GPL-3.0-or-later
// EVE SSO (OAuth 2.0 authorization code flow, v2 endpoints) with refresh-token persistence.
import crypto from 'node:crypto';
import { dataPath, readJson, writeJson } from './store.js';
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
  const pendingStates = new Map(); // state -> createdAt
  let refreshing = null;

  function status() {
    if (!tokens) return { loggedIn: false, configured: config.configured };
    return {
      loggedIn: true,
      configured: config.configured,
      characterId: tokens.characterId,
      characterName: tokens.characterName,
      scopes: tokens.scopes,
    };
  }

  function loginUrl() {
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now());
    for (const [s, t] of pendingStates) if (Date.now() - t > 10 * 60_000) pendingStates.delete(s);
    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: config.callbackUrl,
      client_id: config.clientId,
      scope: config.scopes.join(' '),
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString().replace(/\+/g, '%20')}`;
  }

  async function tokenRequest(body) {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const res = await netFetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': config.userAgent,
      },
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

  function storeTokenResponse(json) {
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
    };
    saveTokens(tokens);
    onChange(status());
  }

  async function handleCallback({ code, state }) {
    if (!state || !pendingStates.has(state))
      throw new Error('Login state did not match. Start the login again from the HUD.');
    pendingStates.delete(state);
    if (!code) throw new Error('No authorization code returned by EVE SSO.');
    const json = await tokenRequest({ grant_type: 'authorization_code', code });
    storeTokenResponse(json);
    log.info?.(`[auth] Logged in as ${tokens.characterName} (${tokens.characterId})`);
    return status();
  }

  async function refresh() {
    if (!tokens?.refreshToken) throw new Error('Not logged in');
    if (!refreshing) {
      refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
        .then(storeTokenResponse)
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
