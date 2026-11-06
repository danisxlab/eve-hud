// SPDX-License-Identifier: GPL-3.0-or-later
// Snap-to-grid window manager: modules occupy whole cells, can be dragged by their header
// and resized from the left or right edge, the bottom edge or the bottom corners. Layout persists via settings.
import { h, svg, fill, hoverPop, hoverRow, motionFull, motionReduced } from './util.js';
import { store, saveSettings } from './store.js';

const overlaps = (a, b) => a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;

export function createGrid(root, registry, { toast }) {
  const mounted = new Map(); // id -> { def, el, api, body }
  let geom = { cw: 0, ch: 0, gap: 8 };
  let ghost = null;
  let bootIndex = 0;

  const S = () => store.settings;
  const placement = (id) => S().modules[id];

  function computeGeom() {
    const { cols, rows, gap } = S().grid;
    const W = root.clientWidth;
    const H = root.clientHeight;
    geom = { cols, rows, gap, cw: (W - gap * (cols - 1)) / cols, ch: (H - gap * (rows - 1)) / rows };
    return geom;
  }

  function rectFor(p) {
    const { cw, ch, gap } = geom;
    return {
      left: p.c * (cw + gap),
      top: p.r * (ch + gap),
      width: p.w * cw + (p.w - 1) * gap,
      height: p.h * ch + (p.h - 1) * gap,
    };
  }

  function apply(el, p) {
    const r = rectFor(p);
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }

  function fits(id, p) {
    const { cols, rows } = S().grid;
    if (p.c < 0 || p.r < 0 || p.w < 1 || p.h < 1 || p.c + p.w > cols || p.r + p.h > rows) return false;
    for (const [oid, op] of Object.entries(S().modules)) {
      if (oid === id || !op.visible || !registry[oid]) continue;
      if (overlaps(p, op)) return false;
    }
    return true;
  }

  function findFree(id, w, h) {
    const { cols, rows } = S().grid;
    for (const [tw, th] of [
      [w, h],
      [Math.min(w, 2), 1],
      [1, 1],
    ]) {
      for (let r = 0; r <= rows - th; r++) {
        for (let c = 0; c <= cols - tw; c++) {
          const p = { c, r, w: tw, h: th };
          if (fits(id, p)) return p;
        }
      }
    }
    return null;
  }

  // Keep every visible module inside the grid and non-overlapping (e.g. after changing cols/rows).
  function normalize() {
    const { cols, rows } = S().grid;
    const placed = [];
    for (const [id, p] of Object.entries(S().modules)) {
      if (!registry[id] || !p.visible) continue;
      p.w = Math.min(p.w, cols);
      p.h = Math.min(p.h, rows);
      p.c = Math.min(p.c, cols - p.w);
      p.r = Math.min(p.r, rows - p.h);
      if (placed.some((q) => overlaps(p, q))) {
        p.visible = false;
        const free = findFree(id, p.w, p.h);
        if (free) Object.assign(p, free, { visible: true });
      }
      if (p.visible) placed.push(p);
    }
  }

  function makeChrome(def) {
    const title = h('h2', {}, def.title);
    // the light (green / amber / red / grey) and the module's own short status text
    const light = h('span', { class: 'led mod-led', hidden: true });
    const subText = h('span', { class: 'sub-text' });
    const sub = h('div', { class: 'sub' }, subText, light); // the light last: the ESI status of the module
    const head = h('header', { class: 'mod-head' }, svg(def.glyph, 'glyph mod-glyph'), title, sub);
    const body = h('div', { class: 'mod-body' });
    const el = h(
      'section',
      { class: 'mod', 'data-id': def.id, 'aria-label': def.title },
      h('i', { class: 'tick tl' }),
      h('i', { class: 'tick tr' }),
      h('i', { class: 'tick bl' }),
      h('i', { class: 'tick br' }),
      head,
      body,
      h('div', { class: 'flash' }),
      h('div', { class: 'rz rz-e', 'data-rz': 'e' }),
      h('div', { class: 'rz rz-s', 'data-rz': 's' }),
      h('div', { class: 'rz rz-se', 'data-rz': 'se' }),
      h('div', { class: 'rz rz-w', 'data-rz': 'w' }),
      h('div', { class: 'rz rz-sw', 'data-rz': 'sw' }),
    );
    head.querySelector('.mod-glyph').style.cssText =
      'width:15px;height:15px;color:var(--gal);flex:none;display:grid';
    return { el, head, title, sub, subText, light, body };
  }

  function boot(el) {
    if (!S().appearance.boot) return;
    const delay = 90 + bootIndex++ * 150;
    el.style.animationDelay = `${delay}ms`;
    for (const c of el.querySelectorAll('.flash, .mod-head, .mod-body'))
      c.style.animationDelay = `${delay}ms`;
    el.classList.add('boot');
    setTimeout(() => {
      el.classList.remove('boot');
      el.style.animationDelay = '';
      for (const c of el.querySelectorAll('.flash, .mod-head, .mod-body')) c.style.animationDelay = '';
    }, delay + 900);
  }

  function mount(id) {
    const def = registry[id];
    const chrome = makeChrome(def);
    root.append(chrome.el);
    apply(chrome.el, placement(id));
    let lightState; // until the module sets one: green for an ESI module, none otherwise
    const ctx = {
      id,
      body: chrome.body,
      setTitle: (...nodes) => fill(chrome.title, ...nodes),
      setSub: (...nodes) => fill(chrome.subText, ...nodes),
      // the module's own meaning of its light: 'on' (green), 'warn' (amber), '' (grey); ESI trouble
      // (setHealth) overrides it with amber or red
      setLight: (state) => {
        lightState = state;
        const m = mounted.get(id);
        if (m?.chrome === chrome) {
          m.light = state;
          paintLight(id);
        }
      },
      settings: () => S(),
      save: saveSettings,
      toast,
      size: () => ({ w: chrome.body.clientWidth, h: chrome.body.clientHeight, cells: placement(id) }),
    };
    const api = def.mount(ctx) || {};
    mounted.set(id, { def, el: chrome.el, api, ctx, chrome, light: lightState });
    hoverPop(chrome.light, () => mounted.get(id)?.lightInfo || null, { alignRight: chrome.el }); // right side on the module's border
    paintLight(id);
    wireInteractions(id, chrome);
    boot(chrome.el);
  }

  function unmount(id) {
    const m = mounted.get(id);
    if (!m) return;
    m.api.destroy?.();
    m.el.remove();
    mounted.delete(id);
  }

  // animate: the grid itself changed (Settings → Columns, Rows, Gap). The content fades out, the
  // windows glide to their new size and place, and the content fades back in, already laid out
  // for the new size. With Animations: Limited only the fade, with Off neither.
  function layout({ animate = false } = {}) {
    const fade = animate && !motionReduced();
    const from = new Map();
    if (fade)
      for (const [id, m] of mounted) {
        const cs = getComputedStyle(m.el); // where it is now, also halfway through a glide
        from.set(id, { left: cs.left, top: cs.top, width: cs.width, height: cs.height });
      }
    computeGeom();
    for (const [id, m] of mounted) apply(m.el, placement(id));
    if (fade) for (const [id, m] of mounted) if (from.has(id)) resizeFx(m, from.get(id), motionFull());
    for (const m of mounted.values()) m.api.resize?.();
  }

  const GLIDE_MS = 300;
  function resizeFx(m, from, glide) {
    const s = m.el.style;
    const to = { left: s.left, top: s.top, width: s.width, height: s.height };
    if (!Object.keys(to).some((k) => Math.abs(parseFloat(from[k]) - parseFloat(to[k])) > 0.5)) return;
    const body = m.chrome.body;
    // a slider being dragged: carry on from where the last fade is, instead of flashing back in
    const op = m.fadeFx?.playState === 'running' ? Number(getComputedStyle(body).opacity) : 1;
    m.glideFx?.cancel();
    m.fadeFx?.cancel();
    const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
    if (glide) {
      m.glideFx = m.el.animate([from, to], { duration: GLIDE_MS, easing: ease });
      m.glideFx.onfinish = () => m.api.resize?.(); // measured again at its final size
    }
    // the content: out quickly, hidden while the window moves, then back in
    const d = glide ? GLIDE_MS + 220 : 360;
    const out = 90 / d;
    const back = glide ? GLIDE_MS / d : out;
    m.fadeFx = body.animate(
      [{ opacity: op }, { opacity: 0, offset: out }, { opacity: 0, offset: back }, { opacity: 1 }],
      { duration: d, easing: 'ease-out' },
    );
  }

  function sync({ animate = false } = {}) {
    normalize();
    for (const id of Object.keys(registry)) {
      const p = placement(id);
      if (p?.visible && !mounted.has(id)) mount(id);
      if ((!p || !p.visible) && mounted.has(id)) unmount(id);
    }
    layout({ animate });
  }

  // Returns true when done, 'replace' when the grid is full and the user now picks a module to replace.
  function setVisible(id, visible) {
    const p = (S().modules[id] ||= { c: 0, r: 0, w: 1, h: 1, visible: false });
    if (visible) {
      if (!fits(id, p)) {
        const free = findFree(id, p.w, p.h);
        if (!free) {
          startReplace(id);
          return 'replace';
        }
        Object.assign(p, free);
      }
      p.visible = true;
    } else {
      p.visible = false;
    }
    saveSettings();
    sync();
    return true;
  }

  // ---------------- replace (grid full) ----------------
  // Showing a module while no cell is free: a bar asks you to click the module it should replace.
  // The new module takes that module's cell and size; the replaced one is hidden but keeps its
  // settings, so ticking it again in Settings → Modules brings it back. Esc, Cancel or a click
  // outside the modules cancels.
  let replacing = null;
  function startReplace(id) {
    cancelReplace();
    const title = registry[id].title;
    const bar = h(
      'div',
      { class: 'replace-bar', role: 'status' },
      h('span', {}, 'No free space for ', h('b', {}, title), '. Click the module it should replace.'),
      h('button', { type: 'button', class: 'btn', onclick: () => cancelReplace(true) }, 'Cancel'),
    );
    document.body.append(bar);
    root.classList.add('replacing');
    for (const m of mounted.values()) {
      m.el.append(h('div', { class: 'replace-hit' }, h('span', {}, `Replace with ${title}`)));
    }
    const onKey = (e) => {
      if (e.key === 'Escape') cancelReplace(true);
    };
    // capture phase: modules (map panning, header dragging, buttons) never see these clicks
    const block = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e) => {
      block(e);
      const el = e.target.closest('.mod');
      if (el) replaceWith(id, el.dataset.id);
      else cancelReplace(true);
    };
    addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', block, true);
    root.addEventListener('click', onClick, true);
    replacing = {
      bar,
      off: () => {
        removeEventListener('keydown', onKey);
        root.removeEventListener('pointerdown', block, true);
        root.removeEventListener('click', onClick, true);
      },
    };
  }

  function cancelReplace(announce = false) {
    if (!replacing) return;
    replacing.off();
    replacing.bar.remove();
    replacing = null;
    root.classList.remove('replacing');
    for (const el of root.querySelectorAll('.replace-hit')) el.remove();
    if (announce) toast('Nothing replaced');
  }

  function replaceWith(id, oldId) {
    const old = placement(oldId);
    cancelReplace();
    if (!old || oldId === id) return;
    Object.assign(placement(id), { c: old.c, r: old.r, w: old.w, h: old.h, visible: true });
    old.visible = false;
    saveSettings();
    sync();
    toast(
      `${registry[id].title} replaced ${registry[oldId].title}. Tick ${registry[oldId].title} in Settings → Modules to bring it back.`,
    );
  }

  // ---------------- drag + resize ----------------
  function cellFromPx(x, y) {
    return { c: Math.round(x / (geom.cw + geom.gap)), r: Math.round(y / (geom.ch + geom.gap)) };
  }

  let ghost2 = null; // preview of where the other module goes during a swap
  function showGhost(p, ok, label) {
    if (!ghost) {
      ghost = h('div', { class: 'ghost' }, h('span'));
      root.append(ghost);
    }
    apply(ghost, p);
    ghost.classList.toggle('bad', !ok);
    ghost.firstChild.textContent = label || (ok ? `${p.w} × ${p.h}` : 'Occupied');
  }
  function showSwapGhost(p, label) {
    if (!p) {
      ghost2?.remove();
      ghost2 = null;
      return;
    }
    if (!ghost2) {
      ghost2 = h('div', { class: 'ghost swap' }, h('span'));
      root.append(ghost2);
    }
    apply(ghost2, p);
    ghost2.firstChild.textContent = label;
  }
  function hideGhost() {
    ghost?.remove();
    ghost = null;
    showSwapGhost(null);
  }

  const inBounds = (p) => {
    const { cols, rows } = S().grid;
    return p.c >= 0 && p.r >= 0 && p.c + p.w <= cols && p.r + p.h <= rows;
  };

  // Where can module `id` go if dropped at `target`? A free spot is a plain move. If the target covers
  // exactly one other module, that module takes the dragged module's old spot (a swap), provided it fits there.
  function planDrop(id, target, origin) {
    if (fits(id, target)) return { kind: 'move' };
    if (!inBounds(target)) return null;
    const hits = Object.entries(S().modules).filter(
      ([oid, op]) => oid !== id && op.visible && registry[oid] && overlaps(target, op),
    );
    if (hits.length !== 1) return null;
    const [otherId, op] = hits[0];
    const candidates = [
      { c: origin.c, r: origin.r, w: op.w, h: op.h }, // align top-left corners
      { c: origin.c + origin.w - op.w, r: origin.r + origin.h - op.h, w: op.w, h: op.h }, // align bottom-right
    ];
    for (const spot of candidates) {
      if (!inBounds(spot) || overlaps(spot, target)) continue;
      const clear = Object.entries(S().modules).every(
        ([oid, q]) => oid === id || oid === otherId || !q.visible || !registry[oid] || !overlaps(spot, q),
      );
      if (clear) return { kind: 'swap', otherId, spot };
    }
    return null;
  }

  function wireInteractions(id, { el, head }) {
    head.addEventListener('pointerdown', (e) => {
      if (S().locked || e.button !== 0 || e.target.closest('button, input, select, a, .tabs')) return;
      e.preventDefault();
      const p = { ...placement(id) };
      const start = rectFor(p);
      const ox = e.clientX;
      const oy = e.clientY;
      let target = p;
      let plan = null;
      let moved = false;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - ox;
        const dy = ev.clientY - oy;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        el.classList.add('dragging');
        root.classList.add('editing');
        el.style.left = `${start.left + dx}px`;
        el.style.top = `${start.top + dy}px`;
        const cell = cellFromPx(start.left + dx, start.top + dy);
        target = { ...p, c: cell.c, r: cell.r };
        plan = planDrop(id, target, p);
        if (plan?.kind === 'swap') {
          const other = registry[plan.otherId].title;
          showGhost(target, true, `Swap with ${other}`);
          showSwapGhost(plan.spot, `${other} moves here`);
        } else {
          showGhost(target, Boolean(plan), plan ? null : 'Occupied');
          showSwapGhost(null);
        }
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        root.classList.remove('editing');
        hideGhost();
        if (moved && plan) {
          Object.assign(placement(id), { c: target.c, r: target.r });
          if (plan.kind === 'swap') {
            Object.assign(placement(plan.otherId), { c: plan.spot.c, r: plan.spot.r });
            const other = mounted.get(plan.otherId);
            if (other) {
              apply(other.el, placement(plan.otherId));
              setTimeout(() => other.api.resize?.(), 200);
            }
          }
          saveSettings();
        }
        apply(el, placement(id));
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });

    for (const handle of el.querySelectorAll('.rz')) {
      handle.addEventListener('pointerdown', (e) => {
        if (S().locked || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const mode = handle.dataset.rz;
        const p = { ...placement(id) };
        const start = rectFor(p);
        const ox = e.clientX;
        const oy = e.clientY;
        let target = p;
        handle.setPointerCapture(e.pointerId);
        // Freeze the content at its current size while you drag: only the frame follows the mouse.
        // The content rearranges once, when you let go (with the blink), instead of reflowing
        // live like a web page.
        const body = mounted.get(id)?.chrome.body;
        if (body) {
          body.style.width = `${body.offsetWidth}px`;
          body.style.height = `${body.offsetHeight}px`;
          body.style.flex = 'none';
        }
        el.classList.add('resizing');
        root.classList.add('editing');
        const left = mode.includes('w'); // left edge or bottom-left corner: the right edge stays put
        const move = (ev) => {
          const dx = ev.clientX - ox;
          const minW = geom.cw * 0.6;
          const w =
            mode === 's'
              ? start.width
              : left
                ? Math.min(start.left + start.width, Math.max(minW, start.width - dx))
                : Math.max(minW, start.width + dx);
          const hh =
            mode === 'e' || mode === 'w'
              ? start.height
              : Math.max(geom.ch * 0.6, start.height + ev.clientY - oy);
          el.style.width = `${w}px`;
          el.style.height = `${hh}px`;
          if (left) {
            el.style.left = `${start.left + start.width - w}px`;
            if (body) {
              // the frozen content stays where it is on screen, cut off at the moving edge
              body.style.marginLeft = `${w - start.width}px`;
              body.style.clipPath = `inset(0 0 0 ${Math.max(0, start.width - w)}px)`;
            }
          }
          const cols = Math.max(1, Math.round((w + geom.gap) / (geom.cw + geom.gap)));
          target = {
            ...p,
            c: left ? p.c + p.w - cols : p.c,
            w: cols,
            h: Math.max(1, Math.round((hh + geom.gap) / (geom.ch + geom.gap))),
          };
          showGhost(target, fits(id, target));
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          el.classList.remove('resizing');
          root.classList.remove('editing');
          hideGhost();
          if (body) {
            body.style.width = '';
            body.style.height = '';
            body.style.flex = '';
            body.style.marginLeft = '';
            body.style.clipPath = '';
          } // let the content take the new size
          const ok = target.c >= 0 && fits(id, target);
          const resized = ok && (target.w !== p.w || target.h !== p.h);
          if (ok) {
            Object.assign(placement(id), { c: target.c, w: target.w, h: target.h });
            saveSettings();
          }
          apply(el, placement(id));
          setTimeout(() => mounted.get(id)?.api.resize?.(), 200);
          reflowBlink(id, resized);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
    }
  }

  new ResizeObserver(() => layout()).observe(root);

  function tick(now) {
    for (const m of mounted.values()) m.api.tick?.(now);
  }

  // After a resize: the content (dimmed while you drag) comes back with a quick double blink as it
  // settles into its new size, like a HUD redrawing a panel. Not with Animations: Off.
  function reflowBlink(id, changed) {
    const m = mounted.get(id);
    if (!m) return;
    const b = m.chrome.body;
    b.classList.remove('reflow');
    if (!changed || document.body.classList.contains('reduce-motion')) return;
    void b.offsetWidth; // restart the animation
    b.classList.add('reflow');
    clearTimeout(m.reflowTimer);
    m.reflowTimer = setTimeout(() => b.classList.remove('reflow'), 700);
  }

  // Update blink: the frame flashes twice like at boot, content stays visible.
  const lastPulse = new Map();
  function pulse(id) {
    const m = mounted.get(id);
    if (
      !m ||
      !S().appearance.updateBlink ||
      m.el.classList.contains('boot') ||
      document.body.classList.contains('reduce-motion')
    )
      return;
    const now = Date.now();
    if (now - (lastPulse.get(id) || 0) < 8000) return; // at most once per 8 s per module
    lastPulse.set(id, now);
    m.el.classList.remove('pulse');
    void m.el.offsetWidth; // restart the animation
    m.el.classList.add('pulse');
    clearTimeout(m.pulseTimer);
    m.pulseTimer = setTimeout(() => m.el.classList.remove('pulse'), 900);
  }

  // ESI health per module (from app.js): id -> { level: 'ok' | 'degraded' | 'recovering' | 'down',
  // problems: [{ route, status }] }, or null for a module that doesn't use ESI.
  let healthOf = () => null;
  function paintLight(id) {
    const m = mounted.get(id);
    if (!m?.chrome) return;
    const esiHealth = healthOf(id);
    const own = m.light;
    const el = m.chrome.light;
    el.hidden = !esiHealth && own === undefined;
    if (el.hidden) return;
    const bad = esiHealth && esiHealth.level !== 'ok';
    const state = esiHealth?.level === 'down' ? 'off' : bad ? 'warn' : (own ?? 'on');
    el.className = `led mod-led ${state}`;
    m.lightInfo = bad
      ? esiHealth.problems.map((x) =>
          hoverRow(x.status === 'down' ? 'bad' : 'warn', `ESI ${x.status}`, x.route),
        )
      : esiHealth
        ? [hoverRow('', 'ESI', 'every route this module uses is OK')]
        : null;
  }
  function setHealth(fn) {
    healthOf = fn;
    for (const id of mounted.keys()) paintLight(id);
  }

  return {
    sync,
    layout,
    setVisible,
    cancelReplace,
    tick,
    pulse,
    setHealth,
    remountAll() {
      for (const id of [...mounted.keys()]) unmount(id);
      bootIndex = 0;
      sync();
    },
  };
}
