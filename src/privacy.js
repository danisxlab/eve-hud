// SPDX-License-Identifier: GPL-3.0-or-later
// Privacy and network rules for the app window.
//
//   No cookies or site data on disk: the window uses an in-memory session (a partition name without
//   "persist:"), so nothing it loads leaves cookies, local storage or a disk cache behind. The EVE
//   login doesn't happen in the app at all: it opens in your default browser (see window.js).
//   Only EVE servers: the window may load the HUD itself (http://localhost:<port>) and CCP's hosts
//   (*.evetech.net for portraits and icons, *.eveonline.com). Every other request is cancelled before
//   it is made, and logged once per host. Links to other sites open in your browser when you click
//   them; the app itself doesn't fetch them.
//   No device permissions: camera, microphone, location, notifications etc. are refused. Only
//   writing to the clipboard is allowed (the HUD's Copy buttons).
//
// The HUD server (inside the app) has the same EVE-only rule for its own requests (lib/net.js).

export const SESSION_PARTITION = 'eve-hud'; // in memory: no "persist:" prefix

const EVE_DOMAINS = ['evetech.net', 'eveonline.com'];
const isEveHost = (hostname) => {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  return EVE_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
};

// May the window load this URL? hudOrigin: e.g. "http://localhost:4747".
export function isAllowedRequest(url, hudOrigin) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (['data:', 'blob:', 'about:', 'devtools:', 'chrome-devtools:'].includes(u.protocol)) return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false;
  if (u.origin === hudOrigin) return true;
  return u.protocol === 'https:' && isEveHost(u.hostname);
}

// Installs the request filter and the permission rules on the window's session.
export function guardSession(ses, { getHudOrigin, log }) {
  const reported = new Set();
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const ok = isAllowedRequest(details.url, getHudOrigin());
    if (!ok) {
      let host = details.url;
      try {
        host = new URL(details.url).host;
      } catch {
        /* keep the raw url */
      }
      if (!reported.has(host)) {
        reported.add(host);
        log.warn(`Blocked a request to ${host}: the app only connects to EVE servers`);
      }
    }
    callback({ cancel: !ok });
  });
  const allowed = new Set(['clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler?.((_wc, permission) => allowed.has(permission));
}
