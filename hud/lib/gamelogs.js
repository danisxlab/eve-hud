// SPDX-License-Identifier: GPL-3.0-or-later
// Combat from EVE's game logs (ESI has no combat data). EVE writes every session's log to
// Documents/EVE/logs/Gamelogs, next to Chatlogs; lines like
//   [ 2026.11.02 19:01:12 ] (combat) <color=…><b>32</b> … to <b>Guristas Arrogator</b> - Hobgoblin I - Hits
// Any (combat) line (damage done or taken, misses, warp scrambles…) means you're in combat, except
// remote reps and capacitor transfers; when
// none came for `combatIdleSeconds` (default 15), the combat is over. Only new lines count: what's
// already in the file when the HUD starts (or switches files) is skipped.
//
// The folder follows Settings → Storage → EVE logs: Gamelogs next to the chosen Chatlogs folder (or
// inside it, when the chosen folder is the logs folder itself). Polled like the chat logs, so it
// works on a network share too.
import fs from 'node:fs';
import path from 'node:path';
import { candidateDirs, logsRootFor, newestCandidates, mtimeSync, mtimeAsync } from './chatlogs.js';

// every log line: [ 2026.11.02 19:01:12 ] (type) text
const LINE_RE = /^\[\s*(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})\s*\]\s*\((\w+)\)\s?(.*)$/;
// friendly (combat) lines: remote reps and capacitor transfers, given or received, aren't an attack
const FRIENDLY_RE = /\b(repaired|boosted|transferred)\b/i;

// Gamelogs for a chat log folder (or the logs folder itself): …/logs/Chatlogs -> …/logs/Gamelogs.
// No chat log folder at all: where the game logs would usually be, for the "can't read" message.
export function gamelogDirFor(chatDir) {
  const root = chatDir ? logsRootFor(chatDir) : path.dirname(candidateDirs()[0]);
  let sub = null;
  try {
    sub = fs.readdirSync(root).find((f) => f.toLowerCase() === 'gamelogs');
  } catch {
    /* below */
  }
  return path.join(root, sub || 'Gamelogs');
}

// EVE has written these both as UTF-8 and as UTF-16LE over the years
function decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe)
    return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf16le' };
  let zeros = 0;
  for (let i = 1; i < Math.min(buf.length, 400); i += 2) if (buf[i] === 0) zeros += 1;
  return zeros > 50
    ? { text: buf.toString('utf16le'), encoding: 'utf16le' }
    : { text: buf.toString('utf8'), encoding: 'utf8' };
}

// the quiet time that ends a combat (and so allows a new ATTACK alert): 5 to 300 s, 15 by default
export function idleSecondsOf(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(300, Math.max(5, n)) : 15;
}

// Why a folder can't be read, in words
function reason(err, dir = '') {
  if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR')
    return "The folder doesn't exist (or the network share isn't connected).";
  if (err?.code === 'EACCES' || err?.code === 'EPERM') {
    if (process.platform !== 'darwin') return 'No permission to read it.';
    // macOS asks once per app ("would like to access files on a network volume"); started with
    // npm start, the app is Electron, so it has to be allowed again for that one
    const what = dir.startsWith('/Volumes/') ? 'Network Volumes' : 'Documents Folder';
    return `macOS doesn't let EVE HUD read it yet: answer macOS's question with Allow, or turn on ${what} for EVE HUD (or "Electron", when started with npm start) under System Settings → Privacy & Security → Files and Folders.`;
  }
  return `It can't be read (${err?.code || err?.message || 'unknown error'}).`;
}

