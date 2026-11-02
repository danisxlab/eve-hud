// SPDX-License-Identifier: GPL-3.0-or-later
// Connection check: npm run check
// Tests every host the HUD talks to, over IPv4 and IPv6 separately, plus Node's own fetch().
import dns from 'node:dns/promises';
import https from 'node:https';
import { netFetch } from '../hud/lib/net.js';

const HOSTS = [
  ['esi.evetech.net', '/status/'],
  ['login.eveonline.com', '/.well-known/oauth-authorization-server'],
  ['developers.eveonline.com', '/static-data/tranquility/latest.jsonl'],
  ['images.evetech.net', '/characters/1/portrait?size=64'],
];

function get(host, path, family) {
  return new Promise((resolve) => {
    const req = https.get(
      { host, path, family, timeout: 8000, headers: { 'User-Agent': 'eve-hud connection check' } },
      (res) => {
        res.resume();
        resolve(`HTTP ${res.statusCode}`);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve('timed out');
    });
    req.on('error', (e) => resolve(`${e.code || e.message}`));
  });
}

console.log(`Node ${process.version} on ${process.platform} ${process.arch}`);
console.log(
  `Proxy variables: ${['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].filter((k) => process.env[k]).join(', ') || 'none'}\n`,
);

for (const [host, path] of HOSTS) {
  let addrs = '';
  try {
    const all = await dns.lookup(host, { all: true });
    addrs = all.map((a) => `${a.address} (v${a.family})`).join(', ');
  } catch (e) {
    addrs = `DNS failed: ${e.code}`;
  }
  const [v4, v6] = await Promise.all([get(host, path, 4), get(host, path, 6)]);
  let viaFetch;
  try {
    const r = await netFetch(`https://${host}${path}`, { timeoutMs: 10_000 });
    viaFetch = `HTTP ${r.status}`;
  } catch (e) {
    viaFetch = e.message;
  }
  console.log(host);
  console.log(`  DNS:    ${addrs}`);
  console.log(`  IPv4:   ${v4}`);
  console.log(`  IPv6:   ${v6}`);
  console.log(`  fetch:  ${viaFetch}\n`);
}
console.log('Any HTTP status (even 404) means the host is reachable. Error codes mean it is not.');
