// SPDX-License-Identifier: GPL-3.0-or-later
// Looks up what an EVE chat link points at, for the item window in the HUD.
//   GET /api/showinfo?type=<typeID>[&item=<itemID>]
// Items, groups, categories and stations come from CCP/Fenris Creations's static data (statics.js);
// characters, corporations, alliances, names and prices from public ESI endpoints (no scopes),
// whose own cache headers keep repeat clicks free.
import { cleanText } from './evehtml.js';
import { marketPrices } from './esi.js';

const CHARACTER_TYPES = new Set([
  1373, 1374, 1375, 1376, 1377, 1378, 1379, 1380, 1381, 1382, 1383, 1384, 1385, 1386, 34574,
]);
const TYPE = { corporation: 2, alliance: 16159, region: 3, constellation: 4, system: 5, faction: 30 };
const DESCRIPTION_MAX = 900;

export function createShowInfo({ esi, universe, log = console }) {
  const memo = new Map(); // small result cache on top of ESI's, so a popular link doesn't re-resolve names
  let lastPrices = null; // the price map last read (the same one the ESI client keeps), if ESI fails

  async function marketPrice(typeId) {
    try {
      lastPrices = (await marketPrices(esi)).map; // every type in one request, cached by ESI for an hour
    } catch (err) {
      log.warn?.(`[showinfo] market prices: ${err.message}`);
      if (!lastPrices) return null;
    }
    const p = lastPrices.get(typeId);
    return p ? { average: p[0], adjusted: p[1] } : null;
  }

  const statics = universe.statics;

  // Without the item data (not downloaded yet): just the name, from ESI's name lookup.
  async function nameOnlyCard(typeId) {
    const name = (await esi.resolveNames([typeId]))(typeId);
    if (name === `#${typeId}`) throw Object.assign(new Error('Unknown item'), { status: 404 });
    return {
      kind: 'type',
      typeId,
      name,
      group: null,
      category: null,
      categoryId: null,
      image: 'icon',
      techLevel: null,
      metaLevel: null,
      volume: null,
      mass: null,
      published: true,
      price: await marketPrice(typeId),
      description: '',
    };
  }

  async function typeCard(typeId) {
    if (!statics?.ready()) return nameOnlyCard(typeId);
    const t = statics.type(typeId);
    if (!t) throw Object.assign(new Error('Unknown item'), { status: 404 });
    const g = statics.group(t.groupId);
    let description = cleanText(t.description, { keepBreaks: true })
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (description.length > DESCRIPTION_MAX)
      description = `${description.slice(0, DESCRIPTION_MAX).replace(/\s+\S*$/, '')}…`;
    const categoryId = g?.categoryId ?? null;
    return {
      kind: 'type',
      typeId,
      name: t.name,
      group: g?.name ?? null,
      category: categoryId !== null ? statics.category(categoryId) : null,
      categoryId,
      // ships and structures have 3D renders; blueprints their own art; everything else an icon
      image: categoryId === 6 || categoryId === 65 ? 'render' : categoryId === 9 ? 'bp' : 'icon',
      techLevel: t.techLevel,
      metaLevel: t.metaLevel,
      volume: t.volume,
      mass: t.mass || null,
      published: t.published,
      price: t.published && t.marketGroupId ? await marketPrice(typeId) : null,
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
    const st = statics?.station(id) ?? null; // system and number of services
    const name = (await esi.resolveNames([id]))(id);
    if (!st && name === `#${id}`) throw Object.assign(new Error('Unknown station'), { status: 404 });
    const s = st ? universe.system(st.systemId) : null;
    return {
      kind: 'station',
      id,
      typeId,
      name,
      system: s
        ? { id: s.id, name: s.name, securityStatus: s.sec, region: s.regionName || null }
        : { id: st?.systemId ?? null, name: null },
      services: st?.services ?? null,
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
        const e = new Error("EVE doesn't know this item");
        e.status = 404;
        throw e;
      }
      throw err;
    }
  }

  return { lookup };
}
