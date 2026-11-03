// SPDX-License-Identifier: GPL-3.0-or-later
// Building blocks shared by the list-style modules (Activity, Mining, Assets, Standings, Kills).
import { h, fill, fmt, emptyState, scopeNeeded, hoverPop } from '../util.js';

export const PERIODS = [
  ['day', 'Today'],
  ['week', '7 days'],
  ['month', '30 days'],
];

// Segmented buttons: [[key, label], …]
export function seg(options, value, onPick) {
  return h(
    'div',
    { class: 'seg' },
    ...options.map(([k, label]) =>
      h(
        'button',
        {
          class: k === value ? 'on' : '',
          onclick: (e) => {
            // light up the new tab at once, even while the content still fades
            for (const b of e.currentTarget.parentElement.children)
              b.classList.toggle('on', b === e.currentTarget);
            onPick(k);
          },
        },
        label,
      ),
    ),
  );
}

export const section = (label, extra) =>
  h('div', { class: 'lm-sec label' }, label, extra ? h('span', { class: 'faint' }, extra) : null);

// One row with a name, a value on the right, an optional second line and a thin bar under it.
//   frac 0..1 (bar length), tone: '' (teal) | 'cal' | 'amber' | 'red'
//   key: a stable id for the row, so a new row can slide in and the bar can ease to its new length
//   when the data changes (fx.js)
export function barRow({
  name,
  value,
  sub,
  frac = null,
  tone = '',
  lead = null,
  title = null,
  href = null,
  pop = null,
  key = null,
}) {
  const inner = [
    lead ? h('div', { class: 'lm-lead' }, lead) : null,
    h(
      'div',
      { class: 'lm-main' },
      h(
        'div',
        { class: 'lm-top' },
        h('span', { class: 'lm-name' }, name),
        h('span', { class: `lm-val ${tone}` }, value),
      ),
      sub ? h('div', { class: 'lm-sub' }, sub) : null,
      frac !== null
        ? h(
            'i',
            { class: `lm-bar ${tone}` },
            h('i', { style: { width: `${Math.max(0, Math.min(1, frac)) * 100}%` } }),
          )
        : null,
    ),
  ];
  const row = href
    ? h(
        'a',
        { class: `lm-row${lead ? ' has-lead' : ''}`, href, target: '_blank', rel: 'noopener noreferrer' },
        ...inner,
      )
    : h('div', { class: `lm-row${lead ? ' has-lead' : ''}` }, ...inner);
  if (key !== null) row.dataset.k = key;
  // above the row, its right side on the module's border (out of the way of the row's values)
  if (title)
    hoverPop(row, () => h('span', {}, title), pop || { above: true, alignRight: () => row.closest('.mod') }); // the top bar's hover style, not the browser's tooltip
  return row;
}

// Net line chart for Activity & income: one point per day (or hour), oldest left. Each day's piece
// of the line is green when more came in than went out, red when more went out. Hovering a piece
// shows that day in a small window that fades in like the top bar's hover boxes.
//   points: [{ label, income, expense }]
export function netLine(points, { height = 54 } = {}) {
  const n = points.length;
  const W = 300; // viewBox width; the svg stretches to the module's width
  const nets = points.map((p) => p.income + p.expense);
  // the zero line always sits in the middle, in every tab: up = more in, down = more out. (Scaling
  // to the data put it at the top on a day without any income, e.g. "Today" before you earned.)
  const top = Math.max(1, ...nets.map(Math.abs));
  const bottom = -top;
  const span = top - bottom;
  const pad = 5;
  const y = (v) => pad + ((top - v) / span) * (height - 2 * pad);
  const slot = W / Math.max(1, n);
  const cx = (i) => slot * (i + 0.5);
  const svg = h('svg', {
    class: 'nl-svg',
    viewBox: `0 0 ${W} ${height}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': 'Net income per day',
  });
  svg.append(
    h('line', {
      ns: 'svg',
      class: 'nl-zero',
      x1: 0,
      x2: W,
      y1: y(0),
      y2: y(0),
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  const tip = h('div', { class: 'nl-tip', hidden: true });
  const pieces = points.map((p, i) => {
    // from halfway to the previous point, through this one, to halfway to the next (flat at the ends)
    const yi = y(nets[i]);
    const left = i > 0 ? [slot * i, (y(nets[i - 1]) + yi) / 2] : [0, yi];
    const right = i < n - 1 ? [slot * (i + 1), (y(nets[i + 1]) + yi) / 2] : [W, yi];
    const tone = nets[i] > 0 ? 'up' : nets[i] < 0 ? 'down' : 'flat';
    const path = h('path', {
      ns: 'svg',
      class: `nl-piece ${tone}`,
      d: `M${left[0]},${left[1]}L${cx(i)},${yi}L${right[0]},${right[1]}`,
      'vector-effect': 'non-scaling-stroke',
    });
    svg.append(path);
    return path;
  });
  // hover areas, one per day, the full height
  const hit = h(
    'div',
    { class: 'nl-hit' },
    ...points.map((p, i) =>
      h('i', {
        style: { left: `${(i / n) * 100}%`, width: `${100 / n}%` },
        onmouseenter: () => {
          const wasHidden = tip.hidden;
          pieces.forEach((el, k) => el.classList.toggle('on', k === i));
          const net = nets[i];
          fill(
            tip,
            h('b', {}, p.label),
            h(
              'span',
              { class: net > 0 ? 'up' : net < 0 ? 'down' : '' },
              `net ${net > 0 ? '+' : ''}${fmt.compact(net)}`,
            ),
            h('span', { class: 'faint' }, `in ${fmt.compact(p.income)} · out ${fmt.compact(-p.expense)}`),
          );
          tip.hidden = false;
          placeTip(i);
          if (wasHidden) {
            tip.classList.remove('opening');
            void tip.offsetWidth;
            tip.classList.add('opening');
          } // only when it appears, not per day
        },
      }),
    ),
  );
  // Centred over the hovered day, but never past the module's border: near an edge, its side lines
  // up with the border.
  function placeTip(i) {
    const box = wrap.getBoundingClientRect();
    const mod = (wrap.closest('.mod') || wrap).getBoundingClientRect();
    const w = tip.offsetWidth;
    let left = ((i + 0.5) / n) * box.width - w / 2;
    left = Math.min(left, mod.right - box.left - w);
    left = Math.max(left, mod.left - box.left);
    tip.style.left = `${Math.round(left)}px`;
  }
  hit.addEventListener('mouseleave', () => {
    tip.hidden = true;
    pieces.forEach((el) => el.classList.remove('on'));
  });
  const wrap = h('div', { class: 'nl' }, svg, hit, tip);
  return wrap;
}

// The module's state when there's no data: needs a scope, failed, or still loading.
export function placeholder(feed, loading) {
  if (feed?.error?.scope) return scopeNeeded(feed.error.scope);
  if (feed?.error) return emptyState(`Update failed: ${feed.error.message}`);
  return emptyState(loading);
}

export const isk = (n) => `${fmt.compact(n)} ISK`;
export const signed = (n) => `${n > 0 ? '+' : ''}${fmt.compact(n)}`;
