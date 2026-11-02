// SPDX-License-Identifier: GPL-3.0-or-later
// Tails EVE's chat log files (ESI has no chat API). EVE writes them as UTF-16LE text to
// Documents/EVE/logs/Chatlogs when "Log chat to file" is enabled in the client settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMessage } from './evehtml.js';

const LINE_RE = /^\[\s*(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})\s*\]\s(.+?)\s>\s(.*)$/;
const HISTORY_BYTES = 96 * 1024;
const MAX_BUFFER = 300;

export function candidateDirs() {
  const home = os.homedir();
  const list = [
    path.join(home, 'Documents', 'EVE', 'logs', 'Chatlogs'),
    path.join(home, 'OneDrive', 'Documents', 'EVE', 'logs', 'Chatlogs'),
    path.join(
      home,
      'Library',
      'Application Support',
      'EVE Online',
      'p_drive',
      'User',
      'My Documents',
      'EVE',
      'logs',
      'Chatlogs',
    ),
    path.join(
      home,
      '.local',
      'share',
      'Steam',
      'steamapps',
      'compatdata',
      '8500',
      'pfx',
      'drive_c',
      'users',
      'steamuser',
      'My Documents',
      'EVE',
      'logs',
      'Chatlogs',
    ),
    path.join(
      home,
      '.local',
      'share',
      'Steam',
      'steamapps',
      'compatdata',
      '8500',
      'pfx',
      'drive_c',
      'users',
      'steamuser',
      'Documents',
      'EVE',
      'logs',
      'Chatlogs',
    ),
  ];
  if (process.env.USERPROFILE)
    list.unshift(path.join(process.env.USERPROFILE, 'Documents', 'EVE', 'logs', 'Chatlogs'));
  return list;
}

// EVE's logs folder (…/EVE/logs, with Chatlogs, Gamelogs, Fleetlogs, Marketlogs…) for a folder
// chosen in the HUD: the logs folder itself, or one of its subfolders, means that logs folder.
const SUBFOLDERS = ['chatlogs', 'gamelogs', 'fleetlogs', 'marketlogs', 'notifications', 'sounds'];
export function logsRootFor(chosen) {
  if (!chosen) return '';
  const clean = chosen.replace(/[\\/]+$/, '') || chosen;
  return SUBFOLDERS.includes(path.basename(clean).toLowerCase()) ? path.dirname(clean) : clean;
}

// The Chatlogs folder in a logs folder (any capitalisation; Chatlogs when it isn't there)
export function chatDirFor(chosen) {
  const root = logsRootFor(chosen);
  if (!root) return '';
  let sub = null;
  try {
    sub = fs.readdirSync(root).find((f) => f.toLowerCase() === 'chatlogs');
  } catch {
    /* below */
  }
  return path.join(root, sub || 'Chatlogs');
}

// The logs folder set in config.json: "eveLogDir", or an older "chatLogDir" (a Chatlogs folder).
// '' = the usual place on this computer.
export function configuredLogsDir(config) {
  return logsRootFor(config.eveLogDir || config.chatLogDir || '');
}

function decode(buf, encoding) {
  return encoding === 'utf16le' ? buf.toString('utf16le') : buf.toString('utf8');
}

// The folder EVE writes its chat logs to on this computer, if one of the usual places exists.
export function autoDir() {
  return candidateDirs().find((d) => fs.existsSync(d)) || '';
}

