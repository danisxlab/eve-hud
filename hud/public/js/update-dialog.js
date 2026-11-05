// SPDX-License-Identifier: GPL-3.0-or-later
// "Update Ready": a newer EVE HUD is on GitHub (the server checks once an hour: lib/updates.js).
// The orange button in the top bar (topbar.js) opens a window over the blurred HUD with the release
// notes and a button to the release page; the window also opens by itself, once for each new
// version. Nothing is downloaded or installed: the button opens the page in your browser.

import { h } from './util.js';
import { store, saveSettings } from './store.js';
import { markdown } from './markdown.js';

// "1.0.4" + "7f18d07" -> "v1.0.4_7f18d07" (as on GitHub's release page); without a commit "v1.0.4"
export function versionLabel(version, commit) {
  if (!version) return '';
  const v = String(version).replace(/^v/i, '');
  return commit ? `v${v}_${String(commit).slice(0, 7)}` : `v${v}`;
}

let overlay = null;

export function updateModal() {
  const u = store.update;
  if (!u?.available || overlay) return;
  const close = () => {
    overlay?.remove();
    overlay = null;
    removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const ext = { target: '_blank', rel: 'noopener noreferrer' }; // opens in your browser
  const closeBtn = h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Later');
  // the release page opens in your browser, and the window closes
  const get = h(
    'a',
    { class: 'btn update-get', href: u.url, ...ext, onclick: () => setTimeout(close) },
    `Get EVE HUD ${u.version}`,
  );
  const title = u.name && u.name !== u.version && u.name !== `v${u.version}` ? u.name : null;
  overlay = h(
    'div',
    {
      class: 'modal-overlay update-overlay',
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    h(
      'div',
      { class: 'modal update', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Update ready' },
      ['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: `tick ${c}` })),
      h(
        'div',
        { class: 'update-head' },
        h(
          'div',
          {},
          h('h2', {}, 'A new version of EVE HUD is available.'),
          h(
            'p',
            { class: 'versions' },
            h('b', {}, versionLabel(u.version, u.commit)),
            ` · installed ${versionLabel(u.current, store.config?.commit)}`,
          ),
        ),
        get,
      ),
      // the release notes, as written on GitHub; they scroll, the frame stays
      h(
        'div',
        { class: 'modal-scroll' },
        title ? h('h3', { class: 'release-name' }, title) : null,
        u.notes?.trim() ? markdown(u.notes) : h('p', { class: 'faint' }, 'No release notes.'),
      ),
      h('div', { class: 'modal-actions' }, closeBtn),
    ),
  );
  document.body.append(overlay);
  addEventListener('keydown', onKey, true);
  get.focus();
}

// Opens the window by itself the first time a version is available (then only from the button).
export function watchUpdate() {
  const check = () => {
    const u = store.update;
    if (!u?.available || store.config?.web || !store.settings) return;
    if (store.settings.updates?.seen === u.version) return;
    store.settings.updates = { ...store.settings.updates, seen: u.version };
    saveSettings();
    updateModal();
  };
  store.on('update', check);
  check();
}
