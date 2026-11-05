// SPDX-License-Identifier: GPL-3.0-or-later
// New versions of EVE HUD. At start and then once an hour the app asks GitHub for the newest
// release (api.github.com/repos/danisxlab/eve-hud/releases/latest): its version (the tag, e.g.
// 1.0.4), the release notes and its page. Newer than this app's version (package.json) → the top
// bar shows "Update Ready" and the release notes (update-dialog.js in the page).
//
// It is the only request that doesn't go to CCP/Fenris Creations, and it sends nothing about you: no character, no
// settings (GitHub sees the request like any website visit). Settings → Updates turns it off.
// Asking with the last answer's ETag means an unchanged release costs GitHub nothing.
// The app never downloads or installs anything itself: the button opens the release page.

import { netFetch } from './net.js';

export const RELEASES_API = 'https://api.github.com/repos/danisxlab/eve-hud/releases/latest';
export const RELEASES_PAGE = 'https://github.com/danisxlab/eve-hud/releases/latest';
const COMMITS_API = 'https://api.github.com/repos/danisxlab/eve-hud/commits/';
const GITHUB_API_HOST = 'api.github.com';
const RELEASE_PAGE_PREFIX = 'https://github.com/danisxlab/eve-hud/releases/';
const MAX_NOTES = 30_000; // characters of release notes kept

// "1.0.4", "v1.0.4", "1.0" -> [1, 0, 4] / [1, 0, 0]; anything else -> null
export function parseVersion(v) {
  const m = String(v ?? '')
    .trim()
    .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:$|[-+\s])/i);
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}

// is version a newer than version b?
export function isNewer(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// "1.0.4" + "7f18d078b7…" -> "v1.0.4_7f18d07" (the short form GitHub shows next to a release)
export function versionLabel(version, commit) {
  if (!version) return '';
  const v = String(version).replace(/^v/i, '');
  return commit ? `v${v}_${String(commit).slice(0, 7)}` : `v${v}`;
}

export function createUpdateCheck({
  version, // this app's version; without one (plain `node`, tests) there's nothing to compare
  userAgent = 'eve-hud',
  enabled = () => true,
  onChange = () => {},
  log = console,
  fetchImpl = netFetch,
  everyMs = 60 * 60_000,
}) {
  let etag = null;
  let release = null; // the newest release, as GitHub described it the last time
  let state = { available: false };
  let timer = null;
  let running = null;

  const headers = () => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': userAgent,
  });

  // the commit the release's tag points to (for "v1.0.4_7f18d07"); not needed, so failures are fine
  async function commitOf(tag) {
    try {
      const res = await fetchImpl(COMMITS_API + encodeURIComponent(tag), {
        allowHost: GITHUB_API_HOST,
        headers: { ...headers(), Accept: 'application/vnd.github.sha' },
        timeoutMs: 20_000,
      });
      const sha = res.ok ? (await res.text()).trim() : '';
      return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : null;
    } catch {
      return null;
    }
  }

  function setState(next) {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    if (state.available) log.info?.(`[updates] EVE HUD ${state.version} is available (this is ${version})`);
    onChange(state);
  }

  async function run() {
    if (!version || !enabled()) return setState({ available: false });
    const res = await fetchImpl(RELEASES_API, {
      allowHost: GITHUB_API_HOST,
      headers: { ...headers(), ...(etag ? { 'If-None-Match': etag } : {}) },
      timeoutMs: 20_000,
    });
    if (res.status === 404) {
      release = null; // no release published yet
      etag = null;
    } else if (res.status !== 304) {
      if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
      const j = await res.json();
      const tag = String(j.tag_name || '');
      const url = String(j.html_url || '');
      release = {
        version: tag.replace(/^v/i, ''),
        name: String(j.name || tag),
        notes: String(j.body || '').slice(0, MAX_NOTES),
        url: url.startsWith(RELEASE_PAGE_PREFIX) ? url : RELEASES_PAGE,
        publishedAt: j.published_at || null,
        commit: tag ? await commitOf(tag) : null,
      };
      etag = res.headers.get('etag');
    }
    setState(
      release && isNewer(release.version, version)
        ? { available: true, ...release, current: version }
        : { available: false },
    );
  }

  // one check at a time; errors (offline, GitHub busy) are logged and tried again next hour
  function check() {
    running ||= run()
      .catch((err) => log.warn?.(`[updates] ${err.message}`))
      .finally(() => {
        running = null;
      });
    return running.then(() => state);
  }

  return {
    start() {
      check();
      clearInterval(timer);
      timer = setInterval(check, everyMs);
      timer.unref?.();
    },
    stop: () => clearInterval(timer),
    check,
    state: () => state,
  };
}
