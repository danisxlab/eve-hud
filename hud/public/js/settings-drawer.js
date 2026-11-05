// SPDX-License-Identifier: GPL-3.0-or-later
// The settings drawer (the gear in the top bar): appearance, modules, alerts, combat, grid,
// storage and EVE logs, account and permissions, ESI rate limits.

import { $, h, fill, grantAccess } from './util.js';
import { store, saveSettings, resetLayout } from './store.js';
import { ALERT_KINDS } from './alerts.js';
import { hud } from './hud-context.js';
import { REGISTRY } from './modules/index.js';
import { toast } from './toast.js';
import { applyAppearance } from './appearance.js';
import { confirmModal } from './dialogs.js';

// ---------------- settings drawer ----------------
export function toggleDrawer(force) {
  const d = $('#drawer');
  const o = $('#overlay');
  const open = force ?? d.hidden;
  if (open) hud.grid?.cancelReplace(); // opening the settings cancels a half-done "replace"
  d.hidden = !open;
  o.hidden = !open;
  if (open) {
    renderDrawer();
    d.classList.remove('opening');
    void d.offsetWidth;
    d.classList.add('opening');
    d.addEventListener('animationend', () => d.classList.remove('opening'), { once: true });
  }
}

export function renderDrawer() {
  const d = $('#drawer');
  const s = store.settings;
  const range = (label, min, max, step, get, set, unit = '') => {
    const out = h('output', {}, `${get()}${unit}`);
    const input = h('input', { type: 'range', min, max, step, value: get(), 'aria-label': label });
    input.oninput = () => {
      set(Number(input.value));
      out.textContent = `${input.value}${unit}`;
      applyAppearance();
      saveSettings();
    };
    return h('label', { class: 'row' }, h('span', {}, label), out, input);
  };
  const check = (label, get, set) => {
    const input = h('input', { type: 'checkbox' });
    input.checked = get();
    input.onchange = () => {
      set(input.checked);
      applyAppearance();
      saveSettings();
    };
    return h('label', { class: 'check' }, input, label);
  };
  const auth = store.auth || {};
  const rates = h('div');
  fill(
    d,
    h('h3', {}, 'Appearance'),
    // how much of the (moving) background shines through the modules; the cheap way to soften it
    range(
      'Module background opacity',
      0,
      1,
      0.02,
      () => s.appearance.opacity,
      (v) => {
        s.appearance.opacity = v;
      },
    ),
    range(
      'Background blur',
      0,
      24,
      1,
      () => s.appearance.blur,
      (v) => {
        s.appearance.blur = v;
      },
      'px',
    ),
    check(
      'Scanlines',
      () => s.appearance.scanlines,
      (v) => {
        s.appearance.scanlines = v;
      },
    ),
    check(
      'Boot animation on load',
      () => s.appearance.boot,
      (v) => {
        s.appearance.boot = v;
      },
    ),
    check(
      'Blink a module when its data updates',
      () => s.appearance.updateBlink,
      (v) => {
        s.appearance.updateBlink = v;
      },
    ),
    check(
      'Blink the chat window on new messages',
      () => s.appearance.chatBlink !== false,
      (v) => {
        s.appearance.chatBlink = v;
      },
    ),
    check(
      'Show the mail icon in the top bar',
      () => s.appearance.showMail !== false,
      (v) => {
        s.appearance.showMail = v;
        store.emit('settings:mail');
      },
    ),
    (() => {
      const sel = h(
        'select',
        { 'aria-label': 'Animations' },
        ...[
          ['on', 'Full'],
          ['limited', 'Limited'],
          ['off', 'Off'],
        ].map(([v, label]) => h('option', { value: v }, label)),
      );
      sel.value = ['on', 'limited', 'off'].includes(s.appearance.motion) ? s.appearance.motion : 'on';
      sel.onchange = () => {
        s.appearance.motion = sel.value;
        applyAppearance();
        saveSettings();
      };
      return h(
        'label',
        { class: 'row anim-row' },
        h('span', {}, 'Animations'),
        sel,
        h(
          'span',
          { class: 'note', style: { gridColumn: '1 / -1', margin: '0' } },
          'Limited: the same effects, but less smooth (a few frames a second), for much less CPU. Off stops all motion (blinks, pulses, drifting stars) and only redraws when something changes, which is the most efficient for battery and CPU usage.',
        ),
      );
    })(),
    check(
      'Starfield behind windows',
      () => s.appearance.backdrop !== 'none',
      (v) => {
        s.appearance.backdrop = v ? 'stars' : 'none';
      },
    ),
    check(
      'Display background',
      () => s.appearance.plexus !== false,
      (v) => {
        s.appearance.plexus = v;
      },
    ),
    // off by default: the moving background costs a game on the other screen many frames a second
    check(
      'Animate background',
      () => s.appearance.plexusMotion === true,
      (v) => {
        s.appearance.plexusMotion = v;
      },
    ),
    check(
      'Light running along the training bar',
      () => s.appearance.trainingLight === true,
      (v) => {
        s.appearance.trainingLight = v;
      },
    ),
    // on by default: the whole HUD flashes red when a fight starts (ATTACK in the top bar shows either way)
    check(
      'Flash the whole HUD red when you are attacked',
      () => s.appearance.redFlash !== false,
      (v) => {
        s.appearance.redFlash = v;
      },
    ),

    h('h3', {}, 'Modules'),
    ...Object.values(REGISTRY).map((m) => {
      const input = h('input', { type: 'checkbox' });
      input.checked = s.modules[m.id]?.visible;
      input.onchange = () => {
        const done = hud.grid.setVisible(m.id, input.checked);
        // grid full: close the drawer so you can click the module to replace
        if (done === 'replace') {
          input.checked = false;
          toggleDrawer(false);
        } else if (!done) input.checked = false;
      };
      return h('label', { class: 'check' }, input, m.title);
    }),

    h('h3', {}, 'Top bar alerts'),
    ...ALERT_KINDS.map(([k, label]) =>
      check(
        label,
        () => s.alerts?.[k] !== false,
        (v) => {
          (s.alerts ||= {})[k] = v;
          store.emit('settings:alerts');
        },
      ),
    ),
    h(
      'p',
      { class: 'note' },
      'The triangle in the top bar lists them. An alert that is on keeps its data updating even while its module is hidden.',
    ),

    h('h3', {}, 'Combat'),
    combatBlock(),

    h('h3', {}, 'Grid'),
    range(
      'Columns',
      1,
      8,
      1,
      () => s.grid.cols,
      (v) => {
        s.grid.cols = v;
        hud.grid.sync();
      },
    ),
    range(
      'Rows',
      1,
      8,
      1,
      () => s.grid.rows,
      (v) => {
        s.grid.rows = v;
        hud.grid.sync();
      },
    ),
    range(
      'Gap',
      0,
      24,
      1,
      () => s.grid.gap,
      (v) => {
        s.grid.gap = v;
        hud.grid.layout();
      },
      'px',
    ),
    h(
      'p',
      { class: 'note' },
      'Unlock the layout (padlock in the top bar), then drag a window by its header or resize it from its right or bottom edge. Windows snap to the grid.',
    ),
    h(
      'button',
      {
        class: 'btn',
        onclick: () => {
          resetLayout();
          hud.grid.remountAll();
          renderDrawer();
          toast('Layout reset');
        },
      },
      'Reset layout',
    ),
    h(
      'button',
      {
        class: 'btn',
        onclick: () => {
          hud.grid.remountAll();
          toggleDrawer(false);
        },
      },
      'Replay boot animation',
    ),

    // new versions (server: lib/updates.js); the demo website has nothing to update
    store.config?.web
      ? null
      : [
          h('h3', {}, 'Updates'),
          check(
            'Check GitHub for new versions (once an hour)',
            () => s.updates?.check !== false,
            (v) => {
              s.updates = { ...s.updates, check: v };
            },
          ),
          h(
            'p',
            { class: 'note' },
            'A newer version shows "Update Ready" in the top bar, with its release notes.',
          ),
        ],

    h('h3', {}, 'Storage'),
    storageBlock(),
    chatLogsBlock(),

    h('h3', {}, 'Account'),
    auth.demo
      ? h(
          'p',
          { class: 'note' },
          store.config?.web
            ? 'Demo website: sample data, nothing from EVE. Download the app to use your own character.'
            : 'Demo mode: showing sample data. Start the app without --demo to use your character.',
        )
      : [
          auth.loggedIn
            ? [
                h('p', { class: 'note' }, `Logged in as ${auth.characterName}.`),
                permissionsBlock(auth),
                h(
                  'div',
                  { class: 'btn-row' },
                  h(
                    'button',
                    {
                      class: 'btn',
                      onclick: () =>
                        fetch('/api/refresh', { method: 'POST' }).then(() => toast('Refreshing all data')),
                    },
                    'Refresh now',
                  ),
                  h('a', { class: 'btn', href: '/login' }, 'Log in again'),
                ),
              ]
            : null,
          h(
            'div',
            { class: 'btn-row' },
            auth.loggedIn
              ? h(
                  'button',
                  {
                    class: 'btn warn',
                    onclick: () => fetch('/api/logout', { method: 'POST' }).then(() => toggleDrawer(false)),
                  },
                  'Log out',
                )
              : auth.configured
                ? h('a', { class: 'btn', href: '/login' }, 'Log in with EVE Online')
                : null,
            h('button', { class: 'btn muted', onclick: resetHud }, 'Reset EVE HUD…'),
          ),
        ],
    h('h3', {}, 'ESI API rate limits'),
    rates,
    store.config?.web
      ? null
      : h(
          'p',
          { class: 'note' },
          'Refresh timings and the rate-limit reserve are in config.json (see Storage).',
        ),
  );
  loadRates(rates);
}

