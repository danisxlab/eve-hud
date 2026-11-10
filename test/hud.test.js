// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for the server side: which feeds poll for what's on screen, the wallet journal grouping,
// killmail values, local routes, and the HTTP endpoints. No network or EVE login needed.
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(APP, 'hud');
const SERVER = path.join(APP, 'test', 'run-server.js'); // the server on its own, without Electron
// lib/store.js reads EVE_HUD_HOME once, at import: point it at a temp folder before importing lib/
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-hud-test-'));
process.env.EVE_HUD_HOME = home;
const { createFeeds, categoryOfRef, summarizeKillmail } = await import('../hud/lib/feeds.js');
const { createRouter } = await import('../hud/lib/route.js');
const { loadConfig } = await import('../hud/lib/store.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in ESI that records the paths asked for and answers with empty-ish data.
function fakeEsi() {
  const asked = [];
  const answer = (p) => {
    if (p === '/status') return { players: 1, server_version: '1', start_time: new Date().toISOString() };
    if (p.endsWith('/mail/labels')) return { labels: [], total_unread_count: 0 };
    if (p.endsWith('/location')) return { solar_system_id: 30000142 };
    if (p.endsWith('/clones')) return { jump_clones: [] };
    if (p.endsWith('/skills')) return { total_sp: 1, skills: [] };
    if (p.endsWith('/attributes')) return {};
    if (/^\/characters\/\d+$/.test(p)) return { name: 'T', corporation_id: 1000107 };
    if (/^\/corporations\/\d+$/.test(p)) return { name: 'C', ticker: 'C' };
    return [];
  };
  return {
    asked,
    request: async (p) => {
      asked.push(p);
      return { data: answer(p), expires: Date.now() + 60_000, pages: 1 };
    },
    requestAll: async (p) => {
      asked.push(p);
      return { data: [], expires: Date.now() + 60_000 };
    },
    requestCursor: async (p) => {
      asked.push(p);
      return { data: [], raw: {}, expires: Date.now() + 60_000 };
    },
    resolveNames: async () => (id) => `#${id}`,
  };
}
const fakeAuth = { characterId: 1, hasScope: () => true };
const fakeUniverse = { system: () => ({ name: 'Jita', sec: 0.9 }) };

test('feeds: only what is on screen polls; showing a module fetches at once', async () => {
  const esi = fakeEsi();
  const published = [];
  const feeds = createFeeds({
    esi,
    auth: fakeAuth,
    universe: fakeUniverse,
    publish: (n) => published.push(n),
    log: { info() {}, warn() {} },
  });
  feeds.start();
  try {
    await sleep(1200); // start-up is staggered by 150 ms per feed
    const startup = new Set(esi.asked);
    assert.ok(startup.has('/status'), 'top bar: players online');
    assert.ok(startup.has('/characters/1/location'), 'top bar: location');
    assert.ok(startup.has('/characters/1/mail/labels'), 'mail icon');
    assert.ok(!startup.has('/characters/1/skillqueue'), 'skills module not shown yet');
    assert.ok(!startup.has('/characters/1/orders'), 'market module not shown yet');
    assert.ok(!startup.has('/universe/system_kills'), 'map not shown yet');
    assert.deepEqual(feeds.activeFeeds().sort(), [
      'character',
      'clones',
      'esihealth',
      'mail',
      'notifications',
      'presence',
      'status',
    ]);
    assert.ok(startup.has('/meta/status'), 'ESI health for the module lights');

    esi.asked.length = 0;
    feeds.setDemand(['topbar', 'mail', 'skills', 'map', 'map:hazards']);
    await sleep(80);
    assert.ok(esi.asked.includes('/characters/1/skillqueue'), 'skills fetched straight away');
    assert.ok(esi.asked.includes('/universe/system_kills'), 'map traffic fetched straight away');
    assert.ok(esi.asked.includes('/incursions'), 'hazard overlay fetched straight away');
    assert.ok(!esi.asked.includes('/sovereignty/systems'), 'faction colouring is off');

    // hide them again: "refresh now" no longer touches them
    feeds.setDemand(['topbar']);
    esi.asked.length = 0;
    await feeds.refresh();
    assert.ok(esi.asked.includes('/status'));
    assert.ok(!esi.asked.includes('/characters/1/skillqueue'));
    assert.ok(!esi.asked.includes('/characters/1/mail/labels'), 'mail icon hidden');

    // an alert keeps its feed alive without the module
    feeds.setDemand(['topbar', 'alert:industry']);
    await sleep(80);
    assert.ok(feeds.activeFeeds().includes('industry'));
    assert.ok(!feeds.activeFeeds().includes('orders'));
  } finally {
    feeds.stop();
  }
});

test('activity: wallet journal ref types map to sources', () => {
  const cases = {
    agent_mission_reward: 'missions',
    agent_mission_time_bonus_reward: 'missions',
    bounty_prizes: 'bounties',
    ess_escrow_transfer: 'bounties',
    market_transaction: 'market',
    brokers_fee: 'market',
    transaction_tax: 'market',
    insurance: 'insurance',
    contract_price: 'contracts',
    industry_job_tax: 'industry',
    planetary_export_tax: 'planetary',
    lp_store: 'lp',
    player_donation: 'transfers',
    jump_clone_activation_fee: 'fees',
    something_new: 'other',
  };
  for (const [ref, cat] of Object.entries(cases)) assert.equal(categoryOfRef(ref), cat, ref);
});

test('kills: killmail summary and value estimate', () => {
  const price = new Map([
    [626, 20_000_000],
    [2048, 1_000_000],
    [34, 5],
  ]);
  const km = {
    killmail_id: 9,
    killmail_time: '2026-10-30T10:00:00Z',
    solar_system_id: 30000142,
    victim: {
      character_id: 7,
      corporation_id: 8,
      ship_type_id: 626,
      items: [
        { item_type_id: 2048, quantity_destroyed: 1 },
        { item_type_id: 34, quantity_dropped: 1000, items: [{ item_type_id: 2048, quantity_dropped: 1 }] },
      ],
    },
    attackers: [{ character_id: 1, final_blow: true, ship_type_id: 593 }, { character_id: 5 }],
  };
  const k = summarizeKillmail(km, 1, price);
  assert.equal(k.loss, false);
  assert.equal(k.finalBlow, true);
  assert.equal(k.myShipTypeId, 593);
  assert.equal(k.value, 20_000_000 + 1_000_000 + 5000 + 1_000_000);
  assert.equal(summarizeKillmail(km, 7, price).loss, true);
  assert.equal(summarizeKillmail(km, 7, price, 'abc123').hash, 'abc123'); // for the Copy killmail link
  assert.equal(k.hash, null);
});

test('routes: local route over stargates, Safer avoids low-sec', async () => {
  // A - B - C - D (B is low-sec) and A - E - F - G - D (all high-sec, one jump longer)
  const sys = { 1: 0.9, 2: 0.3, 3: 0.8, 4: 0.9, 5: 0.9, 6: 0.9, 7: 0.9 };
  const universe = {
    system: (id) => (sys[id] !== undefined ? { sec: sys[id] } : null),
    jumps: () => [
      [1, 2],
      [2, 3],
      [3, 4],
      [1, 5],
      [5, 6],
      [6, 7],
      [7, 4],
    ],
  };
  const router = createRouter({ esi: null, auth: {}, universe, demo: true });
  assert.deepEqual((await router.route(1, 4, 'shorter')).route, [1, 2, 3, 4]);
  assert.deepEqual((await router.route(1, 4, 'safer')).route, [1, 5, 6, 7, 4]);
  assert.equal((await router.route(1, 4, 'safer')).jumps, 4);
  await assert.rejects(router.route(1, 99), /Unknown solar system/);
  assert.deepEqual(await router.setDestination(4), { ok: true, demo: true });
});

test('routes: live mode asks ESI with POST /route/{from}/{to}', async () => {
  const calls = [];
  const esi = {
    request: async (p, o) => {
      calls.push([p, o]);
      return { data: { route: [1, 5, 4] } };
    },
  };
  const universe = { system: () => ({ sec: 0.9 }), jumps: () => [] };
  const auth = { characterId: 1, hasScope: (s) => s === 'esi-ui.write_waypoint.v1' };
  const router = createRouter({ esi, auth, universe });
  const r = await router.route(1, 4, 'insecure');
  assert.deepEqual(r, { route: [1, 5, 4], jumps: 2, source: 'esi', preference: 'insecure' });
  assert.deepEqual(calls[0], ['/route/1/4', { method: 'POST', body: { preference: 'LessSecure' } }]);
  await router.setDestination(4);
  assert.equal(calls[1][0], '/ui/autopilot/waypoint');
  assert.deepEqual(calls[1][1].query, {
    destination_id: 4,
    clear_other_waypoints: true,
    add_to_beginning: false,
  });
  const noScope = createRouter({ esi, auth: { characterId: 1, hasScope: () => false }, universe });
  await assert.rejects(noScope.setDestination(4), /esi-ui.write_waypoint.v1/);
});

test('server (demo): demand endpoint, route, waypoint, cross-site requests refused', async () => {
  const port = 4799;
  const child = spawn(process.execPath, [SERVER, '--demo', `--port=${port}`], {
    env: { ...process.env, EVE_HUD_HOME: home },
    stdio: 'ignore',
  });
  try {
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${base}/api/state`);
        break;
      } catch {
        await sleep(100);
      }
    }
    const post = (p, body, headers = {}) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post('/api/demand', { client: 'test-client-1', consumers: ['topbar', 'skills'] })).status,
      200,
    );
    assert.equal(
      (await post('/api/demand', { client: 'x', consumers: [] })).status,
      400,
      'client id too short',
    );
    assert.equal(
      (
        await post(
          '/api/demand',
          { client: 'test-client-1', consumers: [] },
          { Origin: 'https://evil.example' },
        )
      ).status,
      403,
    );
    assert.equal(
      (await post('/api/demand', { client: 'test-client-1', consumers: [] }, { Origin: base })).status,
      200,
      'same origin is fine',
    );
    // a website that points its own name at 127.0.0.1 (DNS rebinding) gets nothing, not even a GET
    const withHost = (host, p) =>
      new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, path: p, headers: { Host: host } }, (res) => {
          res.resume();
          res.on('end', () => resolve(res));
        });
        r.on('error', reject);
        r.end();
      });
    assert.equal((await withHost(`evil.example:${port}`, '/api/state')).statusCode, 421);
    assert.equal((await withHost('evil.example', '/')).statusCode, 421);
    assert.equal((await withHost(`127.0.0.1:${port}`, '/api/state')).statusCode, 200);
    const page = await fetch(`${base}/`);
    assert.equal(page.headers.get('x-frame-options'), 'DENY', 'no other website may frame the HUD');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    const r = await fetch(`${base}/api/route?from=30000001&to=30000001`).then((x) => x.json());
    assert.equal(r.jumps, 0);
    const w = await post('/api/waypoint', { to: 30000001 }).then((x) => x.json());
    assert.equal(w.ok, true);
    assert.equal(
      (await post('/api/waypoint', { to: 30000001 }, { Origin: 'http://localhost.evil.example' })).status,
      403,
    );
  } finally {
    child.kill();
  }
});

test('new feeds against ESI-shaped answers: activity, mining, assets, standings, kills', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const answers = {
    '/characters/1/wallet/journal': [
      {
        id: 1,
        date: now,
        ref_type: 'agent_mission_reward',
        amount: 500_000,
        first_party_id: 3017001,
        second_party_id: 1,
      },
      {
        id: 2,
        date: now,
        ref_type: 'bounty_prizes',
        amount: 200_000,
        context_id: 30000142,
        context_id_type: 'system_id',
      },
      { id: 3, date: now, ref_type: 'brokers_fee', amount: -1_000 },
      {
        id: 4,
        date: new Date(Date.now() - 10 * 86400_000).toISOString(),
        ref_type: 'insurance',
        amount: 3_000_000,
      },
    ],
    '/characters/1/loyalty/points': [
      { corporation_id: 1000120, loyalty_points: 1500 },
      { corporation_id: 1000107, loyalty_points: 0 },
    ],
    '/markets/prices': [
      { type_id: 1230, average_price: 10 },
      { type_id: 626, average_price: 20_000_000 },
      { type_id: 2048, average_price: 1_000_000 },
    ],
    '/characters/1/mining': [{ date: today, quantity: 1000, solar_system_id: 30000142, type_id: 1230 }],
    '/characters/1/assets': [
      {
        item_id: 1001,
        type_id: 626,
        location_id: 60003760,
        location_type: 'station',
        location_flag: 'Hangar',
        quantity: 1,
        is_singleton: true,
      },
      {
        item_id: 1002,
        type_id: 2048,
        location_id: 1001,
        location_type: 'item',
        location_flag: 'HiSlot0',
        quantity: 1,
        is_singleton: true,
      },
      {
        item_id: 1003,
        type_id: 1230,
        location_id: 60003760,
        location_type: 'station',
        location_flag: 'Hangar',
        quantity: 500,
        is_singleton: false,
      },
    ],
    '/universe/types/626': { group_id: 26 },
    '/universe/groups/26': { category_id: 6 },
    '/universe/types/2048': { group_id: 60 },
    '/universe/groups/60': { category_id: 7 },
    '/characters/1/assets/names': [{ item_id: 1001, name: 'Bessie' }],
    '/characters/1/standings': [
      { from_id: 500004, from_type: 'faction', standing: 3.2 },
      { from_id: 1000120, from_type: 'npc_corp', standing: -1 },
    ],
    '/characters/1/killmails/recent': [{ killmail_id: 9, killmail_hash: 'abc' }],
    '/killmails/9/abc': {
      killmail_id: 9,
      killmail_time: now,
      solar_system_id: 30000142,
      victim: { character_id: 7, ship_type_id: 626 },
      attackers: [{ character_id: 1, final_blow: true, ship_type_id: 626 }],
    },
  };
  const asked = [];
  const reply = (p, o = {}) => {
    asked.push(`${o.method || 'GET'} ${p}`);
    if (!(p in answers))
      return Promise.reject(Object.assign(new Error(`no answer for ${p}`), { status: 404 }));
    return Promise.resolve({ data: answers[p], expires: Date.now() + 60_000, pages: 1 });
  };
  const esi = {
    request: reply,
    requestAll: reply,
    requestCursor: async () => ({ data: [], raw: {}, expires: Date.now() + 60_000 }),
    resolveNames: async () => (id) => `Name ${id}`,
  };
  const got = {};
  const feeds = createFeeds({
    esi,
    auth: fakeAuth,
    universe: fakeUniverse,
    publish: (n, p) => {
      got[n] = p;
    },
    log: { info() {}, warn() {} },
  });
  feeds.setDemand(['activity', 'mining', 'assets', 'standings', 'kills']);
  feeds.start();
  for (let i = 0; i < 40 && Object.keys(got).length < 5; i++) await sleep(50);
  feeds.stop();
  for (const n of ['activity', 'mining', 'assets', 'standings', 'kills'])
    assert.equal(got[n]?.error, null, `${n}: ${got[n]?.error?.message}`);

  const a = got.activity.data;
  assert.equal(a.periods.day.income, 700_000);
  assert.equal(a.periods.month.income, 3_700_000);
  assert.deepEqual(
    a.periods.day.agents.map((x) => [x.id, x.isk]),
    [[3017001, 500_000]],
  );
  assert.deepEqual(
    a.periods.day.systems.map((x) => [x.id, x.isk]),
    [[30000142, 200_000]],
  );
  assert.deepEqual(a.lp, [{ id: 1000120, name: 'Name 1000120', points: 1500 }]);

  assert.equal(got.mining.data.periods.day.value, 10_000);
  assert.equal(got.mining.data.periods.day.types[0].quantity, 1000);

  const s = got.assets.data;
  assert.equal(s.shipCount, 1);
  assert.equal(s.ships[0].name, 'Bessie');
  assert.equal(s.ships[0].value, 21_000_000, 'hull + fitted module');
  assert.equal(s.totalValue, 21_005_000);
  assert.ok(asked.includes('POST /characters/1/assets/names'));

  assert.equal(got.standings.data.factions[0].standing, 3.2);
  assert.equal(got.standings.data.corporations[0].standing, -1);

  assert.equal(got.kills.data.month.kills, 1);
  assert.equal(got.kills.data.list[0].value, 20_000_000);
  assert.ok(fs.existsSync(path.join(home, 'data', 'killmails.json')), 'killmails kept for next time');
});

test('setup: Client ID / Secret from the page, Reset EVE HUD, config.json keeps its formatting', async () => {
  const liveHome = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-hud-setup-'));
  const port = 4798;
  const child = spawn(process.execPath, [SERVER, `--port=${port}`], {
    env: { ...process.env, EVE_HUD_HOME: liveHome },
    stdio: 'ignore',
  });
  try {
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${base}/api/state`);
        break;
      } catch {
        await sleep(100);
      }
    }
    const post = (p, body, headers = {}) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const example = fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8');
    const id = 'a'.repeat(32);
    const secret = 'eat_SecretSecretSecretSecret1234';
    const first = (await fetch(`${base}/api/state`).then((r) => r.json())).auth;
    assert.equal(first.configured, true, 'ready to log in with the built-in application');
    assert.equal(first.ownApp, false);
    assert.equal(first.callbackUrl, 'http://localhost:4747/callback');
    // an older config.json with only Local and Corp still gets the Militia channel
    assert.ok(
      (await fetch(`${base}/api/state`).then((r) => r.json())).config.chatChannels.some(
        (c) => c.id === 'militia' && c.fw,
      ),
    );
    assert.equal((await post('/api/credentials', { clientId: 'nope', clientSecret: secret })).status, 400);
    assert.equal(
      (
        await post(
          '/api/credentials',
          { clientId: id, clientSecret: secret },
          { Origin: 'https://evil.example' },
        )
      ).status,
      403,
    );
    // like an older config.json: without the newest scopes; setting up adds them (the form lists all to enable)
    fs.writeFileSync(
      path.join(liveHome, 'config.json'),
      fs
        .readFileSync(path.join(liveHome, 'config.json'), 'utf8')
        .replace(',\n    "esi-ui.write_waypoint.v1"', ''),
    );
    assert.equal((await post('/api/credentials', { clientId: id, clientSecret: secret })).status, 200);
    const cfg = fs.readFileSync(path.join(liveHome, 'config.json'), 'utf8');
    assert.equal(
      cfg,
      example.replace('PASTE_YOUR_CLIENT_ID_HERE', id).replace('PASTE_YOUR_CLIENT_SECRET_HERE', secret),
      'only the two values changed',
    );
    const state = await fetch(`${base}/api/state`).then((r) => r.text());
    assert.ok(JSON.parse(state).auth.ownApp);
    assert.ok(!state.includes(secret), 'the secret never goes back to the page');
    assert.equal(
      (await post('/api/credentials', { clientId: id, clientSecret: secret })).status,
      409,
      'no overwriting without a reset',
    );
    assert.equal((await post('/api/reset', {})).status, 200);
    const after = JSON.parse(fs.readFileSync(path.join(liveHome, 'config.json'), 'utf8'));
    assert.equal(after.clientId, '');
    assert.equal(after.clientSecret, '');
    assert.equal(after.port, 4747, 'everything else kept');
    assert.equal(
      (await fetch(`${base}/api/state`).then((r) => r.json())).auth.ownApp,
      false,
      'built-in again',
    );
    // Settings → Storage → EVE logs: another folder (e.g. a network share), checked, saved, applied
    const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-hud-chatlogs-'));
    assert.equal(
      (await post('/api/chatlogs', { dir: path.join(logs, 'missing') })).status,
      400,
      'a folder that cannot be reached is refused',
    );
    assert.equal(
      (await post('/api/chatlogs', { dir: logs }, { Origin: 'https://evil.example' })).status,
      403,
    );
    const set = await post('/api/chatlogs', { dir: logs }).then((r) => r.json());
    assert.equal(set.dir, logs);
    assert.equal(set.reading, logs, 'read from the new folder at once');
    assert.equal(JSON.parse(fs.readFileSync(path.join(liveHome, 'config.json'), 'utf8')).eveLogDir, logs);
    // choosing its Chatlogs (or Gamelogs) saves the logs folder itself
    fs.mkdirSync(path.join(logs, 'Chatlogs'));
    const sub = await post('/api/chatlogs', { dir: path.join(logs, 'Chatlogs') }).then((r) => r.json());
    assert.equal(sub.dir, logs);
    assert.equal(sub.found, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(liveHome, 'config.json'), 'utf8')).eveLogDir, logs);
    assert.equal(
      (await post('/api/chatlogs', { dir: '' }).then((r) => r.json())).dir,
      '',
      'back to the usual place',
    );
    // Settings → Combat: the quiet time before a new attack alert, kept in range and saved
    assert.equal((await fetch(`${base}/api/combat`).then((r) => r.json())).idleSeconds, 15);
    assert.equal((await post('/api/combat', { idleSeconds: 30 }).then((r) => r.json())).idleSeconds, 30);
    assert.equal((await post('/api/combat', { idleSeconds: 1 }).then((r) => r.json())).idleSeconds, 5);
    assert.equal(
      (await post('/api/combat', { idleSeconds: 30 }, { Origin: 'https://evil.example' })).status,
      403,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(liveHome, 'config.json'), 'utf8')).combatIdleSeconds,
      5,
    );
  } finally {
    child.kill();
  }
});

