// SPDX-License-Identifier: GPL-3.0-or-later
// Top-bar alerts: things that need your attention, worked out from other feeds (no extra ESI calls).
// They used to live in the Objectives module. Each kind can be switched off in Settings → Top bar
// alerts; a kind that's on keeps its feed running even while its module is hidden.
import { fmt } from './util.js';
import { store } from './store.js';
import { ICONS } from './glyphs.js';

const H = 3600_000;

export const ALERT_KINDS = [
  ['skills', 'Skill queue empty or ending within 24 h, unallocated skill points'],
  ['industry', 'Industry jobs ready to deliver'],
  ['orders', 'Market orders expiring within 2 days'],
];

export function derivedAlerts(now = Date.now()) {
  const on = store.settings?.alerts || {};
  const out = [];
  const sk = on.skills !== false && store.feed('skills')?.data;
  if (sk) {
    const q = (sk.queue || []).filter((e) => !e.finish || e.finish > now);
    const end = q.at(-1)?.finish;
    if (!q.length)
      out.push({
        kind: 'skills',
        glyph: ICONS.skills,
        title: 'Skill queue is empty',
        foot: 'Nothing is training right now',
      });
    else if (end && end - now < 24 * H)
      out.push({
        kind: 'skills',
        glyph: ICONS.skills,
        title: 'Skill queue runs out soon',
        foot: `Ends in ${fmt.duration(end - now)}`,
      });
    if (sk.unallocatedSp > 0)
      out.push({
        kind: 'skills',
        glyph: ICONS.skills,
        title: `${fmt.int(sk.unallocatedSp)} unallocated skill points`,
        foot: 'Apply them in the character sheet',
        soft: true,
      });
  }
  const jobs = on.industry !== false ? store.feed('industry')?.data?.jobs || [] : [];
  const ready = jobs.filter((j) => j.status === 'ready' || (j.status === 'active' && j.end <= now));
  if (ready.length)
    out.push({
      kind: 'industry',
      glyph: ICONS.industry,
      title: `Deliver ${ready.length} industry job${ready.length > 1 ? 's' : ''}`,
      foot: ready
        .map((j) => j.product)
        .slice(0, 3)
        .join(', '),
    });
  const orders = on.orders !== false ? store.feed('orders')?.data?.orders || [] : [];
  const expiring = orders.filter((o) => o.expires - now < 2 * 24 * H);
  if (expiring.length)
    out.push({
      kind: 'orders',
      glyph: ICONS.market,
      title: `${expiring.length} market order${expiring.length > 1 ? 's' : ''} expiring`,
      foot: expiring
        .map((o) => o.name)
        .slice(0, 3)
        .join(', '),
    });
  return out;
}
