// SPDX-License-Identifier: GPL-3.0-or-later
// Looks up what an EVE chat link points at, for the item window in the HUD.
//   GET /api/showinfo?type=<typeID>[&item=<itemID>]
// All public ESI endpoints (no scopes); ESI's own cache headers keep repeat clicks free.
import { cleanText } from './evehtml.js';

const CHARACTER_TYPES = new Set([
  1373, 1374, 1375, 1376, 1377, 1378, 1379, 1380, 1381, 1382, 1383, 1384, 1385, 1386, 34574,
]);
const TYPE = { corporation: 2, alliance: 16159, region: 3, constellation: 4, system: 5, faction: 30 };
const ATTR = { techLevel: 422, metaLevel: 633 };
const DESCRIPTION_MAX = 900;

export function createShowInfo({ esi, universe, log = console }) {
  const memo = new Map(); // small result cache on top of ESI's, so a popular link doesn't re-resolve names
  let prices = { at: 0, byType: null };

  async function marketPrice(typeId) {
    if (!prices.byType || Date.now() - prices.at > 3600_000) {
      try {
        const { data } = await esi.request('/markets/prices'); // every type in one request, cached by ESI for an hour
        prices = { at: Date.now(), byType: new Map(data.map((p) => [p.type_id, p])) };
      } catch (err) {
        log.warn?.(`[showinfo] market prices: ${err.message}`);
        if (!prices.byType) return null;
      }
    }
    const p = prices.byType.get(typeId);
    return p ? { average: p.average_price ?? null, adjusted: p.adjusted_price ?? null } : null;
  }

  async function typeCard(typeId) {
    const { data: t } = await esi.request(`/universe/types/${typeId}`);
    const { data: g } = await esi.request(`/universe/groups/${t.group_id}`);
    let category = null;
    try {
      category = (await esi.request(`/universe/categories/${g.category_id}`)).data;
    } catch {
      /* optional */
    }
    const attr = (id) => t.dogma_attributes?.find((a) => a.attribute_id === id)?.value ?? null;
    let description = cleanText(t.description || '', { keepBreaks: true })
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (description.length > DESCRIPTION_MAX)
      description = `${description.slice(0, DESCRIPTION_MAX).replace(/\s+\S*$/, '')}…`;
    const categoryId = g.category_id;
    return {
      kind: 'type',
      typeId,
      name: t.name,
      group: g.name,
      category: category?.name ?? null,
      categoryId,
      // ships and structures have 3D renders; blueprints their own art; everything else an icon
      image: categoryId === 6 || categoryId === 65 ? 'render' : categoryId === 9 ? 'bp' : 'icon',
      techLevel: attr(ATTR.techLevel),
      metaLevel: attr(ATTR.metaLevel),
      volume: t.packaged_volume ?? t.volume ?? null,
      mass: t.mass || null,
      published: t.published !== false,
      price: t.published !== false && t.market_group_id ? await marketPrice(typeId) : null,
      description,
    };
  }

  async function namesOf(ids) {
    const nameOf = await esi.resolveNames(ids.filter(Boolean));
    return (id) => (id ? nameOf(id) : null);
  }

  async function character(id) {
    const { data: c } = await esi.request(`/characters/${id}`);
    const nameOf = await namesOf([c.corporation_id, c.alliance_id]);
    return {
      kind: 'character',
      id,
      name: c.name,
      corporation: { id: c.corporation_id, name: nameOf(c.corporation_id) },
      alliance: c.alliance_id ? { id: c.alliance_id, name: nameOf(c.alliance_id) } : null,
      birthday: c.birthday ?? null,
      securityStatus: c.security_status ?? null,
      title: c.title ? cleanText(c.title) : null,
    };
  }

  async function corporation(id) {
    const { data: c } = await esi.request(`/corporations/${id}`);
    const nameOf = await namesOf([c.alliance_id]);
    return {
      kind: 'corporation',
      id,
      name: c.name,
      ticker: c.ticker,
      members: c.member_count ?? null,
      alliance: c.alliance_id ? { id: c.alliance_id, name: nameOf(c.alliance_id) } : null,
      founded: c.date_founded ?? null,
    };
  }

  async function alliance(id) {
    const { data: a } = await esi.request(`/alliances/${id}`);
    const nameOf = await namesOf([a.executor_corporation_id]);
    return {
      kind: 'alliance',
      id,
      name: a.name,
      ticker: a.ticker,
      founded: a.date_founded ?? null,
      executor: a.executor_corporation_id
        ? { id: a.executor_corporation_id, name: nameOf(a.executor_corporation_id) }
        : null,
    };
  }

  function system(id) {
    const s = universe.system(id);
    if (!s) return null;
    return {
      kind: 'system',
      id,
      name: s.name,
      securityStatus: s.sec,
      region: s.regionName || null,
      onMap: universe.isKSpace(s.regionId),
    };
  }

  async function station(id, typeId) {
    const { data: st } = await esi.request(`/universe/stations/${id}`);
    const s = universe.system(st.system_id);
    return {
      kind: 'station',
      id,
      typeId,
      name: st.name,
      system: s
        ? { id: s.id, name: s.name, securityStatus: s.sec, region: s.regionName || null }
        : { id: st.system_id, name: null },
      services: st.services?.length ?? null,
    };
  }

  async function generic(itemId, typeId) {
    const nameOf = await esi.resolveNames([itemId]);
    const card = await typeCard(typeId).catch(() => null);
    return { kind: 'entity', id: itemId, name: nameOf(itemId), type: card };
  }

  async function resolve(typeId, itemId) {
    if (!itemId) return typeCard(typeId);
    if (CHARACTER_TYPES.has(typeId)) return character(itemId);
    if (typeId === TYPE.corporation) return corporation(itemId);
    if (typeId === TYPE.alliance) return alliance(itemId);
    if (typeId === TYPE.system) return system(itemId) || generic(itemId, typeId);
    if (itemId >= 60_000_000 && itemId < 64_000_000) return station(itemId, typeId);
    if (typeId === TYPE.region || typeId === TYPE.constellation || typeId === TYPE.faction) {
      const nameOf = await esi.resolveNames([itemId]);
      return {
        kind: 'place',
        id: itemId,
        name: nameOf(itemId),
        what: typeId === TYPE.region ? 'Region' : typeId === TYPE.constellation ? 'Constellation' : 'Faction',
      };
    }
    return generic(itemId, typeId); // a specific item, e.g. a structure or a ship someone owns
  }

  async function lookup(typeId, itemId) {
    typeId = Number(typeId);
    itemId = itemId ? Number(itemId) : null;
    if (
      !Number.isInteger(typeId) ||
      typeId <= 0 ||
      (itemId !== null && (!Number.isInteger(itemId) || itemId <= 0))
    ) {
      const err = new Error('Invalid link');
      err.status = 400;
      throw err;
    }
    const key = `${typeId}/${itemId ?? ''}`;
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
    try {
      const data = await resolve(typeId, itemId);
      memo.set(key, { at: Date.now(), data });
      if (memo.size > 500) memo.delete(memo.keys().next().value);
      return data;
    } catch (err) {
      if (err.status === 404 || /404/.test(err.message)) {
        const e = new Error("ESI doesn't know this item");
        e.status = 404;
        throw e;
      }
      throw err;
    }
  }

  return { lookup };
}