export function createGameLogs(
  config,
  {
    chatDir = '',
    getCharacterId = () => null,
    onCombat = () => {},
    onAutopilot = () => {},
    onHealth = () => {},
    log = console,
    now = () => Date.now(),
  } = {},
) {
  let dir = gamelogDirFor(chatDir);
  let file = null;
  let offset = 0;
  let encoding = 'utf8';
  let remainder = '';
  let lastHit = 0; // when the last (combat) line was read
  let active = false;
  let health = { ok: true, dir, error: null }; // can the game log folder be read? (the "EVE logs" window)
  let idleMs = idleSecondsOf(config.combatIdleSeconds) * 1000;

  // The newest game log: the folder is listed, and of the few files with the newest date in their
  // name (the logged-in character's first) the one written last is taken.
  const txt = (names) =>
    newestCandidates(
      names.filter((f) => f.endsWith('.txt')),
      getCharacterId(),
    );
  const newestOf = (stats, inDir) => {
    const f = stats.sort((x, y) => y.mtime - x.mtime)[0]?.f;
    return f ? path.join(inDir, f) : null;
  };
  function newestFile() {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      setHealth(false, reason(err, dir));
      return null;
    }
    setHealth(true, null);
    return newestOf(
      txt(names).map((f) => ({ f, mtime: mtimeSync(path.join(dir, f)) })),
      dir,
    );
  }
  async function newestFileAsync(inDir) {
    let names;
    try {
      names = await fs.promises.readdir(inDir);
    } catch (err) {
      if (inDir === dir) setHealth(false, reason(err, inDir));
      return null;
    }
    if (inDir === dir) setHealth(true, null);
    const stats = [];
    for (const f of txt(names)) stats.push({ f, mtime: await mtimeAsync(path.join(inDir, f)) });
    return newestOf(stats, inDir);
  }

  function setHealth(ok, error) {
    if (ok === health.ok && error === health.error && dir === health.dir) return;
    health = { ok, dir, error };
    log.info?.(
      `[combat] ${ok ? `Game logs readable: ${dir}` : `Can't read the game logs in ${dir}: ${error}`}`,
    );
    onHealth(health);
  }

  // The in-game autopilot, as far as the log tells: on or off, and the system it jumps to next.
  // ESI can't read the destination or the route the game planned; the log only names the next jump:
  //   (notify) Autopilot engaged / Autopilot disabled
  //   (notify) Autopilot warping to Tiberis      (the gate to Tiberis; at the end: a station's name)
  //   (notify) Autopilot jumping to Tiberis
  //   (None)   Jumping from Fortitude to Tiberis
  let autopilot = { on: false, next: null };
  function setAutopilot(next) {
    if (next.on === autopilot.on && next.next === autopilot.next) return;
    autopilot = next;
    onAutopilot({ ...autopilot, t: now() });
  }
  function readAutopilot(type, text) {
    let m;
    if (/^Autopilot engaged/i.test(text)) setAutopilot({ on: true, next: autopilot.next });
    else if (/^Autopilot (disabled|disengaged)/i.test(text)) setAutopilot({ on: false, next: null });
    else if ((m = text.match(/^Autopilot (?:warping|jumping) to (.+?)\.?$/i)))
      setAutopilot({ on: true, next: m[1] });
    else if ((m = text.match(/^Jumping from (.+) to (.+?)\.?$/i)) && autopilot.next === m[2])
      setAutopilot({ on: autopilot.on, next: null }); // arrived there; the next gate comes in the next line
  }

  function setActive(on) {
    if (on === active) return;
    active = on;
    log.info?.(`[combat] ${on ? 'in combat' : 'combat over'}`);
    onCombat({ active, t: now() });
  }

  // scan(): at once (the start, a new folder). scanAsync(): the look every 5 seconds, which doesn't
  // hold up the app while a big folder or a slow network share answers.
  function scan() {
    return useFile(newestFile());
  }
  let scanning = false;
  async function scanAsync() {
    if (scanning) return;
    scanning = true;
    const inDir = dir;
    try {
      const f = await newestFileAsync(inDir);
      if (inDir === dir) useFile(f); // (not when another folder was chosen meanwhile)
    } finally {
      scanning = false;
    }
  }
  function useFile(f) {
    if (!f || f === file) return health;
    file = f;
    remainder = '';
    if (autopilot.on || autopilot.next) setAutopilot({ on: false, next: null }); // a new game session
    try {
      offset = fs.statSync(f).size;
    } catch {
      offset = 0;
    } // only what EVE writes from now on
    try {
      const head = Buffer.alloc(Math.min(offset, 64));
      const fd = fs.openSync(f, 'r');
      fs.readSync(fd, head, 0, head.length, 0);
      fs.closeSync(fd);
      encoding = decode(head).encoding;
    } catch {
      encoding = 'utf8';
    }
    return health;
  }

  function poll() {
    if (file) {
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        file = null;
      }
      if (file && size < offset) offset = 0; // replaced
      if (file && size > offset) {
        const buf = Buffer.alloc(size - offset);
        try {
          const fd = fs.openSync(file, 'r');
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offset = size;
          take(buf);
        } catch {
          /* try again next time */
        }
      }
    }
    if (active && now() - lastHit > idleMs) setActive(false);
  }
  // The same for the look every second, without holding up the app while the disk (or a network
  // share) answers.
  let polling = false;
  async function pollAsync() {
    if (polling) return; // the last look is still waiting for the disk
    polling = true;
    try {
      const f = file;
      if (f) {
        let size = -1;
        try {
          size = (await fs.promises.stat(f)).size;
        } catch {
          /* gone: below */
        }
        if (file === f) {
          if (size < 0) file = null;
          else {
            if (size < offset) offset = 0; // replaced
            if (size > offset) {
              const from = offset;
              const buf = Buffer.alloc(size - from);
              let handle = null;
              try {
                handle = await fs.promises.open(f, 'r');
                await handle.read(buf, 0, buf.length, from);
                if (file === f && offset === from) {
                  offset = size;
                  take(buf);
                }
              } catch {
                /* try again next time */
              } finally {
                await handle?.close().catch(() => {});
              }
            }
          }
        }
      }
      if (active && now() - lastHit > idleMs) setActive(false);
    } finally {
      polling = false;
    }
  }
  // the bytes just read: combat lines and the autopilot's
  function take(buf) {
    const text = encoding === 'utf16le' ? buf.toString('utf16le') : buf.toString('utf8');
    const lines = (remainder + text).split(/\r?\n/);
    remainder = lines.pop() ?? '';
    for (const raw of lines) {
      const m = raw.replace(/^\uFEFF/, '').match(LINE_RE);
      if (!m) continue;
      const [, Y, M, D, h, mi, s, type, rest] = m;
      const t = Date.UTC(+Y, +M - 1, +D, +h, +mi, +s); // EVE time is UTC
      if (Math.abs(now() - t) > 120_000) continue; // an old line (a copied file, a wrong clock)
      const line = rest.replace(/<[^>]*>/g, '').trim();
      if (type === 'combat') {
        if (FRIENDLY_RE.test(line)) continue;
        lastHit = now();
        setActive(true);
      } else readAutopilot(type, line);
    }
  }

  function start() {
    scan();
    setInterval(() => pollAsync().catch(() => {}), Math.max(250, Number(config.chatPollMs) || 1000)).unref();
    setInterval(() => scanAsync().catch(() => {}), 5000).unref();
    if (dir) log.info?.(`[combat] Watching game logs in ${dir}`);
  }

  // the EVE logs folder changed (Settings → Storage)
  function setChatDir(next) {
    dir = gamelogDirFor(next);
    file = null;
    scan();
    if (active) setActive(false);
    return health;
  }

  // Settings → Combat
  function setIdleSeconds(n) {
    idleMs = idleSecondsOf(n) * 1000;
  }

  return {
    start,
    setChatDir,
    setIdleSeconds,
    status: () => ({ dir, file: file ? path.basename(file) : null, active, idleSeconds: idleMs / 1000 }),
    health: () => health,
    autopilot: () => autopilot,
    poll,
    scan,
    scanAsync,
    pollAsync,
  };
}
