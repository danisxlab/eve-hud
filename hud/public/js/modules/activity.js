// SPDX-License-Identifier: GPL-3.0-or-later
// Activity & income: where your ISK came from and went, from the wallet journal (ESI keeps 30 days).
// Mission rewards per agent, bounties per system, market, insurance and more, plus loyalty points.
import { h, fill, fmt, grantLink } from '../util.js';
import { store } from '../store.js';
import { snapshot, animateChanges, switchTab, pulse } from '../fx.js';
import { ICONS } from '../glyphs.js';
import { secChip } from './character.js';
import { PERIODS, seg, section, barRow, netLine, placeholder, isk, signed } from './common.js';

// The points of the line for the chosen period: per hour today, per day for 7 or 30 days.
function linePoints(d, period) {
  const day = (t) =>
    new Date(t).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  if (period === 'day') {
    const hours = d.hourly ? d.hourly.slice(0, new Date().getUTCHours() + 1) : [];
    return hours.map((x, hr) => ({
      ...x,
      label: `${String(hr).padStart(2, '0')}:00–${String(hr + 1).padStart(2, '0')}:00 EVE`,
    }));
  }
  const n = period === 'week' ? 7 : 30;
  const today = d.today ?? Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return d.daily.slice(-n).map((x, k) => {
    const t = today - (n - 1 - k) * 86400_000;
    return { ...x, label: k === n - 1 ? `Today, ${day(t)}` : day(t) };
  });
}

export default {
  id: 'activity',
  title: 'Activity & Income',
  glyph: ICONS.activity,
  mount(ctx) {
    const st = (ctx.settings().activity ||= { period: 'week' });
    const top = h('div', { class: 'lm-head' });
    const body = h('div', { class: 'lm-body scroll' });
    ctx.body.append(h('div', { class: 'lm' }, top, body));

    let lastLine = null;
    let lineChanged = false;
    function draw() {
      const f = store.feed('activity');
      const d = f?.data;
      fill(
        top,
        seg(PERIODS, st.period, (k) => {
          st.period = k;
          ctx.save();
          switchTab(body, () => {
            render(false);
            body.scrollTop = 0;
          });
        }),
      );
      if (!d) {
        fill(body, placeholder(f, 'Reading your wallet journal…'));
        ctx.setSub();
        return;
      }
      const p = d.periods[st.period];
      const net = p.income + p.expense;
      ctx.setSub(h('span', { class: `lm-net ${net >= 0 ? 'up' : 'down'}` }, `${signed(net)} ISK`));
      // the line pulses twice when its numbers change (not when you switch the period)
      const points = linePoints(d, st.period);
      const sig = points.map((x) => Math.round(x.income + x.expense)).join(',');
      lineChanged = Boolean(lastLine && lastLine.period === st.period && lastLine.sig !== sig);
      lastLine = { period: st.period, sig };
      const maxSrc = Math.max(1, ...p.sources.map((x) => Math.max(x.income, -x.expense)));
      const maxAgent = Math.max(1, ...p.agents.map((a) => a.isk));
      const maxSys = Math.max(1, ...p.systems.map((a) => a.isk));
      fill(
        body,
        h(
          'div',
          { class: 'lm-total' },
          h('div', {}, h('span', { class: 'label' }, 'In'), h('b', { class: 'up' }, fmt.compact(p.income))),
          h(
            'div',
            {},
            h('span', { class: 'label' }, 'Out'),
            h('b', { class: 'down' }, fmt.compact(-p.expense)),
          ),
          h(
            'div',
            {},
            h('span', { class: 'label' }, 'Net'),
            h('b', { class: net >= 0 ? 'up' : 'down' }, signed(net)),
          ),
        ),
        h(
          'div',
          { class: 'lm-chart' },
          h(
            'div',
            { class: 'lm-chart-head' },
            h('span', { class: 'label' }, st.period === 'day' ? 'Net per hour today' : 'Net per day'),
            h('span', { class: 'faint' }, 'green: more in than out · red: more out'),
          ),
          netLine(points),
        ),
        section('By source'),
        p.sources.length
          ? p.sources.map((x) =>
              barRow({
                key: `src:${x.label}`,
                name: x.label,
                value: signed(x.income + x.expense),
                tone: x.income + x.expense < 0 ? 'red' : '',
                sub: [
                  x.income ? `in ${fmt.compact(x.income)}` : null,
                  x.expense ? `out ${fmt.compact(-x.expense)}` : null,
                  `${x.count} entr${x.count === 1 ? 'y' : 'ies'}`,
                ]
                  .filter(Boolean)
                  .join(' · '),
                frac: Math.max(x.income, -x.expense) / maxSrc,
              }),
            )
          : h('p', { class: 'lm-note' }, 'No wallet activity in this period.'),
        p.agents.length
          ? [
              section('Mission agents'),
              p.agents.map((a) =>
                barRow({
                  key: `agent:${a.name}`,
                  name: a.name,
                  value: isk(a.isk),
                  sub: `${a.count} reward${a.count === 1 ? '' : 's'}`,
                  frac: a.isk / maxAgent,
                  tone: 'cal',
                }),
              ),
            ]
          : null,
        p.systems.length
          ? [
              section('Bounties by system'),
              p.systems.map((s) =>
                barRow({
                  key: `sys:${s.name}`,
                  name: secChip(s.name, s.sec),
                  value: isk(s.isk),
                  sub: `${s.count} payout${s.count === 1 ? '' : 's'}`,
                  frac: s.isk / maxSys,
                  tone: 'amber',
                }),
              ),
            ]
          : null,
        section('Loyalty points'),
        d.lp
          ? d.lp.length
            ? d.lp.map((x) => barRow({ key: `lp:${x.name}`, name: x.name, value: `${fmt.int(x.points)} LP` }))
            : h('p', { class: 'lm-note' }, 'No loyalty points.')
          : h(
              'p',
              { class: 'lm-note' },
              d.lpScope
                ? 'Loyalty points unavailable right now.'
                : [
                    'Needs the permission esi-characters.read_loyalty.v1. ',
                    grantLink('esi-characters.read_loyalty.v1'),
                  ],
            ),
        h(
          'p',
          { class: 'lm-note faint' },
          `${fmt.int(d.entries)} journal entries${d.oldest ? ` since ${fmt.date(d.oldest).slice(0, 10)}` : ''}. ESI keeps 30 days.`,
        ),
      );
    }

    function render(anim) {
      const before = anim !== false ? snapshot(body) : null; // false: a tab switch (its own animation)
      draw();
      animateChanges(body, before);
      if (before && lineChanged) pulse(body.querySelector('.nl-svg'), 'fx-pulse2');
    }

    const off = store.on('feed:activity', render);
    render();
    return { destroy: off };
  },
};