// config.eveLogDir: EVE's logs folder somewhere else, e.g. a network share the game PC's logs are on
// (\\gamepc\EVE\logs, /Volumes/evelogs); the chat is read from its Chatlogs. Empty: the usual place.
// Read by polling (not file watching), which also works on network shares.
export function createChatLogs(
  config,
  {
    getCharacterId = () => null,
    onMessages = () => {},
    onStatus = () => {},
    onSystemChange = () => {},
    log = console,
  } = {},
) {
  let dir = configuredLogsDir(config) ? chatDirFor(configuredLogsDir(config)) : autoDir();
  const channels = new Map(); // id -> { cfg, file, offset, encoding, remainder, buffer, listener }

  for (const cfg of config.chatChannels) {
    channels.set(cfg.id, {
      cfg,
      file: null,
      offset: 0,
      encoding: 'utf16le',
      remainder: '',
      buffer: [],
      listener: null,
    });
  }

  function status() {
    return {
      dir,
      found: Boolean(dir && fs.existsSync(dir)),
      channels: [...channels.values()].map((c) => ({
        id: c.cfg.id,
        label: c.cfg.label,
        file: c.file ? path.basename(c.file) : null,
        listener: c.listener,
      })),
    };
  }

  function snapshot() {
    return Object.fromEntries([...channels.values()].map((c) => [c.cfg.id, c.buffer]));
  }

  function pickFile(prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return null;
    }
    const charId = getCharacterId();
    const matches = entries
      .filter((f) => f.startsWith(`${prefix}_`) && f.endsWith('.txt'))
      .map((f) => {
        const full = path.join(dir, f);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          /* ignore */
        }
        return { f, full, mtime };
      });
    if (!matches.length) return null;
    // Newer clients append the listener's character ID; prefer files for the logged-in character.
    const mine = charId ? matches.filter((m) => m.f.endsWith(`_${charId}.txt`)) : [];
    const pool = mine.length ? mine : matches;
    pool.sort((a, b) => b.mtime - a.mtime);
    return pool[0].full;
  }

  function parseLines(ch, text) {
    const all = (ch.remainder + text).split(/\r?\n/);
    ch.remainder = all.pop() ?? '';
    const out = [];
    for (const raw of all) {
      const line = raw.replace(/^﻿/, '');
      const header = line.match(/^\s*Listener:\s*(.+)$/);
      if (header) {
        ch.listener = header[1].trim();
        continue;
      }
      const m = line.match(LINE_RE);
      if (m) {
        const [, Y, M, D, h, mi, s, speaker, msg] = m;
        const { text, parts } = parseMessage(msg); // parts only when the line contains links
        const entry = {
          t: Date.UTC(+Y, +M - 1, +D, +h, +mi, +s),
          from: speaker.trim(),
          text,
          ...(parts ? { parts } : {}),
          system: speaker.trim() === 'EVE System',
          self: ch.listener ? speaker.trim() === ch.listener : false,
        };
        out.push(entry);
      } else if (
        out.length &&
        line.trim() &&
        !/^\s*-{5,}/.test(line) &&
        !/^\s*(Channel ID|Channel Name|Session started):/.test(line)
      ) {
        // multi-line message continuation
        const prev = out[out.length - 1];
        const more = parseMessage(line);
        if (prev.parts || more.parts)
          prev.parts = [
            ...(prev.parts || [{ text: prev.text }]),
            { text: '\n' },
            ...(more.parts || [{ text: more.text }]),
          ];
        prev.text += `\n${more.text}`;
      }
    }
    return out;
  }

  function readNew(ch, initial) {
    let stat;
    try {
      stat = fs.statSync(ch.file);
    } catch {
      return;
    }
    if (stat.size < ch.offset) ch.offset = 0; // truncated / replaced
    if (stat.size === ch.offset) return;
    let start = ch.offset;
    if (initial) {
      // detect encoding from BOM, then read the header + recent history
      const fd0 = fs.openSync(ch.file, 'r');
      const bom = Buffer.alloc(2);
      fs.readSync(fd0, bom, 0, 2, 0);
      fs.closeSync(fd0);
      ch.encoding = bom[0] === 0xff && bom[1] === 0xfe ? 'utf16le' : 'utf8';
      const headBytes = Math.min(stat.size, 2048);
      const head = Buffer.alloc(headBytes);
      const fdh = fs.openSync(ch.file, 'r');
      fs.readSync(fdh, head, 0, headBytes, 0);
      fs.closeSync(fdh);
      const lm = decode(head, ch.encoding).match(/Listener:\s*(.+)/);
      if (lm) ch.listener = lm[1].trim();
      start = Math.max(0, stat.size - HISTORY_BYTES);
      if (ch.encoding === 'utf16le' && start % 2) start += 1;
    }
    let len = stat.size - start;
    if (ch.encoding === 'utf16le' && len % 2) len -= 1; // wait for the second byte of a char
    if (len <= 0) return;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(ch.file, 'r');
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    ch.offset = start + len;
    let text = decode(buf, ch.encoding);
    if (initial && start > 0) text = text.slice(text.indexOf('\n') + 1); // drop partial first line
    const msgs = parseLines(ch, text);
    if (!msgs.length) return;
    if (!initial && ch.cfg.id === 'local') {
      for (const m of msgs) {
        const sc = m.system && m.text.match(/Channel changed to Local\s*:\s*(.+)$/i);
        if (sc) onSystemChange(sc[1].trim());
      }
    }
    ch.buffer.push(...msgs);
    if (ch.buffer.length > MAX_BUFFER) ch.buffer.splice(0, ch.buffer.length - MAX_BUFFER);
    onMessages(ch.cfg.id, msgs, initial);
  }

  function scan() {
    if (!dir) return;
    let changed = false;
    for (const ch of channels.values()) {
      const file = pickFile(ch.cfg.filePrefix);
      if (file && file !== ch.file) {
        ch.file = file;
        ch.offset = 0;
        ch.remainder = '';
        ch.buffer = [];
        changed = true;
        readNew(ch, true);
      }
    }
    if (changed) onStatus(status());
  }

  function poll() {
    for (const ch of channels.values()) if (ch.file) readNew(ch, false);
  }

  function start() {
    if (!dir)
      log.warn?.(
        '[chat] EVE chat log folder not found. Choose it in Settings → Storage (or set "eveLogDir" in config.json).',
      );
    else log.info?.(`[chat] Reading chat logs from ${dir}`);
    scan();
    onStatus(status());
    // keeps polling even without a folder: a network share may come online later
    setInterval(poll, Math.max(250, Number(config.chatPollMs) || 1000)).unref();
    setInterval(scan, 5000).unref();
  }

  // Settings → Storage → EVE chat logs: read from another folder from now on ('' = the usual place).
  // The channels start over from the new folder's files.
  function setDir(next) {
    dir = next || autoDir();
    log.info?.(`[chat] Reading chat logs from ${dir || '(no folder found)'}`);
    for (const ch of channels.values()) {
      Object.assign(ch, { file: null, offset: 0, remainder: '', buffer: [], listener: null });
      onMessages(ch.cfg.id, [], true); // empties the chat window until the new files are read
    }
    scan();
    onStatus(status());
  }

  return { start, status, snapshot, rescan: scan, setDir };
}
