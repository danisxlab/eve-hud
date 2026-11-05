// SPDX-License-Identifier: GPL-3.0-or-later
// Feeds about what your character does: industry jobs, market orders, freelance jobs and
// campaigns, income, mining, assets, standings and kills.
//
// Each feed: uses (who shows it, see ../feeds.js), min / max seconds between refreshes, authed:
// false when it needs no login, and run(), which returns { data, expires }.
import { ACTIVITIES, FACTIONS, dumpDebug, pick, progressOf, dateOf } from './shapes.js';
import { categoryOfRef, startOfEveDay, summarizeKillmail, REF_LABELS } from './summaries.js';
import { dataPath, readJson, writeJson } from '../store.js';

export function economyFeeds({
  esi,
  auth,
  universe,
  characterId,
  requireScope,
  journal30,
  prices,
  categoryOf,
  log,
  state,
}) {
  return {
    industry: {
      uses: ['industry', 'alert:industry'],
      min: 120,
      max: 900,
      async run() {
        requireScope('esi-industry.read_character_jobs.v1');
        const r = await esi.request(`/characters/${characterId()}/industry/jobs`, {
          authed: true,
          query: { include_completed: false },
        });
        dumpDebug('industry', {
          fetchedAt: new Date().toISOString(),
          cacheExpires: new Date(r.expires).toISOString(),
          fromCache: Boolean(r.cached),
          jobs: r.data,
        });
        const ids = r.data
          .flatMap((j) => [j.blueprint_type_id, j.product_type_id, j.facility_id, j.station_id])
          .filter(Boolean);
        const nameOf = await esi.resolveNames(ids);
        const jobs = r.data
          .map((j) => ({
            id: j.job_id,
            activityId: j.activity_id,
            activity: ACTIVITIES[j.activity_id] || `Activity ${j.activity_id}`,
            status: j.status,
            blueprint: nameOf(j.blueprint_type_id),
            blueprintTypeId: j.blueprint_type_id,
            product: j.product_type_id ? nameOf(j.product_type_id) : nameOf(j.blueprint_type_id),
            productTypeId: j.product_type_id || j.blueprint_type_id,
            runs: j.runs,
            licensedRuns: j.licensed_runs,
            probability: j.probability ?? null,
            cost: j.cost ?? null,
            facility: nameOf(j.facility_id || j.station_id),
            start: Date.parse(j.start_date),
            end: Date.parse(j.end_date),
            pauseDate: j.pause_date ? Date.parse(j.pause_date) : null,
          }))
          .sort((a, b) => a.end - b.end);
        return { data: { jobs }, expires: r.expires };
      },
    },

    orders: {
      uses: ['market', 'alert:orders'],
      min: 300,
      max: 1800,
      async run() {
        requireScope('esi-markets.read_character_orders.v1');
        const r = await esi.request(`/characters/${characterId()}/orders`, { authed: true });
        const nameOf = await esi.resolveNames(r.data.flatMap((o) => [o.type_id, o.location_id, o.region_id]));
        const orders = r.data.map((o) => ({
          id: o.order_id,
          typeId: o.type_id,
          name: nameOf(o.type_id),
          buy: Boolean(o.is_buy_order),
          price: o.price,
          volumeTotal: o.volume_total,
          volumeRemain: o.volume_remain,
          minVolume: o.min_volume ?? 1,
          escrow: o.escrow ?? 0,
          location: nameOf(o.location_id),
          regionId: o.region_id,
          region: nameOf(o.region_id),
          range: o.range,
          issued: Date.parse(o.issued),
          expires: Date.parse(o.issued) + o.duration * 86400_000,
        }));
        // 30-day average price history per item (sparklines), max 24 distinct items
        const history = {};
        const pairs = [...new Map(orders.map((o) => [`${o.regionId}:${o.typeId}`, o])).values()].slice(0, 24);
        for (const o of pairs) {
          try {
            const h = await esi.request(`/markets/${o.regionId}/history`, { query: { type_id: o.typeId } });
            history[`${o.regionId}:${o.typeId}`] = h.data
              .slice(-30)
              .map((d) => [Date.parse(d.date), d.average, d.volume]);
          } catch {
            /* ignore */
          }
        }
        return { data: { orders, history }, expires: r.expires };
      },
    },

    // Your freelance jobs and military campaign objectives (shown in Warfare → Campaigns).
    objectives: {
      uses: ['warfare'],
      min: 120,
      max: 900,
      async run() {
        const items = [];
        const notes = [];
        const debug = {};
        let expires = Date.now() + 300_000;

        if (auth.hasScope('esi-characters.read_freelance_jobs.v1')) {
          try {
            // cursor-paginated route: follow `before` so older participations are included too
            const r = await esi.requestCursor(
              `/characters/${characterId()}/freelance-jobs`,
              { authed: true },
              { idOf: (e) => pick(e, ['job_id', 'id', 'freelance_job_id']) ?? JSON.stringify(e) },
            );
            debug.freelance = r.raw;
            expires = Math.min(expires, r.expires);
            for (const entry of r.data.slice(-12).reverse()) {
              // newest last in cursor order
              const jobId = pick(entry, ['job_id', 'id', 'freelance_job_id']);
              let detail = null;
              let participation = null;
              if (jobId) {
                try {
                  detail = (await esi.request(`/freelance-jobs/${jobId}`, { authed: true })).data;
                } catch {
                  /* ignore */
                }
                try {
                  participation = (
                    await esi.request(`/characters/${characterId()}/freelance-jobs/${jobId}/participation`, {
                      authed: true,
                    })
                  ).data;
                } catch {
                  /* ignore */
                }
              }
              debug[`freelance_${jobId}`] = { detail, participation };
              const merged = { ...entry, ...(detail || {}) };
              items.push({
                kind: 'freelance',
                id: String(jobId ?? items.length),
                title:
                  pick(merged, ['name', 'title', 'job_name']) || `Freelance job ${String(jobId).slice(0, 8)}`,
                state: pick(merged, ['state', 'status']) || 'active',
                progress: progressOf(merged),
                mine: progressOf(participation),
                ends: dateOf(merged, [
                  'expires',
                  'expiry',
                  'expiration',
                  'end_date',
                  'ends_at',
                  'expires_at',
                  'finished',
                ]),
                reward: pick(merged, ['reward', 'isk_reward', 'reward_isk', 'payout']) ?? null,
              });
            }
          } catch (err) {
            notes.push(`Freelance jobs: ${err.status ? `ESI ${err.status}` : err.message}`);
          }
        }

        if (auth.hasScope('esi.activity.char:read')) {
          try {
            const r = await esi.requestCursor(
              `/characters/${characterId()}/military-campaigns/objectives`,
              { authed: true },
              { idOf: (e) => `${pick(e, ['campaign_id'])}:${pick(e, ['objective_id', 'id'])}` },
            );
            debug.campaigns = r.raw;
            expires = Math.min(expires, r.expires);
            for (const entry of r.data.slice(-12).reverse()) {
              const campaignId = pick(entry, ['campaign_id']);
              const objectiveId = pick(entry, ['objective_id', 'id']);
              let detail = null;
              if (campaignId && objectiveId) {
                try {
                  detail = (await esi.request(`/military-campaigns/${campaignId}/objectives/${objectiveId}`))
                    .data;
                } catch {
                  /* ignore */
                }
              }
              const merged = { ...(detail || {}), ...entry };
              items.push({
                kind: 'campaign',
                id: String(objectiveId ?? items.length),
                title:
                  pick(merged, ['name', 'title']) || `Campaign objective ${String(objectiveId).slice(0, 8)}`,
                state: pick(merged, ['state', 'status']) || (merged.committed ? 'committed' : 'active'),
                committed: Boolean(merged.committed ?? merged.is_committed),
                progress: progressOf(detail),
                mine: progressOf(entry),
                ends: dateOf(merged, ['finish', 'finished', 'end_date', 'expires', 'expiry', 'ends_at']),
              });
            }
          } catch (err) {
            notes.push(`Military campaigns: ${err.status ? `ESI ${err.status}` : err.message}`);
          }
        }
        dumpDebug('objectives', debug);
        return { data: { items, notes }, expires };
      },
    },

    // ---------- optional modules ----------

    // Activity & income: the wallet journal grouped by source (missions per agent, bounties per
    // system, market, insurance…) for today / 7 days / 30 days, plus loyalty points per corporation.
    activity: {
      uses: ['activity'],
      min: 300,
      max: 1800,
      async run() {
        requireScope('esi-wallet.read_character_wallet.v1');
        const j = await journal30();
        let expires = j.expires;
        const me = characterId();
        const now = Date.now();
        const periods = { day: startOfEveDay(now), week: now - 7 * 86400_000, month: now - 30 * 86400_000 };
        const agg = Object.fromEntries(
          Object.keys(periods).map((k) => [
            k,
            { sources: {}, agents: {}, systems: {}, income: 0, expense: 0 },
          ]),
        );
        // per EVE day (UTC), oldest first, the last one is today; and per hour of today
        const today = startOfEveDay(now);
        const daily = new Array(30).fill(0).map(() => ({ income: 0, expense: 0 }));
        const hourly = new Array(24).fill(0).map(() => ({ income: 0, expense: 0 }));
        const ids = new Set();
        for (const e of j.rows) {
          const t = Date.parse(e.date);
          const amount = e.amount || 0;
          const cat = categoryOfRef(e.ref_type);
          const agent =
            cat === 'missions' ? [e.first_party_id, e.second_party_id].find((x) => x && x !== me) : null;
          const system = cat === 'bounties' && e.context_id_type === 'system_id' ? e.context_id : null;
          if (agent) ids.add(agent);
          const d = Math.round((today - startOfEveDay(t)) / 86400_000);
          if (d >= 0 && d < 30) daily[29 - d][amount >= 0 ? 'income' : 'expense'] += amount;
          if (t >= today) hourly[new Date(t).getUTCHours()][amount >= 0 ? 'income' : 'expense'] += amount;
          for (const [k, from] of Object.entries(periods)) {
            if (t < from) continue;
            const a = agg[k];
            const src = (a.sources[cat] ||= { income: 0, expense: 0, count: 0 });
            src[amount >= 0 ? 'income' : 'expense'] += amount;
            src.count++;
            a[amount >= 0 ? 'income' : 'expense'] += amount;
            if (agent) {
              const g = (a.agents[agent] ||= { isk: 0, count: 0 });
              g.isk += amount;
              g.count++;
            }
            if (system) {
              const g = (a.systems[system] ||= { isk: 0, count: 0 });
              g.isk += amount;
              g.count++;
            }
          }
        }
        let lp = null;
        if (auth.hasScope('esi-characters.read_loyalty.v1')) {
          try {
            const r = await esi.request(`/characters/${me}/loyalty/points`, { authed: true });
            expires = Math.min(expires, r.expires);
            lp = (r.data || [])
              .filter((x) => x.loyalty_points)
              .sort((a, b) => b.loyalty_points - a.loyalty_points);
            for (const x of lp) ids.add(x.corporation_id);
          } catch (err) {
            log.warn?.(`[activity] loyalty points: ${err.message}`);
          }
        }
        const nameOf = await esi.resolveNames([...ids]);
        const out = {};
        for (const [k, a] of Object.entries(agg)) {
          out[k] = {
            income: a.income,
            expense: a.expense,
            sources: Object.entries(a.sources)
              .map(([cat, v]) => ({ cat, label: REF_LABELS[cat], ...v }))
              .sort((x, y) => y.income - y.expense - (x.income - x.expense)),
            agents: Object.entries(a.agents)
              .map(([id, v]) => ({ id: Number(id), name: nameOf(Number(id)), ...v }))
              .sort((x, y) => y.isk - x.isk)
              .slice(0, 8),
            systems: Object.entries(a.systems)
              .map(([id, v]) => ({
                id: Number(id),
                name: universe.system(Number(id))?.name || `#${id}`,
                sec: universe.system(Number(id))?.sec ?? null,
                ...v,
              }))
              .sort((x, y) => y.isk - x.isk)
              .slice(0, 6),
          };
        }
        return {
          data: {
            periods: out,
            daily,
            hourly,
            today,
            entries: j.rows.length,
            oldest: j.rows[0] ? Date.parse(j.rows[0].date) : null,
            lp: lp
              ? lp.map((x) => ({
                  id: x.corporation_id,
                  name: nameOf(x.corporation_id),
                  points: x.loyalty_points,
                }))
              : null,
            lpScope: auth.hasScope('esi-characters.read_loyalty.v1'),
          },
          expires,
        };
      },
    },

    // Mining ledger: what you mined in the last 30 days, per ore and system, with an ISK estimate.
    mining: {
      uses: ['mining'],
      min: 600,
      max: 3600,
      async run() {
        requireScope('esi-industry.read_character_mining.v1');
        const r = await esi.requestAll(`/characters/${characterId()}/mining`, { authed: true });
        const price = await prices().catch(() => new Map());
        const rows = Array.isArray(r.data) ? r.data : [];
        const nameOf = await esi.resolveNames(rows.map((x) => x.type_id));
        const today = new Date().toISOString().slice(0, 10);
        const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);
        const periods = {
          day: dayMs(today),
          week: dayMs(today) - 6 * 86400_000,
          month: dayMs(today) - 29 * 86400_000,
        };
        const out = {};
        for (const [k, from] of Object.entries(periods)) {
          const types = {};
          const systems = {};
          let value = 0;
          let units = 0;
          for (const x of rows) {
            if (dayMs(x.date) < from) continue;
            const v = (price.get(x.type_id) || 0) * x.quantity;
            const t = (types[x.type_id] ||= {
              typeId: x.type_id,
              name: nameOf(x.type_id),
              quantity: 0,
              value: 0,
            });
            t.quantity += x.quantity;
            t.value += v;
            const sys = universe.system(x.solar_system_id);
            const s = (systems[x.solar_system_id] ||= {
              id: x.solar_system_id,
              name: sys?.name || `#${x.solar_system_id}`,
              sec: sys?.sec ?? null,
              quantity: 0,
              value: 0,
            });
            s.quantity += x.quantity;
            s.value += v;
            value += v;
            units += x.quantity;
          }
          out[k] = {
            value,
            units,
            types: Object.values(types).sort((a, b) => b.value - a.value || b.quantity - a.quantity),
            systems: Object.values(systems)
              .sort((a, b) => b.value - a.value)
              .slice(0, 6),
          };
        }
        const daily = new Array(30).fill(0);
        for (const x of rows) {
          const d = Math.round((dayMs(today) - dayMs(x.date)) / 86400_000);
          if (d >= 0 && d < 30) daily[29 - d] += (price.get(x.type_id) || 0) * x.quantity;
        }
        return {
          data: { periods: out, daily, days: new Set(rows.map((x) => x.date)).size },
          expires: r.expires,
        };
      },
    },

    // Ships & assets: every ship you own and where it is, plus the estimated value of everything,
    // per location. Values are CCP/Fenris Creations's average prices; blueprint copies count as 0.
    assets: {
      uses: ['assets'],
      min: 1800,
      max: 3600,
      async run() {
        requireScope('esi-assets.read_assets.v1');
        const r = await esi.requestAll(`/characters/${characterId()}/assets`, { authed: true });
        const items = Array.isArray(r.data) ? r.data : [];
        const price = await prices().catch(() => new Map());
        const byId = new Map(items.map((a) => [a.item_id, a]));
        const children = new Map();
        for (const a of items)
          if (byId.has(a.location_id))
            (children.get(a.location_id) || children.set(a.location_id, []).get(a.location_id)).push(a);
        const own = (a) => (a.is_blueprint_copy ? 0 : (price.get(a.type_id) || 0) * (a.quantity || 1));
        const total = (a) => own(a) + (children.get(a.item_id) || []).reduce((s, c) => s + total(c), 0);
        const rootOf = (a) => {
          let x = a;
          for (let i = 0; i < 10 && byId.has(x.location_id); i++) x = byId.get(x.location_id);
          return x;
        };
        const catOf = await categoryOf(items.filter((a) => a.is_singleton).map((a) => a.type_id));
        const shipItems = items.filter((a) => a.is_singleton && catOf(a.type_id) === 6);
        // custom ship names (POST, up to 1000 IDs per call)
        const shipNames = new Map();
        for (let i = 0; i < shipItems.length; i += 1000) {
          try {
            const n = await esi.request(`/characters/${characterId()}/assets/names`, {
              authed: true,
              method: 'POST',
              body: shipItems.slice(i, i + 1000).map((a) => a.item_id),
            });
            for (const x of n.data || []) if (x.name && x.name !== 'None') shipNames.set(x.item_id, x.name);
          } catch (err) {
            log.warn?.(`[assets] ship names: ${err.message}`);
          }
        }
        // locations: stations (and structures you can dock at) by name, systems from the star map
        const roots = new Map();
        for (const a of items) {
          if (byId.has(a.location_id)) continue;
          const l =
            roots.get(a.location_id) ||
            roots
              .set(a.location_id, { id: a.location_id, type: a.location_type, value: 0, items: 0, ships: 0 })
              .get(a.location_id);
          l.value += total(a);
          l.items += 1;
        }
        for (const s of shipItems) {
          const l = roots.get(rootOf(s).location_id);
          if (l) l.ships++;
        }
        const ranked = [...roots.values()].sort((a, b) => b.value - a.value);
        const lookup = ranked
          .filter((l) => l.type !== 'solar_system' && l.id !== 2004)
          .slice(0, 40)
          .map((l) => l.id);
        const nameOf = await esi.resolveNames([...lookup, ...items.map((a) => a.type_id)]);
        const placeName = (id, type) => {
          if (id === 2004) return 'Asset Safety';
          if (type === 'solar_system')
            return universe.system(id)?.name ? `${universe.system(id).name} (in space)` : `System #${id}`;
          return nameOf(id);
        };
        const activeShip = state.presence?.data?.ship?.itemId ?? null;
        const ships = shipItems
          .map((s) => {
            const root = rootOf(s);
            return {
              itemId: s.item_id,
              typeId: s.type_id,
              typeName: nameOf(s.type_id),
              name: shipNames.get(s.item_id) || null,
              location: placeName(root.location_id, root.location_type),
              locationId: root.location_id,
              inside: root !== s ? nameOf(root.type_id) : null, // e.g. in a carrier's ship hangar
              value: total(s),
              active: s.item_id === activeShip,
            };
          })
          .sort((a, b) => Number(b.active) - Number(a.active) || b.value - a.value);
        return {
          data: {
            totalValue: ranked.reduce((s, l) => s + l.value, 0),
            itemCount: items.length,
            ships: ships.slice(0, 80),
            shipCount: ships.length,
            locations: ranked.slice(0, 12).map((l) => ({
              id: l.id,
              name: placeName(l.id, l.type),
              value: l.value,
              items: l.items,
              ships: l.ships,
            })),
            locationCount: ranked.length,
          },
          expires: r.expires,
        };
      },
    },

    // Standings toward you from factions, NPC corporations and agents (raw values, before skills).
    standings: {
      uses: ['standings'],
      min: 1800,
      max: 3600,
      async run() {
        requireScope('esi-characters.read_standings.v1');
        const r = await esi.request(`/characters/${characterId()}/standings`, { authed: true });
        const list = Array.isArray(r.data) ? r.data : [];
        const nameOf = await esi.resolveNames(list.map((s) => s.from_id));
        const group = (type) =>
          list
            .filter((s) => s.from_type === type)
            .map((s) => ({
              id: s.from_id,
              name: FACTIONS[s.from_id] || nameOf(s.from_id),
              standing: s.standing,
            }))
            .sort((a, b) => b.standing - a.standing);
        return {
          data: { factions: group('faction'), corporations: group('npc_corp'), agents: group('agent') },
          expires: r.expires,
        };
      },
    },

    // Kills & losses from your recent killmails. Killmail details never change, so each one is
    // fetched once and kept in data/killmails.json (the newest 300).
    kills: {
      uses: ['kills'],
      min: 600,
      max: 3600,
      async run() {
        requireScope('esi-killmails.read_killmails.v1');
        const me = characterId();
        const r = await esi.request(`/characters/${me}/killmails/recent`, { authed: true });
        const recent = Array.isArray(r.data) ? r.data : [];
        const KM_FILE = dataPath('killmails.json');
        const stored = readJson(KM_FILE, {});
        const missing = recent.filter((k) => !stored[k.killmail_id]).slice(0, 25);
        // the hash makes the official ESI link of a killmail (Copy killmail link, for zKillboard's
        // Post page); killmails kept by an older version get it from the recent list
        let hashed = 0;
        for (const k of recent) {
          const x = stored[k.killmail_id];
          if (x && !x.hash && k.killmail_hash) {
            x.hash = k.killmail_hash;
            hashed += 1;
          }
        }
        if (missing.length || hashed) {
          const price = await prices().catch(() => new Map());
          for (const k of missing) {
            try {
              const km = (await esi.request(`/killmails/${k.killmail_id}/${k.killmail_hash}`)).data;
              stored[k.killmail_id] = summarizeKillmail(km, me, price, k.killmail_hash);
            } catch (err) {
              log.warn?.(`[kills] killmail ${k.killmail_id}: ${err.message}`);
            }
          }
          const keep = Object.values(stored)
            .sort((a, b) => b.t - a.t)
            .slice(0, 300);
          writeJson(KM_FILE, Object.fromEntries(keep.map((x) => [x.id, x])));
        }
        const list = Object.values(stored)
          .sort((a, b) => b.t - a.t)
          .slice(0, 40);
        const nameOf = await esi.resolveNames(
          list.flatMap((x) => [x.shipTypeId, x.victimId, x.victimCorpId, x.myShipTypeId]),
        );
        const since = Date.now() - 30 * 86400_000;
        const month = Object.values(stored).filter((x) => x.t >= since);
        return {
          data: {
            list: list.map((x) => {
              const sys = universe.system(x.systemId);
              return {
                ...x,
                shipName: nameOf(x.shipTypeId),
                victimName: x.victimId ? nameOf(x.victimId) : null,
                victimCorp: x.victimCorpId ? nameOf(x.victimCorpId) : null,
                myShipName: x.myShipTypeId ? nameOf(x.myShipTypeId) : null,
                systemName: sys?.name || `#${x.systemId}`,
                sec: sys?.sec ?? null,
              };
            }),
            month: {
              kills: month.filter((x) => !x.loss).length,
              losses: month.filter((x) => x.loss).length,
              iskKilled: month.filter((x) => !x.loss).reduce((s, x) => s + x.value, 0),
              iskLost: month.filter((x) => x.loss).reduce((s, x) => s + x.value, 0),
            },
          },
          expires: r.expires,
        };
      },
    },
  };
}
