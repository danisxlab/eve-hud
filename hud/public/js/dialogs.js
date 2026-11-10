// SPDX-License-Identifier: GPL-3.0-or-later
// Windows in the middle of the screen: About, the graphics-card restart, confirmations, and
// "EVE HUD stopped working" when the built-in server goes away.

import { h } from './util.js';
import { store } from './store.js';
import { versionLabel } from './update-dialog.js';

// About EVE HUD: version, credits and licenses, in a window in the middle of the screen
// (the (i) button in the top bar). Closes with Close, Esc or a click outside.
export function aboutModal() {
  const close = () => {
    overlay.remove();
    removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text); // opens in your browser
  // the font license, read from the file next to the fonts when you open it
  const ofl = h('pre', { class: 'license' }, 'Loading…');
  const oflBox = h('details', {}, h('summary', {}, 'Show the font license (OFL.txt)'), ofl);
  oflBox.addEventListener('toggle', () => {
    if (oflBox.open && ofl.textContent === 'Loading…') {
      fetch('/fonts/OFL.txt')
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(
          (t) => {
            ofl.textContent = t;
          },
          (err) => {
            ofl.textContent = `Could not load it: ${err.message}`;
          },
        );
    }
  });
  const closeBtn = h('button', { type: 'button', class: 'btn', onclick: close }, 'Close');
  const version = store.config?.version;
  const overlay = h(
    'div',
    {
      class: 'modal-overlay',
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    h(
      'div',
      { class: 'modal info about', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'About EVE HUD' },
      h('i', { class: 'tick tl' }),
      h('i', { class: 'tick tr' }),
      h('i', { class: 'tick bl' }),
      h('i', { class: 'tick br' }),
      // the text scrolls inside, so the corner highlights outside it stay visible
      h(
        'div',
        { class: 'modal-scroll' },
        h('h2', {}, `EVE HUD${version ? ` ${version}` : ''}`),
        h(
          'p',
          {},
          'A live EVE Online HUD for a second screen. Not made, endorsed or supported by CCP/Fenris Creations.',
        ),
        h(
          'p',
          {},
          'Source code, updates and issues: ',
          ext('https://github.com/danisxlab/eve-hud', 'github.com/danisxlab/eve-hud'),
        ),
        h('h3', {}, 'License'),
        h(
          'p',
          {},
          'EVE HUD © 2026 danisxlab. Free software: you can share and change it under the ',
          ext('https://www.gnu.org/licenses/gpl-3.0.html', 'GNU General Public License'),
          ', version 3 or (at your option) any later version. It comes with absolutely no warranty. The full text is in the LICENSE file that comes with it.',
        ),
        h('h3', {}, 'EVE Online'),
        h(
          'p',
          { class: 'legal' },
          '© CCP/Fenris Creations. All rights reserved. "EVE", "EVE Online", "CCP/Fenris Creations", and all related logos and images are trademarks or registered trademarks of CCP/Fenris Creations.',
        ),
        h(
          'p',
          {},
          "Portraits, logos, icons, the star map and all game data come from CCP/Fenris Creations's servers and are used under the ",
          ext('https://developers.eveonline.com/license-agreement', 'EVE Developer License Agreement'),
          ' (non-commercial use).',
        ),
        h('h3', {}, 'Font'),
        h(
          'p',
          {},
          'Saira Semi Condensed, © 2016 The Saira Project Authors (Hector Gatti, Omnibus-Type), with Reserved Font Name "Saira". Licensed under the SIL Open Font License 1.1.',
        ),
        oflBox,
        h('h3', {}, 'Software'),
        h(
          'p',
          {},
          "Built with Electron (MIT license) and Chromium; their license files come with the app. The HUD's icons were drawn for it; it uses no other libraries.",
        ),
        h(
          'p',
          {},
          'zKillboard and EVE Ref are only linked: they open in your browser when you click a link.',
        ),
      ),
      h('div', { class: 'modal-actions' }, closeBtn),
      // this app's version and the commit it was built from, as on GitHub: v1.0.3_8f2c1d0
      version ? h('span', { class: 'build' }, versionLabel(version, store.config?.commit)) : null,
    ),
  );
  document.body.append(overlay);
  addEventListener('keydown', onKey, true);
  closeBtn.focus();
}

// The Mac app menu's "About EVE HUD" opens this same window (src/tray.js → main.js).
window.eveHudAbout = () => aboutModal();

// Tray / Settings menu → "Use the graphics card" (src/main.js): explains the change and offers to
// restart, in the same window style as About. Restart now → /__app/restart (the app restarts).
export function gpuModal(on) {
  const close = () => {
    overlay.remove();
    removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const later = h('button', { type: 'button', class: 'btn', onclick: close }, 'Later');
  const now = h(
    'button',
    {
      type: 'button',
      class: 'btn primary',
      onclick: () => {
        location.href = '/__app/restart';
      },
    },
    'Restart now',
  );
  const overlay = h(
    'div',
    {
      class: 'modal-overlay',
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    h(
      'div',
      { class: 'modal info', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Graphics card' },
      h('i', { class: 'tick tl' }),
      h('i', { class: 'tick tr' }),
      h('i', { class: 'tick bl' }),
      h('i', { class: 'tick br' }),
      h(
        'div',
        { class: 'modal-scroll' },
        h('h2', {}, on ? 'Use the graphics card again' : 'Draw without the graphics card'),
        on
          ? h(
              'p',
              {},
              'After a restart the HUD draws with the graphics card again: smoother, and less work for the processor.',
            )
          : [
              h(
                'p',
                {},
                'After a restart the HUD draws with the processor instead, so a game on the other screen has the graphics card to itself.',
              ),
              h(
                'p',
                {},
                'That costs some processor time. ',
                h('b', {}, 'Settings → Animations → Limited'),
                ' keeps it low.',
              ),
            ],
        h(
          'p',
          { class: 'faint' },
          'This takes effect after a restart. You can change it back in the same menu.',
        ),
      ),
      h('div', { class: 'modal-actions' }, later, now),
    ),
  );
  document.body.append(overlay);
  addEventListener('keydown', onKey, true);
  now.focus();
}
window.eveHudGpuModal = (on) => gpuModal(on);

// A confirmation window in the middle of the screen. Resolves true (confirmed) or false
// (Cancel, Esc, or a click outside).
export function confirmModal({ title, body = [], confirmLabel = 'OK', danger = true }) {
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.remove();
      removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === cancel ? ok : cancel).focus();
      } // keep focus in the window
    };
    const cancel = h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Cancel');
    const ok = h(
      'button',
      { type: 'button', class: `btn${danger ? ' warn' : ''}`, onclick: () => close(true) },
      confirmLabel,
    );
    const overlay = h(
      'div',
      {
        class: 'modal-overlay',
        onclick: (e) => {
          if (e.target === overlay) close(false);
        },
      },
      h(
        'div',
        { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
        h('i', { class: 'tick tl' }),
        h('i', { class: 'tick tr' }),
        h('i', { class: 'tick bl' }),
        h('i', { class: 'tick br' }),
        h('h2', {}, title),
        body.map((t) => h('p', {}, t)),
        h('div', { class: 'modal-actions' }, cancel, ok),
      ),
    );
    document.body.append(overlay);
    addEventListener('keydown', onKey, true);
    cancel.focus(); // the safe choice is the default
  });
}

