// SPDX-License-Identifier: GPL-3.0-or-later
// node --import ./test/fake-electron/register.js …  makes `import … from 'electron'` load the
// stand-in in electron.js instead of the real Electron (which can't run under plain Node).
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: ${JSON.stringify(new URL('./electron.js', import.meta.url).href)}, shortCircuit: true };
    return next(specifier, context);
  }
`),
);
