// SPDX-License-Identifier: GPL-3.0-or-later
// fetch() wrapper that turns Node's opaque "fetch failed" into a readable reason.
import dns from 'node:dns';
import net from 'node:net';

// Prefer IPv4 and race address families: on networks with broken IPv6, Node may
// otherwise try an unreachable IPv6 address and fail with "fetch failed".
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* older Node */
}
try {
  net.setDefaultAutoSelectFamily?.(true);
} catch {
  /* older Node */
}

const HINTS = {
  ENOTFOUND: 'DNS could not resolve the host name',
  EAI_AGAIN: 'DNS lookup timed out',
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset (a firewall, VPN or antivirus may be interfering)',
  ETIMEDOUT: 'connection timed out',
  ENETUNREACH: 'network unreachable (often a broken IPv6 route)',
  EHOSTUNREACH: 'host unreachable',
  UND_ERR_CONNECT_TIMEOUT: 'connection timed out',
  UND_ERR_SOCKET: 'socket closed unexpectedly',
  CERT_HAS_EXPIRED: 'TLS certificate expired (check the computer clock)',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    'TLS certificate not trusted (a proxy or antivirus may be intercepting HTTPS)',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS certificate not trusted (a proxy or antivirus may be intercepting HTTPS)',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate not trusted (a proxy or antivirus may be intercepting HTTPS)',
};

export function describeNetError(err, url) {
  let c = err;
  while (c?.cause) c = c.cause; // undici nests the real error
  const code = c?.code || c?.errno || err?.code;
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  const hint = HINTS[code] || c?.message || err?.message;
  return `Cannot reach ${host}: ${hint}${code && !hint.includes(code) ? ` [${code}]` : ''}`;
}

// The HUD only talks to EVE's own servers: CCP's ESI (esi.evetech.net), EVE SSO (login.eveonline.com)
// and the static data (developers.eveonline.com). Anything else is refused here, before a connection
// is made, and so are redirects that lead elsewhere. The one exception is the update check
// (updates.js), which passes allowHost: 'api.github.com' for its own requests only. (Portraits and icons come from images.evetech.net,
// loaded by the page; the app window enforces the same rule there.)
export const EVE_HOSTS = ['evetech.net', 'eveonline.com'];
export function isEveHost(hostname) {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  return EVE_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function refuse(url, why) {
  const e = new Error(`Refused to connect to ${new URL(url).host}: ${why}`);
  e.network = true;
  e.blocked = true;
  return e;
}

export async function netFetch(url, { allowHost = null, ...opts } = {}) {
  const allowed = (u) => {
    const h = new URL(u).hostname.toLowerCase();
    return isEveHost(h) || (allowHost != null && h === allowHost);
  };
  if (!allowed(url)) throw refuse(url, 'not an EVE server');
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  try {
    // Follow redirects here (max 5), so each hop is checked against EVE's hosts too.
    let current = url;
    let options = { ...opts };
    for (let hop = 0; ; hop++) {
      const res = await fetch(current, { signal: timeout, ...options, redirect: 'manual' });
      if (res.status < 300 || res.status > 399 || !res.headers.get('location')) return res;
      if (hop >= 5) throw new Error('too many redirects');
      const next = new URL(res.headers.get('location'), current).href;
      if (!allowed(next))
        throw refuse(next, `${new URL(current).host} redirected there, and it is not an EVE server`);
      res.body?.cancel?.();
      if (
        res.status === 303 ||
        ((res.status === 301 || res.status === 302) && (options.method || 'GET') !== 'GET')
      ) {
        options = { ...options, method: 'GET', body: undefined };
      }
      current = next;
    }
  } catch (err) {
    if (err.blocked) throw err;
    const e = new Error(
      err.name === 'TimeoutError'
        ? `Cannot reach ${new URL(url).host}: request timed out`
        : describeNetError(err, url),
    );
    e.network = true;
    e.cause = err;
    throw e;
  }
}
