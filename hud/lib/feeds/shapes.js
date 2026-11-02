// SPDX-License-Identifier: GPL-3.0-or-later
// Small helpers for the feeds: game tables, the debug dump, and readers for answers of unknown or
// changing shape (freelance jobs and campaigns are new in ESI).
import fs from 'node:fs';
import { dataPath, writeJson } from '../store.js';

export const RACES = { 1: 'Caldari', 2: 'Minmatar', 4: 'Amarr', 8: 'Gallente' };
export const ACTIVITIES = {
  1: 'Manufacturing',
  3: 'TE research',
  4: 'ME research',
  5: 'Copying',
  7: 'Reverse engineering',
  8: 'Invention',
  9: 'Reactions',
  11: 'Reactions',
};
export const DEBUG_DIR = dataPath('debug');

export function dumpDebug(name, value) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    writeJson(`${DEBUG_DIR}/${name}.json`, value);
  } catch {
    /* best effort */
  }
}

// ---------- helpers for unknown / new response shapes (freelance jobs, campaigns) ----------
export function firstArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') for (const val of Object.values(v)) if (Array.isArray(val)) return val;
  return [];
}
export function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const r = pick(val, keys);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}
// like pick(), but only accepts numbers (so a nested "progress" object is searched, not returned)
// Finds an ID by name in an object of unknown shape: `faction_id: 1`, `faction: 1`, or `faction: { id: 1 }`.
export function idNamed(obj, name, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return null;
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (key === `${name}_id` || key === name || key === `${name}id`) {
      if (Number.isInteger(v)) return v;
      if (v && typeof v === 'object') {
        const inner = v.id ?? v[`${name}_id`];
        if (Number.isInteger(inner)) return inner;
      }
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = idNamed(v, name, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function pickNum(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (typeof obj[k] === 'number') return obj[k];
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const r = pickNum(val, keys);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}
export function progressOf(o) {
  const cur = pickNum(o, [
    'progress_current',
    'current_progress',
    'current',
    'progress',
    'contributed',
    'contribution',
    'delivered',
    'amount',
  ]);
  const tgt = pickNum(o, [
    'progress_target',
    'target_progress',
    'target',
    'desired',
    'desired_progress',
    'required',
    'quantity',
    'goal',
  ]);
  if (cur !== undefined && tgt !== undefined && tgt > 0)
    return { current: cur, target: tgt, ratio: Math.min(1, cur / tgt) };
  if (cur !== undefined && cur >= 0 && cur <= 1 && tgt === undefined)
    return { current: cur, target: 1, ratio: cur };
  if (cur !== undefined) return { current: cur, target: null, ratio: null };
  return null;
}
export function dateOf(o, keys) {
  const v = pick(o, keys);
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

export const FACTIONS = {
  500001: 'Caldari State',
  500002: 'Minmatar Republic',
  500003: 'Amarr Empire',
  500004: 'Gallente Federation',
  500010: 'Guristas',
  500011: 'Angel Cartel',
  500012: 'Blood Raiders',
  500019: "Sansha's Nation",
  500020: 'Serpentis',
  500026: 'Triglavian Collective',
  500027: 'EDENCOM',
};
export const human = (s) => String(s || '').replace(/_/g, ' ');

// Collect solar system IDs anywhere inside an object of unknown shape (used for military campaign objectives).
export function systemIdsIn(obj, out = new Set(), depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (/solar_?system_?id|^system_id$/i.test(k)) {
      for (const id of [v].flat()) if (Number.isInteger(id) && id >= 30000000 && id < 33000000) out.add(id);
    } else if (/solar_?system_?ids|^system_ids$/i.test(k) && Array.isArray(v)) {
      for (const id of v) if (Number.isInteger(id)) out.add(id);
    } else if (typeof v === 'object') systemIdsIn(v, out, depth + 1);
  }
  return out;
}
