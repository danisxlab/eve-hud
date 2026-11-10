// SPDX-License-Identifier: GPL-3.0-or-later
// Before the HUD can show anything: the "Log in with EVE Online" button (the built-in EVE HUD
// application, or your own), or the form for your own application's Client ID and Secret Key.

import { h } from './util.js';
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
                "Opens in your default browser. When it says you're logged in, close the tab: the HUD updates by itself.",
              )
            : null,
          a.secretProblem ? h('p', { class: 'form-error' }, a.secretProblem) : null,
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
  const copyBtn = (text, label) =>
    h(
      'button',
      {
        type: 'button',
        class: 'copy',
        title: `Copy ${label}`,
        onclick: (e) =>
          navigator.clipboard?.writeText(text).then(() => {
            e.target.textContent = 'Copied';
            setTimeout(() => {
              e.target.textContent = 'Copy';
            }, 1500);
          }),
      },
      'Copy',
    );
  // The Callback URL to register: it uses EVE HUD's port (4747; another port only by hand in
  // config.json, with your own application). It must match developers.eveonline.com exactly.
  const callbackUrl = `http://localhost:${Number(cfg.port) || 4747}/callback`;
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
            body: JSON.stringify({ clientId: id.value, clientSecret: secret.value }),
          });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            err.textContent = body.error || `Saving failed (HTTP ${r.status})`;
            err.hidden = false;
            (body.field === 'clientSecret' ? secret : id).focus();
            return;
          }
          secret.value = '';
          // the next screen ("Connect your capsuleer") arrives over the live connection
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
      h('code', { class: 'cb' }, callbackUrl),
      copyBtn(callbackUrl, 'the callback URL'),
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
      'Saved only on this computer, encrypted with your ',
      navigator.platform.startsWith('Mac') ? 'macOS Keychain' : 'Windows account',
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
