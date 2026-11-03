// SPDX-License-Identifier: GPL-3.0-or-later
// The website on GitHub Pages: the documentation and the demo (the HUD with sample data, in the
// browser, without the app). The GitHub Actions workflow .github/workflows/docs.yml runs this.
//
//   npm run site            builds it in _site/
//   npm run site:preview    builds it and serves it at http://localhost:8790/eve-hud/
//                           (the same address layout as https://danisxlab.github.io/eve-hud/)
//
// _site/ has the same folder layout as the repository, so the relative links in the pages work
// unchanged: documentation/, demo/, hud/public/ (the HUD page), hud/lib/ (only the files the demo
// imports), assets/icon.png, LICENSE, and index.html, which forwards to the documentation.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '.eve-hud-site'; // marks a folder this script made, so it may empty it again

export function buildSite(out) {
  out = path.resolve(ROOT, out);
  if (fs.existsSync(out)) {
    if (fs.readdirSync(out).length && !fs.existsSync(path.join(out, MARKER)))
      throw new Error(`${out} exists and wasn't made by this script; choose another folder`);
    fs.rmSync(out, { recursive: true, force: true });
  }
  const copy = (from, to = from) =>
    fs.cpSync(path.join(ROOT, from), path.join(out, to), {
      recursive: true,
      filter: (src) => path.basename(src) !== '.DS_Store',
    });

  copy('documentation');
  copy('hud/public');
  copy('assets/icon.png');
  copy('LICENSE');
  copy('demo');
  for (const file of moduleGraph('demo/fake-server.js')) if (file.startsWith('hud/')) copy(file);

  // demo/index.html: the HUD page, its files taken from ../hud/public/, with the demo server first
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  let page = fs.readFileSync(path.join(ROOT, 'hud/public/index.html'), 'utf8');
  const edits = [
    ['<html lang="en">', `<html lang="en" data-version="${version}">`],
    [/<title>[^<]*<\/title>/, '<title>EVE HUD demo</title>'],
    [
      '<meta name="viewport"',
      '<meta name="description" content="EVE HUD with sample data: try the live EVE Online HUD in your browser before you download it." />\n    <meta name="viewport"',
    ],
    ['href="/css/', 'href="../hud/public/css/'],
    [
      '<script type="module" src="/js/app.js"></script>',
      '<script type="module" src="fake-server.js"></script>\n    <script type="module" src="../hud/public/js/app.js"></script>',
    ],
  ];
  for (const [from, to] of edits) {
    const next = page.replace(from, to);
    if (next === page) throw new Error(`hud/public/index.html changed: can't find ${from} for the demo page`);
    page = next;
  }
  if (/(?:src|href)="\/(?!\/)/.test(page))
    throw new Error('demo/index.html still has a path from the server root');
  fs.writeFileSync(path.join(out, 'demo/index.html'), page);

  fs.writeFileSync(
    path.join(out, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>EVE HUD</title>\n' +
      '<meta http-equiv="refresh" content="0; url=documentation/">\n' +
      '<a href="documentation/">EVE HUD documentation</a>\n',
  );
  fs.writeFileSync(path.join(out, MARKER), '');
  return out;
}

// The files a module imports, and what those import (relative imports only), as repository paths.
function moduleGraph(start) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm))
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
  };
  visit(start);
  return [...seen];
}

// A small static server for checking the site before pushing it, under /eve-hud/ like GitHub Pages.
function preview(out, port = 8790) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
  };
  http
    .createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (!p.startsWith('/eve-hud/')) {
        res.writeHead(302, { Location: '/eve-hud/' });
        return res.end();
      }
      let file = path.join(out, path.normalize(p.slice('/eve-hud/'.length)).replace(/^(\.\.[/\\])+/, ''));
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!file.startsWith(out) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, '127.0.0.1', () => {
      console.log(`Documentation: http://localhost:${port}/eve-hud/documentation/`);
      console.log(`Demo:          http://localhost:${port}/eve-hud/demo/`);
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = buildSite(args.find((a) => !a.startsWith('--')) || '_site');
  console.log(`Website built in ${path.relative(ROOT, out) || '.'}`);
  if (args.includes('--preview')) preview(out);
}
