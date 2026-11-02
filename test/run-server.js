// SPDX-License-Identifier: GPL-3.0-or-later
// Test helper: runs the HUD server on its own, without Electron (the app itself always starts it
// from src/main.js). node test/run-server.js [--demo] [--port=N]; config.json and data/ go to
// EVE_HUD_HOME, or a new temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EVE_HUD_HOME ||= fs.mkdtempSync(path.join(os.tmpdir(), 'eve-hud-server-'));
const args = process.argv.slice(2);
const { startServer } = await import('../hud/server.js');
await startServer({
  demo: args.includes('--demo'),
  port: args.find((a) => a.startsWith('--port='))?.slice('--port='.length),
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
