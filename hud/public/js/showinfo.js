// SPDX-License-Identifier: GPL-3.0-or-later
// The link window: a compact, animated card that opens at a clicked chat link and floats above
// everything. Clicking anywhere outside it (or pressing Escape) closes it, so it has no close button.
import { h, fill, fmt, img, imageUrl, displaySec, secColor } from './util.js';
import { store } from './store.js';
import { secChip } from './modules/character.js';

const W = 340; // px
let pop = null;
let openFor = null; // the link element the window belongs to
let seq = 0;

function el() {
  if (pop) return pop;
  pop = h('div', { class: 'si-pop', role: 'dialog', 'aria-modal': 'false', hidden: true });
  document.body.append(pop);
  // capture phase: runs before anything else reacts to the click
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (pop.hidden) return;
      if (pop.contains(e.target)) return;
      if (openFor && openFor.contains(e.target)) return; // clicking the same link again toggles in onclick
      close();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) close();
  });
  window.addEventListener('resize', () => {
    if (!pop.hidden) close();
  });
  return pop;
}

export function close() {
  if (!pop || pop.hidden) return;
  openFor?.classList.remove('open');
  openFor = null;
  seq++;
  pop.classList.remove('opening');
  pop.classList.add('closing');
  const done = () => {
    pop.hidden = true;
    pop.classList.remove('closing');
  };
  if (document.body.classList.contains('reduce-motion')) done();
  else setTimeout(done, 110);
}

// "showinfo:2048" / "showinfo:5//30000142" / "fitting:587:..." / "killReport:123:abc" / https://…
export function parseHref(href) {
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(String(href || '').trim());
  if (!m) return { kind: 'unknown' };
  const scheme = m[1].toLowerCase();
  const payload = m[2];
  if (scheme === 'http' || scheme === 'https') return { kind: 'web', url: href };
  if (scheme === 'showinfo') {
    const [typeId, itemId] = payload.split('//');
    return Number(typeId) > 0
      ? { kind: 'showinfo', typeId: Number(typeId), itemId: Number(itemId) > 0 ? Number(itemId) : null }
      : { kind: 'unknown' };
  }
  if (scheme === 'fitting') {
    const [ship, ...mods] = payload.split(':').filter(Boolean);
    const count = mods.reduce((n, s) => n + (Number(s.split(';')[1]) || 0), 0);
    return Number(ship) > 0 ? { kind: 'fitting', typeId: Number(ship), count } : { kind: 'unknown' };
  }
  if (scheme === 'killreport') {
    const [id] = payload.split(':');
    return { kind: 'kill', id };
  }
  return { kind: 'unknown', scheme: m[1] };
}

// Renders message parts; links become orange buttons that open the window.
export function renderParts(parts) {
  return parts.map((p) => {
    if (!p.href) return p.text;
    const t = parseHref(p.href);
    if (t.kind === 'web')
      return h('a', { class: 'evelink', href: t.url, target: '_blank', rel: 'noopener noreferrer' }, p.text);
    const b = h('button', { type: 'button', class: 'evelink', title: 'Show info' }, p.text);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openFor === b && !pop.hidden) {
        close();
        return;
      }
      open(p.href, p.text, b);
    });
    return b;
  });
}

function place(anchor) {
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth,
    vh = window.innerHeight,
    m = 10;
  const left = Math.max(m, Math.min(r.left - 8, vw - W - m));
  const below = vh - r.bottom;
  const up = below < 300 && r.top > below;
  Object.assign(pop.style, {
    left: `${left}px`,
    width: `${W}px`,
    top: up ? '' : `${r.bottom + 6}px`,
    bottom: up ? `${vh - r.top + 6}px` : '',
  });
  pop.classList.toggle('up', up);
  pop.style.setProperty(
    '--tail',
    `${Math.max(14, Math.min(W - 14, r.left - left + Math.min(r.width, 60) / 2))}px`,
  );
  pop.style.maxHeight = `${Math.max(180, (up ? r.top : below) - 18)}px`;
}

