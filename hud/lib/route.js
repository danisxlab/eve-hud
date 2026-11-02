// SPDX-License-Identifier: GPL-3.0-or-later
// Routes for the star map, and "Set destination" (the in-game autopilot) through ESI.
//
//   route(from, to, preference)  -> { route: [systemId, …], jumps, source }
//       ESI: POST /route/{origin}/{destination} with { preference: "Shorter" | "Safer" | "LessSecure" },
//       the same route planner as the game (compatibility date 2026-08-18; it replaced the old
//       GET /route/… of the legacy ESI). Answers are kept 10 minutes per origin/destination/preference.
//       Demo mode, or when ESI can't be reached: worked out here from the star map's stargates
//       (marked source: "local", without the game's exact security weighting).
//   setDestination(to)           -> ESI POST /ui/autopilot/waypoint (scope esi-ui.write_waypoint.v1);
//       clears your other waypoints, like "Set Destination" in the game. EVE has to be running
//       with the character logged in for the client to pick it up.

export const PREFERENCES = { shorter: 'Shorter', safer: 'Safer', insecure: 'LessSecure' };
const SCOPE = 'esi-ui.write_waypoint.v1';

export function createRouter({ esi, auth, universe, demo = false, log = console }) {
  const cache = new Map(); // "from:to:pref" -> { at, result }

  async function route(from, to, pref = 'shorter') {
    from = Number(from);
    to = Number(to);
    if (!PREFERENCES[pref]) pref = 'shorter';
    if (!universe.system(from) || !universe.system(to)) throw httpError(400, 'Unknown solar system');
    if (from === to) return { route: [from], jumps: 0, source: 'local', preference: pref };
    const key = `${from}:${to}:${pref}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 600_000) return hit.result;
    let result;
    if (demo) {
      result = localRoute(from, to, pref);
    } else {
      try {
        const r = await esi.request(`/route/${from}/${to}`, {
          method: 'POST',
          body: { preference: PREFERENCES[pref] },
        });
        const ids = Array.isArray(r.data) ? r.data : r.data?.route;
        if (!Array.isArray(ids) || !ids.length) throw httpError(404, 'No route');
        result = { route: ids, jumps: ids.length - 1, source: 'esi', preference: pref };
      } catch (err) {
        if (err.status === 404)
          throw httpError(404, 'No route between these systems (for example Pochven, or a closed region)');
        if (err.status && err.status < 500 && err.status !== 420 && err.status !== 429) throw err;
        log.warn?.(`[route] ESI route unavailable (${err.message}); using the star map's stargates`);
        result = localRoute(from, to, pref);
      }
    }
    if (!result) throw httpError(404, 'No route between these systems');
    cache.set(key, { at: Date.now(), result });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return result;
  }

  // Dijkstra over the stargates. Safer avoids low/null-sec, Less secure avoids high-sec; each
  // unwanted system costs like 31 jumps, so it is only used when there is no way around it.
  let adj = null;
  let adjFor = null;
  function localRoute(from, to, pref) {
    const jumps = universe.jumps();
    if (adjFor !== jumps) {
      adj = new Map();
      for (const [a, b] of jumps) {
        (adj.get(a) || adj.set(a, []).get(a)).push(b);
        (adj.get(b) || adj.set(b, []).get(b)).push(a);
      }
      adjFor = jumps;
    }
    const high = (id) => (universe.system(id)?.sec ?? 0) >= 0.45;
    const cost = (id) => 1 + ((pref === 'safer' && !high(id)) || (pref === 'insecure' && high(id)) ? 30 : 0);
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const open = [[0, from]];
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [d, a] = open.shift();
      if (a === to) break;
      if (d > dist.get(a)) continue;
      for (const b of adj.get(a) || []) {
        const nd = d + cost(b);
        if (nd < (dist.get(b) ?? Infinity)) {
          dist.set(b, nd);
          prev.set(b, a);
          open.push([nd, b]);
        }
      }
    }
    if (!dist.has(to)) return null;
    const path = [to];
    while (path[0] !== from) path.unshift(prev.get(path[0]));
    return { route: path, jumps: path.length - 1, source: 'local', preference: pref };
  }

  async function setDestination(to) {
    to = Number(to);
    if (!universe.system(to)) throw httpError(400, 'Unknown solar system');
    if (demo) return { ok: true, demo: true };
    if (!auth.characterId) throw httpError(401, 'Not logged in');
    if (!auth.hasScope(SCOPE))
      throw Object.assign(
        httpError(
          403,
          `Setting the destination needs the scope ${SCOPE}. Add it to "scopes" in config.json (and your EVE application), then log in again.`,
        ),
        { scope: SCOPE },
      );
    await esi.request('/ui/autopilot/waypoint', {
      authed: true,
      method: 'POST',
      query: { destination_id: to, clear_other_waypoints: true, add_to_beginning: false },
    });
    return { ok: true };
  }

  return { route, setDestination };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