test('another port: only with your own application (otherwise auth.portProblem: the red window); the own-application form moves EVE HUD there; Grant access adds scopes', async () => {
  const liveHome = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-hud-port-'));
  const port = 4785;
  const next = 4784;
  // "port" changed by hand in config.json (callbackUrl too, as for your own application)
  fs.writeFileSync(
    path.join(liveHome, 'config.json'),
    fs
      .readFileSync(path.join(ROOT, 'config.example.json'), 'utf8')
      .replace('"port": 4747', `"port": ${port}`)
      .replace(
        '"callbackUrl": "http://localhost:4747/callback"',
        `"callbackUrl": "http://localhost:${port}/callback"`,
      ),
  );
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, EVE_HUD_HOME: liveHome },
    stdio: 'ignore',
  });
  try {
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${base}/api/state`);
        break;
      } catch {
        await sleep(100);
      }
    }
    const post = (b, p, body) =>
      fetch(`${b}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    // the EVE HUD application (no Client ID of your own) only works on 4747
    const before = (await fetch(`${base}/api/state`).then((r) => r.json())).auth;
    assert.equal(before.ownApp, false);
    assert.equal(before.portProblem, port, 'the page shows the red window');
    const refused = await fetch(`${base}/login`, { redirect: 'manual' });
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /The login needs port 4747/);
    // the own-application form says whether a port is free
    assert.deepEqual(await fetch(`${base}/api/portcheck?port=${next}`).then((r) => r.json()), {
      port: next,
      free: true,
    });
    assert.equal((await fetch(`${base}/api/portcheck?port=${port}`).then((r) => r.json())).current, true);
    assert.equal((await fetch(`${base}/api/portcheck?port=80`).then((r) => r.json())).invalid, true);
    // the EVE HUD application's own Client ID is no "own application" (not in the form, not in config.json)
    const { BUILTIN_CLIENT_ID, hasOwnApp, builtinPortProblem } = await import('../hud/lib/store.js');
    const builtinRefused = await post(base, '/api/credentials', { clientId: BUILTIN_CLIENT_ID });
    assert.equal(builtinRefused.status, 400);
    assert.equal((await builtinRefused.json()).field, 'clientId');
    assert.equal(
      hasOwnApp({ clientId: BUILTIN_CLIENT_ID, clientSecret: 'eat_PastedByHandPastedByHand' }),
      false,
    );
    assert.equal(builtinPortProblem({ clientId: BUILTIN_CLIENT_ID, port: port }), true);
    assert.equal(builtinPortProblem({ clientId: 'c'.repeat(32), port: port }), false);
    assert.equal(builtinPortProblem({ clientId: '', port: 4747 }), false);

    // your own application with another port: EVE HUD moves there, config.json keeps port and
    // callbackUrl in step, and the old port closes
    const creds = { clientId: 'b'.repeat(32), clientSecret: 'eat_PortTestSecretPortTestSecret' };
    assert.equal((await post(base, '/api/credentials', { ...creds, port: 'abc' })).status, 400);
    const r = await post(base, '/api/credentials', { ...creds, port: next }).then((x) => x.json());
    assert.equal(r.url, `http://localhost:${next}/`);
    const cfg = JSON.parse(fs.readFileSync(path.join(liveHome, 'config.json'), 'utf8'));
    assert.equal(cfg.port, next);
    assert.equal(cfg.callbackUrl, `http://localhost:${next}/callback`);
    const nb = `http://localhost:${next}`;
    const after = (await fetch(`${nb}/api/state`).then((x) => x.json())).auth;
    assert.equal(after.ownApp, true);
    assert.equal(after.portProblem, undefined, 'no red window with your own application');
    await sleep(1800);
    await assert.rejects(fetch(`${base}/api/state`), 'old port closed');
    const login = await fetch(`${nb}/login`, { redirect: 'manual' });
    assert.equal(
      new URL(login.headers.get('location')).searchParams.get('redirect_uri'),
      `http://localhost:${next}/callback`,
    );

    // Grant access: known scopes are added to config.json in place, unknown ones refused
    fs.writeFileSync(
      path.join(liveHome, 'config.json'),
      fs
        .readFileSync(path.join(liveHome, 'config.json'), 'utf8')
        .replace(',\n    "esi-assets.read_assets.v1"', ''),
    );
    assert.equal((await post(nb, '/api/scopes', { scopes: ['esi-made-up.v1'] })).status, 400);
    const g = await post(nb, '/api/scopes', { scopes: ['esi-assets.read_assets.v1'] }).then((x) => x.json());
    assert.ok(g.scopes.includes('esi-assets.read_assets.v1'));
    const text = fs.readFileSync(path.join(liveHome, 'config.json'), 'utf8');
    assert.ok(
      text.includes('\n    "esi-assets.read_assets.v1"\n  ],'),
      'added as its own line, same indentation',
    );
    // from the desktop app: the login still goes straight to EVE (in the browser)
    const appLogin = await fetch(`${nb}/login?from=app`, { redirect: 'manual' });
    assert.equal(new URL(appLogin.headers.get('location')).host, 'login.eveonline.com');
    const login2 = await fetch(`${nb}/login`, { redirect: 'manual' });
    assert.ok(
      new URL(login2.headers.get('location')).searchParams
        .get('scope')
        .split(' ')
        .includes('esi-assets.read_assets.v1'),
    );
  } finally {
    child.kill();
  }
});

