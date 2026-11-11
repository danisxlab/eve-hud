// SPDX-License-Identifier: GPL-3.0-or-later
// SHA-256 checksums of this version's release files: npm run checksums
// Writes dist/SHA256SUMS.txt (one "<sha256>  <file name>" line per file, the format of sha256sum
// and shasum) for the installers of the version in package.json, and prints it. Attach the file to
// the GitHub release, so people can check their download (documentation, "Verify your download").
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const OUT = 'SHA256SUMS.txt';
const KINDS = ['.exe', '.dmg', '.zip', '.AppImage', '.deb'];

// the release files of this version: "EVE HUD Setup 1.1.0.exe", "eve-hud_1.1.0_amd64.deb", …
export function releaseFiles(names, ver) {
  const hasVersion = new RegExp(`(^|[ _-])${ver.replace(/[.+]/g, '\\$&')}([ ._-]|$)`);
  return names.filter((n) => KINDS.includes(path.extname(n)) && hasVersion.test(n)).sort();
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  const names = fs.existsSync(dist)
    ? fs.readdirSync(dist).filter((n) => fs.statSync(path.join(dist, n)).isFile())
    : [];
  const files = releaseFiles(names, version);
  if (!files.length) {
    console.error(`No release files of version ${version} in dist/. Build first (npm run dist:…).`);
    process.exitCode = 1;
    return;
  }
  const lines = [];
  for (const name of files) lines.push(`${await sha256(path.join(dist, name))}  ${name}`);
  fs.writeFileSync(path.join(dist, OUT), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  console.log(`\nSaved as dist/${OUT} (${files.length} files, version ${version}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
