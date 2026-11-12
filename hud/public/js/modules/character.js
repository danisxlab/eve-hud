// SPDX-License-Identifier: GPL-3.0-or-later
import {
  h,
  fill,
  fmt,
  img,
  imageUrl,
  secColor,
  displaySec,
  tweenNumber,
  feedError,
  motionFull,
} from '../util.js';
import { pulse } from '../fx.js';
import { store } from '../store.js';
import { ICONS } from '../glyphs.js';

export function secChip(name, sec) {
  const d = displaySec(sec);
  return h(
    'span',
    { class: 'sec-chip' },
    h('span', { class: 'n' }, name),
    h('span', { class: 's', style: { background: secColor(sec) } }, d === null ? '?' : d.toFixed(1)),
  );
}

function portraitRing(sec) {
  const r = 62;
  const C = 2 * Math.PI * r;
  const frac = Math.min(1, Math.abs(sec || 0) / 10);
  const color = (sec || 0) >= 0 ? 'var(--gal-hi)' : 'var(--red)';
  const ticks = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r1 = i % 9 === 0 ? 57 : 59;
    ticks.push(
      `M${66 + Math.sin(a) * r1},${66 - Math.cos(a) * r1}L${66 + Math.sin(a) * 60.5},${66 - Math.cos(a) * 60.5}`,
    );
  }
  const el = h('svg', { viewBox: '0 0 132 132' });
  el.innerHTML = `
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2"/>
    <path d="${ticks.join('')}" stroke="rgba(255,255,255,.16)" stroke-width="1"/>
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="${color}" stroke-width="2"
      stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 66 66)"
      style="filter:drop-shadow(0 0 4px ${color});transition:stroke-dasharray 1s"/>
    <circle cx="66" cy="66" r="53" fill="none" stroke="rgba(79,176,143,.25)" stroke-width="1"/>`;
  return el;
}

