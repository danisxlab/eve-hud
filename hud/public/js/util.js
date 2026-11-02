// SPDX-License-Identifier: GPL-3.0-or-later
// Small DOM + formatting helpers shared by all modules.

// The first element matching a CSS selector (like jQuery's $, without jQuery).
export const $ = (selector) => document.querySelector(selector);

// Creates an element: h('div', { class: 'row', onclick: fn }, 'text', otherElement, …).
// attrs: class, style (an object), on<event> (a listener), html (innerHTML), anything else becomes an
// attribute (true = present, false / null / undefined = left out). Children: strings, numbers,
// elements, nested arrays; null / undefined / false are skipped, so `cond ? x : null` works.
// The name "h" is the usual one for this (hyperscript, as in Preact and Vue).
export function h(tag, attrs = {}, ...children) {
  const el =
    tag === 'svg' || attrs?.ns === 'svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', tag)
      : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false || k === 'ns') continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// replaceChildren() that skips null/undefined/false (conditional children)
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

// An icon: SVG markup (from glyphs.js) inside a <span class="glyph">, sized by CSS.
export function svg(markup, cls = 'glyph') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = markup;
  return span;
}

export const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = {
  int: (n) => (n === null || n === undefined ? '—' : nf0.format(n)),
  isk: (n) => (n === null || n === undefined ? '—' : nf2.format(n)),
  compact(n) {
    if (n === null || n === undefined) return '—';
    const a = Math.abs(n);
    if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
    return nf2.format(n);
  },
  price(n) {
    if (n === null || n === undefined) return '—';
    return n >= 1e6 ? fmt.compact(n) : nf2.format(n);
  },
  // EVE style: "3d 11h", "1h 56m", "40m 11s"
  duration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
    if (ms <= 0) return '0s';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const hh = Math.floor((s % 86400) / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (d > 0) return `${d}d ${hh}h`;
    if (hh > 0) return `${hh}h ${mm}m`;
    if (mm > 0) return `${mm}m ${ss}s`;
    return `${ss}s`;
  },
  // "10d 3h 38m"
  long(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0m';
    const m = Math.floor(ms / 60000);
    const d = Math.floor(m / 1440);
    const hh = Math.floor((m % 1440) / 60);
    const mm = m % 60;
    return [d ? `${d}d` : '', d || hh ? `${hh}h` : '', `${mm}m`].filter(Boolean).join(' ');
  },
  // "05:12:44" countdown, with days prefix
  clock(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const p = (x) => String(x).padStart(2, '0');
    const core = `${p(Math.floor((s % 86400) / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
    return d ? `${d}d ${core}` : core;
  },
  evetime(t) {
    const d = new Date(t);
    const p = (x) => String(x).padStart(2, '0');
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  },
  date(t) {
    const d = new Date(t);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  },
  ago(t) {
    return fmt.duration(Date.now() - t);
  },
};

// EVE rounds security for display: anything between 0.0 and 0.05 shows as 0.1.
export function displaySec(sec) {
  if (sec === null || sec === undefined) return null;
  if (sec > 0 && sec < 0.05) return 0.1;
  return Math.round(sec * 10) / 10;
}

const SEC_COLORS = {
  '1.0': '#2c74df',
  0.9: '#3a9aeb',
  0.8: '#4ecef8',
  0.7: '#60d9a3',
  0.6: '#71e554',
  0.5: '#f3fd82',
  0.4: '#dc6d07',
  0.3: '#ce440f',
  0.2: '#bc1117',
  0.1: '#722020',
  '0.0': '#8d3264',
};
export function secColor(sec) {
  const d = displaySec(sec);
  if (d === null) return '#7f8b90';
  if (d <= 0) return SEC_COLORS['0.0'];
  return SEC_COLORS[d.toFixed(1)] || SEC_COLORS['0.0'];
}

export function sparkline(
  points,
  {
    width = 80,
    height = 18,
    stroke = 'var(--gal-hi)',
    fill = 'rgba(63,174,149,.12)',
    key = (p) => p[1],
  } = {},
) {
  const el = h('svg', {
    class: 'spark',
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    preserveAspectRatio: 'none',
  });
  if (!points || points.length < 2) return el;
  const vals = points.map(key);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const xy = vals.map((v, i) => [
    (i / (vals.length - 1)) * width,
    height - 1.5 - ((v - min) / span) * (height - 3),
  ]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  el.append(h('path', { ns: 'svg', d: `${line}L${width},${height}L0,${height}Z`, fill, stroke: 'none' }));
  el.append(
    h('path', {
      ns: 'svg',
      d: line,
      fill: 'none',
      stroke,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  const [lx, ly] = xy.at(-1);
  el.append(h('circle', { ns: 'svg', cx: lx, cy: ly, r: 1.6, fill: stroke }));
  return el;
}

// One animation clock for the whole HUD, instead of a requestAnimationFrame loop per part: at most
// FPS frames a second (plenty for slow drifts and pulses; the screen's 60+ would double the work),
// and nothing at all while the window is minimised or completely hidden (document.hidden). Losing
// the focus doesn't count: the HUD keeps going while you play.
//   const stop = onFrame((t) => …)   t: ms timestamp like requestAnimationFrame's
export const FPS = 30;
const LIMITED_FPS = 10; // Settings → Animations → Limited
// fn -> { fps (optional function), slot }: each part can have its own rate (the plexus: 30 / 24)
const frameFns = new Map();
let rafId = 0;
let timer = 0;
const fpsOf = (o) => (o.fps ? o.fps() : motionLimited() ? LIMITED_FPS : FPS);
function pump(t) {
  rafId = 0;
  if (document.hidden) return; // visibilitychange restarts it
  for (const [fn, o] of [...frameFns]) {
    // a fixed beat (slots of 1000/fps ms since the page loaded): parts with the same rate share
    // their frames, and the average rate holds (24 a second on a 60 Hz screen: 2 and 3 refreshes)
    const slot = Math.floor((t + 8) / (1000 / fpsOf(o))); // a screen frame up to 8 ms early counts
    if (slot === o.slot) continue;
    o.slot = slot;
    try {
      fn(t);
    } catch (err) {
      console.error(err);
    }
  }
  schedule();
}
// Asks the browser for a frame only when one is due. (Asking every screen frame and skipping the
// ones not needed still made Chromium run its whole frame pipeline, style and layout included, at
// the screen's rate: 120 times a second on a ProMotion Mac, measured with a performance trace.)
function schedule() {
  if (rafId || timer || !frameFns.size || document.hidden) return;
  let due = Infinity;
  for (const o of frameFns.values()) {
    const every = 1000 / fpsOf(o);
    due = Math.min(due, (o.slot + 1) * every);
  }
  // wake just before it's due: the frame lands on the next screen refresh, which counts up to 8 ms early
  const wait = due - performance.now() - 4;
  if (wait > 1)
    timer = setTimeout(() => {
      timer = 0;
      rafId = requestAnimationFrame(pump);
    }, wait);
  else rafId = requestAnimationFrame(pump);
}
document.addEventListener('visibilitychange', schedule);
// opts.fps: a function returning this part's frames per second (default: 30, 10 with Limited)
export function onFrame(fn, opts = {}) {
  frameFns.set(fn, { fps: opts.fps || null, slot: -1 });
  schedule();
  return () => frameFns.delete(fn);
}

// A small hover box in the style of the top bar's (.tb-pop): dark, thin border, corner ticks,
// fading in just below the element. content: nodes, or a function returning nodes (null = none).
// Rows with a coloured dot: hoverRow(dot, title, detail), dot '' (green), 'warn', 'bad', 'idle'.
let hoverBox = null;
let hoverTimer = 0;
// opts.above: show it above the element instead of below. opts.alignRight: an element (or a function
// returning one) whose right side the box lines up with, e.g. the module's border.
export function hoverPop(anchor, content, opts = {}) {
  anchor.addEventListener('mouseenter', () => {
    const nodes = typeof content === 'function' ? content() : content;
    if (!nodes) return;
    clearTimeout(hoverTimer);
    if (!hoverBox) {
      hoverBox = h('div', { class: 'tb-pop hint hover-pop', role: 'tooltip', hidden: true });
      document.body.append(hoverBox);
    }
    const wasHidden = hoverBox.hidden;
    fill(hoverBox, nodes);
    hoverBox.hidden = false;
    hoverBox.className = `tb-pop hint hover-pop${wasHidden ? ' opening' : ''}`;
    const a = anchor.getBoundingClientRect();
    hoverBox.style.top = `${Math.round(a.bottom + 6)}px`;
    hoverBox.style.right = '';
    const edge = typeof opts.alignRight === 'function' ? opts.alignRight() : opts.alignRight;
    if (opts.above) hoverBox.style.top = `${Math.round(Math.max(4, a.top - 6 - hoverBox.offsetHeight))}px`;
    if (edge) {
      hoverBox.style.left = '';
      hoverBox.style.right = `${Math.round(innerWidth - edge.getBoundingClientRect().right)}px`;
      return;
    }
    hoverBox.style.left = `${Math.round(a.left - 4)}px`;
    // near the right edge: line its right side up with the element instead
    if (a.left - 4 + hoverBox.offsetWidth > innerWidth - 8) {
      hoverBox.style.left = '';
      hoverBox.style.right = `${Math.round(innerWidth - a.right - 4)}px`;
    }
  });
  anchor.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (hoverBox) hoverBox.hidden = true;
    }, 80);
  });
}
export const hoverRow = (dot, title, detail) =>
  h(
    'div',
    { class: `pop-row ${dot}` },
    h('i'),
    h(
      'span',
      { class: 'txt' },
      h('span', { class: 'nm' }, title),
      detail ? h('span', { class: 'ago' }, detail) : null,
    ),
  );

// True when the HUD's Animations setting (or macOS Reduce motion, when following it) says no motion.
export const motionReduced = () => document.body.classList.contains('reduce-motion');
// True with Animations → Limited: everything still moves, but at a few frames a second.
export const motionLimited = () => document.body.classList.contains('limited-motion');

// Smoothly counts a number element up/down to a new value.
// True with Animations → Full (the default): the data-change animations run only then.
export const motionFull = () => !motionReduced() && !motionLimited();

// Counts a number element up/down to a new value (Animations: Full; otherwise it just changes).
export function tweenNumber(el, to, format, ms = 900) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = to;
  const run = (el._tween || 0) + 1;
  el._tween = run; // a newer count replaces one still running
  if (from === to || !motionFull()) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    if (el._tween !== run) return;
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function imageUrl(kind, id, size = 128) {
  const variant = {
    character: 'portrait',
    corporation: 'logo',
    alliance: 'logo',
    render: 'render',
    icon: 'icon',
  }[kind];
  const cat =
    kind === 'render' || kind === 'icon'
      ? 'types'
      : `${kind === 'character' ? 'characters' : kind === 'corporation' ? 'corporations' : 'alliances'}`;
  return `https://images.evetech.net/${cat}/${id}/${variant}?size=${size}`;
}

export function img(src, attrs = {}) {
  const el = h('img', { src, alt: attrs.alt || '', loading: 'lazy', decoding: 'async', ...attrs });
  el.addEventListener('error', () => el.classList.add('img-missing'));
  return el;
}

export function emptyState(text, hint) {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty-mark' }),
    h('p', {}, text),
    hint ? h('p', { class: 'dim' }, hint) : null,
  );
}

