// SPDX-License-Identifier: GPL-3.0-or-later
// Warfare: conflict data that has no map location (wars, Faction Warfare, leaderboards, campaigns).
// The Campaigns tab also lists your own freelance jobs and military campaign objectives (the
// "objectives" feed; they used to be in the Objectives module).
import { h, fill, fmt, svg, emptyState, grantLink } from '../util.js';
import { store } from '../store.js';
import { snapshot, animateChanges, switchTab } from '../fx.js';
import { ICONS } from '../glyphs.js';

// short names, so all four fit even in the smallest Warfare module
const TABS = [
  ['wars', 'Wars'],
  ['fw', 'Factions'], // Faction Warfare
  ['boards', 'Leaders'], // Faction Warfare leaderboards
  ['campaigns', 'Campaigns'],
];
const FACTION_COLORS = {
  500001: '#4fa3d6',
  500002: '#c8563f',
  500003: '#d9a441',
  500004: '#4fb08f',
  500010: '#b9a84a',
  500011: '#c43c3c',
  500012: '#9b2f3f',
  500019: '#5fae5a',
  500020: '#8f7fd6',
};
const PERIODS = [
  ['yesterday', 'Yesterday'],
  ['last_week', 'Last week'],
  ['active_total', 'All time'],
];
const BOARDS = [
  ['factions', 'Factions'],
  ['corporations', 'Corporations'],
  ['characters', 'Pilots'],
];
const METRICS = [
  ['kills', 'Kills'],
  ['victory_points', 'Victory points'],
];

const day = (t) => (t ? fmt.date(t).slice(0, 10) : '—');

