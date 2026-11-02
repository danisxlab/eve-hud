// SPDX-License-Identifier: GPL-3.0-or-later
// Feeds from ESI's public data (no login needed for most): Tranquility, ESI health, the star map's
// hazards, sovereignty and traffic, and Faction Warfare.
//
// Each feed: uses (who shows it, see ../feeds.js), min / max seconds between refreshes, authed:
// false when it needs no login, and run(), which returns { data, expires }.
import { FACTIONS, dumpDebug, pick, idNamed, progressOf, dateOf, human, systemIdsIn } from './shapes.js';
import { feedHealth } from './health.js';

export function publicFeeds({ esi, auth, characterId, hazardCfg, log }) {
  return {
    status: {
      uses: ['topbar'],
      authed: false,
      min: 30,
      max: 120,
      async run() {
        const r = await esi.request('/status');
        return {
          data: {
            players: r.data.players,
            version: r.data.server_version,
            startTime: r.data.start_time,
            vip: Boolean(r.data.vip),
          },
          expires: r.expires,
        };
      },
    },

    // ESI's own health per route, for the green / amber / red light of each module.
    esihealth: {
      uses: ['topbar'],
      authed: false,
      min: 60,
      max: 300,
      async run() {
        const r = await esi.request('/meta/status');
        const health = feedHealth(r.data);
        if (!health.routes)
          dumpDebug('meta-status', {
            note: 'answer not understood; first 20 entries',
            at: new Date().toISOString(),
            sample: Array.isArray(r.data) ? r.data.slice(0, 20) : r.data,
          });
        return { data: health, expires: r.expires };
      },
    },

    // Public data about where trouble is, for the star map's hazard overlay.
    hazards: {
      uses: ['map:hazards'],
      authed: false,
      min: 300,
      max: 1800,
      async run() {
        const systems = {}; // systemId -> [{ type, label, detail, level }]
        const add = (id, h) => {
          if (Number.isInteger(id)) (systems[id] ||= []).push(h);
        };
        const notes = [];
        const debug = {};
        let expires = Date.now() + 1800_000;
        const source = async (name, fn) => {
          try {
            await fn();
          } catch (err) {
            notes.push(`${name}: ${err.status ? `ESI ${err.status}` : err.message}`);
          }
        };

        await source('Incursions', async () => {
          const r = await esi.request('/incursions');
          expires = Math.min(expires, r.expires);
          for (const inc of r.data) {
            const who = FACTIONS[inc.faction_id] || 'Incursion';
            const detail = `${who} · ${human(inc.state)}${inc.has_boss ? ' · mothership present' : ''} · influence ${Math.round((inc.influence || 0) * 100)}%`;
            for (const id of inc.infested_solar_systems || []) {
              add(id, {
                type: 'incursion',
                label: id === inc.staging_solar_system_id ? 'Incursion staging system' : 'Incursion',
                detail,
                level: 1,
              });
            }
          }
        });

        await source('Sovereignty campaigns', async () => {
          const r = await esi.request('/sovereignty/campaigns');
          expires = Math.min(expires, r.expires);
          for (const c of r.data) {
            const started = c.start_time ? Date.parse(c.start_time) : null;
            const score =
              typeof c.defender_score === 'number'
                ? ` · defender ${Math.round(c.defender_score * 100)}% / attackers ${Math.round((c.attackers_score || 0) * 100)}%`
                : '';
            add(c.solar_system_id, {
              type: 'sov',
              label: `Sovereignty fight: ${human(c.event_type) || 'campaign'}`,
              detail: `${started && started > Date.now() ? 'starts' : 'started'} ${started ? new Date(started).toISOString().slice(0, 16).replace('T', ' ') : '?'} EVE${score}`,
              level: 1,
            });
          }
        });

        await source('Faction Warfare', async () => {
          const r = await esi.request('/fw/systems');
          expires = Math.min(expires, r.expires);
          for (const s of r.data) {
            if (!['contested', 'vulnerable'].includes(s.contested)) continue;
            const pct = s.victory_points_threshold
              ? Math.round((s.victory_points / s.victory_points_threshold) * 100)
              : null;
            add(s.solar_system_id, {
              type: 'fw',
              label: `Faction Warfare: ${s.contested}`,
              detail: `${FACTIONS[s.occupier_faction_id] || 'Occupier'} holds it${pct !== null ? ` · ${pct}% contested` : ''}`,
              level: s.contested === 'vulnerable' ? 1 : Math.min(1, (pct ?? 50) / 100),
            });
          }
        });

        const threshold = Math.max(1, Number(hazardCfg.pvpKillThreshold) || 3);
        await source('Recent kills', async () => {
          const r = await esi.request('/universe/system_kills');
          expires = Math.min(expires, r.expires);
          for (const k of r.data) {
            const pvp = (k.ship_kills || 0) + (k.pod_kills || 0);
            if (pvp < threshold) continue;
            add(k.system_id, {
              type: 'kills',
              label: `${pvp} player kills in the last hour`,
              detail: `${k.ship_kills || 0} ships · ${k.pod_kills || 0} pods${k.npc_kills ? ` · ${k.npc_kills} NPCs` : ''}`,
              level: Math.min(1, pvp / 20),
            });
          }
        });

        await source('Military campaigns', async () => {
          const list = await esi.requestCursor(
            '/military-campaigns',
            {},
            { idOf: (c) => pick(c, ['campaign_id', 'id']) },
          );
          expires = Math.min(expires, list.expires);
          debug.campaigns = list.raw;
          const active = list.data
            .filter((c) => !/completed|expired/i.test(String(pick(c, ['state', 'status']) || '')))
            .slice(0, 10);
          for (const c of active) {
            const id = pick(c, ['campaign_id', 'id']);
            if (!id) continue;
            const objs = await esi.requestCursor(
              `/military-campaigns/${id}/objectives`,
              {},
              { idOf: (o) => pick(o, ['objective_id', 'id']) },
            );
            debug[`campaign_${id}`] = objs.raw;
            const ids = new Set([...systemIdsIn(c), ...objs.data.flatMap((o) => [...systemIdsIn(o)])]);
            for (const sid of ids)
              add(sid, {
                type: 'campaign',
                label: 'Military campaign objective',
                detail: pick(c, ['name', 'title']) || `Campaign ${String(id).slice(0, 8)}`,
                level: 1,
              });
          }
        });

        dumpDebug('hazards', { notes, ...debug });
        const counts = {};
        for (const list of Object.values(systems))
          for (const h of list) counts[h.type] = (counts[h.type] || 0) + 1;
        return { data: { systems, counts, notes, killThreshold: threshold }, expires };
      },
    },

    // Who controls each system, for the star map's "Faction" colouring (public, one request an hour):
    //   /sovereignty/systems -> per system a `claim`: an empire or NPC faction, or a player alliance.
    //                           (It replaced /sovereignty/map at compatibility date 2026-05-19.)
    //   /fw/systems          -> Faction Warfare: the original owner and the current occupier
    //   /universe/factions + /universe/names -> display names
    // The exact fields inside `claim` aren't documented where we could check, so the IDs are looked
    // up by name wherever they sit. A sample of the raw answer goes to data/debug/sovereignty.json.
    sovereignty: {
      uses: ['map:faction'],
      authed: false,
      min: 1800,
      max: 3600,
      async run() {
        let r;
        let route = '/sovereignty/systems';
        try {
          r = await esi.request(route);
        } catch (err) {
          if (err.status !== 404) throw err;
          route = '/sovereignty/map'; // older compatibility dates
          r = await esi.request(route);
        }
        const list = Array.isArray(r.data) ? r.data : r.data?.solar_systems || r.data?.systems || [];
        const owners = {}; // systemId -> factionId (500xxx) or allianceId
        const alliances = new Set();
        for (const s of list) {
          const systemId = s.solar_system_id ?? s.system_id;
          const claim = s.claim ?? s;
          const factionId = idNamed(claim, 'faction');
          const allianceId = idNamed(claim, 'alliance');
          const id = factionId || allianceId;
          if (!Number.isInteger(systemId) || !id) continue;
          owners[systemId] = id;
          if (!factionId) alliances.add(allianceId);
        }
        dumpDebug('sovereignty', {
          route,
          at: new Date().toISOString(),
          topLevelKeys: Array.isArray(r.data) ? '(array)' : Object.keys(r.data || {}),
          systems: list.length,
          withOwner: Object.keys(owners).length,
          factionSystems: Object.values(owners).filter((id) => id >= 500000 && id < 600000).length,
          allianceSystems: Object.values(owners).filter((id) => !(id >= 500000 && id < 600000)).length,
          sample: [...list.filter((s) => s.claim).slice(0, 4), ...list.filter((s) => !s.claim).slice(0, 2)],
        });
        const fw = {}; // systemId -> [ownerFactionId, occupierFactionId], only where they differ
        try {
          const f = await esi.request('/fw/systems');
          for (const s of f.data) {
            if (s.occupier_faction_id && s.occupier_faction_id !== s.owner_faction_id)
              fw[s.solar_system_id] = [s.owner_faction_id, s.occupier_faction_id];
          }
        } catch (err) {
          log.warn?.(`[sovereignty] FW systems: ${err.message}`);
        }
        const names = {};
        try {
          const f = await esi.request('/universe/factions');
          for (const x of f.data) names[x.faction_id] = x.name;
        } catch {
          Object.assign(names, FACTIONS);
        }
        const nameOf = await esi.resolveNames([...alliances]);
        for (const id of alliances) names[id] = nameOf(id);
        return { data: { owners, fw, names }, expires: r.expires };
      },
    },

    // Last-hour activity for every system (two requests total; ESI aggregates these hourly).
    // /universe/system_kills is shared with the hazards feed through the ESI cache.
    traffic: {
      uses: ['map'],
      authed: false,
      min: 600,
      max: 3600,
      async run() {
        const kills = await esi.request('/universe/system_kills');
        const jumps = await esi.request('/universe/system_jumps');
        const k = {};
        for (const r of kills.data)
          if (r.ship_kills || r.pod_kills || r.npc_kills)
            k[r.system_id] = [r.ship_kills || 0, r.pod_kills || 0, r.npc_kills || 0];
        const j = {};
        let max = 0;
        for (const r of jumps.data)
          if (r.ship_jumps) {
            j[r.system_id] = r.ship_jumps;
            max = Math.max(max, r.ship_jumps);
          }
        // 90th percentile of jumps, used to call a system "busy"
        const sorted = Object.values(j).sort((a, b) => a - b);
        const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0;
        return {
          data: { kills: k, jumps: j, busyJumps: p90, maxJumps: max },
          expires: Math.min(kills.expires, jumps.expires),
        };
      },
    },

    // Conflict data without a map location: wars, Faction Warfare stats, leaderboards, campaigns.
    warfare: {
      uses: ['warfare'],
      authed: false,
      min: 600,
      max: 3600,
      async run() {
        const notes = [];
        let expires = Date.now() + 3600_000;
        const track = (r) => {
          expires = Math.min(expires, r.expires);
          return r.data;
        };
        const source = async (name, fn) => {
          try {
            return await fn();
          } catch (err) {
            notes.push(`${name}: ${err.status ? `ESI ${err.status}` : err.message}`);
            return null;
          }
        };
        const ids = new Set();
        const out = {
          wars: [],
          myCorp: null,
          fw: null,
          me: null,
          leaderboards: null,
          campaigns: [],
          incursions: [],
        };

        // ---- your corporation / alliance (to highlight your wars)
        if (auth.characterId) {
          await source('Character', async () => {
            const c = track(await esi.request(`/characters/${characterId()}`));
            out.myCorp = {
              corporationId: c.corporation_id,
              allianceId: c.alliance_id || null,
              npc: c.corporation_id >= 1000000 && c.corporation_id < 2000000,
            };
          });
        }

        // ---- wars: the 15 most recent (ESI lists war IDs newest first)
        await source('Wars', async () => {
          const list = track(await esi.request('/wars'));
          for (const id of list.slice(0, 15)) {
            const w = await source(`War ${id}`, async () => track(await esi.request(`/wars/${id}`)));
            if (!w) continue;
            const side = (s) => ({
              id: s?.alliance_id || s?.corporation_id,
              alliance: Boolean(s?.alliance_id),
              isk: s?.isk_destroyed ?? 0,
              ships: s?.ships_killed ?? 0,
            });
            const war = {
              id,
              aggressor: side(w.aggressor),
              defender: side(w.defender),
              declared: w.declared ? Date.parse(w.declared) : null,
              started: w.started ? Date.parse(w.started) : null,
              finished: w.finished ? Date.parse(w.finished) : null,
              retracted: w.retracted ? Date.parse(w.retracted) : null,
              mutual: Boolean(w.mutual),
              openForAllies: Boolean(w.open_for_allies),
              allies: (w.allies || []).length,
            };
            const mine =
              out.myCorp &&
              [
                war.aggressor.id,
                war.defender.id,
                ...(w.allies || []).map((a) => a.alliance_id || a.corporation_id),
              ].some((x) => x && (x === out.myCorp.corporationId || x === out.myCorp.allianceId));
            war.mine = Boolean(mine);
            ids.add(war.aggressor.id);
            ids.add(war.defender.id);
            out.wars.push(war);
          }
        });

        // ---- Faction Warfare statistics and who fights whom
        await source('Faction Warfare stats', async () => {
          const stats = track(await esi.request('/fw/stats'));
          const wars = await source('FW wars', async () => track(await esi.request('/fw/wars')));
          out.fw = {
            factions: stats
              .map((f) => ({
                id: f.faction_id,
                name: FACTIONS[f.faction_id] || null,
                pilots: f.pilots ?? 0,
                systems: f.systems_controlled ?? 0,
                killsYesterday: f.kills?.yesterday ?? 0,
                killsWeek: f.kills?.last_week ?? 0,
                killsTotal: f.kills?.total ?? 0,
                vpYesterday: f.victory_points?.yesterday ?? 0,
                vpWeek: f.victory_points?.last_week ?? 0,
              }))
              .sort((a, b) => b.systems - a.systems),
            wars: (wars || []).map((w) => [w.faction_id, w.against_id]),
          };
          for (const f of out.fw.factions) if (!f.name) ids.add(f.id);
        });

        // ---- your own FW status (needs esi-characters.read_fw_stats.v1)
        if (auth.characterId && auth.hasScope('esi-characters.read_fw_stats.v1')) {
          await source('Your FW stats', async () => {
            const m = track(await esi.request(`/characters/${characterId()}/fw/stats`, { authed: true }));
            out.me = {
              enlisted: Boolean(m.faction_id),
              factionId: m.faction_id || null,
              faction: FACTIONS[m.faction_id] || null,
              enlistedOn: m.enlisted_on ? Date.parse(m.enlisted_on) : null,
              rank: m.current_rank ?? null,
              killsWeek: m.kills?.last_week ?? 0,
              vpWeek: m.victory_points?.last_week ?? 0,
            };
          });
        }

        // ---- leaderboards: top 10 per board / metric / period
        await source('FW leaderboards', async () => {
          const top = (board, key) => {
            const res = {};
            for (const metric of ['kills', 'victory_points']) {
              res[metric] = {};
              for (const period of ['yesterday', 'last_week', 'active_total']) {
                res[metric][period] = (board?.[metric]?.[period] || []).slice(0, 10).map((r) => {
                  ids.add(r[key]);
                  return { id: r[key], amount: r.amount ?? 0 };
                });
              }
            }
            return res;
          };
          const factions = track(await esi.request('/fw/leaderboards'));
          const corps = await source('FW corporation leaderboard', async () =>
            track(await esi.request('/fw/leaderboards/corporations')),
          );
          const pilots = await source('FW pilot leaderboard', async () =>
            track(await esi.request('/fw/leaderboards/characters')),
          );
          out.leaderboards = {
            factions: top(factions, 'faction_id'),
            corporations: top(corps, 'corporation_id'),
            characters: top(pilots, 'character_id'),
          };
        });

        // ---- military campaigns (titles live in the SDE; ESI gives state and progress)
        await source('Military campaigns', async () => {
          const list = await esi.requestCursor(
            '/military-campaigns',
            {},
            { idOf: (c) => pick(c, ['campaign_id', 'id']) },
          );
          expires = Math.min(expires, list.expires);
          for (const c of list.data.slice(-12).reverse()) {
            const id = pick(c, ['campaign_id', 'id']);
            out.campaigns.push({
              id: String(id),
              title: pick(c, ['name', 'title']) || null,
              state: pick(c, ['state', 'status']) || 'active',
              progress: progressOf(c),
              start: dateOf(c, ['start', 'started', 'start_date']),
              finish: dateOf(c, ['finish', 'finished', 'end_date', 'expires']),
            });
          }
        });

        // ---- incursions, grouped per constellation
        await source('Incursions', async () => {
          for (const inc of track(await esi.request('/incursions'))) {
            ids.add(inc.constellation_id);
            if (inc.staging_solar_system_id) ids.add(inc.staging_solar_system_id);
            out.incursions.push({
              constellationId: inc.constellation_id,
              stagingId: inc.staging_solar_system_id,
              faction: FACTIONS[inc.faction_id] || 'Incursion',
              state: inc.state,
              influence: inc.influence ?? 0,
              boss: Boolean(inc.has_boss),
              systems: (inc.infested_solar_systems || []).length,
            });
          }
        });

        const nameOf = await esi.resolveNames([...ids].filter(Boolean));
        out.names = Object.fromEntries(
          [...ids].filter(Boolean).map((id) => [id, FACTIONS[id] || nameOf(id)]),
        );
        out.notes = notes;
        return { data: out, expires };
      },
    },
  };
}
