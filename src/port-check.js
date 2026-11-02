// SPDX-License-Identifier: GPL-3.0-or-later
// When the HUD's port is taken: is it another EVE HUD (a second copy, or an old node server.js) or something else?
// Asks http://127.0.0.1:<port>/api/state and looks for the HUD's answer shape.

export async function probeHud(port, { timeoutMs = 1500, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/api/state`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { isHud: false };
    const body = await res.json();
    if (body && typeof body === 'object' && body.auth && body.config && 'feeds' in body) {
      return { isHud: true, demo: Boolean(body.config.demo), character: body.auth.characterName || null };
    }
  } catch {
    /* not HTTP, not JSON, or no answer */
  }
  return { isHud: false };
}
