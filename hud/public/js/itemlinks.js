// SPDX-License-Identifier: GPL-3.0-or-later
// Recognises EVE item and system names in chat text.
// EVE's chat log files keep only the plain text of a link ("Medium Core Defense Field Extender II"),
// not the link itself, so the HUD matches names against CCP's item list instead:
//   - names of two or more words are matched anywhere (exact spelling and case),
//   - one-word names only when they stand on their own: the whole message, or set apart by the
//     double space EVE writes around a linked name. A casually typed "water" or "Jita" stays plain.
// The longest name wins, so "Exequror Navy Issue Intaki Syndicate SKIN" beats "Exequror Navy Issue".
import { store } from './store.js';

let index = null; // first word -> [{ name, href }] longest first
let version = null;
let loading = null;

const AFTER_OK = /[\s.,!?;:)\]"'»…]/;
const BEFORE_OK = /[\s(["'«]/;
const TRAIL = /[.,!?;:)\]"'»…]+$/;
const LEAD = /^[(["'«]+/;

function build({ items = [], systems = [] }) {
  const map = new Map();
  const add = (name, href) => {
    const first = name.split(' ', 1)[0];
    let list = map.get(first);
    if (!list) map.set(first, (list = []));
    if (!list.some((e) => e.name === name)) list.push({ name, href, multi: name.includes(' ') });
  };
  for (const [id, name] of items) add(name, `showinfo:${id}`);
  for (const [id, name] of systems) add(name, `showinfo:5//${id}`); // items first: they win a tie
  for (const list of map.values()) list.sort((a, b) => b.name.length - a.name.length);
  return map;
}

export function loadLinkNames() {
  if (loading) return loading;
  loading = fetch('/api/linknames', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d && d.version !== version) {
        version = d.version;
        index = build(d);
        store.emit('linknames', { items: d.items.length, systems: d.systems.length });
      }
    })
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
  return loading;
}

export const linkNamesReady = () => Boolean(index && index.size);

function standsAlone(text, start, end) {
  const before =
    start === 0 || text.slice(Math.max(0, start - 2), start) === '  ' || text[start - 1] === '\n';
  const after =
    end === text.length ||
    text.slice(end, end + 2) === '  ' ||
    text[end] === '\n' ||
    /^\s*$/.test(text.slice(end));
  return before && after;
}

// Plain text -> [{ text }, { text, href }, ...], or null when nothing was recognised.
export function annotate(text) {
  if (!index || !text) return null;
  const parts = [];
  let last = 0;
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    let start = m.index;
    if (start < last) continue;
    const tok = m[0];
    const lead = tok.match(LEAD)?.[0].length || 0;
    // try the token as written, then without leading brackets/quotes (names like 'Augmented' keep theirs)
    const tries = lead
      ? [
          [start, tok],
          [start + lead, tok.slice(lead)],
        ]
      : [[start, tok]];
    let hit = null;
    for (const [s, t] of tries) {
      const keys = [t, t.replace(TRAIL, '')];
      for (const key of keys) {
        const list = index.get(key);
        if (!list) continue;
        for (const e of list) {
          if (!text.startsWith(e.name, s)) continue;
          const end = s + e.name.length;
          if (end < text.length && !AFTER_OK.test(text[end])) continue;
          if (s > 0 && !BEFORE_OK.test(text[s - 1])) continue;
          if (!e.multi && !standsAlone(text, s, end)) continue;
          hit = { s, end, e };
          break;
        }
        if (hit) break;
      }
      if (hit) break;
    }
    if (!hit) continue;
    if (hit.s > last) parts.push({ text: text.slice(last, hit.s) });
    parts.push({ text: hit.e.name, href: hit.e.href });
    last = hit.end;
    re.lastIndex = hit.end;
  }
  if (!parts.length) return null;
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// Message -> parts: real links from the log (if EVE ever writes them) plus recognised names.
export function messageParts(m) {
  const base = m.parts || [{ text: m.text }];
  const out = [];
  let any = Boolean(m.parts);
  for (const p of base) {
    if (p.href) {
      out.push(p);
      continue;
    }
    const a = annotate(p.text);
    if (a) {
      any = true;
      out.push(...a);
    } else out.push(p);
  }
  return any ? out : null;
}
