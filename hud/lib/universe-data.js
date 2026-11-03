// SPDX-License-Identifier: GPL-3.0-or-later
// The star map data in the shapes the page uses. Plain JavaScript without Node.js, so the
// demo website (demo/fake-server.js) can use it in the browser too; universe.js loads the data.

export const isKSpace = (regionId) => regionId < 11000000; // excludes wormholes (11xxxxxx), abyssal (12xxxxxx), void (14xxxxxx)

// Compact payload for the browser (/api/universe): k-space only, indexed arrays.
//   data: { source, builtAt, regions: [{ id, name }], systems: [{ id, name, x, z, sec, regionId, x2?, y2? }], jumps: [[id, id]] }
export function compactPayload(data) {
  const ks = data.systems.filter((s) => isKSpace(s.regionId));
  const idx = new Map(ks.map((s, i) => [s.id, i]));
  const regionIds = [...new Set(ks.map((s) => s.regionId))];
  const rIdx = new Map(regionIds.map((id, i) => [id, i]));
  const regionName = new Map(data.regions.map((r) => [r.id, r.name]));
  // Only offer the schematic layout when (nearly) every system has one.
  const with2D = ks.filter((s) => Number.isFinite(s.x2)).length;
  const has2D = ks.length > 0 && with2D / ks.length > 0.98;
  const r13 = (v) => Math.round(v / 1e13);
  return {
    source: data.source,
    builtAt: data.builtAt ?? null,
    has2D,
    regions: regionIds.map((id) => [id, regionName.get(id) || String(id)]),
    // [id, name, x, z, sec, regionIndex, x2, y2]
    //   x, z:   real 3D position seen from above (CCP: image x = X, image y = -Z)
    //   x2, y2: schematic 2D position of the in-game 2D map (image x = X, image y = -Y); falls back to 3D
    systems: ks.map((s) => {
      const row = [s.id, s.name, r13(s.x), r13(s.z), Math.round(s.sec * 1000) / 1000, rIdx.get(s.regionId)];
      if (has2D) row.push(...(Number.isFinite(s.x2) ? [r13(s.x2), r13(s.y2)] : [r13(s.x), r13(s.z)]));
      return row;
    }),
    jumps: data.jumps.filter(([a, b]) => idx.has(a) && idx.has(b)).map(([a, b]) => [idx.get(a), idx.get(b)]),
  };
}

// The k-space system names the chat module recognises (/api/linknames): [[id, name], …]
export function linkSystems(data) {
  return (data?.systems || []).filter((s) => isKSpace(s.regionId)).map((s) => [s.id, s.name]);
}