// One of your freelance jobs / campaign objectives, with a progress bar.
function goalRow(i, now) {
  const p = i.progress && i.progress.target ? i.progress : null;
  const ratio = p ? Math.max(0, Math.min(1, p.ratio ?? p.current / p.target)) : null;
  const disc = h('div', { class: `disc${i.kind === 'campaign' ? ' cal' : ''}` });
  disc.append(svg(i.kind === 'freelance' ? ICONS.freelance : ICONS.campaign, 'g'));
  const foot = [
    i.committed ? 'Committed' : null,
    i.mine ? `Your share ${fmt.int(i.mine.current)}` : null,
    i.ends ? (i.ends > now ? `Ends in ${fmt.duration(i.ends - now)}` : 'Ended') : null,
    typeof i.reward === 'number' ? `${fmt.compact(i.reward)} ISK` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return h(
    'div',
    { class: 'goal' },
    disc,
    h(
      'div',
      { style: { minWidth: 0 } },
      p
        ? h(
            'div',
            { class: 'cnt' },
            p.target === 1
              ? h('b', {}, `${Math.round(ratio * 100)}%`)
              : [h('b', {}, fmt.int(p.current)), ` / ${fmt.int(p.target)}`],
          )
        : h('div', { class: 'cnt' }, i.state),
      p ? h('div', { class: 'gbar' }, h('i', { style: { width: `${ratio * 100}%` } })) : null,
      h('div', { class: 'tt' }, i.title),
      foot ? h('div', { class: 'ft' }, foot) : null,
    ),
  );
}

function seg(options, value, onPick) {
  return h(
    'div',
    { class: 'seg' },
    ...options.map(([k, label]) =>
      h(
        'button',
        {
          class: k === value ? 'on' : '',
          onclick: (e) => {
            for (const b of e.currentTarget.parentElement.children)
              b.classList.toggle('on', b === e.currentTarget);
            onPick(k);
          },
        },
        label,
      ),
    ),
  );
}

export default {
  id: 'warfare',
  title: 'Warfare',
  glyph: ICONS.warfare,
  mount(ctx) {
    const st = (ctx.settings().warfare ||= {
      tab: 'wars',
      board: 'factions',
      metric: 'kills',
      period: 'last_week',
    });
    const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    const body = h('div', { class: 'wf-body scroll' });
    const foot = h('div', { class: 'wf-foot' });
    ctx.body.append(h('div', { class: 'warfare' }, h('div', { class: 'bar-top' }, tabsEl), body, foot));
    const save = () => ctx.save();

    function renderTabs() {
      fill(
        tabsEl,
        TABS.map(([id, label]) =>
          h(
            'button',
            {
              class: `tab${st.tab === id ? ' on' : ''}`,
              role: 'tab',
              'aria-selected': String(st.tab === id),
              onclick: () => {
                st.tab = id;
                save();
                renderTabs();
                switchTab(body, () => {
                  render(false);
                  body.scrollTop = 0;
                });
              },
            },
            label,
          ),
        ),
      );
    }

    const N = (d, id) => d.names?.[id] || `#${id}`;
    const factionChip = (id, d) =>
      h(
        'span',
        { class: 'wf-fac' },
        h('i', { style: { background: FACTION_COLORS[id] || 'var(--ink-3)' } }),
        N(d, id),
      );

    function wars(d) {
      const mc = d.myCorp;
      const mine = d.wars.filter((w) => w.mine);
      const intro = !mc
        ? h('p', { class: 'wf-note' }, 'Log in to highlight wars involving your corporation or alliance.')
        : mc.npc
          ? h('p', { class: 'wf-note ok' }, "You're in an NPC corporation, which can't be at war.")
          : h(
              'p',
              { class: `wf-note${mine.length ? ' warn' : ' ok'}` },
              mine.length
                ? `${mine.length} of these wars involve your corporation or alliance.`
                : 'None of the most recent wars involve your corporation or alliance.',
            );
      if (!d.wars.length) return [intro, emptyState('No wars returned by ESI.')];
      const now = Date.now();
      return [
        intro,
        ...d.wars.map((w) => {
          const total = w.aggressor.isk + w.defender.isk;
          const ended = (w.finished && w.finished < now) || w.retracted;
          const state = ended ? 'ended' : w.started && w.started > now ? 'starts soon' : 'active';
          return h(
            'div',
            { class: `wf-war${w.mine ? ' mine' : ''}${ended ? ' ended' : ''}` },
            h(
              'div',
              { class: 'wf-sides' },
              h('span', { class: 'agg' }, N(d, w.aggressor.id)),
              h('span', { class: 'vs' }, w.mutual ? '⇄' : '→'),
              h('span', { class: 'def' }, N(d, w.defender.id)),
            ),
            h(
              'div',
              {
                class: 'wf-isk',
                title: `ISK destroyed: aggressor ${fmt.compact(w.aggressor.isk)} · defender ${fmt.compact(w.defender.isk)}`,
              },
              h('i', { class: 'agg', style: { flex: `${total ? w.aggressor.isk / total : 0.5} 0 0` } }),
              h('i', { class: 'def', style: { flex: `${total ? w.defender.isk / total : 0.5} 0 0` } }),
            ),
            h(
              'div',
              { class: 'wf-meta' },
              h('span', { class: `state ${state.replace(' ', '-')}` }, state),
              h('span', {}, `${w.aggressor.ships} : ${w.defender.ships} ships`),
              h('span', {}, `${fmt.compact(total)} ISK destroyed`),
              w.mutual ? h('span', {}, 'mutual') : null,
              w.allies ? h('span', {}, `${w.allies} all${w.allies > 1 ? 'ies' : 'y'}`) : null,
              h('span', { class: 'faint' }, `since ${day(w.started || w.declared)}`),
            ),
          );
        }),
      ];
    }

    function fw(d) {
      if (!d.fw) return [emptyState('Faction Warfare statistics unavailable.')];
      const maxSys = Math.max(1, ...d.fw.factions.map((f) => f.systems));
      const pairs = [];
      const seen = new Set();
      for (const [a, b] of d.fw.wars) {
        const k = [a, b].sort().join('-');
        if (!seen.has(k)) {
          seen.add(k);
          pairs.push([a, b]);
        }
      }
      const me = d.me
        ? d.me.enlisted
          ? h(
              'p',
              { class: 'wf-note warn' },
              `You are enlisted with ${d.me.faction || N(d, d.me.factionId)}${d.me.rank !== null ? `, rank ${d.me.rank}` : ''}. This week: ${fmt.int(d.me.killsWeek)} kills, ${fmt.int(d.me.vpWeek)} VP.`,
            )
          : h('p', { class: 'wf-note ok' }, "You're not enlisted in Faction Warfare.")
        : h(
            'p',
            { class: 'wf-note' },
            'Your own FW status needs the permission esi-characters.read_fw_stats.v1. ',
            grantLink('esi-characters.read_fw_stats.v1'),
          );
      return [
        me,
        pairs.length
          ? h(
              'div',
              { class: 'wf-pairs' },
              h('span', { class: 'label' }, 'At war'),
              ...pairs.map(([a, b]) =>
                h(
                  'span',
                  { class: 'pair' },
                  factionChip(a, d),
                  h('span', { class: 'vs' }, '×'),
                  factionChip(b, d),
                ),
              ),
            )
          : null,
        ...d.fw.factions.map((f) =>
          h(
            'div',
            { class: 'wf-facrow' },
            h(
              'div',
              { class: 'top' },
              factionChip(f.id, d),
              h('span', { class: 'sys' }, h('b', {}, f.systems), ' systems'),
            ),
            h(
              'i',
              { class: 'bar' },
              h('i', {
                style: {
                  width: `${(f.systems / maxSys) * 100}%`,
                  background: FACTION_COLORS[f.id] || 'var(--ink-3)',
                },
              }),
            ),
            h(
              'div',
              { class: 'wf-meta' },
              h('span', {}, `${fmt.int(f.pilots)} pilots`),
              h('span', {}, `kills ${fmt.int(f.killsYesterday)} today · ${fmt.int(f.killsWeek)} this week`),
              h('span', {}, `${fmt.compact(f.vpWeek)} VP this week`),
            ),
          ),
        ),
      ];
    }

    function boards(d) {
      const lb = d.leaderboards;
      if (!lb) return [emptyState('Leaderboards unavailable.')];
      const rows = lb[st.board]?.[st.metric]?.[st.period] || [];
      const max = Math.max(1, ...rows.map((r) => r.amount));
      return [
        h(
          'div',
          { class: 'wf-controls' },
          seg(BOARDS, st.board, (v) => {
            st.board = v;
            save();
            switchTab(boardEl, () => render(false));
          }),
          seg(METRICS, st.metric, (v) => {
            st.metric = v;
            save();
            switchTab(boardEl, () => render(false));
          }),
          seg(PERIODS, st.period, (v) => {
            st.period = v;
            save();
            switchTab(boardEl, () => render(false));
          }),
        ),
        rows.length
          ? h(
              'ol',
              { class: 'wf-board' },
              ...rows.map((r) =>
                h(
                  'li',
                  { 'data-k': `${r.id}` },
                  st.board === 'factions' ? factionChip(r.id, d) : h('span', { class: 'nm' }, N(d, r.id)),
                  h('span', { class: 'amt' }, fmt.int(r.amount)),
                  h(
                    'i',
                    { class: 'bar' },
                    h('i', {
                      style: {
                        width: `${(r.amount / max) * 100}%`,
                        background: st.board === 'factions' ? FACTION_COLORS[r.id] : undefined,
                      },
                    }),
                  ),
                ),
              ),
            )
          : emptyState('No entries for this period.'),
      ];
    }

    function campaigns(d) {
      const out = [];
      const mineFeed = store.feed('objectives');
      const mine = mineFeed?.data?.items || [];
      out.push(h('div', { class: 'obj-sec label' }, 'Your freelance jobs and campaign objectives'));
      if (mineFeed?.error?.scope)
        out.push(
          h(
            'p',
            { class: 'wf-note' },
            `Needs the permission ${mineFeed.error.scope}. `,
            grantLink(mineFeed.error.scope),
          ),
        );
      else if (!mineFeed) out.push(h('p', { class: 'wf-note' }, 'Loading…'));
      else if (!mine.length)
        out.push(
          h(
            'p',
            { class: 'wf-note' },
            'None right now. Freelance jobs and campaign objectives you join appear here.',
          ),
        );
      const now = Date.now();
      for (const i of mine) out.push(goalRow(i, now));
      for (const n of mineFeed?.data?.notes || []) out.push(h('p', { class: 'wf-note' }, n));
      out.push(h('div', { class: 'obj-sec label' }, 'Incursions'));
      if (!d.incursions.length) out.push(h('p', { class: 'wf-note ok' }, 'No incursions right now.'));
      for (const i of d.incursions) {
        out.push(
          h(
            'div',
            { class: 'wf-inc' },
            h(
              'div',
              { class: 'top' },
              h('b', {}, N(d, i.constellationId)),
              h('span', { class: `state ${i.state}` }, i.state),
            ),
            h('div', { class: 'gbar' }, h('i', { style: { width: `${Math.round(i.influence * 100)}%` } })),
            h(
              'div',
              { class: 'wf-meta' },
              h('span', {}, `${i.faction} · influence ${Math.round(i.influence * 100)}%`),
              h('span', {}, `${i.systems} systems`),
              i.stagingId ? h('span', {}, `staging ${N(d, i.stagingId)}`) : null,
              i.boss ? h('span', { class: 'warn' }, 'mothership') : null,
            ),
          ),
        );
      }
      out.push(h('div', { class: 'obj-sec label' }, 'Military campaigns'));
      if (!d.campaigns.length)
        out.push(h('p', { class: 'wf-note' }, 'No military campaigns returned by ESI.'));
      for (const c of d.campaigns) {
        const now = Date.now();
        out.push(
          h(
            'div',
            { class: 'wf-inc' },
            h(
              'div',
              { class: 'top' },
              h('b', {}, c.title || `Campaign ${c.id.slice(0, 8)}`),
              h('span', { class: 'state' }, c.state),
            ),
            c.progress?.target
              ? h('div', { class: 'gbar' }, h('i', { style: { width: `${(c.progress.ratio ?? 0) * 100}%` } }))
              : null,
            h(
              'div',
              { class: 'wf-meta' },
              c.progress?.target
                ? h(
                    'span',
                    {},
                    c.progress.target === 1
                      ? `${Math.round(c.progress.ratio * 100)}%`
                      : `${fmt.int(c.progress.current)} / ${fmt.int(c.progress.target)}`,
                  )
                : null,
              c.finish
                ? h(
                    'span',
                    {},
                    c.finish > now ? `ends in ${fmt.duration(c.finish - now)}` : `ended ${day(c.finish)}`,
                  )
                : null,
            ),
          ),
        );
      }
      return out;
    }

    // the leaderboard list (its filters stay put while the list itself changes)
    const boardEl = () => body.querySelector('.wf-board') || body;
    function render(anim) {
      const before = anim !== false ? snapshot(body) : null; // false: a tab switch (its own animation)
      renderTabs();
      const f = store.feed('warfare');
      const d = f?.data;
      if (!d) {
        fill(
          body,
          emptyState(f?.error ? `Warfare data failed: ${f.error.message}` : 'Loading warfare data…'),
        );
        fill(foot);
        return;
      }
      const view = { wars, fw, boards, campaigns }[st.tab] || wars;
      fill(body, view(d));
      animateChanges(body, before);
      const mine = d.wars.filter((w) => w.mine).length;
      ctx.setLight(mine ? 'warn' : 'on');
      ctx.setSub(h('span', {}, mine ? `${mine} war${mine > 1 ? 's' : ''} involve you` : 'Public ESI data'));
      fill(
        foot,
        h('span', {}, `Updated ${fmt.ago(f.updatedAt)} ago`),
        d.notes?.length
          ? h(
              'span',
              { class: 'amber', title: d.notes.join('\n') },
              ` · ${d.notes.length} source${d.notes.length > 1 ? 's' : ''} unavailable`,
            )
          : null,
      );
    }

    const offs = [
      store.on('feed:warfare', render),
      store.on('feed:objectives', () => {
        if (st.tab === 'campaigns') render();
      }),
    ];
    render();
    let last = 0;
    return {
      tick(now) {
        if (now - last > 60_000) {
          last = now;
          if (store.feed('warfare')) render();
        }
      },
      destroy: () => offs.forEach((f) => f()),
    };
  },
};
