// SPDX-License-Identifier: GPL-3.0-or-later
// Data-change animations, only with Settings → Animations: Full. With Limited or Off everything just
// changes in place.
//
//   rows    elements with data-k (a stable key per row): a new row fades and slides in, the rows
//           below it glide down to their new place (instead of jumping)
//   bars    the fill of a bar (.lm-bar, .st-bar, .bar, .gbar) eases from its old to its new length,
//           with a bright head on its moving edge that fades out after
//   tabs    switchTab(): the current content fades out quickly, the new one comes in with a single
//           blink
//   charts  pulse(el, cls): runs a one-time CSS animation class (e.g. the Activity line's double
//           pulse) and removes it again
//
// Use: const before = snapshot(body); fill(body, …); animateChanges(body, before);
import { h, motionFull } from './util.js';

export { motionFull };

const BARS = '.lm-bar > i, .st-bar > i, .bar > i, .gbar > i';
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

// bar key: its row's key plus its place in that row, or its place in the list for rows without a key
function barKeys(root) {
  const out = new Map();
  const perRow = new Map();
  let n = 0;
  for (const el of root.querySelectorAll(BARS)) {
    const row = el.closest('[data-k]');
    if (row && root.contains(row)) {
      const i = perRow.get(row) || 0;
      perRow.set(row, i + 1);
      out.set(`${row.dataset.k}#${i}`, el);
    } else out.set(`@${n++}`, el);
  }
  return out;
}

const topIn = (root, el) =>
  el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;

export function snapshot(root) {
  if (!root || !motionFull()) return null;
  const rows = new Map();
  for (const el of root.querySelectorAll('[data-k]')) rows.set(el.dataset.k, topIn(root, el));
  const bars = new Map();
  for (const [k, el] of barKeys(root)) bars.set(k, el.style.width);
  return { rows, bars };
}

export function animateChanges(root, before) {
  if (!before || !root || !motionFull()) return;
  if (!before.rows.size && !before.bars.size) return; // first content: no "change" to show
  const added = new Set();
  let delay = 0;
  for (const el of root.querySelectorAll('[data-k]')) {
    const k = el.dataset.k;
    if (before.rows.has(k)) {
      const dy = before.rows.get(k) - topIn(root, el);
      if (Math.abs(dy) > 1)
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
          duration: 560,
          easing: EASE,
        });
    } else if (before.rows.size) {
      added.add(el);
      el.animate(
        [
          { opacity: 0, transform: 'translateX(-18px)', filter: 'brightness(1.9)' },
          { opacity: 1, transform: 'none', filter: 'brightness(1.25)', offset: 0.6 },
          { opacity: 1, transform: 'none', filter: 'none' },
        ],
        { duration: 700, delay: 160 + delay, easing: EASE, fill: 'backwards' },
      );
      delay = Math.min(delay + 70, 420);
    }
  }
  for (const [k, el] of barKeys(root)) {
    const to = el.style.width;
    const row = el.closest('[data-k]');
    const isNew = row && added.has(row);
    const from = before.bars.has(k) ? before.bars.get(k) : isNew ? '0%' : null;
    if (from === null || from === to) continue;
    sweepBar(el, from, to, isNew ? 260 : 0);
  }
}

// the fill eases to its new length; a bright head rides its moving edge and fades out
function sweepBar(el, from, to, delay) {
  const ms = 900;
  el.animate([{ width: from }, { width: to }], { duration: ms, delay, easing: EASE, fill: 'backwards' });
  const leftward = Boolean(el.style.right) && !el.style.left; // standings: negative bars grow to the left
  const head = h('span', { class: `fx-head${leftward ? ' left' : ''}` });
  el.append(head);
  head.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], {
    duration: ms + 500,
    delay,
    easing: 'ease-out',
    fill: 'both',
  }).onfinish = () => head.remove();
}

// Tab change inside a module: fade the content out, swap it (apply), blink the new content in once.
// target: the element, or a function returning it (when apply replaces the element itself).
export function switchTab(target, apply) {
  const get = typeof target === 'function' ? target : () => target;
  const el = get();
  if (!el || !motionFull()) {
    apply();
    return;
  }
  el.getAnimations().forEach((a) => {
    if (a.id === 'fx-tab') a.cancel();
  });
  const out = el.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 110,
    easing: 'ease-in',
    fill: 'forwards',
    id: 'fx-tab',
  });
  out.onfinish = () => {
    apply();
    out.cancel();
    get()?.animate(
      [
        { opacity: 0 },
        { opacity: 1, offset: 0.3 },
        { opacity: 0.5, offset: 0.55 },
        { opacity: 1 }, // one soft half blink
      ],
      { duration: 360, easing: 'ease-out', id: 'fx-tab' },
    );
  };
}

// A one-time CSS animation (class `cls`), restarted when it's already running.
export function pulse(el, cls) {
  if (!el || !motionFull()) return;
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}