// ---------------- the built-in server stopped ----------------
// The server runs inside the app, so losing it means something broke. After a few seconds without
// it (and a check that it really doesn't answer), a red window says so, with the log file and a way
// to restart or close the app. Those buttons go to /__app/…, which the app window handles itself.
export function watchServer() {
  let timer = null;
  let shown = null;
  const check = async () => {
    try {
      const r = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (r.ok) return; // still there: the live connection will come back by itself
    } catch {
      /* no answer */
    }
    if (!store.connected && !shown) shown = serverLostModal();
  };
  store.on('connection', (ok) => {
    clearTimeout(timer);
    if (ok) {
      shown?.remove();
      shown = null;
      return;
    }
    timer = setTimeout(check, 6000);
  });
}
export function serverLostModal() {
  const go = (action) => {
    location.href = `/__app/${action}`;
  };
  const quit = h('button', { type: 'button', class: 'btn warn', onclick: () => go('quit') }, 'Close EVE HUD');
  const overlay = h(
    'div',
    { class: 'modal-overlay error-overlay' },
    h(
      'div',
      {
        class: 'modal error',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-label': 'EVE HUD stopped working',
      },
      h('i', { class: 'tick tl' }),
      h('i', { class: 'tick tr' }),
      h('i', { class: 'tick bl' }),
      h('i', { class: 'tick br' }),
      h('h2', {}, 'EVE HUD stopped working'),
      h(
        'p',
        {},
        "An internal error occurred: the HUD's built-in server stopped responding, so nothing on screen updates any more.",
      ),
      h(
        'p',
        {},
        'The log file has the details. ',
        h(
          'a',
          {
            href: '/__app/log',
            onclick: (e) => {
              e.preventDefault();
              go('log');
            },
          },
          'Open the log file',
        ),
      ),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => go('restart') }, 'Restart'),
        quit,
      ),
    ),
  );
  document.body.append(overlay);
  quit.focus();
  return overlay;
}

// ---------------- "port" changed without your own application ----------------
// The EVE HUD application's Callback URL only comes back to port 4747. When "port" in config.json was
// changed by hand and no own EVE developer application is set up, a red window over everything says
// so; it stays until the port is back on 4747 (Open config file, change it, Restart).
let portOverlay = null;
export function checkPortProblem() {
  const port = store.auth?.portProblem;
  if (!port || store.auth?.demo) {
    portOverlay?.remove();
    portOverlay = null;
    return;
  }
  if (!portOverlay) portOverlay = portProblemModal(port);
}
export function portProblemModal(port) {
  const inApp = Boolean(store.config?.app);
  const go = (action) => {
    location.href = `/__app/${action}`;
  };
  const restart = h('button', { type: 'button', class: 'btn warn', onclick: () => go('restart') }, 'Restart');
  const overlay = h(
    'div',
    { class: 'modal-overlay error-overlay' },
    h(
      'div',
      {
        class: 'modal error',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-label': 'The port can only be changed with your own EVE application',
      },
      h('i', { class: 'tick tl' }),
      h('i', { class: 'tick tr' }),
      h('i', { class: 'tick bl' }),
      h('i', { class: 'tick br' }),
      h('h2', {}, 'The port can only be changed with your own EVE application'),
      h(
        'p',
        {},
        h('code', {}, `"port": ${port}`),
        ' in ',
        h('code', {}, 'config.json'),
        " can't be used: EVE HUD logs in through the EVE HUD application, and EVE only sends that login back to port 4747.",
      ),
      h(
        'p',
        {},
        'Change ',
        h('code', {}, '"port"'),
        ' back to ',
        h('code', {}, '4747'),
        ' in ',
        h('code', {}, 'config.json'),
        ' and restart EVE HUD. Another port only works with your own EVE developer application registered on developers.eveonline.com.',
      ),
      inApp
        ? h(
            'div',
            { class: 'modal-actions' },
            h('button', { type: 'button', class: 'btn', onclick: () => go('config') }, 'Open config file'),
            restart,
          )
        : null,
    ),
  );
  document.body.append(overlay);
  if (inApp) restart.focus();
  return overlay;
}
