// SPDX-License-Identifier: GPL-3.0-or-later
// Before the HUD can show anything: the "Log in with EVE Online" button (the built-in EVE HUD
// application, or your own), or the form for your own application's Client ID and Secret Key.

import { h, fill, PLAIN_SECRETS } from './util.js';
import { store } from './store.js';

// ---------------- login gate ----------------
// Not logged in: the "Log in with EVE Online" button. Its "Use your own EVE application" link
// opens the form for your own application's Client ID and Secret Key (saved to config.json, used at once).
const PRIVACY_URL = 'https://danisxlab.github.io/eve-hud/documentation/#data-privacy';
let gateMode = null;
let wantOwnApp = false; // the link was clicked (the form has a "Back" link)
export function renderGate() {
  const a = store.auth;
  if (a?.ownApp || a?.loggedIn) wantOwnApp = false; // saved (or logged in): next time the login button again
  const mode = !a || a.loggedIn ? null : wantOwnApp ? 'setup' : 'login';
  if (mode === gateMode && (mode === null || document.querySelector('.gate'))) return; // keep what's typed
  gateMode = mode;
  document.querySelector('.gate')?.remove();
  if (!mode) return;
  const card = h(
    'div',
    { class: 'card' },
    h('i', { class: 'tick tl' }),
    mode === 'login'
      ? [
          h('h1', {}, 'Connect your capsuleer'),
          h('p', {}, 'Log in through EVE Online to give EVE HUD access to your character information.'),
          // CCP's official "LOG IN with EVE Online" button image (developers.eveonline.com)
          h(
            'div',
            { class: 'cta-row' },
            h(
              'a',
              { class: 'sso', href: '/login', title: 'Log in with EVE Online' },
              h('img', {
                src: 'img/eve-sso-login-white-large.png',
                width: 270,
                height: 45,
                alt: 'Log in with EVE Online',
              }),
            ),
          ),
          store.config?.app
            ? h(
                'p',
                { class: 'fine center' },
                "Opens in your default browser. When it says you're logged in, close the tab: EVE HUD updates by itself.",
              )
            : null,
          a.secretProblem ? h('p', { class: 'form-error' }, a.secretProblem) : null,
          store.config?.plainSecrets ? h('p', { class: 'form-error' }, PLAIN_SECRETS) : null,
          a.ownApp
            ? h(
                'p',
                { class: 'fine center' },
                'Logs in through your own EVE application (Settings → Reset EVE HUD removes it).',
              )
            : h(
                'p',
                { class: 'fine center' },
                h(
                  'a',
                  { href: '#', onclick: (e) => switchGate(e, true) },
                  'Use your own EVE developer client credentials instead',
                ),
              ),
          h(
            'p',
            { class: 'fine privacy' },
            'The necessary tokens to access your character information are only stored on this computer. ',
            "EVE HUD doesn't send or use your data other than to make this application work. Please check the ",
            h(
              'a',
              { href: PRIVACY_URL, target: '_blank', rel: 'noopener noreferrer' }, // opens in your browser
              'privacy',
            ),
            ' section of the documentation on how EVE HUD handles your data.',
          ),
        ]
      : setupForm(),
  );
  document.body.append(h('div', { class: 'gate' }, card));
  card.querySelector('input')?.focus();
}

function switchGate(e, own) {
  e.preventDefault();
  wantOwnApp = own;
  renderGate();
}

