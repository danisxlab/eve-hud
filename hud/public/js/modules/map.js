// SPDX-License-Identifier: GPL-3.0-or-later
// Particle star map of New Eden (k-space). Canvas 2D: a cached static layer (lanes, stars, labels)
// plus a per-frame overlay (dust, twinkles, location pulse, neighbourhood ring, hover).
import {
  h,
  fill,
  svg,
  fmt,
  secColor,
  displaySec,
  motionReduced,
  motionLimited,
  onFrame,
  kickFrames,
  hoverPop,
  FPS,
} from '../util.js';
import { store } from '../store.js';
import { ICONS } from '../glyphs.js';
import { secChip } from './character.js';
import {
  LY,
  NEIGHBOUR_JUMPS,
  regionHue,
  FACTION_GROUPS,
  groupOf,
  isFaction,
  COLOUR_MODES,
  HAZARDS,
  ROUTE_PREFS,
} from './map/constants.js';
import { hexToRgb, glowSprite } from './map/sprites.js';

export default {
  id: 'map',
  title: 'Star Map',
  glyph: ICONS.map,
  // Extra data the map needs beyond its own feeds: hazards only with the overlay on, sovereignty
  // only when colouring by faction (so those feeds don't poll while nobody looks at them).
  demand: (s) =>
    [s.map?.hazards ? 'map:hazards' : null, s.map?.colorBy === 'faction' ? 'map:faction' : null].filter(
      Boolean,
    ),
  mount(ctx) {
    // hover boxes in the HUD's style (util.js hoverPop), kept inside this module; above the element,
    // as most controls sit along the bottom
    const mapMod = () => ctx.body.closest('.mod');
    const hint = (el, text, opts = {}) => {
      if (text) hoverPop(el, () => text, { above: true, within: mapMod, ...opts });
      return el;
    };
    const mapSettings = () => ctx.settings().map; // this module's part of the saved settings
    const canvas = h('canvas', {
      'aria-label': 'Star map. Scroll to zoom, drag to pan, double-click to center on your location.',
    });
    const status = h('div', { class: 'status' }, 'Loading star map…');
    const tip = h('div', { class: 'tip' });
    const tl = h('div', { class: 'hud tl' });
    const scaleBar = h('div', { class: 'scale' }, h('i'), h('span'));
    const zoomTxt = h('span');
    const coordsTxt = h('span', { class: 'coords-bl' }); // your system's coordinates, after the zoom
    // Search (systems and regions, all local: the map already knows every name and position)
    const searchInput = h('input', {
      type: 'search',
      class: 'map-search-input',
      placeholder: 'Search system or region…',
      spellcheck: 'false',
      autocomplete: 'off',
      'aria-label': 'Search a system or region on the map',
    });
    const searchList = h('div', { class: 'map-search-list', role: 'listbox', hidden: true });
    // our own ✕: the browser's built-in one only shows while the box is focused (and not at all in Firefox)
    const searchClear = h(
      'button',
      {
        type: 'button',
        class: 'map-search-clear',
        'aria-label': 'Clear search',
        hidden: true,
        onmousedown: (e) => e.preventDefault(), // keep the focus where it is
      },
      '×',
    );
    const searchBox = h(
      'div',
      { class: 'map-search' },
      h('span', { class: 'map-search-icon', 'aria-hidden': 'true' }),
      searchInput,
      searchClear,
      searchList,
    );
    // the search box: opens like the notification box, from the module's left border
    hint(searchInput, 'Search a system or region (press / to jump here)', {
      mode: 'list',
      alignLeft: mapMod,
    });
    hint(searchClear, 'Clear search');
    // Route from your location to the searched system (shown while a system is searched)
    const routeBox = h('div', { class: 'map-route', hidden: true });
    const bl = h(
      'div',
      { class: 'hud bl' },
      routeBox,
      h('div', { class: 'bl-row' }, scaleBar, zoomTxt, coordsTxt),
      searchBox,
    );
    const legend = h('div', { class: 'legend' });
    // the buttons' names show in the HUD's own hover box (like the top bar's), not the browser's
    const btn = (glyph, title, fn) => {
      const b = h('button', { class: 'icon-btn', 'aria-label': title, onclick: fn });
      b.append(svg(glyph, 'g'));
      hoverPop(b, () => b.getAttribute('aria-label') || null, { within: mapMod });
      return b;
    };
    const lanesBtn = btn(ICONS.lanes, 'Toggle jump lanes', () => {
      mapSettings().lanes = !mapSettings().lanes;
      lanesBtn.classList.toggle('active', mapSettings().lanes);
      dirty = true;
      ctx.save();
    });
    // Security / Faction / Region: which one is on is always visible (it lights up)
    const modeSwitch = h(
      'div',
      { class: 'mode-switch', role: 'radiogroup', 'aria-label': 'Colour systems by' },
      ...COLOUR_MODES.map(([mode, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'data-mode': mode,
            'data-tip': `Colour systems by ${label.toLowerCase()}`,
            onclick: () => {
              mapSettings().colorBy = mode;
              ctx.save();
              dirty = true;
              renderLegend();
            },
          },
          label,
        ),
      ),
    );
    for (const b of modeSwitch.children) hint(b, b.dataset.tip);
    mapSettings().hazardTypes ||= Object.fromEntries(Object.keys(HAZARDS).map((k) => [k, true]));
    const hazardBtn = btn(ICONS.hazard, 'Show hazards: incursions, kills, sovereignty and FW fights', () => {
      mapSettings().hazards = !mapSettings().hazards;
      hazardBtn.classList.toggle('active', Boolean(mapSettings().hazards));
      ctx.save();
      buildHazards();
    });
    hazardBtn.classList.toggle('active', Boolean(mapSettings().hazards));
    // Layout: 'schematic' = the in-game 2D map (CCP/Fenris Creations position2D), 'geographic' = real 3D positions from above.
    const layoutBtn = btn(ICONS.layout, '', () => {
      if (!data?.has2D) return;
      mapSettings().layout = schematic() ? 'geographic' : 'schematic';
      mapSettings().view = null;
      ctx.save();
      applyLayout();
      view = null; // the next frame re-fits and centres on your location (or on the search result)
    });
    const tr = h(
      'div',
      { class: 'hud tr' },
      btn(ICONS.plus, 'Zoom in', () => zoomAt(W / 2, H / 2, 1.6, true)),
      btn(ICONS.minus, 'Zoom out', () => zoomAt(W / 2, H / 2, 1 / 1.6, true)),
      btn(ICONS.center, 'Center on my location', () => focusCurrent(true, 25)),
      lanesBtn,
      hazardBtn,
      layoutBtn,
    );
    lanesBtn.classList.toggle('active', mapSettings().lanes);
    const hazardLegend = h('div', { class: 'hz-legend', hidden: true });
    const br = h(
      'div',
      { class: 'hud br' },
      hazardLegend,
      h(
        'div',
        { class: 'legend-box' },
        legend,
        modeSwitch,
      ) /* switch last: it stays at the bottom in every mode */,
    );
    ctx.body.append(h('div', { class: 'map' }, canvas, tl, bl, tr, br, tip, status));

    // ---------------- hazards ----------------
    let hazardList = []; // [{ i, items: [{type,label,detail,level}] }] for enabled types, mapped to star indices
    let hazardByIndex = new Map();

    function buildHazards() {
      const on = Boolean(mapSettings().hazards);
      const f = store.feed('hazards');
      const sys = f?.data?.systems || {};
      hazardList = [];
      hazardByIndex = new Map();
      if (data) {
        for (const [id, items] of Object.entries(sys)) {
          const i = data.ids.get(Number(id));
          if (i === undefined) continue;
          const shown = items.filter((x) => mapSettings().hazardTypes[x.type] !== false && HAZARDS[x.type]);
          if (!shown.length) continue;
          shown.sort((a, b) => Object.keys(HAZARDS).indexOf(a.type) - Object.keys(HAZARDS).indexOf(b.type));
          hazardByIndex.set(i, shown);
          if (on) hazardList.push({ i, items: shown });
        }
      }
      renderHazardLegend(on, f);
      renderHud();
    }

    function renderHazardLegend(on, f) {
      hazardLegend.hidden = !on;
      if (!on) return;
      const counts = {};
      for (const items of Object.values(f?.data?.systems || {}))
        for (const t of new Set(items.map((x) => x.type))) counts[t] = (counts[t] || 0) + 1;
      hazardLegend.replaceChildren(
        h('div', { class: 'label' }, 'Hazards'),
        ...Object.entries(HAZARDS).map(([type, m]) => {
          const enabled = mapSettings().hazardTypes[type] !== false;
          return hint(
            h(
              'button',
              {
                class: `hz-row${enabled ? '' : ' off'}`,
                onclick: () => {
                  mapSettings().hazardTypes[type] = !enabled;
                  ctx.save();
                  buildHazards();
                },
              },
              h('i', { class: 'hz-dia', style: { borderColor: m.color } }),
              h('span', {}, m.label),
              h('b', {}, String(counts[type] || 0)),
            ),
            `${m.help}. Click to ${enabled ? 'hide' : 'show'}.`,
          );
        }),
        h(
          'div',
          { class: 'hz-foot' },
          !f
            ? 'Loading…'
            : f.error
              ? `Update failed: ${f.error.message}`
              : `Kills: ${f.data?.killThreshold ?? 3}+ in the last hour · updated ${Math.max(0, Math.round((Date.now() - f.updatedAt) / 60000))}m ago`,
        ),
      );
    }

    function drawHazards(now, still = false) {
      if (!hazardList.length) return;
      const zoom = view.s / fitScale;
      const base = Math.min(12, 5 + Math.log2(Math.max(1, zoom)) * 1.6);
      g.lineWidth = 1.2;
      for (const { i, items } of hazardList) {
        const [sx, sy] = toScreen(data.x[i], data.z[i]);
        if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
        items.forEach((hz, k) => {
          const color = HAZARDS[hz.type].color;
          const s = base + k * 4;
          const ph = (now / 1700 + (i % 13) * 0.077) % 1;
          // steady outline, breathing
          g.globalAlpha = still ? 0.9 : 0.55 + 0.35 * Math.sin(now / 500 + i);
          g.strokeStyle = color;
          diamond(sx, sy, s);
          if (still) return;
          // expanding pulse
          g.globalAlpha = (1 - ph) * 0.6 * (0.5 + 0.5 * (hz.level ?? 1));
          diamond(sx, sy, s * (1 + ph * 0.8));
        });
      }
      g.globalAlpha = 1;
    }
    function diamond(x, y, s) {
      g.beginPath();
      g.moveTo(x, y - s);
      g.lineTo(x + s, y);
      g.lineTo(x, y + s);
      g.lineTo(x - s, y);
      g.closePath();
      g.stroke();
    }
    ctx.setSub(h('span', {}, 'Scroll to zoom · drag to pan'));

    const g = canvas.getContext('2d');
    const layer = document.createElement('canvas');
    const lg = layer.getContext('2d');
    let W = 0,
      H = 0,
      dpr = 1;
    let data = null; // { sys: Float32Array x,z ; names ; sec ; region ; adj }
    let view = null; // { cx, cz, s }
    let fitScale = 0.01;
    let dirty = true;
    let current = -1;
    let chatJump = null; // { i, t }: the last jump the Local chat log told about
    let neighbours = { set: new Set(), radius: 0 };
    let hover = -1;
    let marked = -1; // a system shown from a chat link ("Show on map"); amber brackets until replaced
    let found = null; // search result on the map: { kind: 'system', i, t0 } or { kind: 'region', ri, t0 }
    let foundHull = null; // the region's outline in map coordinates (recomputed when the layout changes)
    // the route to a searched system: { to, from, pref, path: [star indices] | null, ids, jumps, source, loading, error, req }
    let route = null;
    let anim = null;
    let dust = [];
    let twinkles = [];

    function renderLegend() {
      const mode = mapSettings().colorBy || 'security';
      for (const b of modeSwitch.children) {
        const on = b.dataset.mode === mode;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
      legend.className = `legend ${mode}`;
      if (mode === 'faction') {
        const sov = store.feed('sovereignty');
        if (!sov?.data) {
          legend.replaceChildren(
            h(
              'span',
              {},
              sov?.error ? `Sovereignty unavailable: ${sov.error.message}` : 'Loading sovereignty…',
            ),
          );
          return;
        }
        const counts = factionInfo?.counts || {};
        legend.replaceChildren(
          ...FACTION_GROUPS.filter((g) => counts[g.key]).map((g) =>
            hint(
              h(
                'div',
                { class: 'fac-row' },
                h('i', { style: { background: g.color } }),
                h('span', {}, g.label),
                h('b', {}, fmt.int(counts[g.key])),
              ),
              g.key === 'alliance' ? 'Each alliance has its own shade; hover a star for its name' : null,
            ),
          ),
        );
        if (factionInfo?.occupied)
          legend.append(
            h(
              'div',
              { class: 'fac-note' },
              `${factionInfo.occupied} Faction Warfare system${factionInfo.occupied === 1 ? '' : 's'} shown in the occupier's colour`,
            ),
          );
      } else if (mode === 'region') {
        // the colours carry no meaning: show yours as an example, the tooltip names the others
        const ri = current >= 0 && data ? data.region[current] : null;
        fill(
          legend,
          ri !== null
            ? h('i', { class: 'rg-dot', style: { background: `hsl(${regionHue(ri)}, 55%, 62%)` } })
            : null,
          h(
            'span',
            {},
            ri !== null
              ? `${data.regions[ri]?.name} · every region has its own colour`
              : 'Every region has its own colour · hover a star for its name',
          ),
        );
      } else {
        legend.replaceChildren(
          h('span', { style: { marginRight: '6px' } }, '-1.0'),
          ...[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((s) =>
            h('i', { style: { background: secColor(s === 0 ? -0.1 : s) } }),
          ),
          h('span', { style: { marginLeft: '6px' } }, '1.0'),
        );
      }
    }

    // Faction colours per star, worked out once per sovereignty update (not on every redraw).
    let factionInfo = null; // { colors: string[], owner: number[], occupiedBy: Map, counts, occupied }
    function buildFactions() {
      const sov = store.feed('sovereignty')?.data;
      if (!data || !sov) {
        factionInfo = null;
        return;
      }
      const colors = new Array(data.n);
      const owner = new Array(data.n);
      const counts = {};
      let occupied = 0;
      for (let i = 0; i < data.n; i++) {
        const sid = data.sid[i];
        const fw = sov.fw?.[sid];
        const id = fw ? fw[1] : sov.owners?.[sid];
        if (fw) occupied++;
        owner[i] = id || 0;
        const g = groupOf(id);
        counts[g.key] = (counts[g.key] || 0) + 1;
        if (g.key === 'alliance') {
          // a shade per alliance (pink to violet), so neighbouring alliances can be told apart
          const n = (id * 2654435761) >>> 0;
          colors[i] = `hsla(${300 + (n % 45)}, ${45 + ((n >> 8) % 25)}%, ${56 + ((n >> 16) % 16)}%, ALPHA)`;
        } else {
          const [r, gg, b] = hexToRgb(g.color);
          colors[i] = `rgba(${r},${gg},${b},ALPHA)`;
        }
      }
      factionInfo = { colors, owner, counts, occupied };
    }

    // The tooltip line for faction mode: "Caldari State" / "Gallente space, occupied by Caldari State"
    function ownerLine(i) {
      const sov = store.feed('sovereignty')?.data;
      if (!sov) return null;
      const sid = data.sid[i];
      const fw = sov.fw?.[sid];
      const id = fw ? fw[1] : sov.owners?.[sid];
      const name = (x) => sov.names?.[x] || (isFaction(x) ? `Faction ${x}` : `Alliance ${x}`);
      const g = groupOf(id);
      const text = !id
        ? 'Unclaimed'
        : fw
          ? `${name(fw[0])} space · occupied by ${name(fw[1])}`
          : g.key === 'alliance'
            ? `${name(id)} (player alliance)`
            : name(id);
      return h(
        'div',
        { class: 'tip-sov' },
        h('i', { style: { background: factionInfo?.colors[i]?.replace('ALPHA', '1') || g.color } }),
        text,
      );
    }
    renderLegend();

    // ---- the tooltip line that matches the colour mode ----
    function modeLine(i) {
      const mode = mapSettings().colorBy || 'security';
      if (mode === 'faction') return ownerLine(i);
      if (mode === 'region') return regionLine(i);
      return securityLine(i);
    }

    // "Low-sec · true security 0.448": the map rounds like EVE does (0.45 shows as 0.5), this shows the real value
    function securityLine(i) {
      const sec = data.sec[i];
      const d = displaySec(sec);
      const cls = d >= 0.5 ? 'High-sec' : d > 0 ? 'Low-sec' : 'Null-sec';
      return h(
        'div',
        { class: 'tip-sov' },
        h('i', { style: { background: secColor(sec) } }),
        `${cls} · true security ${sec.toFixed(3)}`,
      );
    }

    // "Essence · 46 systems · borders Placid, Sinq Laison, Verge Vendor" (from the jump lanes, worked out once per region)
    const regionStats = new Map();
    function regionInfo(ri) {
      if (regionStats.has(ri)) return regionStats.get(ri);
      let count = 0;
      const borders = new Set();
      for (let k = 0; k < data.n; k++) {
        if (data.region[k] !== ri) continue;
        count++;
        for (const b of data.adj[k]) if (data.region[b] !== ri) borders.add(data.region[b]);
      }
      const names = [...borders]
        .map((r) => data.regions[r]?.name)
        .filter(Boolean)
        .sort();
      const info = { count, names };
      regionStats.set(ri, info);
      return info;
    }
    function regionLine(i) {
      const ri = data.region[i];
      const { count, names } = regionInfo(ri);
      const shown =
        names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', ');
      return h(
        'div',
        { class: 'tip-sov' },
        h('i', { style: { background: `hsl(${regionHue(ri)}, 55%, 62%)` } }),
        `${data.regions[ri]?.name || 'Region'} · ${count} systems${shown ? ` · borders ${shown}` : ' · no gate connections to other regions'}`,
      );
    }

    // ---------------- data ----------------
    async function load() {
      try {
        const res = await fetch('/api/universe');
        if (res.status === 503) {
          const st = await res.json();
          status.textContent = st.message || 'Star map is being prepared…';
          return false;
        }
        const u = await res.json();
        const n = u.systems.length;
        const has2D = Boolean(u.has2D);
        const x3 = new Float32Array(n),
          z3 = new Float32Array(n),
          sec = new Float32Array(n);
        const x2 = has2D ? new Float32Array(n) : x3,
          z2 = has2D ? new Float32Array(n) : z3;
        const region = new Uint16Array(n);
        const names = new Array(n);
        const ids = new Map();
        const sid = new Array(n);
        u.systems.forEach(([id, name, sx, sz, ss, ri, px, py], i) => {
          x3[i] = sx;
          z3[i] = sz;
          sec[i] = ss;
          region[i] = ri;
          names[i] = name;
          ids.set(id, i);
          sid[i] = id;
          if (has2D) {
            x2[i] = px;
            z2[i] = py;
          }
        });
        const adj = Array.from({ length: n }, () => []);
        for (const [a, b] of u.jumps) {
          adj[a].push(b);
          adj[b].push(a);
        }
        const byName = new Map(names.map((nm, i) => [nm.toLowerCase(), i]));
        data = {
          n,
          sec,
          region,
          names,
          ids,
          sid,
          byName,
          adj,
          jumps: u.jumps,
          regionList: u.regions,
          source: u.source,
          builtAt: u.builtAt,
          has2D,
          layouts: { schematic: [x2, z2], geographic: [x3, z3] },
        };
        applyLayout();
        status.textContent = '';
        dirty = true;
        regionStats.clear();
        buildHazards();
        buildFactions();
        renderLegend();
        return true;
      } catch (err) {
        status.textContent = `Star map failed to load: ${err.message}`;
        return false;
      }
    }

    const schematic = () => Boolean(data?.has2D) && mapSettings().layout !== 'geographic';

    // Points data.x / data.z at the chosen layout and recomputes everything derived from positions.
    function applyLayout() {
      if (!data) return;
      const [x, z] = data.layouts[schematic() ? 'schematic' : 'geographic'];
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (let i = 0; i < data.n; i++) {
        if (x[i] < minX) minX = x[i];
        if (x[i] > maxX) maxX = x[i];
        if (z[i] < minZ) minZ = z[i];
        if (z[i] > maxZ) maxZ = z[i];
      }
      const rsum = data.regionList.map(() => [0, 0, 0]);
      for (let i = 0; i < data.n; i++) {
        const r = rsum[data.region[i]];
        r[0] += x[i];
        r[1] += z[i];
        r[2]++;
      }
      Object.assign(data, {
        x,
        z,
        bounds: { minX, maxX, minZ, maxZ },
        regions: data.regionList.map(([id, name], i) => ({
          id,
          name,
          x: rsum[i][0] / (rsum[i][2] || 1),
          z: rsum[i][1] / (rsum[i][2] || 1),
          count: rsum[i][2],
        })),
      });
      const label = !data.has2D
        ? 'Map layout: real 3D positions (the 2D layout needs CCP/Fenris Creations static data)'
        : schematic()
          ? 'Map layout: in-game 2D map (click for real 3D positions)'
          : 'Map layout: real 3D positions (click for the in-game 2D map)';
      layoutBtn.setAttribute('aria-label', label);
      layoutBtn.classList.toggle('active', schematic());
      layoutBtn.setAttribute('aria-disabled', String(!data.has2D)); // dimmed, but its hover box still says why
      scaleBar.hidden = schematic(); // distances on the schematic map are not to scale
      const keep = current;
      current = -1;
      if (keep >= 0) setCurrent(keep);
      computeFit();
      foundHull = null;
      dirty = true;
    }

    function computeFit() {
      if (!data || !W) return;
      const b = data.bounds;
      fitScale = Math.min(W / (b.maxX - b.minX), H / (b.maxZ - b.minZ)) * 0.9;
    }

    function setCurrent(i) {
      if (i === current) return;
      const prev = current;
      current = i;
      neighbours = { set: new Set(), radius: 0 };
      if (i >= 0) {
        // breadth-first search: everything within N jumps defines the "area" ring
        const seen = new Map([[i, 0]]);
        const queue = [i];
        while (queue.length) {
          const a = queue.shift();
          const d = seen.get(a);
          if (d >= NEIGHBOUR_JUMPS) continue;
          for (const b of data.adj[a])
            if (!seen.has(b)) {
              seen.set(b, d + 1);
              queue.push(b);
            }
        }
        let r = 0;
        for (const k of seen.keys())
          r = Math.max(r, Math.hypot(data.x[k] - data.x[i], data.z[k] - data.z[i]));
        neighbours = { set: new Set(seen.keys()), radius: Math.max(r * 1.15, 4 * LY) };
      }
      dirty = true;
      renderHud();
      if (mapSettings().colorBy === 'region') renderLegend(); // the legend names your region
      // arrived (jumped yourself or by autopilot): close the route, clear the search and zoom in on
      // where you are now, at 25×
      if (route && i >= 0 && i === route.to) {
        resetSearch();
        focusCurrent(true, 25);
        return;
      }
      // jumped to a system outside the view (zoomed in too far to see it): centre on it, at the zoom
      // you have
      if (prev >= 0 && i >= 0 && view && !inView(i)) animateTo({ cx: data.x[i], cz: data.z[i], s: view.s });
      if (route && i >= 0 && route.from !== i) {
        // you jumped along the route: keep the rest of it, so it doesn't switch to another route of
        // the same length (ESI picks one of them each time; the game keeps the one it chose)
        const at = route.path && !route.loading && !route.error ? route.path.indexOf(i) : -1;
        if (at > 0) {
          Object.assign(route, {
            from: i,
            path: route.path.slice(at),
            ids: route.ids.slice(at),
            jumps: route.path.length - 1 - at,
          });
          dirty = true;
          renderRoute();
          followAutopilot();
        } else requestRoute(route.to); // off the route: a new one from here
      }
    }

    // No saved view yet (first start, or after switching the layout): show your own surroundings at
    // DEFAULT_ZOOM instead of the whole universe, as soon as your location is known. Ends with the
    // first view you choose yourself (scroll, drag, search…), which is then remembered.
    const DEFAULT_ZOOM = 29;
    let autoFocus = false;
    let loggedInAs = store.auth?.loggedIn ? store.auth.characterId : null; // see store.on('auth') below

    function applyPresence(focus = false) {
      if (!data) return;
      const p = store.feed('presence')?.data;
      if (!p?.system) {
        renderHud();
        return;
      }
      const i = data.ids.get(p.system.id);
      // just jumped: the Local channel said so at once, but ESI's location can still say where you
      // were for a few seconds; that stale answer would move you back (and re-route from there)
      const f = store.feed('presence');
      const stale = chatJump && i !== chatJump.i && (f?.updatedAt || 0) < chatJump.t + 8000;
      if (!stale) setCurrent(i ?? -1);
      if (focus && i !== undefined) {
        focusCurrent(false, DEFAULT_ZOOM);
        autoFocus = false;
      }
      renderHud();
    }

    function renderHud() {
      const p = store.feed('presence')?.data;
      if (!p?.system) {
        coordsTxt.textContent = '';
        fill(tl, h('div', { class: 'dim' }, 'Location unknown'));
        return;
      }
      const s = p.system;
      const coords = Number.isFinite(s.x)
        ? `X ${(s.x / 9.4607e15).toFixed(2)} ly   Y ${(s.y / 9.4607e15).toFixed(2)} ly   Z ${(s.z / 9.4607e15).toFixed(2)} ly`
        : '';
      coordsTxt.textContent = coords ? `· ${coords}` : '';
      fill(
        tl,
        h('div', { class: 'label' }, 'Current system'),
        h(
          'div',
          { class: 'sysname' },
          s.name,
          h('span', { class: 'sv', style: { color: secColor(s.sec) } }, displaySec(s.sec)?.toFixed(1) ?? ''),
        ),
        h(
          'div',
          { class: 'rg' },
          s.wormhole
            ? 'Wormhole space · not shown on the k-space map'
            : [
                s.regionName,
                current >= 0 ? `${neighbours.set.size - 1} systems within ${NEIGHBOUR_JUMPS} jumps` : '',
              ]
                .filter(Boolean)
                .join(' · '),
        ),
        trafficLine(s.id),
        hazardWarning(),
        autopilotLine(),
      );
    }

    // "Autopilot → Tiberis" under the current system while the game's autopilot flies
    function autopilotLine() {
      const ap = store.autopilot;
      if (!ap?.on) return null;
      return h(
        'div',
        { class: 'autopilot' },
        h('span', { class: 'label' }, 'Autopilot'),
        ap.next ? ` → ${ap.next}` : ' engaged',
      );
    }

    // Last-hour jumps and kills for a system (ESI aggregates these hourly for every system).
    function trafficOf(sysId) {
      const t = store.feed('traffic')?.data;
      if (!t) return null;
      const [ships, pods, npcs] = t.kills[sysId] || [0, 0, 0];
      return {
        jumps: t.jumps[sysId] || 0,
        ships,
        pods,
        npcs,
        busy: t.busyJumps && (t.jumps[sysId] || 0) > t.busyJumps,
      };
    }
    function trafficLine(sysId) {
      const tr = trafficOf(sysId);
      if (!tr) return h('div', { class: 'traffic faint' }, 'Last hour: loading activity…');
      const pvp = tr.ships + tr.pods;
      const killCls = pvp >= 3 ? 'bad' : pvp ? 'warn' : 'ok';
      // one line each, so the box (and its dark backdrop) stays narrow
      return h(
        'div',
        { class: 'traffic' },
        h('span', { class: 'label' }, 'Last hour'),
        h(
          'span',
          { class: tr.busy ? 'warn' : '' },
          `${fmt.int(tr.jumps)} jump${tr.jumps === 1 ? '' : 's'}${tr.busy ? ' · busy' : ''}`,
        ),
        h(
          'span',
          { class: killCls },
          pvp
            ? `${tr.ships} ship${tr.ships === 1 ? '' : 's'} · ${tr.pods} pod${tr.pods === 1 ? '' : 's'} killed`
            : 'no player kills',
        ),
        h('span', { class: 'faint' }, `${fmt.int(tr.npcs)} NPC kills`),
      );
    }

    // Warn about hazards in the current system or within NEIGHBOUR_JUMPS jumps.
    function hazardWarning() {
      if (!mapSettings().hazards || current < 0 || !hazardByIndex.size) return null;
      const here = hazardByIndex.get(current);
      const near = [...neighbours.set].filter((i) => i !== current && hazardByIndex.has(i));
      if (!here && !near.length)
        return h('div', { class: 'hz-warn ok' }, `No hazards within ${NEIGHBOUR_JUMPS} jumps`);
      const kinds = [
        ...new Set(
          [...(here || []), ...near.flatMap((i) => hazardByIndex.get(i))].map((x) => HAZARDS[x.type].label),
        ),
      ];
      return h(
        'div',
        { class: `hz-warn${here ? ' here' : ''}` },
        here
          ? `Hazard in this system: ${here.map((x) => x.label).join(', ')}`
          : `${near.length} hazard system${near.length > 1 ? 's' : ''} within ${NEIGHBOUR_JUMPS} jumps`,
        !here && kinds.length ? h('span', { class: 'faint' }, ` · ${kinds.join(', ')}`) : null,
        near.length
          ? h(
              'div',
              { class: 'faint' },
              near
                .slice(0, 6)
                .map((i) => data.names[i])
                .join(', ') + (near.length > 6 ? '…' : ''),
            )
          : null,
      );
    }

    // ---------------- view ----------------
    const toScreen = (x, z) => [W / 2 + (x - view.cx) * view.s, H / 2 - (z - view.cz) * view.s];
    const toWorld = (sx, sy) => [view.cx + (sx - W / 2) / view.s, view.cz - (sy - H / 2) / view.s];
    // is this system on screen, a little away from the edges?
    function inView(i, margin = 30) {
      const [sx, sy] = toScreen(data.x[i], data.z[i]);
      return sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin;
    }

    function clampScale(s) {
      return Math.min(Math.max(s, fitScale * 0.6), fitScale * 400);
    }

    function animateTo(target, ms = 650) {
      const from = { ...view };
      const t0 = performance.now();
      anim = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        // zoom interpolates in log space so it feels even
        view.s = Math.exp(Math.log(from.s) + (Math.log(target.s) - Math.log(from.s)) * e);
        view.cx = from.cx + (target.cx - from.cx) * e;
        view.cz = from.cz + (target.cz - from.cz) * e;
        dirty = true;
        if (k >= 1) {
          anim = null;
          persistView();
        }
      };
    }

    function zoomAt(sx, sy, factor, smooth = false) {
      if (!view) return;
      const [wx, wz] = toWorld(sx, sy);
      const s = clampScale(view.s * factor);
      const target = { s, cx: wx - (sx - W / 2) / s, cz: wz + (sy - H / 2) / s };
      if (smooth) animateTo(target, 300);
      else {
        Object.assign(view, target);
        dirty = true;
        persistView();
      }
    }

    // zoom: an exact zoom (× the whole-map fit); without it, close enough to see your area, and never
    // further out than you are now (double-click; the "Center on my location" button uses 25×)
    function focusCurrent(smooth, zoom = 0) {
      if (!data || current < 0) return;
      const s = zoom
        ? clampScale(fitScale * zoom)
        : clampScale(
            Math.max(view?.s || 0, Math.min(fitScale * 9, (Math.min(W, H) * 0.42) / neighbours.radius)),
          );
      const target = { cx: data.x[current], cz: data.z[current], s };
      if (smooth && view) animateTo(target);
      else {
        view = target;
        dirty = true;
        persistView();
      }
    }

    let persistTimer = null;
    function persistView() {
      autoFocus = false;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        mapSettings().view = { ...view };
        ctx.save();
      }, 800);
    }

    // ---------------- input ----------------
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
      },
      { passive: false },
    );

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !view) return;
      anim = null;
      drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        for (const p of dust) {
          p.x += (dx - (p.lx || 0)) * p.d * 0.25;
          p.y += (dy - (p.ly || 0)) * p.d * 0.25;
          p.lx = dx;
          p.ly = dy;
        }
        view.cx = drag.cx - dx / view.s;
        view.cz = drag.cz + dy / view.s;
        dirty = true;
        tip.style.display = 'none';
        return;
      }
      updateHover(mx, my);
    });
    const endDrag = (e) => {
      if (!drag) return;
      // a click (hardly moved) on another system: show the route to it, as when you search for it
      const click = e?.type === 'pointerup' && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4;
      if (click && hover >= 0 && hover !== current) {
        searchInput.value = data.names[hover];
        found = { kind: 'system', i: hover, t0: performance.now(), byClick: true };
        foundHull = null;
        updateClear();
        requestRoute(hover);
      }
      drag = null;
      for (const p of dust) {
        p.lx = 0;
        p.ly = 0;
      }
      canvas.classList.remove('grabbing');
      persistView();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', () => {
      hover = -1;
      tip.style.display = 'none';
    });
    canvas.addEventListener('dblclick', () => {
      marked = -1;
      focusCurrent(true);
    });

    function updateHover(mx, my) {
      if (!data || !view) return;
      let best = -1;
      let bd = 10 * 10;
      for (let i = 0; i < data.n; i++) {
        const sx = W / 2 + (data.x[i] - view.cx) * view.s;
        const sy = H / 2 - (data.z[i] - view.cz) * view.s;
        const d = (sx - mx) ** 2 + (sy - my) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      hover = best;
      if (best < 0) {
        tip.style.display = 'none';
        return;
      }
      const hz = mapSettings().hazards ? hazardByIndex.get(best) || [] : [];
      fill(
        tip,
        h(
          'div',
          {},
          secChip(data.names[best], data.sec[best]),
          h('span', { class: 'rg' }, data.regions[data.region[best]]?.name || ''),
        ),
        modeLine(best), // one line that matches the colour mode
        (() => {
          const tr = trafficOf(data.sid[best]);
          const pl = (n, w) => `${fmt.int(n)} ${w}${n === 1 ? '' : 's'}`;
          return tr
            ? h(
                'div',
                { class: 'tip-tr' },
                `Last hour: ${pl(tr.jumps, 'jump')} · ${pl(tr.ships, 'ship')} · ${pl(tr.pods, 'pod')} · ${pl(tr.npcs, 'NPC kill')}`,
              )
            : null;
        })(),
        ...hz.map((x) =>
          h(
            'div',
            { class: 'tip-hz' },
            h('i', { class: 'hz-dia', style: { borderColor: HAZARDS[x.type].color } }),
            h(
              'span',
              {},
              h('b', {}, x.label),
              x.detail ? h('span', { class: 'faint' }, ` · ${x.detail}`) : null,
            ),
          ),
        ),
      );
      tip.style.left = `${mx}px`;
      tip.style.top = `${my}px`;
      tip.style.display = 'block';
    }

    // ---------------- drawing ----------------
    function colorFor(i) {
      const mode = mapSettings().colorBy;
      if (mode === 'region') return `hsla(${regionHue(data.region[i])}, 55%, 62%, ALPHA)`;
      if (mode === 'faction') return factionInfo?.colors[i] || 'rgba(76,84,88,ALPHA)';
      const [r, gg, b] = hexToRgb(secColor(data.sec[i]));
      return `rgba(${r},${gg},${b},ALPHA)`;
    }

    function drawStatic() {
      lg.setTransform(dpr, 0, 0, dpr, 0, 0);
      lg.clearRect(0, 0, W, H);
      if (!data || !view) return;
      const zoom = view.s / fitScale;
      const pad = 40;
      const vis = (sx, sy) => sx > -pad && sy > -pad && sx < W + pad && sy < H + pad;

      // jump lanes: one path for intra-region, one for region-crossing gates
      if (mapSettings().lanes) {
        const alpha = Math.min(0.32, 0.07 + zoom * 0.012);
        const intra = new Path2D();
        const inter = new Path2D();
        for (const [a, b] of data.jumps) {
          const [ax, ay] = toScreen(data.x[a], data.z[a]);
          const [bx, by] = toScreen(data.x[b], data.z[b]);
          if (!vis(ax, ay) && !vis(bx, by)) continue;
          const p = data.region[a] === data.region[b] ? intra : inter;
          p.moveTo(ax, ay);
          p.lineTo(bx, by);
        }
        lg.lineWidth = zoom > 6 ? 0.9 : 0.6;
        lg.strokeStyle = `rgba(124,198,238,${alpha})`;
        lg.stroke(intra);
        lg.strokeStyle = `rgba(217,138,50,${alpha * 0.9})`;
        lg.stroke(inter);
      }

      // stars
      const r = Math.min(3.2, 0.9 + Math.log2(Math.max(1, zoom)) * 0.42);
      lg.globalCompositeOperation = 'lighter';
      const glowSize = r * 7;
      for (let i = 0; i < data.n; i++) {
        const [sx, sy] = toScreen(data.x[i], data.z[i]);
        if (!vis(sx, sy)) continue;
        const near = neighbours.set.has(i);
        const sprite = glowSprite(colorFor(i));
        const gs = near ? glowSize * 1.35 : glowSize;
        lg.globalAlpha = near || current < 0 ? 1 : 0.78;
        lg.drawImage(sprite, sx - gs / 2, sy - gs / 2, gs, gs);
      }
      lg.globalAlpha = 1;
      lg.globalCompositeOperation = 'source-over';
      for (let i = 0; i < data.n; i++) {
        const [sx, sy] = toScreen(data.x[i], data.z[i]);
        if (!vis(sx, sy)) continue;
        lg.fillStyle = colorFor(i).replace('ALPHA', '1');
        lg.fillRect(sx - r / 2, sy - r / 2, r, r);
      }

      // labels, skipping any that would collide with one already drawn
      const taken = [];
      const free = (x, y, w, hh) => {
        for (const t of taken)
          if (x < t[0] + t[2] && t[0] < x + w && y < t[1] + t[3] && t[1] < y + hh) return false;
        taken.push([x, y, w, hh]);
        return true;
      };
      if (current >= 0) {
        const [cx, cy] = toScreen(data.x[current], data.z[current]);
        taken.push([cx - 20, cy - 24, 140, 46]);
      }
      lg.textBaseline = 'middle';
      if (zoom < 7) {
        lg.font = '500 10px "Saira Semi Condensed", sans-serif';
        lg.textAlign = 'left';
        lg.fillStyle = `rgba(212,217,219,${zoom < 1.4 ? 0.42 : 0.3})`;
        for (const rg of [...data.regions].sort((a, b) => b.count - a.count)) {
          if (rg.count < 4) continue;
          const [sx, sy] = toScreen(rg.x, rg.z);
          if (!vis(sx, sy)) continue;
          const label = spaced(rg.name.toUpperCase());
          const w = lg.measureText(label).width;
          if (free(sx - w / 2, sy - 7, w, 14)) lg.fillText(label, sx - w / 2, sy);
        }
      }
      if (zoom > 4.5 && mapSettings().labels !== false) {
        lg.font = '400 10.5px "Saira Semi Condensed", sans-serif';
        lg.textAlign = 'left';
        let drawn = 0;
        // neighbours first so the local area always gets its names
        const order = [
          ...neighbours.set,
          ...Array.from({ length: data.n }, (_, i) => i).filter((i) => !neighbours.set.has(i)),
        ];
        for (const i of order) {
          if (drawn >= 450 || i === current) continue;
          const [sx, sy] = toScreen(data.x[i], data.z[i]);
          if (sx < 0 || sy < 0 || sx > W || sy > H) continue;
          const w = lg.measureText(data.names[i]).width;
          if (!free(sx + r + 3, sy - 7, w + 2, 14)) continue;
          lg.fillStyle = neighbours.set.has(i) ? 'rgba(212,217,219,0.85)' : 'rgba(142,151,155,0.6)';
          lg.fillText(data.names[i], sx + r + 4, sy);
          drawn++;
        }
      }
      updateScale();
      dirty = false;
    }

    const spaced = (s) => s.split('').join(' ');

    function initParticles() {
      dust = Array.from({ length: Math.round((W * H) / 9000) }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        d: 0.2 + Math.random() * 0.8,
        vx: (Math.random() - 0.5) * 0.06,
        vy: (Math.random() - 0.5) * 0.04,
        a: 0.08 + Math.random() * 0.22,
      }));
    }

    let lastT = performance.now();
    function frame(now) {
      const dt = Math.min(64, now - lastT);
      lastT = now;
      if (!view && data && W) {
        computeFit();
        const b = data.bounds;
        view =
          mapSettings().view && Number.isFinite(mapSettings().view.s)
            ? { ...mapSettings().view }
            : { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, s: fitScale };
        autoFocus = autoFocus || !mapSettings().view; // (a login while the map was loading counts too)
        applyPresence(autoFocus);
        if (found) focusFound(false); // after a layout switch, keep the search result in view
      }
      if (anim) anim(now);
      if (dirty) drawStatic();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      // drifting dust behind the stars
      const still = motionReduced();
      for (const p of dust) {
        if (!still) {
          p.x += p.vx * dt * p.d;
          p.y += p.vy * dt * p.d;
        }
        if (p.x < 0) p.x += W;
        if (p.x > W) p.x -= W;
        if (p.y < 0) p.y += H;
        if (p.y > H) p.y -= H;
        g.fillStyle = `rgba(160,200,215,${p.a})`;
        g.fillRect(p.x, p.y, p.d * 1.2, p.d * 1.2);
      }
      g.drawImage(layer, 0, 0, W, H);
      if (!data || !view) return;

      // twinkles: a few random stars flare briefly
      if (still) twinkles = [];
      else if (Math.random() < 0.25 && twinkles.length < 14)
        twinkles.push({ i: Math.floor(Math.random() * data.n), t: now });
      g.globalCompositeOperation = 'lighter';
      twinkles = twinkles.filter((tw) => {
        const k = (now - tw.t) / 1400;
        if (k > 1) return false;
        const [sx, sy] = toScreen(data.x[tw.i], data.z[tw.i]);
        const a = Math.sin(k * Math.PI);
        g.globalAlpha = a * 0.9;
        const s = 10 + a * 8;
        g.drawImage(glowSprite(colorFor(tw.i)), sx - s / 2, sy - s / 2, s, s);
        return true;
      });
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';

      drawHazards(still ? 0 : now, still);
      if (current >= 0) drawLocation(still ? 0 : now, still);
      if (hover >= 0) {
        const [sx, sy] = toScreen(data.x[hover], data.z[hover]);
        g.strokeStyle = 'rgba(212,217,219,0.8)';
        g.lineWidth = 1;
        g.strokeRect(sx - 5.5, sy - 5.5, 11, 11);
      }
      if (marked >= 0 && marked !== current) drawMarked();
      const apNext = autopilotNext();
      if (apNext >= 0 && apNext !== current && apNext !== marked)
        drawMarked(apNext, '143,230,196', 'Autopilot');
      if (route) drawRoute(still ? 0 : now, still);
      if (found) drawFound(still ? 0 : now, still);
    }

    // ---------------- search ----------------
    let results = [];
    let active = 0;

    // Systems and regions whose name matches; exact matches first, then "starts with", then "contains".
    function search(q) {
      q = q.trim().toLowerCase();
      if (!q || !data) return [];
      const rank = (name) => {
        const n = name.toLowerCase();
        return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : -1;
      };
      const out = [];
      data.regions.forEach((r, ri) => {
        const k = r.name ? rank(r.name) : -1;
        if (k >= 0 && r.count) out.push({ kind: 'region', ri, name: r.name, k: k - 0.5 }); // a region wins a tie
      });
      for (let i = 0; i < data.n; i++) {
        const k = rank(data.names[i]);
        if (k >= 0) out.push({ kind: 'system', i, name: data.names[i], k });
      }
      out.sort((a, b) => a.k - b.k || a.name.length - b.name.length || a.name.localeCompare(b.name));
      return out.slice(0, 60); // the list shows about 8 and scrolls for the rest
    }

    // a new list (typed, opened again) always starts at the top; the arrow keys don't come here
    function renderResults() {
      searchList.scrollTop = 0;
      searchList.hidden = !results.length && !searchInput.value.trim();
      if (!results.length) {
        fill(
          searchList,
          searchInput.value.trim()
            ? h('div', { class: 'ms-empty' }, 'No system or region with that name')
            : null,
        );
        return;
      }
      fill(
        searchList,
        results.map((r, n) =>
          h(
            'div',
            {
              class: `ms-row${n === active ? ' on' : ''}`,
              role: 'option',
              'aria-selected': String(n === active),
              onmousedown: (e) => {
                e.preventDefault();
                choose(r);
              }, // mousedown: before the input loses focus
              // only move the highlight: rebuilding the list under the mouse made Chromium send new
              // mouse events in a loop, and a click could land on a row that was just replaced
              onmouseenter: () => {
                if (active !== n) {
                  active = n;
                  markActive();
                }
              },
            },
            r.kind === 'system'
              ? [
                  h(
                    'i',
                    { class: 'ms-sec', style: { background: secColor(data.sec[r.i]) } },
                    displaySec(data.sec[r.i])?.toFixed(1),
                  ),
                  h('span', { class: 'ms-name' }, r.name),
                  h('span', { class: 'ms-sub' }, data.regions[data.region[r.i]]?.name || ''),
                ]
              : [
                  h('i', { class: 'ms-reg', style: { background: `hsl(${regionHue(r.ri)}, 55%, 62%)` } }),
                  h('span', { class: 'ms-name' }, r.name),
                  h('span', { class: 'ms-sub' }, `Region · ${data.regions[r.ri].count} systems`),
                ],
          ),
        ),
      );
      searchList.scrollTop = 0; // again now that it's shown and filled
    }

    function markActive() {
      [...searchList.children].forEach((el, n) => {
        el.classList.toggle('on', n === active);
        el.setAttribute('aria-selected', String(n === active));
      });
    }
    const showActive = () => searchList.children[active]?.scrollIntoView({ block: 'nearest' }); // arrow keys

    function choose(r) {
      searchInput.value = r.name;
      searchList.hidden = true;
      searchList.scrollTop = 0;
      searchInput.blur();
      found =
        r.kind === 'system'
          ? { kind: 'system', i: r.i, t0: performance.now() }
          : { kind: 'region', ri: r.ri, t0: performance.now() };
      foundHull = null;
      updateClear();
      focusFound(true);
      if (r.kind === 'system') requestRoute(r.i);
      else clearRoute();
    }

    // Zooms to the search result, using the positions of the current layout (in-game 2D or real 3D).
    function focusFound(smooth) {
      if (!found || !view) return;
      let target;
      if (found.kind === 'system') {
        target = { cx: data.x[found.i], cz: data.z[found.i], s: clampScale(Math.max(view.s, fitScale * 10)) };
      } else {
        // fit the whole region on screen
        let minX = Infinity,
          maxX = -Infinity,
          minZ = Infinity,
          maxZ = -Infinity;
        for (let k = 0; k < data.n; k++) {
          if (data.region[k] !== found.ri) continue;
          minX = Math.min(minX, data.x[k]);
          maxX = Math.max(maxX, data.x[k]);
          minZ = Math.min(minZ, data.z[k]);
          maxZ = Math.max(maxZ, data.z[k]);
        }
        target = {
          cx: (minX + maxX) / 2,
          cz: (minZ + maxZ) / 2,
          s: clampScale(Math.min(W / Math.max(1, maxX - minX), H / Math.max(1, maxZ - minZ)) * 0.7),
        };
      }
      if (smooth) animateTo(target);
      else {
        Object.assign(view, target);
        persistView();
      }
      dirty = true;
    }

    function clearFound() {
      found = null;
      foundHull = null;
      dirty = true;
      updateClear();
      clearRoute();
    }

    // ---------------- route ----------------
    // The server asks ESI's route planner (POST /route/{from}/{to}), the same one the game uses;
    // in demo mode it works the route out from the map's stargates.
    // ---------------- the game's autopilot (from the game log) ----------------
    // The log names only the next jump, not the destination. When the HUD's route goes another way
    // of the same length, it's worked out again through that next system.
    function autopilotNext() {
      const ap = store.autopilot;
      if (!ap?.on || !ap.next || !data) return -1;
      const name = String(ap.next).toLowerCase();
      // a neighbour of yours with that name first (in case two systems share a name)
      const near =
        current >= 0 ? data.adj[current].find((j) => data.names[j].toLowerCase() === name) : undefined;
      const i = near ?? data.byName.get(name);
      return i === undefined ? -1 : i;
    }
    function followAutopilot() {
      const next = autopilotNext();
      if (next < 0 || current < 0 || !route?.path || route.loading || route.error) return;
      const at = route.path.indexOf(current);
      if (at < 0 || route.path[at + 1] === next) return; // already the same way
      if (!data.adj[current]?.includes(next)) return; // not a neighbour (yet): wait for the jump
      requestRoute(route.to, { via: next });
    }

    // via: a neighbouring system the route has to start with (the next jump the game's autopilot
    // takes, from the game log), so the route on the map is the one the game flies
    async function requestRoute(to, { via = -1 } = {}) {
      const pref = mapSettings().routePref || 'shorter';
      const from = current;
      const req = {};
      const same = route?.to === to;
      route = {
        to,
        from,
        pref,
        path: same ? route.path : null,
        loading: true,
        error: null,
        req,
        set: same ? route.set : null,
        shown: same && route.shown,
      };
      renderRoute();
      if (from < 0) {
        Object.assign(route, { loading: false, error: 'Your location is unknown, so there is no route.' });
        renderRoute();
        return;
      }
      if (from === to) {
        Object.assign(route, { loading: false, path: [to], ids: [data.sid[to]], jumps: 0 });
        renderRoute();
        return;
      }
      try {
        const start = via >= 0 ? via : from;
        const body =
          start === to
            ? { route: [data.sid[to]], jumps: 0, source: route.source || 'esi' }
            : await fetch(`/api/route?from=${data.sid[start]}&to=${data.sid[to]}&pref=${pref}`).then(
                async (res) => {
                  const b = await res.json();
                  if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
                  return b;
                },
              );
        if (route?.req !== req) return; // a newer request replaced this one
        if (via >= 0) {
          // you, then the autopilot's next system, then the rest from there
          body.route = [data.sid[from], ...body.route];
          body.jumps += 1;
        }
        const path = body.route.map((id) => data.ids.get(id)).filter((i) => i !== undefined);
        const firstForThisSearch = !route.shown;
        Object.assign(route, {
          loading: false,
          path,
          ids: body.route,
          jumps: body.jumps,
          source: body.source,
          shown: true,
        });
        dirty = true;
        renderRoute(); // first, so the route box has its final size when the zoom measures it
        if (firstForThisSearch) fitRoute(path);
        followAutopilot();
        return;
      } catch (err) {
        if (route?.req !== req) return;
        Object.assign(route, { loading: false, error: err.message });
      }
      dirty = true;
      renderRoute();
    }

    // Zoom so the whole route is on screen, start and destination included, in the part of the map
    // that the boxes on top of it (current system, buttons, route box and search, legends) leave free.
    // In a small map module those boxes cover much of it, so fitting to the whole map hid parts of the route.
    function fitRoute(path) {
      if (!view || path.length < 2) return;
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const i of path) {
        minX = Math.min(minX, data.x[i]);
        maxX = Math.max(maxX, data.x[i]);
        minZ = Math.min(minZ, data.z[i]);
        maxZ = Math.max(maxZ, data.z[i]);
      }
      const rw = Math.max(1, maxX - minX);
      const rh = Math.max(1, maxZ - minZ);
      const free = freeArea(rw / rh);
      const s = clampScale(Math.min((free.x1 - free.x0) / rw, (free.y1 - free.y0) / rh) * 0.86);
      // put the route's middle in the middle of the free area (toScreen: x right, z up)
      const fx = (free.x0 + free.x1) / 2;
      const fy = (free.y0 + free.y1) / 2;
      animateTo({ cx: (minX + maxX) / 2 - (fx - W / 2) / s, cz: (minZ + maxZ) / 2 + (fy - H / 2) / s, s });
    }

    // The largest rectangle of the map not covered by its overlay boxes, best suited to a route of
    // the given width/height ratio. Candidate edges are the map's and the boxes' edges (a handful),
    // so trying every combination is cheap.
    function freeArea(ratio) {
      const c = canvas.getBoundingClientRect();
      const gap = 8;
      const boxes = [tl, tr, bl, br]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            x0: r.left - c.left - gap,
            y0: r.top - c.top - gap,
            x1: r.right - c.left + gap,
            y1: r.bottom - c.top + gap,
          };
        })
        .filter((b) => b.x1 - b.x0 > 2 * gap && b.y1 - b.y0 > 2 * gap);
      const edges = (lo, hi, key0, key1) =>
        [
          ...new Set(
            [lo, hi, ...boxes.flatMap((b) => [b[key0], b[key1]])].map((v) => Math.min(hi, Math.max(lo, v))),
          ),
        ].sort((a, b) => a - b);
      const xs = edges(0, W, 'x0', 'x1');
      const ys = edges(0, H, 'y0', 'y1');
      let best = { x0: 0, y0: 0, x1: W, y1: H };
      let bestScale = 0;
      for (const x0 of xs)
        for (const x1 of xs) {
          if (x1 - x0 < W * 0.25) continue;
          for (const y0 of ys)
            for (const y1 of ys) {
              if (y1 - y0 < H * 0.25) continue;
              if (boxes.some((b) => b.x0 < x1 && x0 < b.x1 && b.y0 < y1 && y0 < b.y1)) continue;
              const scale = Math.min((x1 - x0) / ratio, y1 - y0); // how big the route can be drawn here
              if (scale > bestScale) {
                bestScale = scale;
                best = { x0, y0, x1, y1 };
              }
            }
        }
      return best;
    }

    function clearRoute() {
      route = null;
      renderRoute();
    }

    async function setDestination() {
      if (!route?.path?.length) return;
      const to = data.sid[route.to];
      route.set = { state: 'busy' };
      renderRoute();
      try {
        const res = await fetch('/api/waypoint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (route?.to === data.ids.get(to)) route.set = { state: 'ok', demo: body.demo };
        ctx.toast(
          body.demo
            ? `Demo mode: would set ${data.names[data.ids.get(to)]} as destination`
            : `Destination set: ${data.names[data.ids.get(to)]}`,
        );
      } catch (err) {
        if (route) route.set = { state: 'error', message: err.message };
        ctx.toast(`Set destination failed: ${err.message}`);
      }
      renderRoute();
    }

    function renderRoute() {
      routeBox.hidden = !route;
      if (!route) {
        fill(routeBox);
        dirty = true;
        return;
      }
      const name = data.names[route.to];
      const prefSeg = h(
        'div',
        { class: 'seg' },
        ...ROUTE_PREFS.map(([k, label]) =>
          h(
            'button',
            {
              class: k === route.pref ? 'on' : '',
              type: 'button',
              onclick: () => {
                mapSettings().routePref = k;
                ctx.save();
                requestRoute(route.to);
              },
            },
            label,
          ),
        ),
      );
      let info;
      if (route.loading) info = h('div', { class: 'mr-info faint' }, 'Finding the route…');
      else if (route.error) info = h('div', { class: 'mr-info warn' }, route.error);
      else {
        const secs = route.path.map((i) => data.sec[i]);
        const low = Math.min(...secs.slice(1));
        const notHigh = secs.slice(1).filter((x) => displaySec(x) < 0.5).length;
        info = [
          h(
            'div',
            { class: 'mr-info' },
            h(
              'b',
              {},
              route.jumps === 0 ? 'You are here' : `${route.jumps} jump${route.jumps === 1 ? '' : 's'}`,
            ),
            route.jumps
              ? h(
                  'span',
                  { class: 'faint' },
                  ` · lowest ${displaySec(low)?.toFixed(1)}${notHigh ? ` · ${notHigh} below 0.5` : ' · all high-sec'}`,
                )
              : null,
            route.source === 'local'
              ? hint(
                  h('span', { class: 'faint' }, ' · estimate'),
                  "Worked out from the star map, not by the game's route planner",
                )
              : null,
          ),
          // one square per system, like the route bar in the game
          h(
            'div',
            { class: 'mr-squares' },
            route.path
              .slice(1, 61)
              .map((i) =>
                hint(
                  h('i', { style: { background: secColor(data.sec[i]) } }),
                  `${data.names[i]} ${displaySec(data.sec[i])?.toFixed(1)}`,
                ),
              ),
            route.path.length > 61 ? h('span', { class: 'faint' }, `+${route.path.length - 61}`) : null,
          ),
        ];
      }
      const set = route.set;
      const setBtn = h(
        'button',
        {
          type: 'button',
          class: `mr-set${set?.state === 'ok' ? ' done' : ''}`,
          disabled: !route.path?.length || route.jumps === 0 || set?.state === 'busy',
          onclick: setDestination,
        },
        set?.state === 'busy' ? 'Setting…' : set?.state === 'ok' ? 'Destination set' : 'Set destination',
      );
      hint(
        setBtn,
        'Set this system as your in-game autopilot destination (clears your other waypoints). EVE must be running and logged in.',
      );
      fill(
        routeBox,
        h(
          'div',
          { class: 'mr-head' },
          h('span', { class: 'label' }, 'Route to'),
          h('b', {}, name),
          h(
            'span',
            { class: 'mr-sv', style: { color: secColor(data.sec[route.to]) } },
            displaySec(data.sec[route.to])?.toFixed(1),
          ),
        ),
        info,
        h('div', { class: 'mr-actions' }, prefSeg),
        // bottom row: Set destination on the left, Cancel (closes the route and clears the search,
        // like the ✕ in the search box) in the bottom right corner
        h(
          'div',
          { class: 'mr-buttons' },
          setBtn,
          hint(
            h('button', { type: 'button', class: 'mr-cancel', onclick: cancelSearch }, 'Cancel'),
            'Close the route and clear the search',
          ),
        ),
        set?.state === 'error' ? h('div', { class: 'mr-info warn' }, set.message) : null,
      );
      dirty = true;
    }

    // The route on the map: segments in the security colour of the system they lead to.
    function drawRoute(now, still) {
      const path = route?.path;
      if (!path || path.length < 2) return;
      const pts = path.map((i) => toScreen(data.x[i], data.z[i]));
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      // dark halo first, so the route reads over busy areas
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.lineWidth = 5;
      g.beginPath();
      pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
      g.lineWidth = 2.2;
      for (let n = 1; n < pts.length; n++) {
        g.strokeStyle = secColor(data.sec[path[n]]);
        g.beginPath();
        g.moveTo(...pts[n - 1]);
        g.lineTo(...pts[n]);
        g.stroke();
      }
      // the next jump the game's autopilot takes (game log): a dotted border on both sides of that
      // part of the line, marching towards the next system (standing still with Animations: Off)
      const apNext = autopilotNext();
      const at = path.indexOf(current);
      if (apNext >= 0 && at >= 0 && path[at + 1] === apNext)
        drawAutopilotHop(pts[at], pts[at + 1], now, still);
      // a light pulse travelling along the route (still when animations are off): about 3.5 jumps a
      // second, but at least 1.8 s for the whole route (a 1-jump route used to flash past), easing
      // out towards the destination, then a short fade before it starts again
      if (!still) {
        const segs = pts.length - 1;
        const run = Math.max(1.8, segs / 3.5);
        const pause = 0.5;
        const phase = ((now / 1000) % (run + pause)) / run;
        const p = 1 - Math.pow(1 - Math.min(1, phase), 3); // ease out
        const fade = phase <= 1 ? 1 : Math.max(0, 1 - ((phase - 1) * run) / pause);
        const k = Math.min(segs - 1e-6, p * segs);
        const a = Math.floor(k);
        const t = k - a;
        const x = pts[a][0] + (pts[a + 1][0] - pts[a][0]) * t;
        const y = pts[a][1] + (pts[a + 1][1] - pts[a][1]) * t;
        g.fillStyle = `rgba(255,255,255,${(0.9 * fade).toFixed(3)})`;
        g.shadowColor = `rgba(255,255,255,${(0.9 * fade).toFixed(3)})`;
        g.shadowBlur = 8;
        g.beginPath();
        g.arc(x, y, 2, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
      }
      for (let n = 1; n < pts.length; n++) {
        g.fillStyle = secColor(data.sec[path[n]]);
        g.beginPath();
        g.arc(pts[n][0], pts[n][1], 2.6, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }

    function drawAutopilotHop([x1, y1], [x2, y2], now, still) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 12) return; // too short to see on this zoom
      // a unit vector across the line, for the two borders 4.5 px either side of it
      const nx = (-(y2 - y1) / len) * 4.5;
      const ny = ((x2 - x1) / len) * 4.5;
      g.save();
      g.lineCap = 'butt';
      g.setLineDash([3, 4]);
      g.lineDashOffset = still ? 0 : -((now / 45) % 7); // about 22 px a second towards the next system
      for (const side of [1, -1]) {
        g.strokeStyle = 'rgba(0,0,0,0.6)'; // a dark edge, so the dots read over bright stars
        g.lineWidth = 2.6;
        g.beginPath();
        g.moveTo(x1 + nx * side, y1 + ny * side);
        g.lineTo(x2 + nx * side, y2 + ny * side);
        g.stroke();
        g.strokeStyle = 'rgba(143,230,196,0.9)'; // --gal-hi, like the "Autopilot →" line
        g.lineWidth = 1.2;
        g.stroke();
      }
      g.restore();
    }

    function updateClear() {
      searchClear.hidden = !searchInput.value && !found;
    }

    function resetSearch() {
      searchInput.value = '';
      results = [];
      active = 0;
      searchList.scrollTop = 0;
      searchList.hidden = true;
      clearFound();
    }
    // Cancel (route box) and ✕ (search bar): picked on the map -> back to where you are, at 25×;
    // picked from the search -> the map stays where it is
    function cancelSearch() {
      const byClick = found?.byClick;
      resetSearch();
      if (byClick) focusCurrent(true, 25);
    }
    searchClear.addEventListener('click', cancelSearch);

    searchInput.addEventListener('input', () => {
      results = search(searchInput.value);
      active = 0;
      renderResults();
      if (!searchInput.value) clearFound(); // emptying the box removes the highlight
      updateClear();
    });
    searchInput.addEventListener('focus', () => {
      if (searchInput.value) {
        results = search(searchInput.value);
        active = 0;
        renderResults();
      }
    });
    searchInput.addEventListener('blur', () => {
      searchList.hidden = true;
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length)
          active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
        markActive();
        showActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!results.length) results = search(searchInput.value); // e.g. the list was closed
        const r = results[active] || results[0];
        if (r) choose(r);
      } else if (e.key === 'Escape') {
        resetSearch();
        searchInput.blur();
      }
    });
    // "/" anywhere (when not typing somewhere else) jumps to the search box
    const onSlash = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (!canvas.isConnected || !canvas.offsetParent) return; // map module hidden
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    };
    document.addEventListener('keydown', onSlash);

    // Convex outline around a region's systems (monotone chain), in map coordinates.
    function regionHull(ri) {
      const pts = [];
      for (let k = 0; k < data.n; k++) if (data.region[k] === ri) pts.push([data.x[k], data.z[k]]);
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (pts.length < 3) return pts;
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lower = [];
      for (const p of pts) {
        while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
        lower.push(p);
      }
      const upper = [];
      for (const p of [...pts].reverse()) {
        while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
        upper.push(p);
      }
      return [...lower.slice(0, -1), ...upper.slice(0, -1)];
    }

    function drawFound(now, still) {
      const age = (now - found.t0) / 1000;
      if (found.kind === 'system') {
        // a white dot that pulses softly (steady when animations are off)
        const [sx, sy] = toScreen(data.x[found.i], data.z[found.i]);
        const pulse = still ? 0.6 : 0.5 + 0.5 * Math.sin(now / 280);
        g.save();
        g.fillStyle = '#ffffff';
        g.shadowColor = 'rgba(255,255,255,0.95)';
        g.shadowBlur = 6 + pulse * 12;
        g.globalAlpha = 0.75 + pulse * 0.25;
        g.beginPath();
        g.arc(sx, sy, 2.6 + pulse * 1.4, 0, Math.PI * 2);
        g.fill();
        g.restore(); // no extra label: the map already names the system at this zoom
        return;
      }
      // region: a white, semi-transparent dotted line around it, a little outside its outer systems
      foundHull ||= regionHull(found.ri);
      const scr = foundHull.map(([x, z]) => toScreen(x, z));
      const cx = scr.reduce((a, p) => a + p[0], 0) / scr.length;
      const cy = scr.reduce((a, p) => a + p[1], 0) / scr.length;
      const pad = 16;
      g.save();
      g.strokeStyle = `rgba(255,255,255,${still || age > 2.5 ? 0.6 : 0.45 + 0.35 * Math.abs(Math.sin(age * Math.PI))})`;
      g.lineWidth = 1.5;
      g.setLineDash([2, 5]);
      g.lineCap = 'round';
      g.beginPath();
      if (scr.length < 3) {
        const r = Math.max(24, ...scr.map(([x, y]) => Math.hypot(x - cx, y - cy) + pad));
        g.arc(cx, cy, r, 0, Math.PI * 2);
      } else {
        scr.forEach(([x, y], n) => {
          const d = Math.hypot(x - cx, y - cy) || 1;
          const px = x + ((x - cx) / d) * pad,
            py = y + ((y - cy) / d) * pad;
          if (n === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        });
        g.closePath();
      }
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,0.035)';
      g.fill();
      g.restore();
    }

    // amber corner brackets + name, like a selected item in the game
    // corner brackets around a system: amber for a chat link's "Show on map", green for the
    // autopilot's next jump
    function drawMarked(i = marked, rgb = '240,169,82', note = '') {
      const [sx, sy] = toScreen(data.x[i], data.z[i]);
      const r = 9,
        k = 4;
      g.strokeStyle = `rgba(${rgb},0.95)`;
      g.lineWidth = 1.2;
      g.beginPath();
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const cx = sx + dx * r,
          cy = sy + dy * r;
        g.moveTo(cx, cy - dy * k);
        g.lineTo(cx, cy);
        g.lineTo(cx - dx * k, cy);
      }
      g.stroke();
      g.font = '500 12px "Saira Semi Condensed", sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillStyle = `rgb(${rgb})`;
      g.fillText(note ? `${note} → ${data.names[i]}` : data.names[i], sx + 14, sy - 12);
    }

    // "Show on map" from a chat link
    function showSystem(id) {
      const i = data?.ids.get(Number(id));
      if (i === undefined || !view) return false;
      marked = i;
      animateTo({ cx: data.x[i], cz: data.z[i], s: clampScale(Math.max(view.s, fitScale * 10)) });
      dirty = true;
      return true;
    }

    function drawLocation(now, still = false) {
      const [sx, sy] = toScreen(data.x[current], data.z[current]);
      // faint crosshair through the map
      g.strokeStyle = 'rgba(79,176,143,0.13)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, Math.round(sy) + 0.5);
      g.lineTo(sx - 18, Math.round(sy) + 0.5);
      g.moveTo(sx + 18, Math.round(sy) + 0.5);
      g.lineTo(W, Math.round(sy) + 0.5);
      g.moveTo(Math.round(sx) + 0.5, 0);
      g.lineTo(Math.round(sx) + 0.5, sy - 18);
      g.moveTo(Math.round(sx) + 0.5, sy + 18);
      g.lineTo(Math.round(sx) + 0.5, H);
      g.stroke();

      // the neighbourhood: a steady circle around everything within N jumps
      const R = neighbours.radius * view.s;
      const breathe = 0.6; // steady: the ring no longer pulses in opacity
      g.beginPath();
      g.arc(sx, sy, R, 0, Math.PI * 2);
      g.fillStyle = `rgba(79,176,143,${0.025 + breathe * 0.03})`;
      g.fill();
      g.strokeStyle = `rgba(143,230,196,${0.25 + breathe * 0.4})`;
      g.lineWidth = 1;
      g.shadowColor = 'rgba(79,176,143,0.8)';
      g.shadowBlur = 6 + breathe * 8;
      g.stroke();
      g.shadowBlur = 0;
      // rotating ticks on the ring
      const rot = now / 9000;
      g.strokeStyle = `rgba(143,230,196,${0.35 + breathe * 0.35})`;
      g.beginPath();
      for (let k = 0; k < 24; k++) {
        const a = rot + (k / 24) * Math.PI * 2;
        const len = k % 6 === 0 ? 7 : 3;
        g.moveTo(sx + Math.cos(a) * R, sy + Math.sin(a) * R);
        g.lineTo(sx + Math.cos(a) * (R + len), sy + Math.sin(a) * (R + len));
      }
      g.stroke();

      // sonar pulse from the current system
      for (let k = 0; k < (still ? 0 : 2); k++) {
        const ph = (now / 2800 + k * 0.5) % 1;
        g.beginPath();
        g.arc(sx, sy, 5 + ph * 34, 0, Math.PI * 2);
        g.strokeStyle = `rgba(143,230,196,${(1 - ph) * 0.75})`;
        g.lineWidth = 1.2;
        g.stroke();
      }
      // reticle brackets
      const b = 11;
      const c = 4;
      g.strokeStyle = '#8fe6c4';
      g.lineWidth = 1.2;
      g.beginPath();
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        g.moveTo(sx + dx * b, sy + dy * (b - c));
        g.lineTo(sx + dx * b, sy + dy * b);
        g.lineTo(sx + dx * (b - c), sy + dy * b);
      }
      g.stroke();
      g.fillStyle = '#ffffff';
      g.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      g.font = '500 12px "Saira Semi Condensed", sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillStyle = '#e8fff6';
      g.fillText(data.names[current], sx + 17, sy - 13);
    }

    function updateScale() {
      if (!view) return;
      const target = 110; // px
      const lyPerPx = 1 / (view.s * LY);
      const raw = target * lyPerPx;
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      const nice =
        [1, 2, 5, 10]
          .map((m) => m * pow)
          .reverse()
          .find((v) => v <= raw) || pow;
      scaleBar.firstChild.style.width = `${(nice / lyPerPx).toFixed(0)}px`;
      scaleBar.lastChild.textContent = `${nice >= 1 ? nice : nice.toFixed(2)} ly`;
      zoomTxt.textContent = `Zoom ${(view.s / fitScale).toFixed(1)}×`;
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      for (const c of [canvas, layer]) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      computeFit(); // the view keeps its absolute scale; only the zoom-out limit follows the panel size
      initParticles();
      dirty = true;
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // On the HUD's shared clock (25 frames a second, nothing while the window is hidden). With
    // animations off, only redraw when something changed (view, data, hover) or twice a second:
    // the clock then runs at 2 a second for the map, and at full speed only while you use it.
    let lastFrame = 0;
    let lastHover = -2;
    const loop = (t) => {
      if (!motionReduced() || dirty || anim || drag || hover !== lastHover || t - lastFrame > 500) {
        frame(t);
        lastFrame = t;
        lastHover = hover;
      }
    };
    const busy = () => dirty || Boolean(anim) || Boolean(drag) || hover !== lastHover;
    const stopLoop = onFrame(loop, {
      fps: () => (motionReduced() ? (busy() ? FPS : 2) : motionLimited() ? 10 : FPS),
    });
    // animations off: the map idles at 2 frames a second, so wake the clock when you touch it
    const wake = () => {
      if (motionReduced()) setTimeout(kickFrames, 0); // after the handlers that change the view
    };
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'click', 'keydown'])
      ctx.body.addEventListener(type, wake, { passive: true, capture: true });

    async function tryLoad() {
      if (!data) await load();
    }
    tryLoad();
    const legendTimer = setInterval(() => {
      if (mapSettings().hazards) renderHazardLegend(true, store.feed('hazards'));
    }, 60_000);
    const offs = [
      () => clearInterval(legendTimer),
      store.on('feed:hazards', buildHazards),
      store.on('feed:sovereignty', () => {
        buildFactions();
        if (mapSettings().colorBy === 'faction') dirty = true;
        renderLegend();
      }),
      store.on('feed:traffic', () => renderHud()),
      store.on('feed:presence', () => applyPresence(autoFocus)),
      // Logged in (another character, or the same one again): the next location from ESI centres
      // the map on where that character is, at the first-view zoom, instead of the remembered view.
      store.on('auth', (a) => {
        const id = a?.loggedIn ? a.characterId : null;
        if (id && id !== loggedInAs) {
          autoFocus = true;
          current = -1; // that character's system, not the previous one's
          dirty = true;
        }
        loggedInAs = id;
      }),
      store.on('map:show', ({ id }) => showSystem(id)),
      store.on('universe', (u) => {
        if (u.ready && data && u.builtAt && u.builtAt !== data.builtAt) {
          // the server rebuilt the map (new CCP/Fenris Creations build or added 2D layout): reload it
          data = null;
          view = null;
          current = -1;
          hover = -1;
          marked = -1;
          found = null;
          foundHull = null;
          tryLoad();
        } else if (u.ready) tryLoad();
        else if (!data) status.textContent = u.message;
      }),
      store.on('autopilot', () => {
        dirty = true;
        renderHud();
        followAutopilot();
      }),
      store.on('localSystem', ({ name, t }) => {
        const i = data?.byName.get(String(name).toLowerCase());
        if (i === undefined) return;
        chatJump = { i, t: t || Date.now() }; // the server's clock, like the feed's updatedAt
        setCurrent(i);
      }),
    ];
    const u = store.universe;
    if (u && !u.ready) status.textContent = u.message;
    store.mapShown = true; // lets the link window offer "Show on map"

    return {
      destroy() {
        store.mapShown = false;
        document.removeEventListener('keydown', onSlash);
        stopLoop();
        ro.disconnect();
        offs.forEach((f) => f());
      },
    };
  },
};