export async function open(href, label, anchor) {
  el();
  const t = parseHref(href);
  const my = ++seq;
  openFor?.classList.remove('open');
  openFor = anchor;
  anchor.classList.add('open');
  pop.hidden = false;
  pop.classList.remove('closing', 'opening');
  void pop.offsetWidth; // restart the animation
  pop.classList.add('opening');
  place(anchor);
  fill(pop, head(label, null, 'Looking up…'), h('div', { class: 'si-load' }, h('i'), h('i'), h('i')));

  try {
    let card;
    if (t.kind === 'showinfo' || t.kind === 'fitting') {
      const q = new URLSearchParams({ type: t.typeId });
      if (t.kind === 'showinfo' && t.itemId) q.set('item', t.itemId);
      const res = await fetch(`/api/showinfo?${q}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      card = body;
      if (t.kind === 'fitting') card.fitting = t.count;
    } else if (t.kind === 'kill') {
      card = { kind: 'kill', id: t.id };
    } else {
      card = { kind: 'unknown', scheme: t.scheme };
    }
    if (my !== seq) return;
    fill(pop, ...render(card, label));
  } catch (err) {
    if (my !== seq) return;
    fill(pop, head(label, null, 'Not found'), h('p', { class: 'si-desc dim' }, err.message));
  }
  if (my === seq) place(anchor);
}

function head(title, image, sub, extra) {
  return h(
    'div',
    { class: 'si-head' },
    image ? h('div', { class: `si-img ${image.wide ? 'wide' : ''}` }, img(image.src, { alt: '' })) : null,
    h(
      'div',
      { class: 'si-title' },
      h('div', { class: 'si-name' }, title),
      sub ? h('div', { class: 'si-sub' }, sub) : null,
      extra || null,
    ),
  );
}

const TECH = { 1: 'Tech I', 2: 'Tech II', 3: 'Tech III' };
const row = (k, v) =>
  v === null || v === undefined || v === ''
    ? null
    : h('div', { class: 'si-row' }, h('span', {}, k), h('b', {}, v));
const num = (n, unit) =>
  `${n >= 100 ? fmt.int(n) : fmt.isk(n).replace(/\.00$/, '')}${unit ? ` ${unit}` : ''}`;
const actions = (...btns) => (btns.some(Boolean) ? h('div', { class: 'si-actions' }, ...btns) : null);
const extLink = (url, text) =>
  h('a', { class: 'si-btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, text);

function copyBtn(text) {
  const b = h('button', { type: 'button', class: 'si-btn' }, 'Copy name');
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Copy failed';
    }
    setTimeout(() => {
      b.textContent = 'Copy name';
    }, 1400);
  });
  return b;
}

function render(c, label) {
  switch (c.kind) {
    case 'type': {
      const variant = c.image === 'render' ? 'render' : 'icon';
      const src =
        c.image === 'bp'
          ? `https://images.evetech.net/types/${c.typeId}/bp?size=64`
          : imageUrl(variant, c.typeId, variant === 'render' ? 128 : 64);
      const tags = [c.techLevel && TECH[c.techLevel], c.metaLevel ? `Meta ${c.metaLevel}` : null].filter(
        Boolean,
      );
      return [
        head(
          c.name,
          { src, wide: variant === 'render' },
          [c.group, c.category].filter(Boolean).join(' · '),
          tags.length ? h('div', { class: 'si-tags' }, ...tags.map((x) => h('span', {}, x))) : null,
        ),
        c.fitting
          ? h(
              'div',
              { class: 'si-note' },
              `Fitting link · ${c.fitting} item${c.fitting === 1 ? '' : 's'} · open it in the game to see the full fit`,
            )
          : null,
        h(
          'div',
          { class: 'si-grid' },
          row(
            'Avg. price',
            c.price?.average
              ? `${c.price.average >= 1e4 ? fmt.compact(c.price.average) : fmt.isk(c.price.average)} ISK`
              : null,
          ),
          row('Volume', c.volume ? num(c.volume, 'm³') : null),
          row('Mass', c.mass ? num(c.mass, 'kg') : null),
        ),
        c.description ? h('p', { class: 'si-desc scroll' }, c.description) : null,
        actions(copyBtn(c.name), extLink(`https://everef.net/types/${c.typeId}`, 'EVE Ref')),
      ];
    }
    case 'system': {
      const canMap = c.onMap && store.mapShown;
      const show = canMap
        ? h(
            'button',
            {
              type: 'button',
              class: 'si-btn',
              onclick: () => {
                store.emit('map:show', { id: c.id });
                close();
              },
            },
            'Show on map',
          )
        : null;
      return [
        head(
          c.name,
          null,
          h(
            'span',
            {},
            h(
              'b',
              { class: 'si-sec', style: { color: secColor(c.securityStatus) } },
              displaySec(c.securityStatus)?.toFixed(1) ?? '?',
            ),
            c.region ? ` · ${c.region}` : '',
            ' · Solar system',
          ),
        ),
        actions(show, extLink(`https://zkillboard.com/system/${c.id}/`, 'zKillboard'), copyBtn(c.name)),
      ];
    }
    case 'character': {
      const sec = c.securityStatus;
      return [
        head(
          c.name,
          { src: imageUrl('character', c.id, 64) },
          [c.corporation?.name, c.alliance?.name].filter(Boolean).join(' · '),
        ),
        h(
          'div',
          { class: 'si-grid' },
          row('Security status', Number.isFinite(sec) ? sec.toFixed(1) : null),
          row('Born', c.birthday ? fmt.date(Date.parse(c.birthday)) : null),
          row('Title', c.title),
        ),
        actions(extLink(`https://zkillboard.com/character/${c.id}/`, 'zKillboard'), copyBtn(c.name)),
      ];
    }
    case 'corporation':
      return [
        head(
          c.name,
          { src: imageUrl('corporation', c.id, 64) },
          [`[${c.ticker}]`, c.alliance?.name].filter(Boolean).join(' · '),
        ),
        h(
          'div',
          { class: 'si-grid' },
          row('Members', c.members !== null ? fmt.int(c.members) : null),
          row('Founded', c.founded ? fmt.date(Date.parse(c.founded)) : null),
        ),
        actions(extLink(`https://zkillboard.com/corporation/${c.id}/`, 'zKillboard'), copyBtn(c.name)),
      ];
    case 'alliance':
      return [
        head(c.name, { src: imageUrl('alliance', c.id, 64) }, `<${c.ticker}>`),
        h(
          'div',
          { class: 'si-grid' },
          row('Executor', c.executor?.name),
          row('Founded', c.founded ? fmt.date(Date.parse(c.founded)) : null),
        ),
        actions(extLink(`https://zkillboard.com/alliance/${c.id}/`, 'zKillboard'), copyBtn(c.name)),
      ];
    case 'station':
      return [
        head(
          c.name,
          { src: imageUrl('icon', c.typeId, 64) },
          c.system?.name ? secChip(c.system.name, c.system.securityStatus) : 'Station',
        ),
        c.system?.region ? h('div', { class: 'si-grid' }, row('Region', c.system.region)) : null,
        actions(copyBtn(c.name)),
      ];
    case 'place':
      return [head(c.name, null, c.what), actions(copyBtn(c.name))];
    case 'entity':
      return [
        head(
          c.name,
          c.type ? { src: imageUrl('icon', c.type.typeId, 64) } : null,
          c.type ? c.type.name : null,
        ),
        c.type?.description ? h('p', { class: 'si-desc scroll' }, c.type.description) : null,
      ];
    case 'kill':
      return [
        head(label, null, 'Kill report'),
        actions(extLink(`https://zkillboard.com/kill/${c.id}/`, 'Open on zKillboard')),
      ];
    default:
      return [
        head(label, null, 'Link'),
        h('p', { class: 'si-desc dim' }, 'This kind of link only opens inside the EVE client.'),
      ];
  }
}
