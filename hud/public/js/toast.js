// SPDX-License-Identifier: GPL-3.0-or-later
// Toast: a short message at the bottom of the screen that fades after a few seconds.

import { $ } from './util.js';

// ---------------- toast ----------------
let toastTimer = null;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
