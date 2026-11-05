// SPDX-License-Identifier: GPL-3.0-or-later
// Release notes (GitHub's Markdown) as page elements, for the "Update Ready" window.
// Builds elements, never HTML from the text, so nothing in the notes can run or load anything:
// raw HTML shows as text, images become links, and only http(s) links are links (they open in
// your browser). The parts release notes use: headings, paragraphs (a line break stays one),
// lists (nested, numbered, [ ] / [x] tasks), quotes, code, tables, rules, **bold**, *italic*,
// ~~struck~~, `code`, [links](https://…) and bare https://… addresses.

import { h } from './util.js';

const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const width = (s) => s.replace(/\t/g, '    ').length;
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : null);
const link = (href, children) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children);

// ---------------- inline: **bold**, *italic*, `code`, [links](…), https://… ----------------
const INLINE = [
  ['code', /`([^`]+)`/],
  ['image', /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/],
  ['link', /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/],
  ['auto', /<(https?:\/\/[^>\s]+)>/],
  ['url', /https?:\/\/[^\s<]*[^\s<.,:;!?"')\]]/],
  ['strong', /\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__/],
  ['del', /~~(?=\S)([\s\S]+?)~~/],
  ['em', /\*(?=[^\s*])([^*]+?)\*|(?<![\w])_(?=[^\s_])([^_]+?)_(?![\w])/],
];

export function inline(text) {
  const out = [];
  let rest = String(text);
  while (rest) {
    let best = null;
    for (const [kind, re] of INLINE) {
      const m = re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { kind, m };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { kind, m } = best;
    if (m.index) out.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
    const inner = m[1] ?? m[2] ?? '';
    if (kind === 'code') out.push(h('code', {}, inner));
    else if (kind === 'image') {
      const href = safeUrl(m[2]);
      out.push(href ? link(href, inner || 'image') : inner); // shown as a link: the window loads nothing
    } else if (kind === 'link') {
      const href = safeUrl(m[2]);
      out.push(href ? link(href, inline(inner)) : inline(inner));
    } else if (kind === 'auto' || kind === 'url') out.push(link(m[1] ?? m[0], m[1] ?? m[0]));
    else out.push(h(kind, {}, inline(inner)));
  }
  return out;
}

// lines of one paragraph or list item: GitHub keeps a single line break in release notes
function lines(texts) {
  return texts.flatMap((t, i) => (i ? [h('br'), ...inline(t.trim())] : inline(t.trim())));
}

const startsBlock = (line) =>
  FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST.test(line);

// ---------------- blocks ----------------
function list(src, i, base) {
  const ordered = /\d/.test(src[i].match(LIST)[2]);
  const el = h(ordered ? 'ol' : 'ul');
  if (ordered) {
    const n = parseInt(src[i].match(LIST)[2], 10);
    if (n !== 1) el.start = n;
  }
  let li = null;
  let text = [];
  let box = null; // a task's ☐ / ☑, in front of its text
  const flush = () => {
    if (li && (text.length || box)) li.prepend(...(box ? [box, ' '] : []), ...lines(text));
    text = [];
    box = null;
  };
  while (i < src.length) {
    const line = src[i];
    if (!line.trim()) {
      // a blank line: the list goes on only if more of it follows
      const next = src.slice(i + 1).find((l) => l.trim());
      const m = next?.match(LIST);
      if (next && ((m && width(m[1]) >= base) || (!m && width(next.match(/^\s*/)[0]) > base))) {
        i++;
        continue;
      }
      break;
    }
    const m = line.match(LIST);
    const indent = width(line.match(/^\s*/)[0]);
    if (m && indent === base && /\d/.test(m[2]) === ordered) {
      flush();
      li = h('li');
      el.append(li);
      const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        li.classList.add('task');
        box = h('span', { class: 'box', 'aria-hidden': 'true' }, task[1] === ' ' ? '☐' : '☑');
        text.push(task[2]);
      } else text.push(m[3]);
      i++;
    } else if (m && indent > base && li) {
      flush();
      const [sub, next] = list(src, i, indent);
      li.append(sub);
      i = next;
    } else if (li && (indent > base || !startsBlock(line))) {
      text.push(line); // the item goes on on the next line
      i++;
    } else break;
  }
  flush();
  return [el, i];
}

function cells(row) {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

export function blocks(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const line = src[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(FENCE);
    if (fence) {
      const body = [];
      for (i++; i < src.length && !src[i].trim().startsWith(fence[1]); i++) body.push(src[i]);
      i++;
      out.push(h('pre', {}, h('code', {}, body.join('\n'))));
      continue;
    }
    const head = line.match(HEADING);
    if (head) {
      out.push(h(head[1].length <= 2 ? 'h3' : 'h4', {}, inline(head[2])));
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push(h('hr'));
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body = [];
      for (; i < src.length && QUOTE.test(src[i]); i++) body.push(src[i].replace(QUOTE, ''));
      out.push(h('blockquote', {}, blocks(body)));
      continue;
    }
    const item = line.match(LIST);
    if (item) {
      const [el, next] = list(src, i, width(item[1]));
      out.push(el);
      i = next;
      continue;
    }
    if (line.includes('|') && TABLE_SEP.test(src[i + 1] || '')) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < src.length && src[i].includes('|') && src[i].trim(); i++) rows.push(cells(src[i]));
      out.push(
        h(
          'div',
          { class: 'md-table' },
          h(
            'table',
            {},
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                head.map((c) => h('th', {}, inline(c))),
              ),
            ),
            h(
              'tbody',
              {},
              rows.map((r) =>
                h(
                  'tr',
                  {},
                  head.map((_, k) => h('td', {}, inline(r[k] ?? ''))),
                ),
              ),
            ),
          ),
        ),
      );
      continue;
    }
    const para = [];
    for (; i < src.length && src[i].trim() && (!para.length || !startsBlock(src[i])); i++) para.push(src[i]);
    out.push(h('p', {}, lines(para)));
  }
  return out;
}

export function markdown(text) {
  return h(
    'div',
    { class: 'md' },
    blocks(
      String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .split('\n'),
    ),
  );
}