// Settings → Storage: where config.json and data/ are kept. Two folder fields like the setup form,
// each with Browse… (the app's folder dialog). Moving happens at a restart, before the HUD starts,
// so nothing is being written meanwhile; the app copies, checks, then removes the old files.
export function storageBlock() {
  if (store.config?.web)
    return h('p', { class: 'note' }, 'Demo website: your layout and settings are kept in this browser only.');
  const box = h('div', { class: 'storage' }, h('p', { class: 'note' }, 'Reading…'));
  fetch('/api/storage')
    .then((r) => (r.ok ? r.json() : null))
    .then((st) => {
      if (st) fill(box, storageForm(st));
      else fill(box, h('p', { class: 'note' }, `config.json: ${where('config')}`));
    })
    .catch(() => fill(box, h('p', { class: 'note' }, 'Could not read the storage folders.')));
  return box;
}
export function storageForm(st) {
  const sep = st.configDir.includes('\\') ? '\\' : '/';
  const json = (url, body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
  const err = h('p', { class: 'form-error', hidden: true });
  const row = (label, which, value, def, hint) => {
    const input = h('input', {
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      value,
      placeholder: def,
      disabled: st.fixed,
      'aria-label': label,
    });
    const browse = h(
      'button',
      {
        type: 'button',
        class: 'browse',
        disabled: st.fixed,
        onclick: async () => {
          browse.disabled = true;
          try {
            const r = await json('/api/storage/browse', { which, current: input.value });
            if (r.body.folder) {
              setValue(input, r.body.folder);
            }
          } finally {
            browse.disabled = st.fixed;
          }
        },
      },
      'Browse…',
    );
    input.addEventListener('input', () => changed(input));
    return {
      input,
      el: h(
        'div',
        { class: 'path-field' },
        h('label', { class: 'path-row' }, h('span', {}, label), input, browse),
        h('p', { class: 'note path-hint' }, hint),
      ),
    };
  };
  const cfg = row(
    'Settings',
    'config',
    st.configDir,
    st.defaults.configDir,
    'config.json: Client ID and Secret Key (encrypted), refresh timings, window.',
  );
  const dat = row(
    'Data',
    'data',
    st.dataDir,
    st.defaults.dataDir,
    'data/: your login (encrypted), layout, star map and caches.',
  );
  const clean = (v) => v.trim().replace(/[\\/]+$/, '');
  // choosing another settings folder takes the data along when it was in its usual place next to it
  function setValue(input, v) {
    if (input === cfg.input && clean(dat.input.value) === `${clean(cfg.input.value)}${sep}data`)
      dat.input.value = `${clean(v)}${sep}data`;
    input.value = v;
    changed();
  }
  const moveBtn = h(
    'button',
    { class: 'btn', onclick: () => move(clean(cfg.input.value), clean(dat.input.value)) },
    'Move and restart',
  );
  const defBtn = h(
    'button',
    {
      class: 'btn muted',
      onclick: () => {
        cfg.input.value = st.defaults.configDir;
        dat.input.value = st.defaults.dataDir;
        changed();
      },
    },
    'Use default folders',
  );
  function changed() {
    err.hidden = true;
    const now = [clean(cfg.input.value), clean(dat.input.value)];
    moveBtn.disabled = st.fixed || (now[0] === clean(st.configDir) && now[1] === clean(st.dataDir));
    defBtn.disabled =
      st.fixed || (now[0] === clean(st.defaults.configDir) && now[1] === clean(st.defaults.dataDir));
  }
  async function move(configDir, dataDir) {
    const ok = await confirmModal({
      title: 'Move the files and restart?',
      body: [
        `config.json to ${configDir}`,
        `data to ${dataDir}`,
        'EVE HUD restarts and moves them before it starts again. The old copies are removed once the new ones are checked.',
      ],
      confirmLabel: 'Move and restart',
      danger: false,
    });
    if (!ok) return;
    const r = await json('/api/storage', { configDir, dataDir });
    if (!r.ok) {
      err.textContent = r.body.error || 'Moving failed';
      err.hidden = false;
      return;
    }
    toast('Restarting to move the files…');
  }
  changed();
  return [
    cfg.el,
    dat.el,
    err,
    st.fixed
      ? h(
          'p',
          { class: 'note' },
          "Set by --data-dir (or EVE_HUD_HOME) when the app was started, so they can't be changed here.",
        )
      : h('div', { class: 'btn-row' }, moveBtn, defBtn),
    h(
      'p',
      { class: 'note' },
      'Avoid folders that sync to the cloud (iCloud Drive, OneDrive): the encrypted login and Secret Key only work on this computer anyway.',
    ),
  ];
}

// Settings → Storage → EVE logs: where the HUD reads EVE's chat logs (Chat, and your jumps from
// Local). Empty: the usual place on this computer. Can be a network share, e.g. the game PC's
// Documents\EVE\logs\Chatlogs shared to this computer. Applies at once, no restart.
// ATTACK in the top bar: how long it stays after the last combat line. Saved in config.json
// ("combatIdleSeconds"), since the server reads the game logs.
export function combatBlock() {
  const out = h('output', {}, '…');
  const input = h('input', {
    type: 'range',
    min: 5,
    max: 120,
    step: 1,
    value: 15,
    disabled: true,
    'aria-label': 'Seconds without combat before a new attack alert',
  });
  let timer = null;
  input.oninput = () => {
    out.textContent = `${input.value} s`;
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        fetch('/api/combat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idleSeconds: Number(input.value) }),
        })
          .then((r) => {
            if (!r.ok) throw new Error();
          })
          .catch(() => toast('Could not save the combat setting')),
      400,
    );
  };
  fetch('/api/combat')
    .then((r) => (r.ok ? r.json() : null))
    .then((st) => {
      if (!st) {
        out.textContent = 'n/a';
        return;
      }
      input.value = st.idleSeconds;
      out.textContent = `${st.idleSeconds} s`;
      input.disabled = false;
    })
    .catch(() => {
      out.textContent = 'n/a';
    });
  return [
    h(
      'label',
      { class: 'row' },
      h('span', {}, 'Seconds without combat before a new attack alert'),
      out,
      input,
    ),
    h(
      'p',
      { class: 'note' },
      'ATTACK stays in the top bar until there has been no combat for this long. Combat after that counts as a new attack: the HUD flashes red again.',
    ),
  ];
}

