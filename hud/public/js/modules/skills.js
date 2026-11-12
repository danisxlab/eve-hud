// SPDX-License-Identifier: GPL-3.0-or-later
import { h, fill, fmt, ROMAN, emptyState, feedError, motionReduced, motionLimited } from '../util.js';
import { store } from '../store.js';
import { ICONS } from '../glyphs.js';

const ATTRS = [
  ['intelligence', 'Int'],
  ['memory', 'Mem'],
  ['perception', 'Per'],
  ['willpower', 'Wil'],
  ['charisma', 'Cha'],
];

function liveSp(e, now) {
  if (!e.start || !e.finish || e.levelEndSp === null) return null;
  const from = e.trainingStartSp ?? e.levelStartSp;
  const rate = (e.levelEndSp - from) / (e.finish - e.start);
  return Math.min(e.levelEndSp, from + rate * Math.max(0, now - e.start));
}

export default {
  id: 'skills',
  title: 'Training Queue',
  glyph: ICONS.skills,
  mount(ctx) {
    const list = h('div', { class: 'list scroll' });
    const total = h('div', { class: 'big' }, '—');
    const attrs = h('div', { class: 'attrs' });
    const timeline = h('div', { class: 'timeline' });
    const spLine = h('div', { class: 'sp' });
    const endsMini = h('span', { class: 'ends-mini' }); // only shown when the module is short
    const foot = h(
      'div',
      { class: 'foot' },
      h('div', { class: 'tt' }, h('div', { class: 'tt-label' }, 'Training time'), total, endsMini),
      attrs,
      timeline,
      spLine,
    );
    const err = h('div');
    ctx.body.append(h('div', { class: 'skills' }, list, foot), err);

    let queue = [];
    let rows = [];
    let lastSig = '';
    let activeIdx = -1;

    function build() {
      const f = store.feed('skills');
      err.replaceChildren(feedError(f) || '');
      const d = f?.data;
      const now = Date.now();
      queue = (d?.queue || []).filter((e) => !e.finish || e.finish > now);
      ctx.setTitle(
        'Training Queue',
        h('span', { class: 'count' }, String(queue.length), h('small', {}, '/150')),
      );
      const paused = queue.length && !queue[0].start;
      ctx.setLight(queue.length ? (paused ? 'warn' : 'on') : '');
      ctx.setSub(h('span', {}, !queue.length ? 'Idle' : paused ? 'Paused' : 'Training'));

      if (!d) {
        list.replaceChildren(emptyState('Waiting for skill data…'));
        rows = [];
        lastSig = '';
        return;
      }
      // Every skills update (about once a minute) used to rebuild the list, which restarted the
      // active row's animations. Same queue as before: keep the rows, only update the numbers.
      const sig = JSON.stringify([
        paused,
        queue.map((e) => [
          e.skillId,
          e.level,
          e.start,
          e.finish,
          e.levelStartSp,
          e.levelEndSp,
          e.trainingStartSp,
        ]),
      ]);
      if (sig === lastSig && rows.length) {
        const a = d.attributes;
        attrs.replaceChildren(
          ...(a
            ? ATTRS.map(([k, label]) =>
                h('div', {}, h('span', { class: 'v' }, a[k]), h('span', { class: 'k' }, label)),
              )
            : []),
        );
        tick(Date.now(), true);
        return;
      }
      lastSig = sig;
      if (!queue.length) {
        list.replaceChildren(
          emptyState(
            'Your training queue is empty.',
            'Add skills in game to keep training while you are away.',
          ),
        );
        rows = [];
      } else {
        activeIdx = queue.findIndex((e) => e.start && e.start <= now && e.finish > now);
        rows = queue.map((e, i) => {
          // which levels of this skill are still queued at (or before) this entry
          const queuedLevels = new Set(
            queue
              .slice(0, i + 1)
              .filter((q) => q.skillId === e.skillId)
              .map((q) => q.level),
          );
          const lvls = h('div', { class: 'lvls' });
          let bolt = null; // the level being trained: its bolt pulses
          for (let L = 1; L <= e.level; L++) {
            const cls = L === e.level && i === activeIdx ? 'now' : queuedLevels.has(L) ? 'q' : 'have';
            const sq = h('i', { class: cls });
            if (cls === 'now') bolt = sq;
            lvls.append(sq);
          }
          const stars = i === activeIdx ? h('span', { class: 'sk-stars' }) : null;
          const chev = i === activeIdx ? h('span', { class: 'sk-chev' }) : null;
          const tm = h('span', { class: 'tm' });
          const row = h(
            'div',
            {
              class: `sk-row${i === activeIdx ? ' active' : ''}${paused && i === 0 ? ' active paused' : ''}`,
            },
            // the progress fill, the light that runs along it (Animations: Full) and its edge line
            paused && i === 0 ? h('span', { class: 'sk-chev' }) : null, // the chevrons (standing still)
            i === activeIdx
              ? [
                  stars,
                  chev,
                  h('span', { class: 'sk-fill' }),
                  h('span', { class: 'sk-sweep' }),
                  h('span', { class: 'sk-edge' }),
                ]
              : null,
            lvls,
            h('span', { class: 'nm' }, `${e.name} ${ROMAN[e.level]}`),
            tm,
          );
          // the light's 7-second cycle follows the clock: rebuilding the list (every skills update) picks
          // it up where it was instead of starting the run over
          if (i === activeIdx) {
            const now = Date.now();
            row.style.setProperty('--sk-t', `${-(now % 7000)}ms`);
          }
          return { row, tm, e, stars, chev, bolt };
        });
        const detail = h('div', { class: 'detail' });
        const children = rows.map((r) => r.row);
        if (activeIdx >= 0) children.splice(activeIdx + 1, 0, detail);
        rows.detail = detail;
        list.replaceChildren(...children);
      }

      const a = d.attributes;
      attrs.replaceChildren(
        ...(a
          ? ATTRS.map(([k, label]) =>
              h('div', {}, h('span', { class: 'v' }, a[k]), h('span', { class: 'k' }, label)),
            )
          : []),
      );
      tick(Date.now(), true);
    }

    function tick(now, force = false) {
      if (!rows.length) {
        total.textContent = '—';
        timeline.replaceChildren();
        spLine.replaceChildren(
          h(
            'span',
            {},
            store.feed('skills')?.data?.totalSp
              ? `${fmt.int(store.feed('skills').data.totalSp)} SP trained`
              : '',
          ),
        );
        return;
      }
      if (activeIdx >= 0 && queue[activeIdx].finish <= now) {
        build();
        return;
      } // a level just completed
      let remainingTotal = 0;
      let spQueued = 0;
      const segs = [];
      for (let i = 0; i < rows.length; i++) {
        const { tm, e, row } = rows[i];
        if (!e.start || !e.finish) {
          setText(tm, 'Paused');
          continue;
        }
        const remaining = e.finish - Math.max(now, e.start);
        const shown = i === activeIdx ? remaining : e.finish - e.start;
        setText(tm, fmt.duration(shown));
        remainingTotal += Math.max(0, remaining);
        segs.push(Math.max(0, remaining));
        const from = i === activeIdx ? liveSp(e, now) : (e.trainingStartSp ?? e.levelStartSp);
        if (e.levelEndSp !== null && from !== null) spQueued += Math.max(0, e.levelEndSp - from);
        if (i === activeIdx) {
          const p = (now - e.start) / (e.finish - e.start);
          const levelFrac =
            e.levelEndSp && e.levelStartSp !== null
              ? (liveSp(e, now) - e.levelStartSp) / (e.levelEndSp - e.levelStartSp)
              : p;
          const pct = `${(Math.max(0, Math.min(1, levelFrac)) * 100).toFixed(2)}%`;
          if (rows[i].pct !== pct) row.style.setProperty('--p', (rows[i].pct = pct));
          const sp = liveSp(e, now);
          const rate =
            e.levelEndSp !== null
              ? ((e.levelEndSp - (e.trainingStartSp ?? e.levelStartSp)) / (e.finish - e.start)) * 3600_000
              : null;
          const dKey = `${fmt.int(sp)}|${e.levelEndSp}|${rate ? fmt.int(rate) : ''}|${e.finish}`;
          if (rows.detail && rows.detailKey !== dKey) {
            rows.detailKey = dKey; // rebuilt only when a number in it changed
            fill(
              rows.detail,
              h('span', {}, h('b', {}, fmt.int(sp)), ` / ${fmt.int(e.levelEndSp)} SP`),
              rate ? h('span', {}, h('b', {}, fmt.int(rate)), ' SP/h') : null,
              h('span', {}, 'Done ', h('b', {}, fmt.date(e.finish))),
            );
          }
        }
      }
      setText(total, fmt.long(remainingTotal));
      setText(endsMini, queue.at(-1)?.finish ? `ends ${fmt.date(queue.at(-1).finish)}` : '');
      if (force || timeline.childElementCount !== segs.length) {
        timeline.replaceChildren(
          ...segs.map((ms, i) =>
            h('i', {
              class: i === 0 && activeIdx === 0 ? 'cur' : '',
              title: `${rows[i].e.name} ${ROMAN[rows[i].e.level]}`,
            }),
          ),
        );
      }
      const sum = segs.reduce((x, y) => x + y, 0) || 1;
      [...timeline.children].forEach((el, i) => {
        const flex = `${Math.max(segs[i] / sum, 0.004).toFixed(4)} 0 0`;
        if (el.dataset.flex !== flex) el.style.flex = el.dataset.flex = flex;
      });
      const last = queue.at(-1);
      const spKey = `${fmt.int(Math.round(spQueued))}|${last?.finish || ''}`;
      if (force || spKey !== lastSpKey) {
        lastSpKey = spKey;
        fill(
          spLine,
          h('span', {}, `${fmt.int(Math.round(spQueued))} skill points in queue`),
          last?.finish ? h('span', {}, `Queue ends ${fmt.date(last.finish)}`) : null,
        );
      }
    }
    let lastSpKey = '';
    // text that didn't change isn't written again (writing it makes the browser lay the row out anew)
    function setText(el, text) {
      if (el.textContent !== text) el.textContent = text;
    }

    const off = store.on('feed:skills', build);
    build();
    // The always-running motion (chevrons, stars, the level bolt, the timeline shimmer), set from here
    // on the HUD's shared clock (25 frames a second; 10 with Animations: Limited, when the stars stand
    // still): running CSS animations would make the browser draw the whole window at the screen's
    // rate, 120 a second on a ProMotion Mac. Everything follows the clock, so a rebuilt row carries on.
    // Each value is set on the one small element that moves (not on the row, which would make the
    // browser work out the style of everything in the row again, 25 times a second).
    const ease = (a, b, k) => a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * k));
    const twinkle = (t, d) => {
      // 0.35 → 0.9 → 0.6 → 1 and back, over d ms each way
      let k = (t % (2 * d)) / d;
      if (k > 1) k = 2 - k;
      return k < 0.4
        ? ease(0.35, 0.9, k / 0.4)
        : k < 0.55
          ? ease(0.9, 0.6, (k - 0.4) / 0.15)
          : ease(0.6, 1, (k - 0.55) / 0.45);
    };
    function motion() {
      const r = activeIdx >= 0 ? rows[activeIdx] : null;
      if (motionReduced()) return; // Off: everything stands still
      const t = Date.now();
      const cur = timeline.querySelector('i.cur');
      if (cur) cur.style.setProperty('--tl', ((t % 2200) / 2200).toFixed(4));
      if (!r) return;
      r.chev?.style.setProperty('--chev', ((t % 1100) / 1100).toFixed(4));
      r.bolt?.style.setProperty('--bolt', (0.725 + 0.275 * Math.cos((2 * Math.PI * t) / 1600)).toFixed(3));
      if (motionLimited() || !r.stars) return;
      r.stars.style.setProperty('--far', ((t % 34000) / 34000).toFixed(5));
      r.stars.style.setProperty('--near', ((t % 26000) / 26000).toFixed(5));
      r.stars.style.setProperty('--tw1', twinkle(t, 4300).toFixed(3));
      r.stars.style.setProperty('--tw2', twinkle(t + 2200, 6100).toFixed(3));
    }

    return {
      tick: () => tick(Date.now()), // once a second: the countdowns
      // frames only while a skill is training (and animations aren't off)
      animating: () => !motionReduced() && activeIdx >= 0 && rows.length > 0,
      frame: motion,
      destroy: off,
    };
  },
};
