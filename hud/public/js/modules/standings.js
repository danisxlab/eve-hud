// SPDX-License-Identifier: GPL-3.0-or-later
// Standings: how factions, NPC corporations and agents see you (raw values, -10 to +10, before the
// Connections / Diplomacy / Criminal Connections skills are applied).
import { h, fill } from '../util.js';
import { store } from '../store.js';
import { snapshot, animateChanges, switchTab } from '../fx.js';
import { ICONS } from '../glyphs.js';
import { seg, placeholder } from './common.js';

const TABS = [
  ['factions', 'Factions'],
  ['corporations', 'Corporations'],
  ['agents', 'Agents'],
];

function standingRow(s) {
  const v = Math.round(s.standing * 100) / 100; // as shown: -0.001 is 0.00, neutral
  const pct = Math.min(1, Math.abs(v) / 10) * 50;
  return h(
    'div',
    { class: 'st-row', 'data-k': `${s.id ?? s.name}` },
    h('span', { class: 'st-name' }, s.name),
    h(
      'b',
      { class: `st-val ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}` },
      `${v > 0 ? '+' : ''}${(v || 0).toFixed(2)}`,
    ),
    // a bar from the middle: right = positive (blue), left = negative (red)
    h(
      'i',
      { class: 'st-bar' },
      h('i', {
        class: v >= 0 ? 'pos' : 'neg',
        style: v >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` },
      }),
    ),
  );
}

export default {
  id: 'standings',
  title: 'Standings',
  glyph: ICONS.standings,
  mount(ctx) {
    const st = (ctx.settings().standings ||= { tab: 'factions' });
    const top = h('div', { class: 'lm-head' });
    const body = h('div', { class: 'lm-body scroll' });
    ctx.body.append(h('div', { class: 'lm' }, top, body));

    function draw() {
      const f = store.feed('standings');
      const d = f?.data;
      fill(
        top,
        seg(TABS, st.tab, (k) => {
          st.tab = k;
          ctx.save();
          switchTab(body, () => {
            render(false);
            body.scrollTop = 0;
          });
        }),
      );
      if (!d) {
        fill(body, placeholder(f, 'Reading standings…'));
        return;
      }
      const list = d[st.tab] || [];
      ctx.setSub(h('span', {}, `${d.factions.length + d.corporations.length + d.agents.length} standings`));
      fill(
        body,
        list.length ? list.map(standingRow) : h('p', { class: 'lm-note' }, 'None.'),
        h('p', { class: 'lm-note faint' }, 'Raw standings, before your social skills.'),
      );
    }

    function render(anim) {
      const before = anim !== false ? snapshot(body) : null; // false: a tab switch (its own animation)
      draw();
      animateChanges(body, before);
    }

    const off = store.on('feed:standings', render);
    render();
    return { destroy: off };
  },
};
