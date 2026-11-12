// SPDX-License-Identifier: GPL-3.0-or-later
import { h, fmt, svg, emptyState, feedError } from '../util.js';
import { store } from '../store.js';
import { snapshot, animateChanges } from '../fx.js';
import { ICONS } from '../glyphs.js';

const ACT_GLYPH = {
  1: ICONS.manufacturing,
  3: ICONS.research,
  4: ICONS.research,
  5: ICONS.copy,
  7: ICONS.invention,
  8: ICONS.invention,
  9: ICONS.reaction,
  11: ICONS.reaction,
};

function dial(frac, ready) {
  const r = 20;
  const C = 2 * Math.PI * r;
  const el = h('svg', { viewBox: '0 0 46 46' });
  const ticks = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    ticks.push(
      `M${23 + Math.sin(a) * 15},${23 - Math.cos(a) * 15}L${23 + Math.sin(a) * 17},${23 - Math.cos(a) * 17}`,
    );
  }
  el.innerHTML = `
    <circle cx="23" cy="23" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2"/>
    <circle cx="23" cy="23" r="15" fill="rgba(0,0,0,.35)" stroke="rgba(217,138,50,.25)"/>
    <path d="${ticks.join('')}" stroke="rgba(217,138,50,.6)"/>
    <circle class="arc" cx="23" cy="23" r="${r}" fill="none" stroke="${ready ? 'var(--amber-hi)' : 'var(--amber)'}" stroke-width="2.4"
      stroke-dasharray="${(C * frac).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 23 23)"
      style="filter:drop-shadow(0 0 3px rgba(217,138,50,.7))"/>`;
  return el;
}

export default {
  id: 'industry',
  title: 'Industry',
  glyph: ICONS.industry,
  mount(ctx) {
    const list = h('div', { class: 'jobs scroll' });
    const err = h('div');
    ctx.body.append(list, err);
    let items = [];

    function build() {
      const f = store.feed('industry');
      err.replaceChildren(feedError(f) || '');
      const jobs = f?.data?.jobs;
      if (!jobs) {
        list.replaceChildren(emptyState('Waiting for industry jobs…'));
        return;
      }
      const now = Date.now();
      const ready = jobs.filter(
        (j) => j.status === 'ready' || (j.status === 'active' && j.end <= now),
      ).length;
      ctx.setTitle('Industry', h('span', { class: 'count' }, String(jobs.length)));
      ctx.setLight(ready ? 'warn' : jobs.length ? 'on' : '');
      ctx.setSub(h('span', {}, ready ? `${ready} ready` : `${jobs.length} running`));
      if (!jobs.length) {
        list.replaceChildren(
          emptyState('No industry jobs running.', 'Jobs you start at a station or structure show up here.'),
        );
        items = [];
        return;
      }
      items = jobs.map((j) => {
        const dialBox = h('div', { class: 'dial' });
        const when = h('span', { class: 'when' });
        const row = h(
          'div',
          { class: 'job', 'data-k': `${j.id}` },
          dialBox,
          h(
            'div',
            { style: { minWidth: 0 } },
            h(
              'div',
              { class: 'nm' },
              j.product,
              j.runs > 1 ? h('span', { class: 'dim' }, ` × ${j.runs}`) : null,
            ),
            h('div', { class: 'sub2' }, h('span', { class: 'act' }, j.activity), when),
            h('div', { class: 'fac' }, j.facility),
          ),
        );
        return { j, row, dialBox, when, last: -1 };
      });
      const before = snapshot(list);
      list.replaceChildren(...items.map((i) => i.row));
      animateChanges(list, before); // a new job slides in (Animations: Full)
      tick(true);
    }

    function tick(force = false) {
      const now = Date.now();
      for (const it of items) {
        const { j } = it;
        const ready = j.status === 'ready' || (j.status === 'active' && j.end <= now);
        const paused = j.status === 'paused';
        const frac = ready ? 1 : Math.max(0, Math.min(1, (now - j.start) / (j.end - j.start)));
        it.row.classList.toggle('ready', ready);
        const when = ready ? 'Ready to deliver' : paused ? 'Paused' : fmt.clock(j.end - now);
        if (it.when.textContent !== when) it.when.textContent = when;
        const pct = Math.round(frac * 400); // redraw dial in 0.25% steps
        if (force || pct !== it.last) {
          it.last = pct;
          const ic = h('div', { class: 'ic' });
          ic.append(svg(ACT_GLYPH[j.activityId] || ICONS.industry, 'g'));
          it.dialBox.replaceChildren(dial(frac, ready), ic);
        }
      }
    }

    const off = store.on('feed:industry', build);
    build();
    return {
      tick: () => tick(), // once a second (grid.js)
      destroy: off,
    };
  },
};
