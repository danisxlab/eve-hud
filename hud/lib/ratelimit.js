// SPDX-License-Identifier: GPL-3.0-or-later
// Client-side model of ESI's floating-window rate limits.
// https://developers.eveonline.com/docs/services/esi/rate-limiting/
//
// Each response on a rate-limited route carries:
//   X-Ratelimit-Group      route group (buckets are per group and per character / IP)
//   X-Ratelimit-Limit      e.g. "150/15m"  (max tokens per window)
//   X-Ratelimit-Remaining  tokens left after this request
//   X-Ratelimit-Used       tokens this request cost (2xx: 2, 3xx: 1, 4xx: 5, 5xx: 0)
// Tokens flow back over the window, so we estimate the current balance as
//   remaining + elapsed * max / window   (capped at max)
// and hold requests back whenever sending one would dip below a safety reserve.

const UNIT = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseLimit(text) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*([smhd])\s*$/i.exec(text || '');
  if (!m) return null;
  return { max: Number(m[1]), windowMs: Number(m[2]) * UNIT[m[3].toLowerCase()] };
}

// "/characters/2112625428/skillqueue" -> "/characters/{id}/skillqueue" (also UUIDs)
export function routeOf(method, path) {
  const tpl = path
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) ? '{id}' : seg))
    .join('/');
  return `${method} ${tpl}`;
}

export function createRateLimiter({ reserve = 0.25, log = console } = {}) {
  const buckets = new Map(); // "char:group" | "pub:group" -> { group, max, windowMs, remaining, at, blockedUntil, used }
  const routeGroup = new Map(); // route template -> group (learned from response headers)
  const routeBlocked = new Map(); // route template -> until (429s without rate-limit headers)

  const bucketKey = (group, authed) => `${authed ? 'char' : 'pub'}:${group}`;
  const available = (b, now) => Math.min(b.max, b.remaining + ((now - b.at) * b.max) / b.windowMs);

  function bucketFor(method, path, authed) {
    const g = routeGroup.get(routeOf(method, path));
    return g ? buckets.get(bucketKey(g, authed)) : null;
  }

  // Milliseconds to wait before a request of `cost` tokens keeps the bucket above the reserve.
  function waitMs(method, path, authed, cost = 2) {
    const now = Date.now();
    let wait = Math.max(0, (routeBlocked.get(routeOf(method, path)) || 0) - now);
    const b = bucketFor(method, path, authed);
    if (b) {
      wait = Math.max(wait, (b.blockedUntil || 0) - now);
      const floor = b.max * reserve;
      const avail = available(b, now);
      if (avail - cost < floor) wait = Math.max(wait, ((floor + cost - avail) * b.windowMs) / b.max);
    }
    return Math.ceil(wait);
  }

  // Book the tokens before sending, so concurrent requests can't all squeeze past the check.
  function spend(method, path, authed, cost = 2) {
    const b = bucketFor(method, path, authed);
    if (!b) return;
    const now = Date.now();
    b.remaining = available(b, now) - cost;
    b.at = now;
  }

  function observe(method, path, authed, res) {
    const now = Date.now();
    const route = routeOf(method, path);
    const group = res.headers.get('x-ratelimit-group');
    let b = null;
    if (group) {
      routeGroup.set(route, group);
      const key = bucketKey(group, authed);
      b = buckets.get(key) || { group, authed, blockedUntil: 0 };
      const lim = parseLimit(res.headers.get('x-ratelimit-limit'));
      if (lim) Object.assign(b, lim);
      const remaining = Number(res.headers.get('x-ratelimit-remaining'));
      if (Number.isFinite(remaining) && res.headers.has('x-ratelimit-remaining')) {
        b.remaining = remaining;
        b.at = now;
      }
      const used = Number(res.headers.get('x-ratelimit-used'));
      if (Number.isFinite(used)) b.used = used;
      if (b.max && b.windowMs) buckets.set(key, b);
      if (b.max && b.remaining < b.max * reserve) {
        log.info?.(
          `[esi] Rate limit group "${group}" at ${Math.floor(b.remaining)}/${b.max} tokens; slowing down`,
        );
      }
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after')) || 60;
      if (b) b.blockedUntil = now + retry * 1000;
      else routeBlocked.set(route, now + retry * 1000); // deeper limiter without headers: block just this route
      log.warn?.(`[esi] 429 on ${route}${group ? ` (group ${group})` : ''}; holding requests for ${retry}s`);
    }
  }

  // Until a route's group is known (first response), send only one request for it at a time.
  const discovering = new Map(); // route -> Promise
  async function gate(method, path) {
    const route = routeOf(method, path);
    while (!routeGroup.has(route) && discovering.has(route)) await discovering.get(route);
    if (routeGroup.has(route) || routeBlocked.has(route)) return () => {};
    let done;
    discovering.set(
      route,
      new Promise((r) => {
        done = r;
      }),
    );
    return () => {
      discovering.delete(route);
      done();
    };
  }

  function status() {
    const now = Date.now();
    return [...buckets.values()]
      .map((b) => ({
        group: b.group,
        scope: b.authed ? 'character' : 'public',
        max: b.max,
        window: `${b.windowMs / 60_000}m`,
        available: Math.floor(available(b, now)),
        blockedFor: Math.max(0, Math.ceil(((b.blockedUntil || 0) - now) / 1000)),
      }))
      .sort((a, b) => a.available / a.max - b.available / b.max);
  }

  return { gate, waitMs, spend, observe, status };
}