test('network: the HUD server only connects to EVE servers, redirects included', async () => {
  const { netFetch, isEveHost } = await import('../hud/lib/net.js');
  for (const h of [
    'esi.evetech.net',
    'images.evetech.net',
    'login.eveonline.com',
    'developers.eveonline.com',
    'EVETECH.NET.',
  ])
    assert.ok(isEveHost(h), h);
  for (const h of ['fonts.googleapis.com', 'zkillboard.com', 'evil-evetech.net', 'evetech.net.evil.com', ''])
    assert.ok(!isEveHost(h), h);
  const real = globalThis.fetch;
  const asked = [];
  const sent = {};
  globalThis.fetch = async (u, o = {}) => {
    asked.push(u);
    sent[u] = o.headers || {};
    if (u.includes('/insecure'))
      return new Response(null, { status: 302, headers: { location: 'http://esi.evetech.net/plain' } });
    if (u.includes('/hop'))
      return new Response(null, { status: 302, headers: { location: 'https://images.evetech.net/ok' } });
    if (u.includes('/away'))
      return new Response(null, { status: 302, headers: { location: 'https://example.com/x' } });
    return new Response('fine');
  };
  try {
    await assert.rejects(
      netFetch('https://fonts.googleapis.com/css'),
      /Refused to connect to fonts\.googleapis\.com/,
    );
    assert.equal(asked.length, 0, 'refused before connecting');
    assert.equal(
      await (await netFetch('https://esi.evetech.net/hop')).text(),
      'fine',
      'redirects within EVE are followed',
    );
    // the login token stays with the host it was sent to; plain http is never used, not even by a redirect
    await netFetch('https://esi.evetech.net/hop', {
      headers: { Authorization: 'Bearer secret-token', 'User-Agent': 'x' },
    });
    assert.equal(sent['https://esi.evetech.net/hop'].Authorization, 'Bearer secret-token');
    assert.equal(
      sent['https://images.evetech.net/ok'].Authorization,
      undefined,
      'not sent on to another host',
    );
    assert.equal(sent['https://images.evetech.net/ok']['User-Agent'], 'x');
    await assert.rejects(netFetch('http://esi.evetech.net/x'), /Refused/);
    await assert.rejects(netFetch('https://esi.evetech.net/insecure'), /Refused/);
    assert.ok(!asked.some((u) => u.startsWith('http:')), 'no plain-http request');
    await assert.rejects(netFetch('https://esi.evetech.net/away'), /Refused to connect to example\.com/);
    assert.ok(!asked.some((u) => u.includes('example.com')), 'the redirect target is never contacted');
    // the update check's one exception: api.github.com, only when it asks for it
    await assert.rejects(
      netFetch('https://api.github.com/repos/x'),
      /Refused to connect to api\.github\.com/,
    );
    assert.equal(
      await (await netFetch('https://api.github.com/repos/x', { allowHost: 'api.github.com' })).text(),
      'fine',
    );
    await assert.rejects(netFetch('https://github.com/x', { allowHost: 'api.github.com' }), /Refused/);
  } finally {
    globalThis.fetch = real;
  }
});

