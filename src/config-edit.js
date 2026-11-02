// SPDX-License-Identifier: GPL-3.0-or-later
// Saves the window mode chosen in the tray (or with F11) to "window": { "mode": … } in config.json.
//
// config.json is hand-edited and holds the client secret, so this is a small in-place text edit
// that keeps your formatting and every other key. Only when the file's layout is too unusual for
// that does it fall back to rewriting the whole file (same keys and values, standard formatting).
// The result is always checked with JSON.parse before it is written.

import fs from 'node:fs';

export function setWindowMode(file, mode) {
  if (mode !== 'normal' && mode !== 'fullscreen') throw new Error(`Unknown window mode: ${mode}`);
  const text = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(text); // throws on a broken file: then we leave it alone
  if (parsed.window?.mode === mode) return false;

  const ok = (candidate) => {
    try {
      return JSON.parse(candidate).window?.mode === mode;
    } catch {
      return false;
    }
  };
  let next = null;

  // 1. "window": { …, "mode": "normal", … } -> replace just the value
  const modeRe = /("window"\s*:\s*\{[^{}]*?"mode"\s*:\s*)"[^"]*"/;
  if (modeRe.test(text)) next = text.replace(modeRe, `$1"${mode}"`);

  // 2. "window": { … } without "mode" -> add it as the first key
  if (!next || !ok(next)) {
    const objRe = /("window"\s*:\s*\{)(\s*)(\}?)/;
    const m = objRe.exec(text);
    if (m)
      next = text.replace(objRe, (all, open, space, close) =>
        close ? `${open} "mode": "${mode}" }` : `${open}${space}"mode": "${mode}",${space}`,
      );
  }

  // 3. no "window" key at all -> add one right after the opening brace
  if (!next || !ok(next)) {
    const brace = text.indexOf('{');
    const indent = /\n([ \t]+)"/.exec(text)?.[1] || '  ';
    next = `${text.slice(0, brace + 1)}\n${indent}"window": { "mode": "${mode}" },${text.slice(brace + 1)}`;
  }

  // 4. last resort (e.g. an empty {}): rewrite
  if (!next || !ok(next))
    next = `${JSON.stringify({ ...parsed, window: { ...(parsed.window || {}), mode } }, null, 2)}\n`;

  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, file);
  return true;
}