function walletChart(series, w, hgt) {
  const el = h('svg', { viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none' });
  if (!series || series.length < 2 || w < 10) return el;
  const t0 = series[0][0];
  const t1 = series.at(-1)[0];
  const vals = series.map((p) => p[1]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min) * 0.12 || max * 0.05 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const X = (t) => ((t - t0) / (t1 - t0 || 1)) * (w - 2) + 1;
  const Y = (v) => hgt - ((v - lo) / (hi - lo)) * hgt;
  // step line: the balance holds until the next journal entry
  let d = `M${X(series[0][0]).toFixed(1)},${Y(series[0][1]).toFixed(1)}`;
  for (let i = 1; i < series.length; i++) d += `H${X(series[i][0]).toFixed(1)}V${Y(series[i][1]).toFixed(1)}`;
  d += `H${w - 1}`;
  const grid = [0.25, 0.5, 0.75]
    .map(
      (f) =>
        `<line x1="0" x2="${w}" y1="${(hgt * f).toFixed(1)}" y2="${(hgt * f).toFixed(1)}" stroke="rgba(255,255,255,.05)"/>`,
    )
    .join('');
  el.innerHTML = `
    <defs><linearGradient id="wfill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="rgb(79,163,214)" stop-opacity=".22"/><stop offset="1" stop-color="rgb(79,163,214)" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${d}V${hgt}H1Z" fill="url(#wfill)"/>
    <path d="${d}" fill="none" stroke="var(--cal-hi)" stroke-width="1.2" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 3px rgba(79,163,214,.8))"/>
    <circle cx="${w - 1}" cy="${Y(vals.at(-1)).toFixed(1)}" r="2.5" fill="var(--cal-hi)"/>`;
  el.dataset.dot = `${w - 1},${Y(vals.at(-1)).toFixed(1)}`; // where the pulse goes (drawChart)
  return el;
}

const JOURNAL_LABEL = {
  market_transaction: 'Market',
  brokers_fee: 'Broker fee',
  transaction_tax: 'Sales tax',
  agent_mission_reward: 'Mission reward',
  agent_mission_time_bonus_reward: 'Mission bonus',
  bounty_prizes: 'Bounties',
  player_donation: 'Donation',
  insurance: 'Insurance',
  industry_job_tax: 'Industry tax',
  manufacturing: 'Manufacturing',
  contract_price: 'Contract',
  market_escrow: 'Escrow',
};

export default {
  id: 'character',
  title: 'Character',
  glyph: ICONS.character,
  mount(ctx) {
    const portrait = h('div', { class: 'portrait' });
    const ident = h('div', { class: 'ident' });
    const where = h('div', { class: 'whereabouts' });
    const iskNum = h('span', {}, '—');
    const isk = h('div', { class: 'big isk' }, iskNum, h('small', {}, 'ISK'));
    const delta = h('div', { class: 'dim' });
    const chart = h('div', { class: 'chart' });
    const journal = h('div', { class: 'journal' });
    const err = h('div');
    const wallet = h(
      'div',
      { class: 'wallet' },
      h(
        'div',
        { class: 'row' },
        h('div', {}, h('div', { class: 'label' }, 'Wallet'), isk),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'label' }, '30 days'), delta),
      ),
      chart,
      journal,
    );
    ctx.body.append(h('div', { class: 'char' }, portrait, ident, where, wallet), err);
    // no own light: the module light shows the ESI status, like every module (online/offline is the text)
    ctx.setSub(h('span', {}, 'Offline'));

    let lastPortraitId = null;
    const whereIn = h('div', { class: 'wt-in' });
    const whereTxt = h('div', { class: 'where-txt' }, whereIn);
    const shipIn = h('div', { class: 'ship-in' });
    const shipBox = h('div', { class: 'ship' }, shipIn);
    let lastWhere = null;
    let lastShip = null;

    function renderIdent() {
      const c = store.feed('character')?.data;
      const s = store.feed('skills')?.data;
      if (!c) return;
      ctx.setTitle('Character');
      if (lastPortraitId !== c.id) {
        portrait.replaceChildren(
          img(imageUrl('character', c.id, 256), { alt: c.name }),
          portraitRing(c.securityStatus),
        );
        lastPortraitId = c.id;
      } else {
        portrait.querySelector('svg')?.replaceWith(portraitRing(c.securityStatus));
      }
      const ageDays = c.birthday ? Math.floor((Date.now() - Date.parse(c.birthday)) / 86400000) : null;
      fill(
        ident,
        h('div', { class: 'label' }, [c.race, 'Capsuleer'].filter(Boolean).join(' ')),
        h('h3', {}, c.name),
        h(
          'div',
          { class: 'corp' },
          img(imageUrl('corporation', c.corporation.id, 64), { alt: '' }),
          h('span', {}, `[${c.corporation.ticker}] `, h('b', {}, c.corporation.name)),
        ),
        c.alliance
          ? h(
              'div',
              { class: 'corp' },
              img(imageUrl('alliance', c.alliance.id, 64), { alt: '' }),
              h('span', {}, `<${c.alliance.ticker}> `, h('b', {}, c.alliance.name)),
            )
          : null,
        h(
          'div',
          { class: 'meta' },
          h(
            'div',
            {},
            h('span', { class: 'label' }, 'Security'),
            h(
              'span',
              { class: 'v', style: { color: c.securityStatus >= 0 ? 'var(--gal-hi)' : 'var(--red)' } },
              (c.securityStatus >= 0 ? '+' : '') + c.securityStatus.toFixed(2),
            ),
          ),
          h(
            'div',
            {},
            h('span', { class: 'label' }, 'Skill points'),
            h('span', { class: 'v' }, s?.totalSp ? fmt.int(s.totalSp) : '—'),
          ),
          ageDays !== null
            ? h('div', {}, h('span', { class: 'label' }, 'Age'), h('span', { class: 'v' }, `${ageDays} days`))
            : null,
          c.implants?.length
            ? h(
                'div',
                {},
                h('span', { class: 'label' }, 'Implants'),
                h('span', { class: 'v', title: c.implants.map((i) => i.name).join('\n') }, c.implants.length),
              )
            : null,
        ),
      );
    }

    function renderWhere() {
      const p = store.feed('presence');
      const d = p?.data;
      if (!d) {
        where.replaceChildren(h('div', { class: 'dim' }, 'Waiting for location…'));
        return;
      }
      const online = d.online?.online;
      ctx.setSub(
        h(
          'span',
          {},
          online
            ? 'Online'
            : d.online
              ? `Offline · last seen ${fmt.ago(Date.parse(d.online.lastLogout || d.online.lastLogin))} ago`
              : 'Status unknown',
        ),
      );
      // where-txt: docked / in space, system, station; ship: next to it (or, in a short module, top right).
      // Each part only changes when its content does, so the swap animations run on a real change.
      if (whereTxt.parentNode !== where) {
        fill(where, whereTxt, shipBox);
        lastWhere = null;
        lastShip = null;
      }
      const whereSig = [d.docked ? `d:${d.docked.name}` : 's', d.system.name, d.system.regionName].join('|');
      if (whereSig !== lastWhere) {
        const nodes = () => [
          h('div', { class: 'label' }, d.docked ? 'Docked' : 'In space'),
          h(
            'div',
            { class: 'loc' },
            secChip(d.system.name, d.system.sec),
            h('span', { class: 'dim' }, d.system.wormhole ? 'Wormhole space' : d.system.regionName),
          ),
          d.docked ? h('div', { class: 'docked' }, d.docked.name) : null,
        ];
        if (lastWhere !== null && motionFull()) marquee(whereTxt, nodes);
        else fill(whereIn, nodes());
        lastWhere = whereSig;
      }
      const shipSig = d.ship ? `${d.ship.typeId}|${d.ship.name}` : '';
      if (shipSig !== lastShip) {
        const nodes = () =>
          d.ship
            ? [
                h(
                  'div',
                  {},
                  h('div', { class: 'nm' }, d.ship.name),
                  h('div', { class: 'dim' }, d.ship.typeName),
                ),
                img(imageUrl('render', d.ship.typeId, 128), { alt: d.ship.typeName }),
              ]
            : [];
        if (lastShip !== null && motionFull()) shipSwap(nodes);
        else fill(shipIn, nodes());
        lastShip = shipSig;
      }
    }

    // the location line slides out to the right and the new one in from the left, under a soft fade
    // at both ends (Animations: Full)
    const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
    function marquee(box, nodes) {
      box.classList.add('fx-swap');
      const out = whereIn.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: 'translateX(48px)', opacity: 0 },
        ],
        { duration: 340, easing: 'ease-in', fill: 'forwards' },
      );
      out.onfinish = () => {
        fill(whereIn, nodes());
        out.cancel();
        whereIn.animate(
          [
            { transform: 'translateX(-48px)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 560, easing: EASE },
        ).onfinish = () => box.classList.remove('fx-swap');
      };
    }
    // the ship slides down out of view, then the new one blinks in once
    function shipSwap(nodes) {
      shipBox.classList.add('fx-swap');
      const out = shipIn.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: 'translateY(100%)', opacity: 0.2 },
        ],
        { duration: 420, easing: 'ease-in', fill: 'forwards' },
      );
      out.onfinish = () => {
        fill(shipIn, nodes());
        out.cancel();
        shipBox.classList.remove('fx-swap');
        shipIn.animate(
          [
            { opacity: 0 },
            { opacity: 1, offset: 0.3, filter: 'brightness(1.6)' },
            { opacity: 0.15, offset: 0.55, filter: 'none' },
            { opacity: 1 },
          ],
          { duration: 520, easing: 'linear' },
        );
      };
    }

    // the balance counts to its new value; red when ISK goes out, green when it comes in, fading back
    // to white; the chart gets a scan line (Animations: Full)
    let lastBalance = null;
    function showBalance(v) {
      const prev = lastBalance;
      lastBalance = v;
      tweenNumber(iskNum, v, (x) => fmt.isk(x), 1300);
      if (prev === null || prev === v || !motionFull()) return;
      const css = getComputedStyle(document.documentElement);
      const c = (v > prev ? css.getPropertyValue('--gal-hi') : css.getPropertyValue('--down')).trim();
      const ink = css.getPropertyValue('--ink').trim();
      iskNum.animate(
        [
          { color: c, textShadow: `0 0 10px ${c}` },
          { color: c, textShadow: `0 0 10px ${c}`, offset: 0.3 },
          { color: ink, textShadow: '0 0 0 transparent' },
        ],
        { duration: 2200, easing: 'ease-out' },
      );
      requestAnimationFrame(() => pulse(chart, 'fx-scan'));
    }

    let lastSeries = null;
    function drawChart() {
      const w = chart.clientWidth;
      const hh = chart.clientHeight;
      const svgEl = walletChart(lastSeries, w, hh);
      // The end dot's pulse is a plain element over the chart, not part of the SVG: an animated SVG
      // shape makes Chromium redo style and layout for every screen frame (120 a second on a
      // ProMotion Mac, found with a performance trace); a plain element's pulse runs on the graphics
      // card alone.
      const [x, y] = (svgEl.dataset.dot || '').split(',').map(Number);
      fill(
        chart,
        svgEl,
        Number.isFinite(y) ? h('span', { class: 'w-pulse', style: { left: `${x}px`, top: `${y}px` } }) : null,
      );
    }

    function renderWallet() {
      const wf = store.feed('wallet');
      err.replaceChildren(feedError(wf) || '');
      const d = wf?.data;
      if (!d) return;
      showBalance(d.balance);
      const series = d.series?.length ? d.series : null;
      if (series && series.length > 1) {
        const ch = d.balance - series[0][1];
        delta.replaceChildren(
          h('i', { class: ch >= 0 ? 'tri-up' : 'tri-down' }),
          ' ',
          h('span', { class: ch >= 0 ? 'up' : 'down' }, `${ch >= 0 ? '+' : ''}${fmt.compact(ch)}`),
        );
      } else delta.textContent = '—';
      lastSeries = series ? [...series, [Date.now(), d.balance]] : null;
      drawChart();
      journal.replaceChildren(
        ...(d.recent || [])
          .slice(0, 3)
          .flatMap((r) => [
            h('span', { class: 't' }, fmt.evetime(r.t)),
            h('span', { class: 'd' }, JOURNAL_LABEL[r.type] || r.type.replace(/_/g, ' ')),
            h(
              'span',
              { class: r.amount >= 0 ? 'up' : 'down' },
              `${r.amount >= 0 ? '+' : ''}${fmt.isk(r.amount)}`,
            ),
          ]),
      );
    }

    const offs = [
      store.on('feed:character', renderIdent),
      store.on('feed:skills', renderIdent),
      store.on('feed:presence', renderWhere),
      store.on('feed:wallet', renderWallet),
    ];
    renderIdent();
    renderWhere();
    renderWallet();
    const ro = new ResizeObserver(drawChart);
    ro.observe(chart);

    return {
      // the wallet graph's end dot pulses (Animations: Full; hidden otherwise), on the shared clock
      animating: () => motionFull() && Boolean(chart.querySelector('.w-pulse')),
      frame() {
        const dot = chart.querySelector('.w-pulse');
        if (!dot) return;
        const p = (Date.now() % 2800) / 2800;
        const q = Math.min(1, p / 0.7);
        const e = 1 - (1 - q) * (1 - q); // ease out
        dot.style.transform = `scale(${(1 + 2.6 * e).toFixed(3)})`;
        dot.style.opacity = p < 0.7 ? (0.55 * (1 - e)).toFixed(3) : '0';
      },
      destroy() {
        offs.forEach((f) => f());
        ro.disconnect();
      },
    };
  },
};
