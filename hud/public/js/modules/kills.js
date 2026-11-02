// SPDX-License-Identifier: GPL-3.0-or-later
// Kills & losses: your recent killmails from ESI, with an ISK estimate (ship + destroyed and dropped
// items at average market prices). A click opens the killmail on zKillboard in your browser;
// Copy killmail link copies its official EVE link, for zKillboard's Post page.
import { h, fill, fmt, img, imageUrl } from '../util.js';
import { store } from '../store.js';
import { snapshot, animateChanges } from '../fx.js';
import { ICONS } from '../glyphs.js';
import { secChip } from './character.js';
import { section, barRow, placeholder } from './common.js';

// The killmail's official link on EVE's servers. zKillboard only has killmails someone shared with
// it; for one it doesn't have (a 404 there), paste this link on its Post page to add it.
const esiLink = (k) => `https://esi.evetech.net/latest/killmails/${k.id}/${k.hash}/`;

function withCopy(k, row) {
  if (!k.hash) return row; // kept by an older version and no longer in EVE's recent list
  const label = 'Copy killmail link';
  const b = h('button', { type: 'button', class: 'km-copy' }, label);
  b.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(esiLink(k));
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Copy failed';
    }
    setTimeout(() => {
      b.textContent = label;
    }, 1500);
  });
  const item = h('div', { class: 'km-item', 'data-k': row.dataset.k }, row, b);
  delete row.dataset.k; // the whole item (row and button) slides
  return item;
}

export default {
  id: 'kills',
  title: 'Kills & Losses',
  glyph: ICONS.kills,
  mount(ctx) {
    const body = h('div', { class: 'lm-body scroll' });
    ctx.body.append(h('div', { class: 'lm' }, body));

    function draw() {
      const f = store.feed('kills');
      const d = f?.data;
      if (!d) {
        fill(body, placeholder(f, 'Reading your killmails…'));
        ctx.setSub();
        return;
      }
      const m = d.month;
      const eff =
        m.iskKilled + m.iskLost ? Math.round((m.iskKilled / (m.iskKilled + m.iskLost)) * 100) : null;
      ctx.setSub(h('span', { title: 'Kills : losses in the last 30 days' }, `${m.kills} : ${m.losses}`));
      fill(
        body,
        h(
          'div',
          { class: 'lm-total' },
          h(
            'div',
            {},
            h('span', { class: 'label' }, 'Kills'),
            h('b', { class: 'up' }, String(m.kills)),
            h('span', { class: 'faint' }, fmt.compact(m.iskKilled)),
          ),
          h(
            'div',
            {},
            h('span', { class: 'label' }, 'Losses'),
            h('b', { class: 'down' }, String(m.losses)),
            h('span', { class: 'faint' }, fmt.compact(m.iskLost)),
          ),
          h(
            'div',
            {},
            h('span', { class: 'label' }, 'Efficiency'),
            h('b', {}, eff === null ? '—' : `${eff}%`),
          ),
        ),
        section('Latest', ' · last 30 days above'),
        d.list.length
          ? d.list.map((k) =>
              withCopy(
                k,
                barRow({
                  key: `km:${k.id}`,
                  href: `https://zkillboard.com/kill/${k.id}/`,
                  lead: h(
                    'span',
                    { class: `km-tag ${k.loss ? 'loss' : 'kill'}` },
                    img(imageUrl('icon', k.shipTypeId, 32), { class: 'lm-icon' }),
                  ),
                  name: k.loss
                    ? [h('span', { class: 'down' }, 'Lost '), k.shipName]
                    : [k.shipName, h('span', { class: 'faint' }, ` ${k.victimName || ''}`)],
                  value: fmt.compact(k.value),
                  tone: k.loss ? 'red' : '',
                  sub: [
                    secChip(k.systemName, k.sec),
                    ` ${fmt.ago(k.t)} ago`,
                    k.loss
                      ? ` · ${k.attackers} attacker${k.attackers === 1 ? '' : 's'}`
                      : [
                          k.myShipName ? ` · in a ${k.myShipName}` : '',
                          k.solo ? ' · solo' : k.finalBlow ? ' · final blow' : '',
                        ],
                  ],
                  title: 'Open on zKillboard',
                }),
              ),
            )
          : h('p', { class: 'lm-note' }, 'No kills or losses in the last 90 days.'),
        h('p', { class: 'lm-note faint' }, 'Values are estimates at average market prices.'),
      );
    }

    function render(anim) {
      const before = anim !== false ? snapshot(body) : null; // false: a tab switch (its own animation)
      draw();
      animateChanges(body, before);
    }

    const off = store.on('feed:kills', render);
    render();
    let last = 0;
    return {
      tick(now) {
        if (now - last > 60_000) {
          last = now;
          if (store.feed('kills')) render();
        }
      },
      destroy: off,
    };
  },
};
