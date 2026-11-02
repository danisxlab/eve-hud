// SPDX-License-Identifier: GPL-3.0-or-later
// Mining ledger: ore mined in the last 30 days (ESI's personal mining ledger), per ore and system,
// valued at average market prices.
import { h, fill, fmt, img, imageUrl } from '../util.js';
import { store } from '../store.js';
import { snapshot, animateChanges, switchTab } from '../fx.js';
import { ICONS } from '../glyphs.js';
import { secChip } from './character.js';
import { PERIODS, seg, section, barRow, placeholder, isk } from './common.js';

export default {
  id: 'mining',
  title: 'Mining Ledger',
  glyph: ICONS.mining,
  mount(ctx) {
    const st = (ctx.settings().mining ||= { period: 'week' });
    const top = h('div', { class: 'lm-head' });
    const body = h('div', { class: 'lm-body scroll' });
    ctx.body.append(h('div', { class: 'lm' }, top, body));

    function draw() {
      const f = store.feed('mining');
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
        fill(body, placeholder(f, 'Reading your mining ledger…'));
        ctx.setSub();
        return;
      }
      const p = d.periods[st.period];
      ctx.setSub(h('span', {}, isk(p.value)));
      const max = Math.max(1, ...p.types.map((t) => t.value || t.quantity));
      const maxSys = Math.max(1, ...p.systems.map((s) => s.value));
      fill(
        body,
        h(
          'div',
          { class: 'lm-total' },
          h('div', {}, h('span', { class: 'label' }, 'Value'), h('b', { class: 'up' }, fmt.compact(p.value))),
          h('div', {}, h('span', { class: 'label' }, 'Units'), h('b', {}, fmt.compact(p.units))),
          h('div', {}, h('span', { class: 'label' }, 'Ores'), h('b', {}, String(p.types.length))),
        ),
        section('Ore'),
        p.types.length
          ? p.types.map((t) =>
              barRow({
                key: `ore:${t.typeId}`,
                lead: img(imageUrl('icon', t.typeId, 32), { class: 'lm-icon' }),
                name: t.name,
                value: isk(t.value),
                sub: `${fmt.int(t.quantity)} units`,
                frac: (t.value || t.quantity) / max,
              }),
            )
          : h('p', { class: 'lm-note' }, 'Nothing mined in this period.'),
        p.systems.length
          ? [
              section('Where'),
              p.systems.map((s) =>
                barRow({
                  key: `where:${s.name}`,
                  name: secChip(s.name, s.sec),
                  value: isk(s.value),
                  frac: s.value / maxSys,
                  tone: 'cal',
                }),
              ),
            ]
          : null,
        h(
          'p',
          { class: 'lm-note faint' },
          'ESI keeps the ledger for 30 days and updates it a few times a day, not live.',
        ),
      );
    }

    function render(anim) {
      const before = anim !== false ? snapshot(body) : null; // false: a tab switch (its own animation)
      draw();
      animateChanges(body, before);
    }

    const off = store.on('feed:mining', render);
    render();
    return { destroy: off };
  },
};
