// SPDX-License-Identifier: GPL-3.0-or-later
// "EVE's log files can't be read": the window that asks for EVE's logs folder.

import { h, fill } from './util.js';
import { store } from './store.js';
import { toast } from './toast.js';

// The game logs (combat, next to the chat logs) can't be read: a window over everything that asks for
// EVE's logs folder. Exit closes it until the next start; it also closes by itself when the folder
// can be read again (a network share that reconnected).
let logsDismissed = false;
let logsOverlay = null;
// Shown only once the folder has been unreadable for a few seconds: a network share that hiccups
// doesn't flash it, and macOS's own "access files on a network volume?" question comes first.
const LOGS_GRACE_MS = 6000;
let logsBadSince = 0;
let logsTimer = null;
export function checkLogs() {
  const st = store.logs;
  const want = !!st && !st.ok && !!store.auth?.loggedIn && !store.config?.demo && !logsDismissed;
  clearTimeout(logsTimer);
  if (!want) {
    logsBadSince = 0;
    logsOverlay?.remove();
    logsOverlay = null;
    removeEventListener('keydown', trapLogsKeys, true);
    return;
  }
  if (logsOverlay) {
    logsOverlay.update?.(st);
    return;
  }
  logsBadSince ||= Date.now();
  const wait = logsBadSince + LOGS_GRACE_MS - Date.now();
  if (wait > 0) {
    logsTimer = setTimeout(checkLogs, wait);
    return;
  }
  logsOverlay = logsModal(st);
}
export function trapLogsKeys(e) {
  if (!logsOverlay) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    e.preventDefault();
  } // only Exit closes it
  if (e.key === 'Tab') {
    const f = [...logsOverlay.querySelectorAll('input, button:not([disabled]):not([hidden])')];
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
  }
}
export function logsModal(st) {
  const parentOf = (d) => (/[\\/](chat|game)logs$/i.test(d || '') ? d.replace(/[\\/][^\\/]+$/, '') : d || '');
  const input = h('input', {
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    value: parentOf(st.dir),
    'aria-label': 'EVE logs folder',
  });
  const where = h('p', { class: 'logs-where' });
  const err = h('p', { class: 'form-error', hidden: true });
  const paint = (x) =>
    fill(where, 'Looking in ', h('code', {}, x.dir || '(no folder)'), ': ', x.error || "it can't be read.");
  paint(st);
  const json = (url, body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
  const browse = h(
    'button',
    {
      type: 'button',
      class: 'btn browse',
      onclick: async () => {
        browse.disabled = true;
        try {
          const r = await json('/api/storage/browse', { which: 'logs', current: input.value });
          if (r.body.folder) {
            input.value = r.body.folder;
            err.hidden = true;
          }
        } finally {
          browse.disabled = false;
        }
      },
    },
    'Browse…',
  );
  fetch('/api/storage')
    .then((r) => {
      if (!r.ok) browse.hidden = true;
    })
    .catch(() => {
      browse.hidden = true;
    }); // only in the app
  const use = h('button', { type: 'button', class: 'btn warn', onclick: () => apply() }, 'Use this folder');
  const exit = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      onclick: () => {
        logsDismissed = true;
        checkLogs();
        toast('No combat alerts until the EVE logs can be read. Settings → Storage → EVE logs');
      },
    },
    'Exit',
  );
  input.addEventListener('input', () => {
    err.hidden = true;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply();
  });
  async function apply() {
    const dir = input.value.trim();
    if (!dir) {
      err.textContent = 'Type or browse to the folder first.';
      err.hidden = false;
      return;
    }
    use.disabled = true;
    try {
      const r = await json('/api/chatlogs', { dir });
      if (!r.ok) {
        err.textContent = r.body.error || 'Could not use that folder';
        err.hidden = false;
        return;
      }
      if (r.body.game && !r.body.game.ok) {
        paint(r.body.game);
        err.textContent =
          "No readable Gamelogs folder there. Choose EVE's logs folder: the one with Chatlogs and Gamelogs in it.";
        err.hidden = false;
        return;
      }
      store.logs = r.body.game || { ok: true };
      checkLogs();
      toast('Reading the EVE logs from the new folder');
    } catch {
      err.textContent = 'Could not reach the HUD';
      err.hidden = false;
    } finally {
      use.disabled = false;
    }
  }
  const overlay = h(
    'div',
    { class: 'modal-overlay error-overlay logs-overlay' },
    h(
      'div',
      {
        class: 'modal error logs-modal',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-label': "EVE logs can't be read",
      },
      h('i', { class: 'tick tl' }),
      h('i', { class: 'tick tr' }),
      h('i', { class: 'tick bl' }),
      h('i', { class: 'tick br' }),
      h('h2', {}, "EVE's log files can't be read"),
      h(
        'p',
        {},
        "Combat alerts (ATTACK) come from EVE's game logs, and Chat from its chat logs. Choose the folder EVE writes them to.",
      ),
      where,
      h('label', { class: 'path-row' }, h('span', {}, 'EVE logs'), input, browse),
      h(
        'div',
        { class: 'logs-defaults' },
        h('p', {}, 'The usual place:'),
        h(
          'p',
          {},
          h('b', {}, 'Windows'),
          h('code', {}, 'C:\\Users\\<you>\\Documents\\EVE\\logs'),
          h('span', { class: 'faint' }, ' or under OneDrive\\Documents'),
        ),
        h('p', {}, h('b', {}, 'Mac'), h('code', {}, '/Users/<you>/Documents/EVE/logs')),
        h(
          'p',
          { class: 'faint' },
          'The logs folder holds Chatlogs and Gamelogs (choosing one of those works too). EVE on another computer: share its logs folder and choose that, e.g. \\\\gamepc\\EVE\\logs.',
        ),
      ),
      err,
      h('div', { class: 'modal-actions' }, exit, use),
    ),
  );
  overlay.update = (x) => paint(x);
  document.body.append(overlay);
  addEventListener('keydown', trapLogsKeys, true);
  input.focus();
  return overlay;
}
