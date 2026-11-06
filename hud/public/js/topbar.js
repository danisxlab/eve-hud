// SPDX-License-Identifier: GPL-3.0-or-later
// The top bar: character, clone and location, alerts and mail, Tranquility, EVE time, the
// CLUSTER light, and the ATTACK indicator. Its hover boxes list the details.

import { $, h, svg, fmt, fill, motionReduced, hoverPop } from './util.js';
import { store, saveSettings } from './store.js';
import { ICONS } from './glyphs.js';
import { secChip } from './modules/character.js';
import { derivedAlerts } from './alerts.js';
import { toast } from './toast.js';
import { applyAppearance } from './appearance.js';
import { toggleDrawer } from './settings-drawer.js';
import { aboutModal } from './dialogs.js';
import { updateModal } from './update-dialog.js';

// ---------------- top bar ----------------
// the whole HUD turns red for a moment: a blink, a quick fade to red, 0.5 s red, a fade back
export function redAlert() {
  let el = document.getElementById('red-alert');
  if (!el) {
    el = h('div', { id: 'red-alert', 'aria-hidden': 'true' });
    document.body.append(el);
  }
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
  clearTimeout(redAlert.t);
  redAlert.t = setTimeout(() => el.classList.remove('on'), 1300);
}

export function renderTopbar() {
  const bar = $('#topbar');
  // the app's own icon and name
  const brand = h(
    'div',
    { class: 'brand' },
    // the path from this file, so it also works on the demo website
    h('img', {
      class: 'app-icon',
      src: new URL('../img/eve-hud-icon.png', import.meta.url).href,
      alt: '',
      width: 20,
      height: 20,
    }),
    h('span', {}, 'EVE HUD'),
  );
  const who = h('div', { class: 'who' });
  const clone = h('div', { class: 'clone' });
  const tq = h('div', { class: 'stat' });
  const clock = h('div', { class: 'stat clock' });
  const divider = () => h('i', { class: 'tb-div', 'aria-hidden': 'true' });
  // unread mail: envelope (always visible) + round green count badge when unread
  const mailCount = h('b', { class: 'mail-count' });
  const mailIcon = h('span', { class: 'mail-icon' });
  mailIcon.append(svg(ICONS.mail, 'g'), mailCount);
  const mail = h('div', { class: 'tb-mail', role: 'status' }, mailIcon);
  // alerts (skill queue, industry jobs ready, expiring orders): amber triangle + count, only when there are any
  const alertCount = h('b', { class: 'alert-count' });
  const alertIcon = h('span', { class: 'alert-icon' });
  alertIcon.append(svg(ICONS.alert, 'g'), alertCount);
  // alerts + notifications in one triangle: blue, amber when an alert needs attention; a count badge
  // when there is something new. Visible whenever you're logged in.
  const alerts = h('div', { class: 'tb-alerts', role: 'status', hidden: true }, alertIcon);
  // CLUSTER: the EVE cluster (ESI /status) and ESI's own health (/meta/status) in one light
  const conn = h('span', { class: 'led' });
  const lockBtn = h('button', { class: 'icon-btn', 'aria-label': 'Lock layout' });
  const setBtn = h('button', { class: 'icon-btn', 'aria-label': 'Settings' });
  setBtn.append(svg(ICONS.settings, 'g'));
  const infoBtn = h('button', {
    class: 'icon-btn',
    'aria-label': 'About EVE HUD',
    onclick: aboutModal,
  });
  infoBtn.append(svg(ICONS.info, 'g'));
  // their names: the notification box's hover style; near the window's right edge it opens leftwards
  for (const b of [lockBtn, setBtn, infoBtn])
    hoverPop(b, () => b.getAttribute('aria-label'), { mode: 'list' });
  const paintLock = () => {
    lockBtn.replaceChildren(svg(store.settings.locked ? ICONS.lock : ICONS.unlock, 'g'));
    lockBtn.classList.toggle('active', store.settings.locked);
    lockBtn.setAttribute(
      'aria-label',
      store.settings.locked ? 'Layout locked. Click to rearrange modules' : 'Lock layout',
    );
  };
  lockBtn.onclick = () => {
    store.settings.locked = !store.settings.locked;
    paintLock();
    applyAppearance();
    saveSettings();
    toast(store.settings.locked ? 'Layout locked' : 'Layout unlocked. Drag headers to move, edges to resize');
  };
  setBtn.onclick = () => toggleDrawer();
  paintLock();
  const hudConn = h('div', { class: 'stat hud-conn', role: 'status' }, h('span', {}, 'CLUSTER'), conn);
  const attack = h(
    'div',
    { class: 'tb-attack', role: 'status', hidden: true, 'aria-label': 'In combat (from the EVE game log)' },
    svg(ICONS.attack, 'g'),
    h('span', {}, 'ATTACK'),
  );
  hoverPop(attack, () => attack.getAttribute('aria-label'), { mode: 'list' });
  bar.replaceChildren(
    brand,
    who,
    clone,
    h('div', { class: 'spacer' }),
    attack,
    divider(),
    alerts,
    mail,
    divider(),
    tq,
    divider(),
    clock,
    divider(),
    hudConn,
    lockBtn,
    setBtn,
    infoBtn,
  );

  // "Update Ready" (update-dialog.js): one button, so its hover box stays put when the name repaints
  const updateBtn = h(
    'button',
    { type: 'button', class: 'get-app update-ready', 'aria-label': 'Update Ready' },
    'Update Ready',
    ['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: `tick ${c}` })),
  );

  const paintWho = () => {
    const c = store.feed('character')?.data;
    const a = store.auth;
    who.replaceChildren(
      a?.loggedIn
        ? h(
            'span',
            {},
            h('b', {}, c?.name || a.characterName || ''),
            c ? ` [${c.corporation.ticker}]` : '',
            a.demo ? ' · demo data' : '',
            // the demo website: the way to the real app (GitHub forwards to the newest release)
            a.demo && store.config?.web
              ? h(
                  'a',
                  {
                    class: 'get-app',
                    href: 'https://github.com/danisxlab/eve-hud/releases/latest',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  },
                  'Get the app',
                  ['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: `tick ${c}` })),
                )
              : '',
          )
        : '',
      // a newer EVE HUD on GitHub (update-dialog.js): opens its release notes
      store.update?.available ? updateBtn : '',
    );
  };

  const paintTq = () => {
    const s = store.feed('status')?.data;
    // unknown (no answer yet, or none at all): a dash; the CLUSTER light says why
    tq.replaceChildren(
      s
        ? h('span', {}, 'Tranquility: ', h('b', {}, fmt.int(s.players)), ' online')
        : h('span', {}, 'Tranquility: ', h('b', { class: 'faint' }, '–')),
    );
  };
  // green: Tranquility online and ESI fine · amber: VIP mode (only CCP/Fenris Creations can log in), or ESI routes the
  // HUD uses are slow or down · red: Tranquility offline or ESI unreachable · grey: not known yet
  const paintConn = () => {
    const statusFeed = store.feed('status');
    const tranquility = statusFeed?.data; // players online, version, start time, VIP mode
    const esiHealth = store.feed('esihealth')?.data;
    const trouble = Object.values(esiHealth?.problems || {}).flat();
    const uniq = [...new Map(trouble.map((x) => [x.route, x])).values()];
    // rows for the hover box: [dot ('' green, 'warn', 'bad', 'idle'), title, grey detail]
    const rows = [];
    let state = '';
    if (statusFeed?.error) {
      state = 'off';
      rows.push(['bad', "Tranquility doesn't answer", statusFeed.error.message]);
    } else if (tranquility) {
      state = tranquility.vip ? 'warn' : 'on';
      rows.push([
        tranquility.vip ? 'warn' : '',
        tranquility.vip ? 'Tranquility in VIP mode' : 'Tranquility online',
        tranquility.vip ? 'only CCP/Fenris Creations can log in' : `${fmt.int(tranquility.players)} players`,
      ]);
      if (tranquility.version) rows.push(['idle', 'Server version', String(tranquility.version)]);
      if (tranquility.startTime)
        rows.push([
          'idle',
          'Up since',
          `${new Date(tranquility.startTime).toUTCString().slice(17, 22)} EVE time, ${fmt.ago(Date.parse(tranquility.startTime))} ago`,
        ]);
    } else rows.push(['idle', 'Tranquility', 'checking…']);
    if (uniq.length) {
      if (state === 'on') state = 'warn';
      for (const x of uniq.slice(0, 6))
        rows.push([x.status === 'down' ? 'bad' : 'warn', `ESI ${x.status}`, x.route]);
      if (uniq.length > 6) rows.push(['idle', `+ ${uniq.length - 6} more ESI routes with trouble`, '']);
    } else if (esiHealth) rows.push(['', 'ESI', 'every route the HUD uses is OK']);
    else rows.push(['idle', 'ESI', 'checking…']);
    conn.className = `led ${state}`;
    hudConn.setAttribute('aria-label', `Cluster: ${rows.map((r) => `${r[1]} ${r[2]}`).join('; ')}`);
    popContent.status = () => {
      let i = 0;
      return {
        mode: 'list',
        right: true,
        nodes: rows.map(([dot, title, extra]) =>
          h(
            'div',
            { class: `pop-row ${dot}`, style: { animationDelay: `${120 + i++ * 50}ms` } },
            h('i'),
            h(
              'span',
              { class: 'txt' },
              h('span', { class: 'nm' }, title),
              extra ? h('span', { class: 'ago' }, extra) : null,
            ),
          ),
        ),
      };
    };
    if (!pop.hidden && popAnchor === 'status') openPop('status');
  };
  // Medical clone (home station): where you wake up if podded
  const paintClone = () => {
    const f = store.feed('clones');
    // its hover box: like the mail's (openPop below)
    const hint = (nodes) => {
      popContent.clone = nodes ? () => ({ mode: 'hint', nodes }) : null;
      refreshPop('clone');
    };
    if (!store.auth?.loggedIn || !f) {
      clone.replaceChildren();
      hint(null);
      return;
    }
    if (f.error?.scope) {
      clone.replaceChildren(h('span', { class: 'faint' }, 'Clone: needs scope'));
      hint('Add esi-clones.read_clones.v1 to "scopes" in config.json, then log in again');
      return;
    }
    const home = f.data?.home;
    if (!home) {
      clone.replaceChildren(h('span', { class: 'faint' }, 'Clone: unknown'));
      hint(null);
      return;
    }
    const rest =
      home.systemName && home.name?.startsWith(home.systemName)
        ? home.name.slice(home.systemName.length).replace(/^\s*-?\s*/, '')
        : home.name;
    const d = f.data;
    const details = [
      d.lastStationChange ? `home station set ${fmt.date(d.lastStationChange)} EVE` : null,
      `${d.jumpClones} jump clone${d.jumpClones === 1 ? '' : 's'}`,
      d.lastCloneJump ? `last clone jump ${fmt.date(d.lastCloneJump)} EVE` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    fill(
      clone,
      h('span', { class: 'lbl' }, 'Clone'),
      home.systemName ? secChip(home.systemName, home.sec) : null,
      h('span', { class: 'st' }, rest || home.name),
    );
    hint([h('div', {}, h('b', {}, 'Medical clone'), ` ${home.name}`), h('div', { class: 'faint' }, details)]);
  };
  store.on('feed:clones', paintClone);
  store.on('auth', paintClone);
  store.on('feed:character', paintWho);
  store.on('auth', paintWho);
  store.on('update', paintWho);
  // ---- mail + notifications: icons always visible, count badges appear when unread ----
  const blinkOnce = (el) => {
    el.classList.remove('blink');
    void el.offsetWidth;
    el.classList.add('blink');
  };
  const plural = (n, w) => `${n} unread ${w}${n === 1 ? '' : 's'}`;

  // Hover box shared by both icons: a one-line hint, or (unread notifications) an opening list box
  // that spans from the notification icon to the HUD light.
  const pop = h('div', { class: 'tb-pop', role: 'tooltip', hidden: true });
  document.body.append(pop);
  let popAnchor = null;
  let popTimer = null;
  const popContent = { mail: null, alerts: null, status: null, update: null, clone: null };
  const anchors = { mail: mailIcon, alerts: alertIcon, status: hudConn, update: updateBtn, clone };
  function openPop(which) {
    clearTimeout(popTimer);
    const content = popContent[which]?.();
    if (!content) return;
    const anchor = anchors[which];
    const a = anchor.getBoundingClientRect();
    const top = bar.getBoundingClientRect().bottom + 5;
    const wasOpen = !pop.hidden && popAnchor === which && pop.dataset.mode === content.mode;
    pop.dataset.mode = content.mode;
    pop.className = `tb-pop ${content.mode}${content.cls ? ` ${content.cls}` : ''}${content.right ? ' from-right' : ''}${wasOpen ? '' : ' opening'}`;
    pop.style.top = `${top}px`;
    if (content.right) {
      // near the right edge: the box's right side lines up with the icon and it opens to the left
      pop.style.left = '';
      pop.style.right = `${Math.round(innerWidth - a.right - 4)}px`;
      pop.style.width = '';
    } else {
      pop.style.right = '';
      pop.style.left = `${Math.round(a.left - 4)}px`;
    }
    if (content.right) {
      /* width: as wide as its rows */
    } else if (content.mode === 'list' && !content.fit) {
      const right = conn.getBoundingClientRect().right;
      pop.style.width = `${Math.round(right - a.left + 4)}px`;
    } else pop.style.width = '';
    fill(pop, content.nodes);
    pop.hidden = false;
    popAnchor = which;
    content.onShown?.();
  }
  function closePopSoon() {
    clearTimeout(popTimer);
    popTimer = setTimeout(() => {
      pop.hidden = true;
      popAnchor = null;
    }, 160);
  }
  pop.addEventListener('mouseenter', () => clearTimeout(popTimer));
  pop.addEventListener('mouseleave', closePopSoon);
  mail.addEventListener('mouseenter', () => openPop('mail'));
  mail.addEventListener('mouseleave', closePopSoon);
  hudConn.addEventListener('mouseenter', () => openPop('status'));
  hudConn.addEventListener('mouseleave', closePopSoon);
  alerts.addEventListener('mouseenter', () => openPop('alerts'));
  alerts.addEventListener('mouseleave', closePopSoon);
  clone.addEventListener('mouseenter', () => openPop('clone'));
  clone.addEventListener('mouseleave', closePopSoon);
  // Update Ready: opens like the notifications box, in orange; a click (button or box) shows the notes
  popContent.update = () =>
    store.update?.available
      ? {
          mode: 'list',
          cls: 'update-pop',
          fit: true, // as wide as its text
          nodes: h(
            'div',
            { class: 'pop-row update', style: { animationDelay: '120ms' } },
            svg(ICONS.refresh),
            h(
              'span',
              { class: 'txt' },
              `New version ${store.update.version} available. `,
              h('span', { class: 'ago' }, 'Click for more details'),
            ),
          ),
        }
      : null;
  const showUpdate = () => {
    pop.hidden = true;
    popAnchor = null;
    updateModal();
  };
  updateBtn.addEventListener('click', showUpdate);
  updateBtn.addEventListener('mouseenter', () => openPop('update'));
  updateBtn.addEventListener('mouseleave', closePopSoon);
  pop.addEventListener('click', () => {
    if (popAnchor === 'update') showUpdate();
  });
  const refreshPop = (which) => {
    if (!pop.hidden && popAnchor === which && pop.dataset.mode !== 'list') openPop(which);
  };

  let lastUnread = 0;
  const paintMail = () => {
    const visible = store.settings.appearance.showMail !== false && store.auth?.loggedIn;
    mail.classList.toggle('on', Boolean(visible));
    if (!visible) return;
    const f = store.feed('mail');
    const n = f?.data?.unread || 0;
    mailCount.textContent = n > 99 ? '99+' : String(n);
    mailIcon.classList.toggle('has', n > 0);
    if (n > lastUnread) blinkOnce(mailIcon); // new mail arrived
    lastUnread = n;
    const parts = (f?.data?.labels || []).map((l) => `${l.name} ${l.unread}`).join(' · ');
    popContent.mail = () => ({
      mode: 'hint',
      nodes: f?.error?.scope
        ? 'Unread mail needs the scope esi-mail.read_mail.v1 (log in again)'
        : n
          ? [h('b', {}, plural(n, 'mail')), parts ? h('span', { class: 'faint' }, `  ${parts}`) : null]
          : 'No unread mail',
    });
    mail.setAttribute('aria-label', n ? plural(n, 'mail') : 'No unread mail');
    refreshPop('mail');
  };
  store.on('feed:mail', paintMail);

  // The triangle: alerts worked out from the skills, industry and orders feeds, plus new EVE
  // notifications. "New" = arrived after you last opened the box: ESI's own read flag is not
  // updated by EVE's notification panel, so the HUD remembers what you've seen
  // (settings.notifications.seenUntil).
  let lastCount = 0;
  let seenTimer = null;
  const notifState = () => (store.settings.notifications ||= {});
  const paintAlerts = () => {
    const loggedIn = Boolean(store.auth?.loggedIn);
    alerts.hidden = !loggedIn;
    if (!loggedIn) return;
    const list = derivedAlerts();
    // notifications
    const f = store.feed('notifications');
    const noScope = Boolean(f?.error?.scope);
    const items = noScope ? [] : f?.data?.items || [];
    const st = notifState();
    // first run: everything already in the list counts as seen, so only future notifications are "new"
    if (f?.data && st.seenUntil === undefined) {
      st.seenUntil = items[0]?.t || Date.now();
      saveSettings();
    }
    const fresh = items.filter((x) => x.t > (st.seenUntil || 0));
    const total = list.length + fresh.length;

    alertCount.textContent = total > 99 ? '99+' : String(total);
    alertIcon.classList.toggle('has', total > 0);
    alertIcon.classList.toggle(
      'warn',
      list.some((a) => !a.soft),
    ); // amber: something needs attention
    if (total > lastCount) blinkOnce(alertIcon);
    lastCount = total;
    const parts = [
      list.length ? `${list.length} alert${list.length === 1 ? '' : 's'}` : '',
      fresh.length ? `${fresh.length} new notification${fresh.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    alerts.setAttribute('aria-label', parts.join(', ') || 'No alerts or new notifications');

    popContent.alerts = () => {
      if (!total) {
        const last = items[0];
        return {
          mode: 'hint',
          nodes: noScope
            ? 'No alerts. Notifications need the scope esi-characters.read_notifications.v1 (log in again)'
            : [
                'No alerts or new notifications',
                last
                  ? h('span', { class: 'faint' }, `  ·  latest: ${last.label}, ${fmt.ago(last.t)} ago`)
                  : null,
              ],
        };
      }
      let i = 0;
      const delay = () => ({ animationDelay: `${120 + i++ * 50}ms` });
      const row = (cls, title, extra) =>
        h(
          'div',
          { class: `pop-row${cls}`, style: delay() },
          h('i'),
          h(
            'span',
            { class: 'txt' },
            h('span', { class: 'nm' }, title),
            extra ? h('span', { class: 'ago' }, extra) : null,
          ),
        );
      const rows = list.map((a) => row(` alert${a.soft ? ' soft' : ''}`, a.title, a.foot));
      // new notifications: at most 3 lines, or 2 plus a "more" line
      const shown = fresh.slice(0, fresh.length > 3 ? 2 : 3);
      for (const x of shown) rows.push(row('', x.label, `${fmt.ago(x.t)} ago`));
      const more = fresh.length - shown.length;
      if (more > 0)
        rows.push(
          h(
            'div',
            { class: 'pop-more', style: delay() },
            `+ ${more} more new notification${more === 1 ? '' : 's'}`,
          ),
        );
      return { mode: 'list', nodes: rows, onShown: fresh.length ? () => markSeen(fresh[0].t) : null };
    };
    if (!pop.hidden && popAnchor === 'alerts' && pop.dataset.mode !== 'list') openPop('alerts');
  };
  // Opening the box for a moment marks its notifications as seen; the badge updates when it closes.
  function markSeen(t) {
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => {
      if (pop.hidden || popAnchor !== 'alerts') return;
      const st = notifState();
      if (t > (st.seenUntil || 0)) {
        st.seenUntil = t;
        saveSettings();
      }
    }, 700);
  }
  const repaintAfterClose = new MutationObserver(() => {
    if (pop.hidden) paintAlerts();
  });
  repaintAfterClose.observe(pop, { attributes: true, attributeFilter: ['hidden'] });
  for (const n of ['skills', 'industry', 'orders']) store.on(`feed:${n}`, paintAlerts);
  store.on('auth', paintAlerts);
  store.on('settings:alerts', paintAlerts);
  setInterval(paintAlerts, 60_000); // "runs out soon" and "expiring" depend on the clock
  store.on('feed:notifications', paintAlerts);
  store.on('auth', paintMail);
  store.on('settings:mail', paintMail);
  store.on('feed:status', paintTq);
  store.on('feed:status', paintConn);
  store.on('feed:esihealth', paintConn);
  paintWho();
  paintClone();
  paintMail();
  paintAlerts();
  paintTq();
  paintConn();

  // Combat (EVE's game log): ATTACK in the bar while it lasts, and a short red flash of the whole HUD when it starts
  let attackEnd = null;
  const paintCombat = (flash) => {
    const on = !!store.combat?.active;
    clearTimeout(attackEnd);
    attack.classList.remove('ending', 'starting');
    if (on) {
      attack.hidden = false;
      if (flash && !motionReduced()) {
        void attack.offsetWidth;
        attack.classList.add('starting');
        if (store.settings.appearance.redFlash !== false) redAlert();
      }
    } else if (!attack.hidden) {
      if (motionReduced()) {
        attack.hidden = true;
        return;
      }
      void attack.offsetWidth;
      attack.classList.add('ending');
      attackEnd = setTimeout(() => {
        attack.hidden = true;
        attack.classList.remove('ending');
      }, 600);
    }
  };
  store.on('combat', () => paintCombat(true));
  paintCombat(false);
  const tickClock = () => {
    clock.replaceChildren(h('span', {}, 'EVE time'), h('b', {}, fmt.evetime(Date.now())));
  };
  tickClock();
  setInterval(tickClock, 5000);
}
