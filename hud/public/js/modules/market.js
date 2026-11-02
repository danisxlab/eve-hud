// SPDX-License-Identifier: GPL-3.0-or-later
import { h, fmt, sparkline, emptyState, feedError } from '../util.js';
import { store } from '../store.js';
import { snapshot, animateChanges } from '../fx.js';
import { ICONS } from '../glyphs.js';

export default {
  id: 'market',
  title: 'Market Orders',
  glyph: ICONS.market,
  mount(ctx) {
    const sum = h('div', { class: 'mk-sum' });
    const list = h('div', { class: 'scroll mo-list', style: { height: 'auto', flex: '1', minHeight: '0' } });
    const err = h('div');
    ctx.body.append(
      h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, sum, list),
      err,
    );
    let rows = [];

    function build() {
      const f = store.feed('orders');
      err.replaceChildren(feedError(f) || '');
      const d = f?.data;
      if (!d) {
        sum.replaceChildren();
        list.replaceChildren(emptyState('Waiting for market orders…'));
        return;
      }
      const orders = [...d.orders].sort((a, b) => a.buy - b.buy || a.expires - b.expires);
      const sells = orders.filter((o) => !o.buy);
      const buys = orders.filter((o) => o.buy);
      const sellValue = sells.reduce((s, o) => s + o.price * o.volumeRemain, 0);
      const escrow = buys.reduce((s, o) => s + (o.escrow || 0), 0);
      const buyValue = buys.reduce((s, o) => s + o.price * o.volumeRemain, 0);
      ctx.setTitle('Market Orders', h('span', { class: 'count' }, String(orders.length)));
      ctx.setSub(h('span', {}, `${sells.length} sell · ${buys.length} buy`));
      sum.replaceChildren(
        h(
          'div',
          {},
          h('div', { class: 'label' }, 'Sell orders'),
          h(
            'div',
            { class: 'v gal' },
            fmt.compact(sellValue),
            h('span', { class: 'dim', style: { fontSize: '12px' } }, ' ISK'),
          ),
        ),
        h(
          'div',
          {},
          h('div', { class: 'label' }, 'Buy orders'),
          h(
            'div',
            { class: 'v cal' },
            fmt.compact(buyValue),
            h('span', { class: 'dim', style: { fontSize: '12px' } }, ' ISK'),
          ),
        ),
        h(
          'div',
          { class: 'faint', style: { fontSize: '11px' } },
          `${sells.reduce((s, o) => s + o.volumeRemain, 0).toLocaleString('en-US')} units listed`,
        ),
        h(
          'div',
          { class: 'faint', style: { fontSize: '11px' } },
          escrow ? `${fmt.compact(escrow)} ISK in escrow` : 'No escrow',
        ),
      );
      if (!orders.length) {
        list.replaceChildren(
          emptyState(
            'No open market orders.',
            'Sell or buy orders you place show up here with their price history.',
          ),
        );
        rows = [];
        return;
      }
      rows = orders.map((o) => {
        const hist = d.history?.[`${o.regionId}:${o.typeId}`];
        const avg = hist?.length
          ? hist.slice(-7).reduce((s, x) => s + x[1], 0) / Math.min(7, hist.length)
          : null;
        // is my price favourable vs the 7-day regional average? (sell above avg / buy below avg)
        const diff = avg ? (o.price - avg) / avg : null;
        const good = diff === null ? null : o.buy ? diff <= 0 : diff >= 0;
        const exp = h('div', { class: 'exp' });
        const row = h(
          'div',
          { class: 'ord', 'data-k': `${o.id}` },
          h(
            'div',
            { class: 'nm' },
            h('span', { class: `tag ${o.buy ? 'buy' : 'sell'}` }, o.buy ? 'BUY' : 'SELL'),
            h('span', {}, o.name),
          ),
          h(
            'div',
            { class: 'px' },
            diff !== null
              ? h('i', {
                  class: good ? 'tri-up' : 'tri-down',
                  title: `${(diff * 100).toFixed(1)}% vs 7-day average ${fmt.price(avg)}`,
                })
              : null,
            fmt.price(o.price),
          ),
          h(
            'div',
            { class: 'meta' },
            h(
              'div',
              {
                class: `bar ${o.buy ? '' : 'gal'}`,
                title: `${fmt.int(o.volumeRemain)} of ${fmt.int(o.volumeTotal)} remaining`,
              },
              h('i', { style: { width: `${(o.volumeRemain / o.volumeTotal) * 100}%` } }),
            ),
            h('span', {}, `${fmt.int(o.volumeRemain)}/${fmt.int(o.volumeTotal)}`),
            h('span', { class: 'loc' }, o.location),
          ),
          exp,
        );
        if (hist?.length > 1)
          exp.append(
            sparkline(hist, {
              width: 54,
              height: 14,
              stroke: o.buy ? 'var(--cal-hi)' : 'var(--gal-hi)',
              fill: 'transparent',
            }),
          );
        const left = h('span');
        exp.append(left);
        return { o, row, exp, left };
      });
      const before = snapshot(list);
      list.replaceChildren(...rows.map((r) => r.row));
      animateChanges(list, before); // new orders slide in, filled volume eases (Animations: Full)
      tick();
    }

    function tick() {
      const now = Date.now();
      for (const r of rows) {
        const ms = r.o.expires - now;
        r.left.textContent = ms > 0 ? fmt.duration(ms) : 'Expired';
        r.exp.classList.toggle('soon', ms < 2 * 86400_000);
      }
    }

    const off = store.on('feed:orders', build);
    build();
    let lastTick = 0;
    return {
      tick(now) {
        if (now - lastTick >= 30_000) {
          lastTick = now;
          tick();
        }
      },
      destroy: off,
    };
  },
};