export function setupForm() {
  const cfg = store.config || {};
  // every scope the HUD can use (config.json's list plus any new ones); saving adds the new ones to config.json
  const scopes = [...new Set([...(cfg.scopes || []), ...(cfg.knownScopes || [])])];
  // text: a string, or a function giving the current text (the callback URL follows the port field)
  const copyBtn = (text, label) =>
    h(
      'button',
      {
        type: 'button',
        class: 'copy',
        title: `Copy ${label}`,
        onclick: (e) =>
          navigator.clipboard?.writeText(typeof text === 'function' ? text() : text).then(() => {
            e.target.textContent = 'Copied';
            setTimeout(() => {
              e.target.textContent = 'Copy';
            }, 1500);
          }),
      },
      'Copy',
    );
  // Callback URL with an editable port (your own application only; the EVE HUD application only
  // works on 4747): EVE HUD moves to that port when you save, so pick a free one if 4747 is taken.
  // It must match the Callback URL on developers.eveonline.com exactly.
  const currentPort = Number(cfg.port) || 4747;
  const port = h('input', {
    type: 'text',
    inputmode: 'numeric',
    class: 'port',
    name: 'port',
    value: String(currentPort),
    maxlength: 5,
    'aria-label': 'Port',
    title: 'Port of EVE HUD (1024–65535)',
  });
  const portState = h('span', { class: 'port-state' });
  const callbackUrl = () => `http://localhost:${port.value.trim() || currentPort}/callback`;
  let checkTimer = null;
  port.addEventListener('input', () => {
    port.value = port.value.replace(/\D/g, '').slice(0, 5);
    clearTimeout(checkTimer);
    fill(portState);
    portState.className = 'port-state';
    checkTimer = setTimeout(async () => {
      const n = Number(port.value);
      if (!(n >= 1024 && n <= 65535)) {
        portState.className = 'port-state bad';
        fill(portState, '1024–65535');
        return;
      }
      const r = await fetch(`/api/portcheck?port=${n}`)
        .then((x) => x.json())
        .catch(() => null);
      if (!r || String(r.port) !== port.value) return; // typed on meanwhile
      portState.className = `port-state ${r.free ? 'ok' : 'bad'}`;
      fill(portState, r.current ? 'in use by EVE HUD' : r.free ? 'free' : 'in use');
    }, 350);
  });
  const id = h('input', {
    type: 'text',
    name: 'clientId',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Client ID',
  });
  const secret = h('input', {
    type: 'password',
    name: 'clientSecret',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Secret Key (optional)',
  });
  const err = h('p', { class: 'form-error', hidden: true });
  const save = h('button', { type: 'submit', class: 'cta' }, 'Save and continue');
  const form = h(
    'form',
    {
      class: 'setup',
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        save.disabled = true;
        try {
          const r = await fetch('/api/credentials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: id.value, clientSecret: secret.value, port: port.value }),
          });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            err.textContent = body.error || `Saving failed (HTTP ${r.status})`;
            err.hidden = false;
            (({ clientSecret: secret, port })[body.field] || id).focus();
            return;
          }
          secret.value = '';
          // Moved to another port: the app window follows by itself.
          if (body.url && new URL(body.url).port !== location.port) {
            if (!store.config.app) location.href = body.url;
            return;
          }
          // otherwise the next screen ("Connect your capsuleer") arrives over the live connection
        } catch (e2) {
          err.textContent = `Saving failed: ${e2.message}`;
          err.hidden = false;
        } finally {
          save.disabled = false;
        }
      },
    },
    h('label', {}, h('span', {}, 'Client ID'), id),
    h('label', {}, h('span', {}, 'Secret Key'), secret),
    err,
    h('div', { class: 'cta-row' }, save),
  );
  return [
    h('h1', {}, 'Use your own EVE application'),
    h(
      'p',
      {},
      'Optional: EVE HUD can also log in through your own application on ',
      h(
        'a',
        {
          href: 'https://developers.eveonline.com/applications',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'developers.eveonline.com',
      ),
      '. Create one (or open yours) with:',
    ),
    h(
      'div',
      { class: 'setup-row' },
      h('span', { class: 'label' }, 'Callback URL'),
      h('code', { class: 'cb' }, 'http://localhost:', port, '/callback', portState),
      copyBtn(callbackUrl, 'the callback URL'),
    ),
    h(
      'p',
      { class: 'fine tight' },
      `Port ${currentPort} taken by something else on this computer? Type another one; EVE HUD moves there when you save. The Callback URL on the developer site must match.`,
    ),
    h(
      'div',
      { class: 'setup-row' },
      h('span', { class: 'label' }, 'Scopes'),
      h('span', {}, `${scopes.length} scopes`),
      copyBtn(scopes.join(' '), 'the scopes'),
      h(
        'details',
        {},
        h('summary', {}, 'Show'),
        h(
          'div',
          { class: 'scope-list' },
          scopes.map((x) => h('code', {}, x)),
        ),
      ),
    ),
    store.auth?.secretProblem ? h('p', { class: 'form-error' }, store.auth.secretProblem) : null,
    h('p', {}, 'Then paste its Client ID and Secret Key here (the Secret Key is optional):'),
    form,
    h(
      'p',
      { class: 'fine' },
      'Saved only on this computer, ',
      cfg.plainSecrets
        ? 'not encrypted (this computer has no keyring)'
        : `encrypted with your ${navigator.platform.startsWith('Mac') ? 'macOS Keychain' : navigator.platform.startsWith('Win') ? 'Windows account' : "system's keyring"}`,
      ', in ',
      h('code', {}, cfg.files?.configFile || 'config.json'),
      '. Settings → Reset EVE HUD removes them again.',
    ),
    h(
      'p',
      { class: 'fine center' },
      h('a', { href: '#', onclick: (e) => switchGate(e, false) }, '← Back to the EVE HUD login'),
    ),
  ];
}
