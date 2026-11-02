// SPDX-License-Identifier: GPL-3.0-or-later
// Feeds about your character: notifications, mail, clones, public info, wallet, location and ship,
// and the skill queue.
//
// Each feed: uses (who shows it, see ../feeds.js), min / max seconds between refreshes, authed:
// false when it needs no login, and run(), which returns { data, expires }.
import { RACES, dumpDebug } from './shapes.js';

export function characterFeeds({ esi, auth, universe, characterId, requireScope, journal30, notifCfg, log }) {
  return {
    // Notifications for the top bar: unread count plus the latest few (type and time only).
    notifications: {
      uses: ['topbar'],
      min: 120,
      max: 1800,
      async run() {
        requireScope('esi-characters.read_notifications.v1');
        const r = await esi.request(`/characters/${characterId()}/notifications`, { authed: true });
        const list = [...(Array.isArray(r.data) ? r.data : [])].sort(
          (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
        );
        // "ignoreTypes" in config.json hides notification types you never want to see (case-insensitive)
        const ignore = new Set((notifCfg.ignoreTypes || []).map((t) => String(t).toLowerCase()));
        const kept = list.filter((n) => !ignore.has(String(n.type).toLowerCase()));
        // diagnostics: type, time and read flag only (never the notification text)
        dumpDebug('notifications', {
          fetchedAt: new Date().toISOString(),
          cacheExpires: new Date(r.expires).toISOString(),
          count: list.length,
          ignoredTypes: [...ignore],
          newestFirst: list.slice(0, 25).map((n) => ({
            type: n.type,
            timestamp: n.timestamp,
            is_read: Boolean(n.is_read),
            ignored: ignore.has(String(n.type).toLowerCase()),
          })),
        });
        const label = (type) =>
          String(type || 'Notification')
            .replace(/Msg$/, '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
        // ESI's is_read flag isn't updated by EVE's notification panel, so the HUD tracks "seen" itself (browser side)
        return {
          data: {
            items: kept.slice(0, 100).map((n) => ({
              id: n.notification_id,
              type: n.type,
              label: label(n.type),
              t: Date.parse(n.timestamp),
            })),
            total: list.length,
            ignored: list.length - kept.length,
          },
          expires: r.expires,
        };
      },
    },

    // Unread mail count for the top bar (labels route: counts only, no mail contents).
    mail: {
      uses: ['mail'],
      min: 60,
      max: 600,
      async run() {
        requireScope('esi-mail.read_mail.v1');
        const r = await esi.request(`/characters/${characterId()}/mail/labels`, { authed: true });
        const labels = (r.data.labels || [])
          .filter((l) => l.unread_count)
          .map((l) => ({ name: l.name, unread: l.unread_count }));
        const unread = r.data.total_unread_count ?? labels.reduce((s, l) => s + l.unread, 0);
        return { data: { unread, labels }, expires: r.expires };
      },
    },

    // Medical clone (home station) for the top bar, plus a jump clone count.
    clones: {
      uses: ['topbar'],
      min: 300,
      max: 3600,
      async run() {
        requireScope('esi-clones.read_clones.v1');
        const r = await esi.request(`/characters/${characterId()}/clones`, { authed: true });
        let expires = r.expires;
        const c = r.data;
        const home = c.home_location || null;
        let out = null;
        if (home?.location_id) {
          const id = home.location_id;
          const isStructure = home.location_type === 'structure' || id >= 1e11;
          let name = null;
          let systemId = null;
          try {
            if (isStructure) {
              const s = await esi.request(`/universe/structures/${id}`, { authed: true });
              name = s.data.name;
              systemId = s.data.solar_system_id;
              expires = Math.min(expires, s.expires);
            } else {
              const s = await esi.request(`/universe/stations/${id}`);
              name = s.data.name;
              systemId = s.data.system_id;
              expires = Math.min(expires, s.expires);
            }
          } catch {
            name = isStructure ? `Structure ${id}` : (await esi.resolveNames([id]))(id); // no docking access, or lookup failed
          }
          let system = systemId ? universe.system(systemId) : null;
          if (systemId && !system) {
            try {
              const s = await esi.request(`/universe/systems/${systemId}`);
              system = { name: s.data.name, sec: s.data.security_status };
            } catch {
              /* ignore */
            }
          }
          out = {
            id,
            structure: isStructure,
            name,
            systemId,
            systemName: system?.name || null,
            sec: system?.sec ?? null,
          };
        }
        return {
          data: {
            home: out,
            jumpClones: (c.jump_clones || []).length,
            lastCloneJump: c.last_clone_jump_date ? Date.parse(c.last_clone_jump_date) : null,
            lastStationChange: c.last_station_change_date ? Date.parse(c.last_station_change_date) : null,
          },
          expires,
        };
      },
    },

    character: {
      uses: ['topbar', 'character'],
      min: 120,
      max: 3600,
      async run() {
        const pub = await esi.request(`/characters/${characterId()}`);
        const p = pub.data;
        const corp = await esi.request(`/corporations/${p.corporation_id}`);
        const ally = p.alliance_id ? await esi.request(`/alliances/${p.alliance_id}`) : null;
        let implants = [];
        let expires = Math.min(pub.expires, corp.expires);
        if (auth.hasScope('esi-clones.read_implants.v1')) {
          const imp = await esi.request(`/characters/${characterId()}/implants`, { authed: true });
          const nameOf = await esi.resolveNames(imp.data);
          implants = imp.data.map((id) => ({ id, name: nameOf(id) }));
          expires = Math.min(expires, imp.expires);
        }
        return {
          data: {
            id: characterId(),
            name: p.name,
            securityStatus: p.security_status ?? 0,
            birthday: p.birthday,
            race: RACES[p.race_id] || '',
            gender: p.gender,
            achievementScore: p.achievement_score ?? null,
            corporation: {
              id: p.corporation_id,
              name: corp.data.name,
              ticker: corp.data.ticker,
              members: corp.data.member_count,
            },
            alliance: ally ? { id: p.alliance_id, name: ally.data.name, ticker: ally.data.ticker } : null,
            implants,
            factionId: p.faction_id || null, // set while enlisted in Faction Warfare (the chat's Militia tab)
          },
          expires,
        };
      },
    },

    wallet: {
      uses: ['character'],
      min: 60,
      max: 900,
      async run() {
        requireScope('esi-wallet.read_character_wallet.v1');
        const bal = await esi.request(`/characters/${characterId()}/wallet`, { authed: true });
        let series = [];
        let recent = [];
        let expires = bal.expires;
        try {
          const since = Date.now() - 30 * 86400_000;
          const j = await journal30();
          expires = Math.min(expires, j.expires);
          const rows = j.rows;
          series = rows
            .filter((r) => Date.parse(r.date) >= since && typeof r.balance === 'number')
            .map((r) => [Date.parse(r.date), r.balance]);
          recent = rows
            .slice(-8)
            .reverse()
            .map((r) => ({
              t: Date.parse(r.date),
              amount: r.amount,
              type: r.ref_type,
              description: r.description,
            }));
        } catch (err) {
          log.warn?.(`[wallet] journal: ${err.message}`);
        }
        return { data: { balance: bal.data, series, recent }, expires };
      },
    },

    presence: {
      uses: ['topbar', 'character', 'map'],
      min: 5,
      max: 60,
      async run() {
        requireScope('esi-location.read_location.v1');
        const loc = await esi.request(`/characters/${characterId()}/location`, { authed: true });
        let expires = loc.expires;
        let ship = null;
        let online = null;
        if (auth.hasScope('esi-location.read_ship_type.v1')) {
          const s = await esi.request(`/characters/${characterId()}/ship`, { authed: true });
          expires = Math.min(expires, s.expires);
          const nameOf = await esi.resolveNames([s.data.ship_type_id]);
          ship = {
            typeId: s.data.ship_type_id,
            typeName: nameOf(s.data.ship_type_id),
            name: s.data.ship_name,
            itemId: s.data.ship_item_id,
          };
        }
        if (auth.hasScope('esi-location.read_online.v1')) {
          const o = await esi.request(`/characters/${characterId()}/online`, { authed: true });
          expires = Math.min(expires, o.expires);
          online = {
            online: o.data.online,
            lastLogin: o.data.last_login,
            lastLogout: o.data.last_logout,
            logins: o.data.logins,
          };
        }
        const sysId = loc.data.solar_system_id;
        let sys = universe.system(sysId);
        let system;
        if (sys) {
          system = {
            id: sysId,
            name: sys.name,
            sec: sys.sec,
            regionId: sys.regionId,
            regionName: sys.regionName,
            x: sys.x,
            y: sys.y,
            z: sys.z,
          };
        } else {
          const r = await esi.request(`/universe/systems/${sysId}`);
          system = {
            id: sysId,
            name: r.data.name,
            sec: r.data.security_status,
            regionId: null,
            regionName: '',
            x: r.data.position?.x,
            y: r.data.position?.y,
            z: r.data.position?.z,
          };
        }
        system.wormhole = sysId >= 31000000 && sysId < 32000000;
        const dockedId = loc.data.station_id || loc.data.structure_id || null;
        let docked = null;
        if (dockedId) {
          const nameOf = await esi.resolveNames([dockedId]);
          docked = { id: dockedId, name: nameOf(dockedId), structure: Boolean(loc.data.structure_id) };
        }
        return { data: { system, docked, ship, online }, expires };
      },
    },

    skills: {
      uses: ['skills', 'character', 'alert:skills'],
      min: 60,
      max: 900,
      async run() {
        requireScope('esi-skills.read_skillqueue.v1');
        const q = await esi.request(`/characters/${characterId()}/skillqueue`, { authed: true });
        let expires = q.expires;
        let totalSp = null;
        let unallocatedSp = null;
        let attributes = null;
        let trainedSkills = null;
        if (auth.hasScope('esi-skills.read_skills.v1')) {
          const s = await esi.request(`/characters/${characterId()}/skills`, { authed: true });
          totalSp = s.data.total_sp;
          unallocatedSp = s.data.unallocated_sp || 0;
          trainedSkills = s.data.skills?.length ?? null;
          expires = Math.min(expires, s.expires);
          try {
            const a = await esi.request(`/characters/${characterId()}/attributes`, { authed: true });
            attributes = {
              intelligence: a.data.intelligence,
              memory: a.data.memory,
              perception: a.data.perception,
              willpower: a.data.willpower,
              charisma: a.data.charisma,
              bonusRemaps: a.data.bonus_remaps ?? 0,
              nextRemap: a.data.accrued_remap_cooldown_date || null,
            };
          } catch {
            /* optional */
          }
        }
        const nameOf = await esi.resolveNames(q.data.map((e) => e.skill_id));
        const queue = [...q.data]
          .sort((a, b) => a.queue_position - b.queue_position)
          .map((e) => ({
            skillId: e.skill_id,
            name: nameOf(e.skill_id),
            level: e.finished_level,
            position: e.queue_position,
            start: e.start_date ? Date.parse(e.start_date) : null,
            finish: e.finish_date ? Date.parse(e.finish_date) : null,
            trainingStartSp: e.training_start_sp ?? null,
            levelStartSp: e.level_start_sp ?? null,
            levelEndSp: e.level_end_sp ?? null,
          }));
        return { data: { queue, totalSp, unallocatedSp, trainedSkills, attributes }, expires };
      },
    },
  };
}