export function chatLogsBlock() {
  if (store.config?.web) return null; // the demo website reads no files
  const box = h('div', { class: 'storage chatlogs' }, h('p', { class: 'note' }, 'Reading…'));
  const json = (url, body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }));
  const render = (st) => {
    const err = h('p', { class: 'form-error', hidden: true });
    const input = h('input', {
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      value: st.dir,
      placeholder: st.auto || 'Documents/EVE/logs (not found on this computer)',
      disabled: st.demo,
      'aria-label': 'EVE logs folder',
    });
    const browse = h(
      'button',
      {
        type: 'button',
        class: 'browse',
        disabled: st.demo,
        onclick: async () => {
          browse.disabled = true;
          try {
            const r = await json('/api/storage/browse', { which: 'logs', current: input.value || st.auto });
            if (r.body.folder) {
              input.value = r.body.folder;
              changed();
            }
          } finally {
            browse.disabled = st.demo;
          }
        },
      },
      'Browse…',
    );
    // the browse button needs the app (it opens the system's folder window); in a browser, type the path
    fetch('/api/storage')
      .then((r) => {
        if (!r.ok) browse.hidden = true;
      })
      .catch(() => {
        browse.hidden = true;
      });
    const save = h('button', { class: 'btn', onclick: () => apply(input.value.trim()) }, 'Use this folder');
    const def = h(
      'button',
      {
        class: 'btn muted',
        onclick: () => {
          input.value = '';
          apply('');
        },
      },
      'Use the default folder',
    );
    const changed = () => {
      err.hidden = true;
      save.disabled = st.demo || input.value.trim() === st.dir;
      def.disabled = st.demo || !st.dir;
    };
    input.addEventListener('input', changed);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !save.disabled) apply(input.value.trim());
    });
    async function apply(dir) {
      save.disabled = true;
      const r = await json('/api/chatlogs', { dir });
      if (!r.ok) {
        err.textContent = r.body.error || 'Could not use that folder';
        err.hidden = false;
        changed();
        return;
      }
      toast(
        dir ? 'Reading the EVE logs from the new folder' : 'Reading the EVE logs from the default folder',
      );
      fill(box, render(r.body));
    }
    changed();
    const gameBad = st.game && !st.game.ok;
    const reading = st.demo
      ? 'Demo mode: sample chat.'
      : !st.reading
        ? 'No EVE logs folder found on this computer: choose one.'
        : !st.found
          ? `No Chatlogs in ${st.reading}`
          : `Reading: ${st.reading}${gameBad ? " (but its Gamelogs can't be read: no combat alerts)" : ''}`;
    return [
      h(
        'div',
        { class: 'path-field' },
        h('label', { class: 'path-row' }, h('span', {}, 'EVE logs'), input, browse),
        h(
          'p',
          { class: 'note path-hint' },
          "EVE's logs folder, with Chatlogs and Gamelogs in it: for Chat, your jumps in Local and combat alerts. Empty: the usual place on this computer. Also a network share, e.g. \\\\gamepc\\EVE\\logs or /Volumes/evelogs.",
        ),
        h('p', { class: `note path-hint${(st.found && !gameBad) || st.demo ? '' : ' warn'}` }, reading),
      ),
      err,
      h('div', { class: 'btn-row' }, save, def),
    ];
  };
  fetch('/api/chatlogs')
    .then((r) => (r.ok ? r.json() : null))
    .then((st) =>
      fill(box, st ? render(st) : h('p', { class: 'note' }, 'Could not read the chat log folder.')),
    )
    .catch(() => fill(box, h('p', { class: 'note' }, 'Could not read the chat log folder.')));
  return box;
}

