// SPDX-License-Identifier: GPL-3.0-or-later
// Recognises EVE item and system names in chat text, where the messages are read (the server; the
// demo website's stand-in for it), so the page gets finished links and needs no name list of its own.
// EVE's chat log files keep only the plain text of a link ("Medium Core Defense Field Extender II"),
// not the link itself, so the HUD matches names against CCP/Fenris Creations's item list instead:
//   - names of two or more words are matched anywhere (exact spelling and case),
//   - one-word names only when they stand on their own: the whole message, or set apart by the
//     double space EVE writes around a linked name. A casually typed "water" or "Jita" stays plain.
// The longest name wins, so "Exequror Navy Issue Intaki Syndicate SKIN" beats "Exequror Navy Issue".
// No Node.js imports: the demo website loads this file in the browser.

const AFTER_OK = /[\s.,!?;:)\]"'»…]/;
const BEFORE_OK = /[\s(["'«]/;
const TRAIL = /[.,!?;:)\]"'»…]+$/;
const LEAD = /^[(["'«]+/;

// first word -> [{ name, id, sys, multi }] longest first (the names are the list's own strings)
function build(items = [], systems = []) {
  const map = new Map();
  const add = (id, name, sys) => {
    const first = name.split(' ', 1)[0];
    let list = map.get(first);
    if (!list) map.set(first, (list = []));
    if (!list.some((e) => e.name === name)) list.push({ name, id, sys, multi: name.includes(' ') });
  };
  for (const [id, name] of items) add(id, name, false);
  for (const [id, name] of systems) add(id, name, true); // items first: they win a tie
  for (const list of map.values()) if (list.length > 1) list.sort((a, b) => b.name.length - a.name.length);
  return map;
}
const hrefOf = (e) => (e.sys ? `showinfo:5//${e.id}` : `showinfo:${e.id}`);

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

export function createLinker() {
  let index = null;
  let version = null;
  const asRead = new WeakMap(); // message -> its parts as read from the log (null: plain text)

  // names: { version, items: [[id, name], …], systems: [[id, name], …] }. true when they changed.
  function setNames(names) {
    if (names.version === version) return false;
    version = names.version;
    index = names.items?.length || names.systems?.length ? build(names.items, names.systems) : null;
    return true;
  }

  // Plain text -> [{ text }, { text, href }, ...], or null when nothing was recognised.
  function annotate(text) {
    if (!index || !text) return null;
    const parts = [];
    let last = 0;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
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
      parts.push({ text: hit.e.name, href: hrefOf(hit.e) });
      last = hit.end;
      re.lastIndex = hit.end;
    }
    if (!parts.length) return null;
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts;
  }

  // Gives a chat message its parts: real links from the log (if EVE ever writes them) plus the
  // recognised names; no parts when it's plain text. Can be done again after the names changed.
  function link(msg) {
    if (!asRead.has(msg)) asRead.set(msg, msg.parts || null);
    const read = asRead.get(msg);
    const out = [];
    let any = Boolean(read);
    for (const p of read || [{ text: msg.text }]) {
      const a = p.href ? null : annotate(p.text);
      if (a) {
        any = true;
        out.push(...a);
      } else out.push(p);
    }
    if (any) msg.parts = out;
    else delete msg.parts;
    return msg;
  }

  return {
    setNames,
    annotate,
    link,
    get version() {
      return version;
    },
  };
}