test('security: other websites in the browser get nothing from the API; pending logins are capped; private files', async () => {
  const { isCrossSite } = await import('../hud/server.js');
  const req = (headers) => ({ headers: { host: 'localhost:4747', ...headers } });
  assert.equal(isCrossSite(req({})), false, 'no browser headers: not from a web page');
  assert.equal(isCrossSite(req({ 'sec-fetch-site': 'same-origin', origin: 'http://localhost:4747' })), false);
  assert.equal(isCrossSite(req({ 'sec-fetch-site': 'cross-site' })), true);
  assert.equal(isCrossSite(req({ 'sec-fetch-site': 'same-site' })), true, 'another localhost port');
  assert.equal(isCrossSite(req({ origin: 'https://evil.example' })), true);
  assert.equal(isCrossSite(req({ origin: 'http://localhost:3000' })), true);
  assert.equal(isCrossSite(req({ origin: 'null' })), true);

  // a running HUD: reads, work and the live stream are refused to other sites too
  const port = 4793;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-hud-xsite-'));
  const child = spawn(process.execPath, [SERVER, '--demo', `--port=${port}`], {
    env: { ...process.env, EVE_HUD_HOME: home },
    stdio: 'ignore',
  });
  try {
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${base}/api/state`);
        break;
      } catch {
        await sleep(100);
      }
    }
    for (const p of ['/api/state', '/api/stream', '/api/showinfo?type=34', '/api/route?from=1&to=2']) {
      const r = await fetch(`${base}${p}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
      assert.equal(r.status, 403, p);
      const o = await fetch(`${base}${p}`, { headers: { Origin: 'https://evil.example' } });
      assert.equal(o.status, 403, p);
    }
    const ok = await fetch(`${base}/api/state`, {
      headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' },
    });
    assert.equal(ok.status, 200, 'the HUD page itself');
    const otherStatus = await new Promise((resolve, reject) => {
      const r = http.get(
        { host: '127.0.0.1', port, path: '/api/state', headers: { Host: 'evil.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      r.on('error', reject);
    });
    assert.equal(otherStatus, 421, 'DNS rebinding: other names get nothing');
    // text from the address on the login error page is plain text, and short
    const page = await fetch(
      `${base}/callback?error=x&error_description=${encodeURIComponent('<script>x</script>' + 'a'.repeat(500))}`,
    );
    const html = await page.text();
    assert.ok(!html.includes('<script>x'), 'escaped');
    assert.ok(!html.includes('a'.repeat(300)), 'shortened');
  } finally {
    child.kill();
  }

  // at most 20 logins waiting: the oldest is forgotten
  const { createAuth } = await import('../hud/lib/auth.js');
  const auth = createAuth(
    { scopes: ['publicData'], clientId: '', port: 4747 },
    { log: { info() {}, warn() {} } },
  );
  const first = new URL(auth.loginUrl()).searchParams.get('state');
  for (let i = 0; i < 25; i++) auth.loginUrl();
  await assert.rejects(auth.handleCallback({ code: 'x', state: first }), /state did not match/);

  // config.json and data/ files: readable for your user account only (Mac, Linux)
  if (process.platform !== 'win32') {
    const store = await import('../hud/lib/store.js');
    const f = store.dataPath('private-test.json');
    store.writeJson(f, { a: 1 });
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    fs.chmodSync(f, 0o644);
    store.makePrivate(f);
    assert.equal(fs.statSync(f).mode & 0o777, 0o600, 'older files are made private');
    fs.rmSync(f);
  }
});

test('a Client ID that cannot be one (typed into config.json): the EVE HUD application, and the login screen says why', async () => {
  const store = await import('../hud/lib/store.js');
  const { createAuth } = await import('../hud/lib/auth.js');
  const before = fs.existsSync(store.CONFIG_FILE) ? fs.readFileSync(store.CONFIG_FILE) : null;
  try {
    const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
    fs.writeFileSync(
      store.CONFIG_FILE,
      JSON.stringify({ ...example, clientId: 'test12345', clientSecret: 'test12345' }, null, 2),
    );
    const cfg = store.loadConfig();
    assert.equal(cfg.ownApp, false);
    assert.equal(cfg.clientId, '');
    assert.match(cfg.secretProblem, /doesn't look like one/);
    assert.equal(store.loginApp(cfg).builtin, true);
    // a real-looking one is your own application
    fs.writeFileSync(store.CONFIG_FILE, JSON.stringify({ ...example, clientId: 'd'.repeat(32) }, null, 2));
    const own = store.loadConfig();
    assert.equal(own.ownApp, true);
    assert.equal(own.secretProblem, null);

    // Settings → Account names the application the login was made with, not the one in config.json
    const quiet = { info() {}, warn() {} };
    const write = (t) => fs.writeFileSync(store.dataPath('tokens.json'), JSON.stringify(t));
    const t = {
      characterId: 1,
      characterName: 'P',
      refreshToken: 'r',
      accessToken: 'a',
      expiresAt: Date.now() + 9e5,
      scopes: [],
    };
    write({ ...t, clientId: store.BUILTIN_CLIENT_ID });
    assert.equal(createAuth(own, { log: quiet }).status().loginOwnApp, false);
    write({ ...t, clientId: 'd'.repeat(32) });
    assert.equal(createAuth(own, { log: quiet }).status().loginOwnApp, true);
    write(t); // older logins: your own application, the only kind there was
    assert.equal(createAuth(own, { log: quiet }).status().loginOwnApp, true);
    fs.rmSync(store.dataPath('tokens.json'));
  } finally {
    if (before) fs.writeFileSync(store.CONFIG_FILE, before);
    else fs.rmSync(store.CONFIG_FILE, { force: true });
  }
});

test('updates: a newer release on GitHub, its notes and commit; unchanged answers cost nothing; off means no requests', async () => {
  const { createUpdateCheck, isNewer, parseVersion, versionLabel } = await import('../hud/lib/updates.js');
  assert.deepEqual(parseVersion('v1.0.4'), [1, 0, 4]);
  assert.deepEqual(parseVersion('1.0'), [1, 0, 0]);
  assert.equal(parseVersion('latest'), null);
  assert.ok(isNewer('1.0.10', '1.0.9'));
  assert.ok(isNewer('1.1', '1.0.9'));
  assert.ok(!isNewer('1.0.3', '1.0.3'));
  assert.ok(!isNewer('1.0.2', '1.0.3'));
  assert.ok(!isNewer('nonsense', '1.0.3'));
  assert.equal(versionLabel('1.0.3', '8f2c1d0aa'), 'v1.0.3_8f2c1d0');
  assert.equal(versionLabel('1.0.3', null), 'v1.0.3');

  const asked = [];
  let release = {
    tag_name: '1.0.4',
    name: '1.0.4',
    body: '## New\n- one',
    html_url: 'https://github.com/danisxlab/eve-hud/releases/tag/1.0.4',
  };
  const fetchImpl = async (url, opts) => {
    asked.push({ url, etag: opts.headers['If-None-Match'], allowHost: opts.allowHost });
    if (url.includes('/commits/')) return new Response('7f18d078b7102cd4612c7ba2ebf4ae170199637a');
    if (opts.headers['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
    if (!release) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(release), { headers: { etag: '"v1"' } });
  };
  const changes = [];
  let on = true;
  const u = createUpdateCheck({
    version: '1.0.3',
    enabled: () => on,
    fetchImpl,
    onChange: (s) => changes.push(s),
    log: {},
  });
  let s = await u.check();
  assert.equal(s.available, true);
  assert.equal(s.version, '1.0.4');
  assert.equal(s.current, '1.0.3');
  assert.equal(s.commit, '7f18d07');
  assert.equal(s.notes, '## New\n- one');
  assert.ok(asked.every((a) => a.allowHost === 'api.github.com'));
  // the next hour: the same release (304), nothing new to tell the page
  await u.check();
  assert.equal(asked.at(-1).etag, '"v1"');
  assert.equal(changes.length, 1);
  // a release page somewhere else is never linked
  release = { ...release, html_url: 'https://evil.example/x' };
  const other = createUpdateCheck({
    version: '1.0.3',
    fetchImpl: async (url) =>
      url.includes('/commits/') ? new Response('x', { status: 404 }) : new Response(JSON.stringify(release)),
    log: {},
  });
  s = await other.check();
  assert.equal(s.url, 'https://github.com/danisxlab/eve-hud/releases/latest');
  assert.equal(s.commit, null, 'no commit: just the version');
  // this version or newer installed: nothing to show
  const same = createUpdateCheck({ version: '1.0.4', fetchImpl, log: {} });
  assert.equal((await same.check()).available, false);
  // switched off (Settings → Updates): no request, and the button goes away
  on = false;
  const before = asked.length;
  assert.equal((await u.check()).available, false);
  assert.equal(asked.length, before, 'no request while switched off');
  assert.equal(changes.at(-1).available, false);
  // no version to compare (plain node, tests): never asks
  const none = createUpdateCheck({ version: null, fetchImpl, log: {} });
  await none.check();
  assert.equal(asked.length, before);
  // offline: logged, nothing breaks
  const warned = [];
  const offline = createUpdateCheck({
    version: '1.0.3',
    fetchImpl: async () => {
      throw new Error('Cannot reach api.github.com');
    },
    log: { warn: (m) => warned.push(m) },
  });
  assert.equal((await offline.check()).available, false);
  assert.match(warned[0], /Cannot reach api\.github\.com/);
});

test('secrets: Client ID, Secret Key and login are stored encrypted; values from another computer are not used', async () => {
  const secrets = await import('../hud/lib/secrets.js');
  const store = await import('../hud/lib/store.js');
  const { createAuth } = await import('../hud/lib/auth.js');
  const key = { v: 'pc1' }; // stand-in for the Keychain / DPAPI key of this computer
  secrets.useSecretBox({
    encrypt: (t) => Buffer.from(`${key.v}|${t}`).toString('base64'),
    decrypt: (b) => {
      const t = Buffer.from(b, 'base64').toString();
      if (!t.startsWith(`${key.v}|`)) throw new Error('wrong key');
      return t.slice(key.v.length + 1);
    },
  });
  const quiet = { warn() {}, info() {} };
  try {
    fs.writeFileSync(
      store.CONFIG_FILE,
      JSON.stringify(
        {
          clientId: 'abcdefabcdefabcdefabcdefabcdef12',
          clientSecret: 'plain-secret-value-123456',
          port: 4747,
        },
        null,
        2,
      ),
    );
    let cfg = store.loadConfig();
    assert.equal(cfg.clientSecret, 'plain-secret-value-123456');
    assert.equal(cfg.ownApp, true);
    const text = fs.readFileSync(store.CONFIG_FILE, 'utf8');
    assert.doesNotMatch(text, /plain-secret|abcdefabcdef/, 'encrypted on first load');
    assert.match(JSON.parse(text).clientSecret, /^enc:/);
    assert.equal(JSON.parse(text).port, 4747, 'other values untouched');
    assert.equal(store.loadConfig().clientSecret, 'plain-secret-value-123456', 'reads back');

    fs.writeFileSync(
      store.dataPath('tokens.json'),
      JSON.stringify({ characterId: 7, characterName: 'Pilot', refreshToken: 'rt-plain' }),
    );
    assert.equal(createAuth(cfg, { log: quiet }).status().characterName, 'Pilot');
    assert.doesNotMatch(
      fs.readFileSync(store.dataPath('tokens.json'), 'utf8'),
      /rt-plain|Pilot/,
      'login encrypted on first load',
    );
    assert.equal(createAuth(cfg, { log: quiet }).status().characterName, 'Pilot', 'reads back');

    key.v = 'pc2'; // the same files on another computer
    cfg = store.loadConfig();
    assert.equal(cfg.ownApp, false, 'falls back to the built-in application');
    assert.equal(cfg.configured, true, 'and can still log in');
    assert.match(cfg.secretProblem, /another computer/);
    const warns = [];
    assert.equal(createAuth(cfg, { log: { ...quiet, warn: (m) => warns.push(m) } }).status().loggedIn, false);
    assert.match(warns[0], /could not be decrypted/);
  } finally {
    secrets.useSecretBox(null);
  }
});

test('ESI health: each feed gets the worst state of its routes; parameters and versions do not matter', async () => {
  const { feedHealth } = await import('../hud/lib/feeds.js');
  const h = feedHealth({
    routes: [
      { method: 'GET', path: '/characters/{character_id}/skillqueue', status: 'Down' },
      { method: 'GET', path: '/characters/{character_id}/skills', status: 'OK' },
      { method: 'POST', path: '/route/{origin}/{destination}', status: 'Degraded' },
      { method: 'GET', path: '/characters/{character_id}/orders', status: 'Recovering' },
      { method: 'GET', path: '/status', status: 'OK' },
      { method: 'GET', path: '/characters/{character_id}/standings', status: 'Unknown' },
    ],
  });
  assert.deepEqual(h.feeds, { status: 'ok', skills: 'down', orders: 'recovering', route: 'degraded' });
  assert.equal(h.feeds.standings, undefined, 'Unknown says nothing');
  assert.deepEqual(h.problems.skills, [{ route: 'GET /characters/{}/skillqueue', status: 'down' }]);
  // the older format: a plain list with route + green / yellow / red
  assert.deepEqual(
    feedHealth([{ method: 'get', route: '/latest/characters/{character_id}/mail/labels/', status: 'yellow' }])
      .feeds,
    { mail: 'degraded' },
  );
  assert.equal(
    feedHealth({ something: 'else' }).routes,
    0,
    "an answer it doesn't understand: no lights changed",
  );
});

test('chat: an older config.json with only Local and Corp still gets the Militia channel (shown while enlisted)', () => {
  fs.writeFileSync(
    path.join(home, 'config.json'),
    JSON.stringify({
      chatChannels: [
        { id: 'local', label: 'Local', filePrefix: 'Local' },
        { id: 'corp', label: 'Corp', filePrefix: 'Corp' },
      ],
    }),
  );
  const cfg = loadConfig();
  assert.deepEqual(
    cfg.chatChannels.map((c) => c.id),
    ['local', 'corp', 'militia'],
  );
  assert.equal(cfg.chatChannels[2].filePrefix, 'Militia');
  assert.equal(cfg.chatChannels[2].fw, true);
  fs.rmSync(path.join(home, 'config.json'));
});

test('feeds: a restart while a request is in flight still updates that feed (Tranquility stayed "checking")', async () => {
  const esi = fakeEsi();
  const slow = esi.request;
  esi.request = async (p) => {
    if (p === '/status') await sleep(250);
    return slow(p);
  };
  const published = [];
  const feeds = createFeeds({
    esi,
    auth: fakeAuth,
    universe: fakeUniverse,
    publish: (n) => published.push(n),
    log: { info() {}, warn() {} },
  });
  feeds.start();
  try {
    await sleep(60); // /status is on its way
    feeds.start(); // e.g. logged in meanwhile
    await sleep(800);
    assert.ok(published.includes('status'), 'status published after the restart');
  } finally {
    feeds.stop();
  }
});

test('login: the built-in EVE HUD application uses PKCE (no Secret Key); your own with a secret uses Basic auth', async () => {
  const store = await import('../hud/lib/store.js');
  const { createAuth } = await import('../hud/lib/auth.js');
  const crypto = await import('node:crypto');
  const jwt = (claims) =>
    `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 1200, ...claims })).toString('base64url')}.y`;
  const calls = [];
  let life = 1200; // seconds until the access token expires
  const real = globalThis.fetch;
  globalThis.fetch = async (u, opts) => {
    calls.push({
      url: String(u),
      headers: opts.headers,
      body: Object.fromEntries(new URLSearchParams(opts.body)),
    });
    const exp = Math.floor(Date.now() / 1000) + life;
    const access = jwt({ sub: 'CHARACTER:EVE:7', name: 'Pilot', scp: ['esi-skills.read_skills.v1'], exp });
    return new Response(
      JSON.stringify({ access_token: access, refresh_token: `rt${calls.length}`, expires_in: 1200 }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };
  const quiet = { warn() {}, info() {} };
  try {
    const cfg = {
      clientId: '',
      clientSecret: '',
      callbackUrl: 'http://localhost:4747/callback',
      scopes: ['a', 'b'],
      userAgent: 'test',
    };
    const auth = createAuth(cfg, { log: quiet });
    auth.logout();
    assert.equal(auth.status().ownApp, false);
    const u = new URL(auth.loginUrl());
    assert.equal(u.searchParams.get('client_id'), store.BUILTIN_CLIENT_ID);
    assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:4747/callback');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    const challenge = u.searchParams.get('code_challenge');
    await auth.handleCallback({ code: 'c1', state: u.searchParams.get('state') });
    const ex = calls[0];
    assert.equal(ex.headers.Authorization, undefined, 'no secret, no Basic auth');
    assert.equal(ex.body.client_id, store.BUILTIN_CLIENT_ID);
    assert.equal(ex.body.grant_type, 'authorization_code');
    assert.equal(crypto.createHash('sha256').update(ex.body.code_verifier).digest('base64url'), challenge);
    assert.equal(auth.status().characterName, 'Pilot');
    // a refresh goes to the same application, also without a secret
    life = 30; // expires within the minute: the next getAccessToken() refreshes
    const u2 = new URL(auth.loginUrl());
    await auth.handleCallback({ code: 'c2', state: u2.searchParams.get('state') });
    life = 1200;
    await auth.getAccessToken();
    const rf = calls.at(-1);
    assert.equal(rf.body.grant_type, 'refresh_token');
    assert.equal(rf.body.refresh_token, 'rt2');
    assert.equal(rf.body.client_id, store.BUILTIN_CLIENT_ID);
    assert.equal(rf.headers.Authorization, undefined);
    auth.logout();
    // your own application with a Secret Key: Basic auth, no PKCE
    const own = { ...cfg, clientId: 'b'.repeat(32), clientSecret: 'eat_OwnSecretOwnSecretOwnSecret12' };
    const auth3 = createAuth(own, { log: quiet });
    const u3 = new URL(auth3.loginUrl());
    assert.equal(u3.searchParams.get('client_id'), 'b'.repeat(32));
    assert.equal(u3.searchParams.get('code_challenge'), null);
    await auth3.handleCallback({ code: 'c3', state: u3.searchParams.get('state') });
    const ex3 = calls.at(-1);
    assert.match(ex3.headers.Authorization, /^Basic /);
    assert.equal(ex3.body.client_id, undefined);
    assert.equal(ex3.body.code_verifier, undefined);
    auth3.logout();
  } finally {
    globalThis.fetch = real;
  }
});
