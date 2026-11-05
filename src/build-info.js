// SPDX-License-Identifier: GPL-3.0-or-later
// The commit this app was built from, for About (v1.0.3_8f2c1d0). The installed app has it in its
// own package.json ("gitCommit", written by electron-builder.config.cjs when it builds); run from
// source, it is read from the repository's .git folder (no git program needed).

import fs from 'node:fs';
import path from 'node:path';

const SHA = /^[0-9a-f]{40}$/i;

export function readGitCommit(dir) {
  try {
    const git = path.join(dir, '.git');
    const head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
    if (SHA.test(head)) return head.slice(0, 7); // a detached HEAD
    const ref = head.match(/^ref:\s*(\S+)$/)?.[1];
    if (!ref) return null;
    const loose = path.join(git, ref);
    if (fs.existsSync(loose)) {
      const sha = fs.readFileSync(loose, 'utf8').trim();
      return SHA.test(sha) ? sha.slice(0, 7) : null;
    }
    // packed refs: "<sha> refs/heads/main" lines
    const packed = fs.readFileSync(path.join(git, 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
    const sha = line?.split(' ')[0];
    return SHA.test(sha || '') ? sha.slice(0, 7) : null;
  } catch {
    return null;
  }
}

export function buildCommit(appPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appPath, 'package.json'), 'utf8'));
    if (/^[0-9a-f]{7,40}$/i.test(pkg.gitCommit || '')) return pkg.gitCommit.slice(0, 7);
  } catch {
    /* no package.json there */
  }
  return readGitCommit(appPath);
}