// "Reset EVE HUD": asks first, in a window in the middle of the screen.
export async function resetHud() {
  toggleDrawer(false);
  const ok = await confirmModal({
    title: 'Reset EVE HUD?',
    body: [
      'This logs you out and removes your Client ID and Secret Key from config.json.',
      'Your layout, settings and the star map stay. The HUD then asks for your EVE application again, like the first time.',
    ],
    confirmLabel: 'Reset everything',
  });
  if (!ok) return;
  try {
    const r = await fetch('/api/reset', { method: 'POST' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    toast('EVE HUD reset. Enter your Client ID and Secret Key to set it up again.');
  } catch (err) {
    toast(`Reset failed: ${err.message}`);
  }
}

// "16 of 22 permissions": what the login has vs. everything the HUD can use, with a button
// that adds the missing ones to config.json and logs in again (EVE then asks you to approve them).
export function permissionsBlock(auth) {
  const known = store.config?.knownScopes || [];
  const granted = new Set(auth.scopes || []);
  const missing = known.filter((x) => !granted.has(x));
  if (!known.length) return null;
  if (!missing.length) return h('p', { class: 'note' }, `All ${known.length} permissions granted.`);
  const btn = h(
    'button',
    {
      class: 'btn',
      onclick: () => {
        btn.disabled = true;
        grantAccess(missing).catch((err) => {
          btn.disabled = false;
          toast(`Couldn't add them: ${err.message}`);
        });
      },
    },
    `Grant the missing ${missing.length}`,
  );
  return h(
    'div',
    { class: 'perm' },
    h(
      'p',
      { class: 'note' },
      `${known.length - missing.length} of ${known.length} permissions granted. Modules that need a missing one say so.`,
    ),
    h(
      'details',
      { class: 'note' },
      h('summary', {}, 'Missing'),
      h(
        'div',
        { class: 'scope-list' },
        missing.map((x) => h('code', {}, x)),
      ),
    ),
    btn,
    h(
      'p',
      { class: 'note' },
      'Tick them on your application at ',
      h(
        'a',
        {
          href: 'https://developers.eveonline.com/applications',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'developers.eveonline.com',
      ),
      ' first, or EVE refuses the login.',
    ),
  );
}

export async function loadRates(el) {
  el.replaceChildren(h('p', { class: 'note' }, 'Loading…'));
  try {
    const r = await fetch('/api/ratelimits').then((x) => x.json());
    if (!r.groups?.length) {
      el.replaceChildren(h('p', { class: 'note' }, 'No rate-limited ESI routes used yet.'));
      return;
    }
    el.replaceChildren(
      ...r.groups.map((g) => {
        const pct = g.available / g.max;
        return h(
          'div',
          { class: 'row', title: `${g.scope} bucket · ${g.max} tokens per ${g.window}` },
          h('span', {}, g.group, h('span', { class: 'faint' }, ` · ${g.scope}`)),
          h(
            'output',
            {
              style: { color: g.blockedFor ? 'var(--red)' : pct < r.reserve ? 'var(--amber)' : 'var(--ink)' },
            },
            g.blockedFor ? `held ${g.blockedFor}s` : `${g.available}/${g.max}`,
          ),
          h(
            'div',
            { class: 'bar gal', style: { gridColumn: '1 / -1' } },
            h('i', { style: { width: `${pct * 100}%` } }),
          ),
        );
      }),
      h(
        'p',
        { class: 'note' },
        `Requests are held back before a group drops below ${Math.round(r.reserve * 100)}% of its tokens.`,
      ),
    );
  } catch {
    el.replaceChildren(h('p', { class: 'note' }, 'Rate-limit status unavailable.'));
  }
}

// Where config.json / data/ are, for help texts. The server sends the real paths (in the desktop
// app they are in the app's own user-data folder, not the HUD folder).
export function where(kind) {
  const f = store.config?.files;
  if (kind === 'data')
    return f?.dataDir
      ? `${f.dataDir}${f.dataDir.includes('\\') ? '\\' : '/'}settings.json`
      : 'data/settings.json in the HUD folder';
  return f?.configFile || 'config.json';
}
