// SPDX-License-Identifier: GPL-3.0-or-later
// EVE's HTML-like markup (https://developers.eveonline.com/docs/guides/eve-html/).
// Used for chat lines and for item descriptions from ESI.

// Only EVE's known tags are removed, so a typed "<3" or "a < b > c" survives. Link tags are removed
// and their visible text is kept. Only the four entities EVE decodes are decoded.
const EVE_TAG =
  /<\/?(?:b|i|u|uppercase|br\s*\/?|font|fontsize|color|letterspace|a|url|hint|localized|left|right|center|t|loc)(?:[\s=][^>]*)?>/gi;

export function cleanText(s, { keepBreaks = false } = {}) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, keepBreaks ? '\n' : ' ')
    .replace(EVE_TAG, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

// Both link spellings: <url=showinfo:5//30000142>Jita</url> and <a href="showinfo:5//30000142">Jita</a>.
const LINK_RE =
  /<url=([^>]*)>([\s\S]*?)<\/url>|<a\s+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))[^>]*>([\s\S]*?)<\/a>/gi;

// Splits a message into plain text plus, when it contains links, a list of parts:
//   { text }               plain text
//   { text, href }         a link (href exactly as EVE wrote it, e.g. "showinfo:2048//1000000")
// `text` is always the plain version, so search, blink and unread counts keep working on it.
export function parseMessage(raw) {
  const parts = [];
  let last = 0;
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(raw))) {
    if (m.index > last) parts.push({ text: cleanText(raw.slice(last, m.index)) });
    const href = (m[1] ?? m[3] ?? m[4] ?? m[5] ?? '').trim().replace(/^["']|["']$/g, '');
    const label = cleanText(m[2] ?? m[6] ?? '');
    parts.push(href ? { text: label, href } : { text: label });
    last = LINK_RE.lastIndex;
  }
  if (last < raw.length) parts.push({ text: cleanText(raw.slice(last)) });
  const text = parts
    .map((p) => p.text)
    .join('')
    .trim();
  const hasLink = parts.some((p) => p.href);
  if (!hasLink) return { text };
  // trim the outer edges the same way as `text`
  if (parts.length) {
    parts[0].text = parts[0].text.replace(/^\s+/, '');
    parts[parts.length - 1].text = parts[parts.length - 1].text.replace(/\s+$/, '');
  }
  return { text, parts: parts.filter((p) => p.text || p.href) };
}