// "Grant access": adds the scope(s) to config.json, then logs in again, so EVE asks you to approve them.
export async function grantAccess(scopes) {
  const r = await fetch('/api/scopes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scopes: [scopes].flat() }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  location.href = body.login || '/login';
}

// What a module shows when its scope is missing: the reason and a "Grant access" button.
export function scopeNeeded(scope) {
  const msg = h(
    'p',
    { class: 'dim' },
    'Your EVE application on ',
    h(
      'a',
      { href: 'https://developers.eveonline.com/applications', target: '_blank', rel: 'noopener noreferrer' },
      'developers.eveonline.com',
    ),
    ' must have this scope ticked too.',
  );
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'btn grant',
      onclick: async () => {
        btn.disabled = true;
        try {
          await grantAccess(scope);
        } catch (err) {
          btn.disabled = false;
          msg.textContent = `Couldn't add it: ${err.message}`;
        }
      },
    },
    'Grant access',
  );
  return h(
    'div',
    { class: 'empty scope-needed' },
    h('div', { class: 'empty-mark' }),
    h('p', {}, 'This module needs the permission ', h('code', {}, scope), '.'),
    btn,
    msg,
  );
}

// Inline version for one line of text: "… needs esi-x. Grant access"
export function grantLink(scope) {
  const b = h(
    'button',
    {
      type: 'button',
      class: 'link-btn',
      onclick: () => {
        b.disabled = true;
        grantAccess(scope).catch((err) => {
          b.disabled = false;
          b.textContent = `Failed: ${err.message}`;
        });
      },
    },
    'Grant access',
  );
  return b;
}

export function feedError(payload) {
  const e = payload?.error;
  if (!e) return null;
  if (e.scope) return scopeNeeded(e.scope);
  return h('div', { class: 'feed-error' }, `Last update failed: ${e.message}`);
}
