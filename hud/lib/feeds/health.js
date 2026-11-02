// SPDX-License-Identifier: GPL-3.0-or-later
// ESI's own health per route (GET /meta/status), turned into a light per feed: the module lights and
// the top bar's CLUSTER hover.

// The ESI routes each feed reads, for the per-module health lights (GET /meta/status). "{}" stands
// for any parameter. Name lookups (/universe/names) are left out: every module uses them, and
// without them a module still shows its data, just with ids instead of names.
export const FEED_ROUTES = {
  status: ['/status'],
  hazards: [
    '/fw/systems',
    '/incursions',
    '/military-campaigns',
    '/military-campaigns/{}/objectives',
    '/sovereignty/campaigns',
    '/universe/system_kills',
  ],
  sovereignty: ['/sovereignty/systems', '/fw/systems', '/universe/factions'],
  notifications: ['/characters/{}/notifications'],
  mail: ['/characters/{}/mail/labels'],
  clones: ['/characters/{}/clones'],
  traffic: ['/universe/system_jumps', '/universe/system_kills'],
  warfare: [
    '/wars',
    '/wars/{}',
    '/fw/stats',
    '/fw/wars',
    '/fw/leaderboards',
    '/fw/leaderboards/characters',
    '/fw/leaderboards/corporations',
    '/characters/{}/fw/stats',
    '/military-campaigns',
    '/incursions',
  ],
  character: ['/characters/{}', '/corporations/{}', '/alliances/{}', '/characters/{}/implants'],
  wallet: ['/characters/{}/wallet', '/characters/{}/wallet/journal'],
  presence: ['/characters/{}/location', '/characters/{}/online', '/characters/{}/ship'],
  skills: ['/characters/{}/skillqueue', '/characters/{}/skills', '/characters/{}/attributes'],
  industry: ['/characters/{}/industry/jobs'],
  orders: ['/characters/{}/orders'],
  objectives: [
    '/characters/{}/freelance-jobs',
    '/characters/{}/military-campaigns/objectives',
    '/freelance-jobs/{}',
  ],
  activity: ['/characters/{}/wallet/journal', '/characters/{}/loyalty/points'],
  mining: ['/characters/{}/mining', '/markets/prices'],
  assets: ['/characters/{}/assets', '/characters/{}/assets/names', '/markets/prices'],
  standings: ['/characters/{}/standings'],
  kills: ['/characters/{}/killmails/recent', '/killmails/{}/{}', '/markets/prices'],
  route: ['POST /route/{}/{}', 'POST /ui/autopilot/waypoint'], // the star map's routes and Set destination
};

// One route's health from GET /meta/status, { routes: [{ method, path, status }] } with status
// OK / Degraded / Recovering / Down / Unknown (older answers: green / yellow / red). "Unknown" says
// nothing, so it's left out like a route ESI doesn't list.
const HEALTH = {
  ok: 'ok',
  green: 'ok',
  degraded: 'degraded',
  yellow: 'degraded',
  recovering: 'recovering',
  down: 'down',
  red: 'down',
};
const HEALTH_RANK = { ok: 0, recovering: 1, degraded: 2, down: 3 };
const routeKey = (method, path) =>
  `${String(method || 'GET').toUpperCase()} ${String(path || '')
    .replace(/^\/(latest|legacy|v\d+)(?=\/)/, '')
    .replace(/\{[^}]*\}/g, '{}')
    .replace(/(.)\/$/, '$1')}`;

// Per feed: the worst health of its routes, and which routes aren't OK. Reads the answer loosely
// (a list, or { routes: [...] }; path or route; status as a word), since its format is new.
export function feedHealth(answer) {
  const list = Array.isArray(answer) ? answer : answer?.routes || answer?.items || [];
  const byRoute = new Map();
  for (const r of list) {
    const status = HEALTH[String(r?.status || '').toLowerCase()];
    const path = r?.path ?? r?.route;
    if (status && path) byRoute.set(routeKey(r.method, path), status);
  }
  const feeds = {};
  const problems = {};
  for (const [feed, routes] of Object.entries(FEED_ROUTES)) {
    let worst = null;
    for (const spec of routes) {
      const [method, path] = spec.includes(' ') ? spec.split(' ') : ['GET', spec];
      const key = routeKey(method, path);
      const st = byRoute.get(key);
      if (!st) continue; // a route ESI doesn't report: no opinion
      if (worst === null || HEALTH_RANK[st] > HEALTH_RANK[worst]) worst = st;
      if (st !== 'ok') (problems[feed] ||= []).push({ route: key, status: st });
    }
    if (worst) feeds[feed] = worst;
  }
  return { feeds, problems, routes: byRoute.size };
}
