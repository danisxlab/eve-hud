// SPDX-License-Identifier: GPL-3.0-or-later
// Ships & assets: where your ships are, and what everything you own is worth, per location.
// Values: CCP/Fenris Creations's average market prices (ship value includes its fitting and cargo).
import { h, fill, fmt, img, imageUrl } from '../util.js';
import { store } from '../store.js';
import { snapshot, animateChanges, switchTab } from '../fx.js';
import { ICONS } from '../glyphs.js';
import { seg, section, barRow, placeholder, isk } from './common.js';

const TABS = [
  ['ships', 'Ships'],
  ['locations', 'Locations'],
];

export default {
  id: 'assets',
  title: 'Ships & Assets',
  glyph: ICONS.assets,
  mount(ctx) {
    const st = (ctx.settings().assets ||= { tab: 'ships' });
    const top = h('div', { class: 'lm-head' });
    const body = h('div', { class: 'lm-body scroll' });
    ctx.body.append(h('div', { class: 'lm' }, top, body));

    function draw() {
      const f = store.feed('assets');
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
        fill(body, placeholder(f, 'Reading your assets…'));
        ctx.setSub();
        return;
      }
      ctx.setSub(h('span', {}, isk(d.totalValue)));
      const summary = h(
        'div',
        { class: 'lm-total' },
        h(
          'div',
          {},
          h('span', { class: 'label' }, 'Worth'),
          h('b', { class: 'up' }, fmt.compact(d.totalValue)),
        ),
        h('div', {}, h('span', { class: 'label' }, 'Ships'), h('b', {}, String(d.shipCount))),
        h('div', {}, h('span', { class: 'label' }, 'Places'), h('b', {}, String(d.locationCount))),
      );
      if (st.tab === 'locations') {
        const max = Math.max(1, ...d.locations.map((l) => l.value));
        fill(
          body,
          summary,
          section('Most valuable locations'),
          d.locations.map((l) =>
            barRow({
              key: `loc:${l.id}`,
              name: l.name,
              value: isk(l.value),
              sub: `${fmt.int(l.items)} item stack${l.items === 1 ? '' : 's'}${l.ships ? ` · ${l.ships} ship${l.ships === 1 ? '' : 's'}` : ''}`,
              frac: l.value / max,
              tone: 'cal',
            }),
          ),
          d.locationCount > d.locations.length
            ? h('p', { class: 'lm-note faint' }, `+ ${d.locationCount - d.locations.length} more locations`)
            : null,
        );
        return;
      }
      fill(
        body,
        summary,
        section('Where your ships are'),
        d.ships.length
          ? d.ships.map((s) =>
              barRow({
                key: `ship:${s.itemId}`,
                lead: img(imageUrl('icon', s.typeId, 32), { class: 'lm-icon' }),
                name: s.name ? [s.name, h('span', { class: 'faint' }, ` ${s.typeName}`)] : s.typeName,
                value: s.active ? h('span', { class: 'lm-tag' }, 'active') : fmt.compact(s.value),
                sub: s.inside ? `in a ${s.inside} · ${s.location}` : s.location,
                title: `${s.typeName}${s.name ? ` “${s.name}”` : ''} · ${isk(s.value)} with fitting and cargo`,
              }),
            )
          : h('p', { class: 'lm-note' }, 'No ships found.'),
        d.shipCount > d.ships.length
          ? h('p', { class: 'lm-note faint' }, `+ ${d.shipCount - d.ships.length} more`)
          : null,
        h('p', { class: 'lm-note faint' }, 'ESI updates assets about once an hour.'),
      );
    }

    function render(anim) {
      const before = anim !== false ? snapshot(body) : null; // false: a tab switch (its own animation)
      draw();
      animateChanges(body, before);
    }

    const off = store.on('feed:assets', render);
    render();
    return { destroy: off };
  },
};
